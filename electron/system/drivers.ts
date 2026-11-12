// Driver backup: exports every third-party driver package with Windows' own pnputil (Windows 10 1607+) into the
// app data folder, so a driver can be put back after an update or reinstall goes wrong. Needs administrator.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DriverBackupView } from '../../shared/types';
import type { SystemAdapter } from './adapter';

export const PNPUTIL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'pnputil.exe');

export async function backupDrivers(adapter: SystemAdapter, root: string): Promise<{ folder: string; message: string }> {
  const folder = path.join(root, new Date().toISOString().replace(/[:.]/g, '-'));
  // pnputil creates the folder; dry-run records the command and creates nothing.
  const r = await adapter.exec(PNPUTIL, ['/export-driver', '*', folder], { timeoutMs: 15 * 60_000, okCodes: 'any' });
  if (adapter.live && r.code !== 0) throw new Error(`pnputil failed (code ${r.code}): ${(r.stdout || r.stderr).trim().split(/\r?\n/).at(-1) ?? ''}`);
  return { folder, message: adapter.live ? `Drivers exported to ${folder}.` : 'Driver backup skipped (dry-run).' };
}

/** Each backup folder and how many driver packages (.inf) it holds. */
export async function listDriverBackups(root: string): Promise<DriverBackupView[]> {
  const out: DriverBackupView[] = [];
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let infs = 0;
    for (const sub of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (sub.isDirectory()) infs += (await readdir(path.join(dir, sub.name)).catch(() => [] as string[])).filter((f) => f.toLowerCase().endsWith('.inf')).length;
    }
    out.push({ id: d.name, folder: dir, packages: infs, created: (await stat(dir)).birthtime.toISOString() });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

/** Reinstalls every driver package in a backup (pnputil /add-driver ... /subdirs /install). */
export async function restoreDrivers(adapter: SystemAdapter, folder: string): Promise<string> {
  const r = await adapter.exec(PNPUTIL, ['/add-driver', path.join(folder, '*.inf'), '/subdirs', '/install'], { timeoutMs: 15 * 60_000, okCodes: 'any' });
  // verify: pnputil exits 3010 when a restart is needed, 259 when nothing new was installed.
  if (adapter.live && ![0, 259, 3010].includes(r.code)) throw new Error(`pnputil failed (code ${r.code}).`);
  return adapter.live ? (r.code === 3010 ? 'Drivers reinstalled. Restart to finish.' : 'Drivers reinstalled.') : 'Driver restore skipped (dry-run).';
}
