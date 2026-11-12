// Run by the uninstaller (`--restore-defender`): puts back the Defender values the app changed, and nothing else.
// Uses the live backup only. No live backup = the app never changed Windows = nothing to do.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { generalTweaks } from '../tweaks/general';
import type { SystemAdapter } from './adapter';
import { createSafety } from './safety';

export async function restoreDefender(adapter: SystemAdapter, liveDataDir: string): Promise<number> {
  if (!existsSync(path.join(liveDataDir, 'backup.json'))) return 0;
  const safety = await createSafety(adapter, liveDataDir);
  let restored = 0;
  for (const s of generalTweaks.find((t) => t.id === 'disable-defender')!.settings) {
    if (await safety.restore(s.ref)) restored++; // only values in the backup, i.e. ones the app changed
  }
  await safety.log('uninstall-restore-defender', 'Defender policies', true, `${restored} value(s) restored`);
  return restored;
}
