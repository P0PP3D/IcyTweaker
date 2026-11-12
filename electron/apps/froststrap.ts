// Froststrap (a Roblox launcher): detects it, opens it, and manages one FastFlag in the flags it applies to
// Roblox: the FPS cap (DFIntTaskSchedulerTargetFps). The flag goes through the safety layer, so the original is
// backed up and Reset / Undo All put it back. Froststrap must be closed while it changes (it rewrites the file).
// verify: Roblox only honors allow-listed FastFlags; DFIntTaskSchedulerTargetFps is on that list as of 2025.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FroststrapInfo } from '../../shared/types';
import { runningProcesses, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';

export const FPS_FLAG = 'DFIntTaskSchedulerTargetFps';

export function createFroststrap(safety: Safety, localAppData: string) {
  const dir = path.join(localAppData, 'Froststrap');
  const exe = path.join(dir, 'Froststrap.exe');
  const flagsFile = path.join(dir, 'ClientSettings', 'ClientAppSettings.json');
  const ref: SettingRef = { kind: 'configKey', file: flagsFile, format: 'json', name: FPS_FLAG, owner: 'froststrap' };

  return {
    exe,
    installed: () => existsSync(exe),
    async info(): Promise<FroststrapInfo> {
      if (!existsSync(exe)) return { installed: false, fpsCap: null, flags: 0, changed: false };
      const flags = await readFile(flagsFile, 'utf8').then((t) => Object.keys(JSON.parse(t) as object).length, () => 0);
      const v = existsSync(flagsFile) ? await safety.read(ref).catch(() => null) : null;
      const n = v === null ? NaN : Number(v);
      return { installed: true, fpsCap: Number.isFinite(n) ? n : null, flags, changed: safety.savedAt(ref) !== null };
    },
    /** fps = the cap to write (Froststrap stores flag values as text); null = put back what was there. */
    async setFps(fps: number | null) {
      if (!existsSync(flagsFile)) throw new Error('Froststrap has no flags file yet. Open Froststrap once, then try again.');
      if ((await runningProcesses(safety.adapter)).has('froststrap.exe')) throw new Error('Close Froststrap first: it rewrites its flags file when it exits.');
      if (fps === null) return safety.restore(ref);
      await safety.set(ref, String(fps));
      return true;
    },
  };
}
