// Safety layer: value backup, restore from backup, undo all, restore point, restart, action log.
// Tweaks and fixes never call the adapter's write directly; they call set()/restore() here.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackupView, LogEntry } from '../../shared/types';
import { POWERSHELL_EXE, SHUTDOWN_EXE, refId, sameValue, type RegRef, type SettingRef, type SystemAdapter, type Value } from './adapter';

export interface BackupEntry {
  ref: SettingRef;
  /** Value before the app first changed it. null = it was absent. */
  original: Value | null;
  savedAt: string;
}

export type Safety = Awaited<ReturnType<typeof createSafety>>;
/** What a tweak may use: reads, backed-up writes, and restore-from-backup. */
export type TweakContext = Pick<Safety, 'read' | 'set' | 'restore'>;

const describeRef = (r: SettingRef) => {
  switch (r.kind) {
    case 'reg':
      return `${r.hive}\\${r.key}\\${r.name}`;
    case 'task':
      return `Task ${r.path}`;
    case 'service':
      return `Service ${r.name} start type`;
    case 'power':
      return `Power setting ${r.sub}/${r.setting} (${r.ac ? 'AC' : 'DC'}) on ${r.scheme} scheme`;
    case 'scheme':
      return `Power plan "${r.name}"`;
    case 'activeScheme':
      return 'Active power plan';
    case 'hibernate':
      return 'Hibernation';
    case 'trim':
      return 'NTFS DisableDeleteNotify (TRIM)';
    case 'tcpGlobal':
      return `TCP global setting ${r.name}`;
    case 'dns':
      return `DNS servers of adapter ${r.guid}`;
    case 'hosts':
      return 'hosts file';
    case 'netAdv':
      return `Network adapter "${r.adapter}" ${r.keyword}`;
    case 'regKey':
      return `Registry key ${r.hive}\\${r.key}`;
    case 'feature':
      return `Windows feature ${r.name}`;
    case 'configKey':
      return `${r.file}: ${r.section ? `[${r.section}] ` : ''}${r.name}`;
  }
};

/**
 * resume: load backup.json from disk (default). main passes false in dry-run: simulated changes die
 * with the app, so an old dry-run backup would list changes that no longer exist.
 */
export async function createSafety(adapter: SystemAdapter, dataDir: string, { resume = true, restorePointWindowMs }: { resume?: boolean; restorePointWindowMs?: number } = {}) {
  await mkdir(dataDir, { recursive: true });
  const backupFile = path.join(dataDir, 'backup.json');
  const logFile = path.join(dataDir, 'actions.jsonl');
  const mode = adapter.live ? 'live' : 'dry-run';

  let backup: Record<string, BackupEntry> = {};
  if (resume) try {
    type Legacy = Omit<BackupEntry, 'ref'> & RegRef; // Phase 1 entries were flat registry refs
    const raw: Record<string, BackupEntry | Legacy> = JSON.parse(await readFile(backupFile, 'utf8'));
    for (const [id, e] of Object.entries(raw)) {
      backup[id] = 'ref' in e ? e : { ref: { kind: 'reg', hive: e.hive, key: e.key, name: e.name }, original: e.original, savedAt: e.savedAt };
    }
  } catch (err) {
    // A missing file is a fresh start. A corrupt one must stop the app, or originals are lost.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Backup file unreadable: ${backupFile}: ${err}`);
  }

  async function persist() {
    await writeFile(`${backupFile}.tmp`, JSON.stringify(backup, null, 2));
    await rename(`${backupFile}.tmp`, backupFile);
  }

  async function log(action: string, target: string, ok: boolean, message?: string) {
    const line = JSON.stringify({ ts: new Date().toISOString(), mode, action, target, ok, message });
    await appendFile(logFile, line + '\n');
  }

  const read = (ref: SettingRef) => adapter.read(ref);

  /**
   * Write a setting (null = delete). The first time the app changes a setting its original is
   * saved to disk before the write. Writing the original back drops the backup entry.
   */
  async function set(ref: SettingRef, value: Value | null) {
    const id = refId(ref);
    const saved = backup[id];
    if (!saved) {
      const original = await adapter.read(ref);
      if (sameValue(original, value)) return; // nothing to change, nothing to back up
      backup[id] = { ref, original, savedAt: new Date().toISOString() };
      await persist();
    }
    await adapter.write(ref, value);
    if (saved && sameValue(saved.original, value)) {
      delete backup[id];
      await persist();
    }
  }

  /** Put a setting back to its backed-up original. false = the app never changed it. */
  async function restore(ref: SettingRef) {
    const saved = backup[refId(ref)];
    if (!saved) return false;
    await set(ref, saved.original);
    return true;
  }

  /** Restore every setting the app changed, newest first. Returns the errors; keeps going past them. */
  async function undoAll() {
    const errors: string[] = [];
    for (const entry of Object.values(backup).reverse()) {
      try {
        await set(entry.ref, entry.original);
      } catch (err) {
        errors.push(`${describeRef(entry.ref)}: ${(err as Error).message}`);
      }
    }
    return errors;
  }

  /**
   * Restores every setting first changed at or after `since` (newest first). Settings first changed earlier keep
   * their current value: the backup holds originals, not every value in between.
   */
  async function undoSince(since: string) {
    const errors: string[] = [];
    const picked = Object.values(backup)
      .filter((e) => e.savedAt >= since)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    for (const entry of picked) {
      try {
        await set(entry.ref, entry.original);
      } catch (err) {
        errors.push(`${describeRef(entry.ref)}: ${(err as Error).message}`);
      }
    }
    return { count: picked.length, errors };
  }

  // Windows makes at most one restore point per 24 h (SystemRestorePointCreationFrequency, default 1440 min) and
  // quietly skips the rest, yet each Checkpoint-Computer call still takes seconds. So within that window after one
  // this app made, the existing point stands for the next change and nothing is called.
  // ponytail: assumes the user didn't delete restore points in between; System Restore > list shows what exists.
  const rpFile = path.join(dataDir, 'restore-point.json');
  const rpWindow = restorePointWindowMs ?? (adapter.live ? 24 * 3_600_000 : 0);
  let lastRestorePoint = resume ? await readFile(rpFile, 'utf8').then((t) => Number(JSON.parse(t).at) || 0, () => 0) : 0;

  /** Windows restore point via Checkpoint-Computer. Throws if it fails. */
  const hooks = { activity: (_task: 'restore-point' | 'restart', _active: boolean) => {} };

  async function restorePoint(description: string, force = false) {
    const desc = description.replace(/'/g, "''");
    if (!force && Date.now() - lastRestorePoint < rpWindow) {
      await log('restore-point', description, true, `covered by the restore point from ${new Date(lastRestorePoint).toLocaleString()} (Windows makes one per 24 h)`);
      return;
    }
    hooks.activity('restore-point', true);
    try {
      const { stdout, stderr } = await adapter.exec(POWERSHELL_EXE, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Checkpoint-Computer -Description '${desc}' -RestorePointType MODIFY_SETTINGS`,
      ]);
      // Windows allows one restore point per 24h by default; that case is a warning, not an error.
      await log('restore-point', description, true, adapter.live ? (stderr || stdout).trim() || undefined : 'dry-run: not created');
      lastRestorePoint = Date.now();
      await writeFile(rpFile, JSON.stringify({ at: lastRestorePoint })).catch(() => {});
    } catch (err) {
      await log('restore-point', description, false, (err as Error).message);
      throw err;
    } finally {
      hooks.activity('restore-point', false);
    }
  }

  /** Restart Windows in 5 seconds. Dry-run only logs it. */
  async function restart() {
    try {
      await adapter.exec(SHUTDOWN_EXE, ['/r', '/t', '5', '/c', 'IcyTweaker: restarting to finish applying tweaks']);
      await log('restart', 'windows', true, adapter.live ? undefined : 'dry-run: not restarted');
      hooks.activity('restart', true);
    } catch (err) {
      await log('restart', 'windows', false, (err as Error).message);
      throw err;
    }
  }

  /** Newest first. */
  async function readLog(limit = 300): Promise<LogEntry[]> {
    const text = await readFile(logFile, 'utf8').catch(() => '');
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as LogEntry);
  }

  const shorten = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
  const changes = (): BackupView[] =>
    Object.values(backup).map((e) => ({
      target: describeRef(e.ref),
      original: e.original === null ? 'absent' : e.ref.kind === 'hosts' ? `${String(e.original).length} characters (saved in the backup)` : shorten(JSON.stringify(e.original)),
      savedAt: e.savedAt,
    }));
  /** Settings the app has changed and can restore. */
  const changedRefs = () => Object.values(backup).map((e) => e.ref);
  /** When the app first changed this setting, or null if it has no backup. */
  const savedAt = (ref: SettingRef) => backup[refId(ref)]?.savedAt ?? null;

  return {
    dataDir,
    logFile,
    adapter,
    read,
    set,
    restore,
    undoAll,
    undoSince,
    restorePoint,
    restart,
    log,
    readLog,
    changes,
    changedRefs,
    savedAt,
    backupCount: () => Object.keys(backup).length,
    /** Set by main to show "Creating a restore point…" / "Restarting…" in the window. */
    hooks,
  };
}
