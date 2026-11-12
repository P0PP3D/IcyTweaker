// Privacy traces: Windows' lists of what you ran, searched and opened. Clearing is reversible:
//   - registry lists: each value is deleted through the safety layer, so it is backed up first (Undo All restores)
//   - Recent items shortcuts: copied into a snapshot folder in the app data folder, then deleted; restorable
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { PrivacySnapshot, PrivacyTraceView } from '../../shared/types';
import { REG_EXE, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';
import { parseRegValues } from '../apps/startup';

const EXPLORER = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer';

export const TRACES: Array<{ id: string; name: string; description: string; key?: string; recentFolder?: true }> = [
  { id: 'run-history', name: 'Run dialog history', description: 'Commands typed into Win+R.', key: `${EXPLORER}\\RunMRU` },
  { id: 'explorer-search', name: 'File Explorer searches', description: 'What you searched for in File Explorer.', key: `${EXPLORER}\\WordWheelQuery` },
  { id: 'typed-paths', name: 'File Explorer address bar', description: 'Paths typed into the File Explorer address bar.', key: `${EXPLORER}\\TypedPaths` },
  { id: 'recent-docs', name: 'Recent documents list', description: 'The list of recently opened files Explorer keeps.', key: `${EXPLORER}\\RecentDocs` },
  { id: 'recent-items', name: 'Recent items', description: 'Shortcuts to recently opened files (Quick access > Recent).', recentFolder: true },
];

export function createPrivacy(safety: Safety, o: { appData: string; snapshotDir: string }) {
  const recentDir = path.join(o.appData, 'Microsoft', 'Windows', 'Recent');
  const valuesOf = async (key: string) => parseRegValues(await safety.adapter.query(REG_EXE, ['query', `HKCU\\${key}`]).catch(() => '')).map((v) => v.name);
  const recentFiles = async () => (await readdir(recentDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.lnk')).map((d) => d.name);
  const ref = (key: string, name: string): SettingRef => ({ kind: 'reg', hive: 'HKCU', key, name });
  const cleared = new Set<string>();
  // Cleared this session and not restored since (Undo All drops the backup entry, so restored values count again).
  const isCleared = (key: string, name: string) => cleared.has(`${key}|${name}`.toLowerCase()) && safety.savedAt(ref(key, name)) !== null;

  return {
    async list(): Promise<PrivacyTraceView[]> {
      const out: PrivacyTraceView[] = [];
      for (const t of TRACES) {
        let count = 0;
        if (t.key) {
          // One `reg query` per list; values cleared this session are subtracted (in dry-run they are still on disk).
          count = (await valuesOf(t.key)).filter((name) => !isCleared(t.key!, name)).length;
        } else count = (await recentFiles()).filter((f) => !safety.adapter.isRemoved?.(path.join(recentDir, f))).length;
        out.push({ id: t.id, name: t.name, description: t.description, count });
      }
      return out;
    },

    /** Clears the picked traces. Returns how many entries were removed. */
    async clear(ids: string[]): Promise<number> {
      let removed = 0;
      for (const t of TRACES.filter((x) => ids.includes(x.id))) {
        if (t.key) {
          for (const name of await valuesOf(t.key)) {
            const id = `${t.key}|${name}`.toLowerCase();
            if (isCleared(t.key, name)) continue;
            try {
              await safety.set(ref(t.key, name), null); // backs up the original first
              cleared.add(id);
              removed++;
            } catch {
              // a value type the backup can't hold (e.g. REG_EXPAND_SZ): left in place rather than deleted unbacked
            }
          }
        } else {
          const files = (await recentFiles()).filter((f) => !safety.adapter.isRemoved?.(path.join(recentDir, f)));
          if (!files.length) continue;
          const snap = path.join(o.snapshotDir, new Date().toISOString().replace(/[:.]/g, '-'));
          await mkdir(snap, { recursive: true });
          for (const f of files) {
            await copyFile(path.join(recentDir, f), path.join(snap, f)); // into the app's own data folder
            await safety.adapter.removeFile(path.join(recentDir, f));
            removed++;
          }
          await safety.log('privacy-snapshot', snap, true, `${files.length} recent item(s)`);
        }
      }
      return removed;
    },

    async snapshots(): Promise<PrivacySnapshot[]> {
      const dirs = await readdir(o.snapshotDir, { withFileTypes: true }).catch(() => []);
      const out: PrivacySnapshot[] = [];
      for (const d of dirs.filter((x) => x.isDirectory())) out.push({ id: d.name, files: (await readdir(path.join(o.snapshotDir, d.name))).length });
      return out.sort((a, b) => b.id.localeCompare(a.id));
    },

    /** Copies a snapshot's shortcuts back into Recent items (skips ones that exist again). */
    async restore(id: string): Promise<number> {
      const dir = path.join(o.snapshotDir, path.basename(id));
      let n = 0;
      for (const f of await readdir(dir)) {
        try {
          await safety.adapter.restoreFile(path.join(dir, f), path.join(recentDir, f));
          n++;
        } catch {
          // already there again
        }
      }
      return n;
    },

    deleteSnapshot: (id: string) => rm(path.join(o.snapshotDir, path.basename(id)), { recursive: true, force: true }),
  };
}
