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

/** Windows tools. Opening one changes nothing by itself; "Go to BIOS" restarts the PC and asks first. */
export const SHORTCUTS: Array<ShortcutView & { open: { exe: string; args?: string[] } | { url: string } | { firmware: true } }> = [
  { id: 'bios', name: 'Go to BIOS / UEFI', description: 'Restarts the PC straight into its firmware settings (UEFI PCs only).', requiresAdmin: true, restarts: true, open: { firmware: true } },
  { id: 'disk-management', name: 'Disk Management', description: 'Partitions, drive letters and new drives.', requiresAdmin: true, restarts: false, open: { exe: path.join(SYSTEM32, 'diskmgmt.msc') } },
  { id: 'reset-pc', name: 'Reset This PC', description: 'Opens Windows recovery settings. Nothing is reset until you choose it there.', requiresAdmin: false, restarts: false, open: { url: 'ms-settings:recovery' } },
  { id: 'bitlocker', name: 'BitLocker settings', description: 'Drive encryption and recovery keys.', requiresAdmin: false, restarts: false, open: { exe: path.join(SYSTEM32, 'control.exe'), args: ['/name', 'Microsoft.BitLockerDriveEncryption'] } },
  { id: 'msconfig', name: 'System Configuration', description: 'Boot options and safe mode (msconfig).', requiresAdmin: true, restarts: false, open: { exe: path.join(SYSTEM32, 'msconfig.exe') } },
  { id: 'display', name: 'Advanced display settings', description: 'Refresh rate and display mode for each monitor.', requiresAdmin: false, restarts: false, open: { url: 'ms-settings:display-advanced' } },
  { id: 'msinfo32', name: 'System Information', description: 'Full hardware and software summary (msinfo32).', requiresAdmin: false, restarts: false, open: { exe: path.join(SYSTEM32, 'msinfo32.exe') } },
];
