// Resources: system corruption check (chkdsk scan, SFC, DISM, in that order) and shortcuts to Windows tools.
// The repairs run through adapter.exec, so dry-run runs none of them.
import path from 'node:path';
import type { ShortcutView, SystemCheckStep } from '../../shared/types';
import type { SystemAdapter } from '../system/adapter';

const SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

interface Step {
  id: SystemCheckStep['id'];
  name: string;
  file: string;
  args: string[];
}

export const CHECK_STEPS: Step[] = [
  // /scan: online, read-mostly scan of the system drive; problems that need a reboot are only reported.
  { id: 'chkdsk', name: 'Check disk (C:)', file: path.join(SYSTEM32, 'chkdsk.exe'), args: ['C:', '/scan'] },
  { id: 'sfc', name: 'System File Checker', file: path.join(SYSTEM32, 'sfc.exe'), args: ['/scannow'] },
  { id: 'dism', name: 'Windows image repair (DISM)', file: path.join(SYSTEM32, 'dism.exe'), args: ['/Online', '/Cleanup-Image', '/RestoreHealth'] },
];

/** Plain-language result. sfc text is matched in English; other languages fall back to the exit code. */
export function summarize(id: Step['id'], code: number, output: string): { ok: boolean; summary: string } {
  if (id === 'chkdsk') {
    const map: Record<number, [boolean, string]> = {
      0: [true, 'No problems found.'],
      1: [true, 'Problems were found and fixed.'],
      2: [true, 'No problems found; some cleanup was done.'],
      3: [false, 'Problems were found that need a restart to fix. Run "chkdsk C: /f" and restart.'],
    };
    const [ok, summary] = map[code] ?? [false, `Check disk could not finish (code ${code}).`];
    return { ok, summary };
  }
  if (id === 'sfc') {
    if (/did not find any integrity violations/i.test(output)) return { ok: true, summary: 'No damaged system files.' };
    if (/successfully repaired/i.test(output)) return { ok: true, summary: 'Damaged system files were found and repaired.' };
    if (/unable to fix/i.test(output)) return { ok: false, summary: 'Damaged system files were found that could not be repaired. Restart and run the check again.' };
    return code === 0 ? { ok: true, summary: 'Finished.' } : { ok: false, summary: `System File Checker could not finish (code ${code}).` };
  }
  return code === 0
    ? { ok: true, summary: 'The Windows image is healthy, or was repaired.' }
    : { ok: false, summary: `DISM could not finish (code ${code}). It needs Windows Update to be reachable to download repair files.` };
}

export async function runSystemCheck(adapter: SystemAdapter, onStep: (i: number, step: Step, line: string) => void): Promise<SystemCheckStep[]> {
  const results: SystemCheckStep[] = [];
  for (const [i, step] of CHECK_STEPS.entries()) {
    onStep(i, step, '');
    let output = '';
    let code: number;
    try {
      const r = await adapter.exec(step.file, step.args, {
        timeoutMs: 2 * 3_600_000,
        okCodes: 'any', // the exit code is the result; summarize() reads it
        onOutput: (chunk) => {
          output += chunk;
          const last = chunk.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop();
          if (last) onStep(i, step, last);
        },
      });
      output ||= r.stdout;
      code = r.code;
    } catch (err) {
      results.push({ id: step.id, name: step.name, ok: false, summary: (err as Error).message });
      continue;
    }
    results.push({ id: step.id, name: step.name, ...(adapter.live ? summarize(step.id, code, output) : { ok: true, summary: 'Not run (dry-run).' }) });
  }
  return results;
}

/**
 * Each GPU maker's own driver app: where its drivers are updated. Found by its Start-menu name (desktop and Store
 * apps alike, so no install path is guessed) and opened like the Start menu does; not installed = its official page.
 * NVIDIA App's Start-menu id read on the dev PC (com.nvidia.nvapp); AMD / Intel names from their current apps.
 */
export const GPU_APPS: Array<{ vendor: GpuVendor; app: string; match: RegExp; page: string; how: string }> = [
  {
    vendor: 'NVIDIA',
    app: 'NVIDIA App',
    match: /^NVIDIA App$|^GeForce Experience$/i,
    page: 'https://www.nvidia.com/en-us/software/nvidia-app/',
    how: 'Drivers tab: Check for updates, then Download and Express Installation.',
  },
  {
    vendor: 'AMD',
    app: 'AMD Software: Adrenalin Edition',
    match: /^AMD Software|^Radeon Software/i,
    page: 'https://www.amd.com/en/support/download/drivers.html',
    how: 'Home: Check for Updates, then Download and install.',
  },
  {
    vendor: 'Intel',
    app: 'Intel Graphics Software',
    match: /^Intel® Graphics Software|^Intel\(R\) Graphics Software|^Intel® Arc Control|^Intel® Driver & Support Assistant/i,
    page: 'https://www.intel.com/content/www/us/en/support/detect.html',
    how: 'Intel Graphics Software, or Intel Driver & Support Assistant, which checks every Intel driver.',
  },
];
export type GpuVendor = 'NVIDIA' | 'AMD' | 'Intel';

/** Start-menu apps (read-only): name and app id, base64 UTF-8 JSON (names carry ® and other characters). */
export const START_APPS_SCRIPT =
  '$a = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.AppID } }); [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $a -Compress)))';

/** START_APPS_SCRIPT output -> each vendor's installed driver app (its Start-menu name and id), if any. */
export function findGpuApps(b64: string): Partial<Record<GpuVendor, { name: string; id: string }>> {
  let list: Array<{ name?: unknown; id?: unknown }> = [];
  try {
    const v = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8'));
    list = Array.isArray(v) ? v : v ? [v] : [];
  } catch {
    // none found
  }
  const out: Partial<Record<GpuVendor, { name: string; id: string }>> = {};
  for (const g of GPU_APPS) {
    // The id goes into a shell:AppsFolder path: only plain app-id characters.
    const hit = list.find((a) => typeof a.name === 'string' && typeof a.id === 'string' && g.match.test(a.name) && /^[\w.!{}\\ -]{1,200}$/.test(a.id));
    if (hit) out[g.vendor] = { name: hit.name as string, id: hit.id as string };
  }
  return out;
}

/** Windows tools. Opening one changes nothing by itself; "Go to BIOS" restarts the PC and asks first. */
export const SHORTCUTS: Array<ShortcutView & { open: { exe: string; args?: string[] } | { url: string } | { firmware: true } }> = [
  { id: 'bios', name: 'Go to BIOS / UEFI', description: 'Restarts the PC straight into its firmware settings (UEFI PCs only).', requiresAdmin: true, restarts: true, open: { firmware: true } },
  { id: 'disk-management', name: 'Disk Management', description: 'Partitions, drive letters and new drives.', requiresAdmin: true, restarts: false, open: { exe: path.join(SYSTEM32, 'diskmgmt.msc') } },
  { id: 'reset-pc', name: 'Reset This PC', description: 'Opens Windows recovery settings. Nothing is reset until you choose it there.', requiresAdmin: false, restarts: false, open: { url: 'ms-settings:recovery' } },
  { id: 'bitlocker', name: 'BitLocker settings', description: 'Drive encryption and recovery keys.', requiresAdmin: false, restarts: false, open: { exe: path.join(SYSTEM32, 'control.exe'), args: ['/name', 'Microsoft.BitLockerDriveEncryption'] } },
  { id: 'msconfig', name: 'System Configuration', description: 'Boot options and safe mode (msconfig).', requiresAdmin: true, restarts: false, open: { exe: path.join(SYSTEM32, 'msconfig.exe') } },
  { id: 'display', name: 'Advanced display settings', description: 'Refresh rate and display mode for each monitor.', requiresAdmin: false, restarts: false, open: { url: 'ms-settings:display-advanced' } },
  // The Store (DCH) NVIDIA Control Panel, opened by its app id through Explorer like the Start menu does. The id is the
  // same on every PC (package family + app id, read on the dev PC 2026-11). Older non-Store installs: the Fixes page.
  { id: 'nvidia-control-panel', name: 'NVIDIA Control Panel', description: 'Display scaling (stretched resolutions), 3D settings and G-SYNC.', requiresAdmin: false, restarts: false, open: { exe: path.join(path.dirname(SYSTEM32), 'explorer.exe'), args: ['shell:AppsFolder\\NVIDIACorp.NVIDIAControlPanel_56jybvy8sckqj!NVIDIACorp.NVIDIAControlPanel'] } },
  { id: 'recycle-bin', name: 'Recycle Bin', description: 'Opens the Recycle Bin, to look through or restore deleted files.', requiresAdmin: false, restarts: false, open: { exe: path.join(path.dirname(SYSTEM32), 'explorer.exe'), args: ['shell:RecycleBinFolder'] } },
  { id: 'msinfo32', name: 'System Information', description: 'Full hardware and software summary (msinfo32).', requiresAdmin: false, restarts: false, open: { exe: path.join(SYSTEM32, 'msinfo32.exe') } },
];
