// Startup manager: what launches at sign-in (Run keys, startup folders, and third-party scheduled tasks with a
// sign-in trigger), turned on or off the way Task Manager does it: StartupApproved flags (REG_BINARY; first byte odd =
// disabled) for Run/folder items, the task's own enabled state for tasks. Every change is backed up (Undo All).
// Delete (on request): Run values through the safety layer (restorable), folder shortcuts to the Recycle Bin.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StartupItemView } from '../../shared/types';
import { POWERSHELL_EXE, REG_EXE, binary, type Hive, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';

const RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
/** Flag Windows writes when it first sees an item: enabled, no timestamp. */
const ENABLED = '020000000000000000000000';

interface Source {
  id: string;
  hive: Hive;
  location: string;
  /** Registry Run key, or a startup folder. */
  key?: string;
  folder?: string;
  approved: string;
}

export function startupSources(env: { APPDATA: string; ProgramData: string }): Source[] {
  const startMenu = 'Microsoft\\Windows\\Start Menu\\Programs';
  return [
    { id: 'hkcu-run', hive: 'HKCU', key: RUN, approved: `${APPROVED}\\Run`, location: 'Registry: your account' },
    { id: 'hklm-run', hive: 'HKLM', key: RUN, approved: `${APPROVED}\\Run`, location: 'Registry: all users' },
    { id: 'hklm-run32', hive: 'HKLM', key: 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `${APPROVED}\\Run32`, location: 'Registry: all users (32-bit)' },
    { id: 'user-folder', hive: 'HKCU', folder: path.join(env.APPDATA, startMenu, 'Startup'), approved: `${APPROVED}\\StartupFolder`, location: 'Startup folder: your account' },
    { id: 'common-folder', hive: 'HKLM', folder: path.join(env.ProgramData, startMenu, 'StartUp'), approved: `${APPROVED}\\StartupFolder`, location: 'Startup folder: all users' },
  ];
}

/** Values of one registry key from `reg query` (read-only). */
export function parseRegValues(out: string): Array<{ name: string; data: string }> {
  return out
    .split(/\r?\n/)
    .map((l) => /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && m[1] !== '(Default)')
    .map((m) => ({ name: m[1], data: m[3] }));
}

const enabledFlag = (v: unknown) => {
  const hex = typeof v === 'object' && v !== null && (v as { type: string }).type === 'REG_BINARY' ? (v as { data: string }).data : '';
  return hex.length < 2 || (parseInt(hex.slice(0, 2), 16) & 1) === 0;
};

/** Third-party scheduled tasks with a sign-in trigger. Read-only (PowerShell, output as base64 JSON). */
export const LOGON_TASKS_SCRIPT =
  "$t = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' -and $_.TaskPath -notlike '\\IcyCleaner\\*' -and @($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count } | " +
  "ForEach-Object { $a = @($_.Actions)[0]; [pscustomobject]@{ path = $_.TaskPath + $_.TaskName; enabled = ($_.State -ne 'Disabled'); command = (\"$($a.Execute) $($a.Arguments)\").Trim() } }); " +
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $t -Compress)))';

export function parseLogonTasks(base64: string): Array<{ path: string; enabled: boolean; command: string }> {
  const json = Buffer.from(base64.trim(), 'base64').toString('utf8').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!json) return [];
  const list = JSON.parse(json) as Array<{ path?: unknown; enabled?: unknown; command?: unknown }>;
  return list.filter((t) => typeof t.path === 'string' && /^\\/.test(t.path)).map((t) => ({ path: t.path as string, enabled: t.enabled === true, command: String(t.command ?? '') }));
}

async function logonTasks(safety: Safety) {
  const out = await safety.adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', LOGON_TASKS_SCRIPT], 60_000).catch(() => '');
  try {
    return parseLogonTasks(out);
  } catch {
    return [];
  }
}

/**
 * The program a startup command runs: `"C:\x\app.exe" --tray` / `C:\x\app.exe -m` / `%ProgramFiles%\x\app.exe`.
 * null when there's no .exe in it. Startup-folder shortcuts (.lnk) are resolved by main.
 */
export function exeOf(command: string, env: Record<string, string | undefined>): string | null {
  const c = command.trim().replace(/%([^%]+)%/g, (m, v: string) => env[v] ?? env[v.toUpperCase()] ?? m);
  const quoted = /^"([^"]+)"/.exec(c);
  const file = quoted ? quoted[1] : /^(.+?\.exe)(?=\s|$)/i.exec(c)?.[1];
  return file && /^[a-z]:\\.+\.exe$/i.test(file) ? file : null;
}

export function createStartup(safety: Safety, sources: Source[]) {
  const flagRef = (s: Source, name: string): SettingRef => ({ kind: 'reg', hive: s.hive, key: s.approved, name });

  return {
    async list(): Promise<StartupItemView[]> {
      // Everything at once (sources, their flags, the task listing): one after another took many seconds, and the
      // adapter only batches registry reads asked for in the same tick.
      const tasks = logonTasks(safety);
      const perSource = await Promise.all(
        sources.map(async (s) => {
          const entries = s.key
            ? parseRegValues(await safety.adapter.query(REG_EXE, ['query', `${s.hive}\\${s.key}`, '/reg:64']).catch(() => ''))
            : (await readdir(s.folder!).catch(() => [] as string[])).filter((f) => f.toLowerCase() !== 'desktop.ini').map((f) => ({ name: f, data: path.join(s.folder!, f) }));
          const flags = await Promise.all(entries.map((e) => safety.read(flagRef(s, e.name))));
          return entries.map(
            (e, i): StartupItemView => ({
              id: `${s.id}|${e.name}`,
              name: e.name.replace(/\.lnk$/i, ''),
              command: e.data,
              location: s.location,
              enabled: enabledFlag(flags[i]),
              requiresAdmin: s.hive === 'HKLM',
              kind: s.key ? 'registry' : 'folder',
            }),
          );
        }),
      );
      // Scheduled tasks that start at sign-in (outside Windows' own \Microsoft\ tasks and IcyTweaker's).
      const taskItems = (await tasks).map(
        (t): StartupItemView => ({ id: `task|${t.path}`, name: t.path.split('\\').pop() || t.path, command: t.command, location: `Scheduled task: ${t.path}`, enabled: t.enabled, requiresAdmin: true, kind: 'task' }),
      );
      return [...perSource.flat(), ...taskItems];
    },

    /**
     * Removes an entry (only items from `list()`). Registry Run values: deleted through the safety layer, so the backup
     * (and Undo All) can put them back. Startup-folder shortcuts: main moves the returned file to the Recycle Bin.
     * Tasks are not deleted (their definition can't be backed up): turn them off instead.
     */
    async remove(id: string): Promise<{ trash?: string }> {
      const [sid, ...rest] = id.split('|');
      const name = rest.join('|');
      const s = sources.find((x) => x.id === sid);
      if (!s) throw new Error('Scheduled tasks can only be turned off, not deleted.');
      if (s.folder) return { trash: path.join(s.folder, name) };
      await safety.set({ kind: 'reg', hive: s.hive, key: s.key!, name }, null);
      if ((await safety.read(flagRef(s, name))) !== null) await safety.set(flagRef(s, name), null);
      return {};
    },

    /** Only items from `list()`; main checks the id. */
    async setEnabled(id: string, enabled: boolean) {
      const [sid, ...rest] = id.split('|');
      if (sid === 'task') return safety.set({ kind: 'task', path: rest.join('|') }, enabled ? 'enabled' : 'disabled');
      const s = sources.find((x) => x.id === sid);
      if (!s) throw new Error('Unknown startup source.');
      const ref = flagRef(s, rest.join('|'));
      const cur = await safety.read(ref);
      if (cur === null && enabled) return; // no flag = already on
      const hex = typeof cur === 'object' && cur?.type === 'REG_BINARY' && cur.data.length >= 2 ? cur.data : ENABLED;
      const first = parseInt(hex.slice(0, 2), 16);
      const next = (enabled ? first & ~1 : first | 1).toString(16).padStart(2, '0');
      await safety.set(ref, binary(next + hex.slice(2)));
    },
  };
}
