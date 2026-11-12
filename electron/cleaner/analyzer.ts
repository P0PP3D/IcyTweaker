// Disk Analyzer: one walk of a root builds folder sizes (folders only, so a whole drive fits in memory)
// and the biggest files. Opening a folder lists its subfolders from that tree plus its files read fresh.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AnalyzeView, DirEntry } from '../../shared/types';
import { walk } from './walk';

const TOP = 50;

export function createAnalyzer() {
  let root: string | null = null;
  const own = new Map<string, number>(); // bytes of files directly in a folder
  const kids = new Map<string, string[]>();
  const total = new Map<string, number>();
  let top: DirEntry[] = [];
  let inaccessible = 0;
  let cancel = false;

  const norm = (p: string) => path.resolve(p).toLowerCase();
  const sizeOf = (dir: string): number => {
    const k = norm(dir);
    const cached = total.get(k);
    if (cached !== undefined) return cached;
    const s = (own.get(k) ?? 0) + (kids.get(k) ?? []).reduce((a, c) => a + sizeOf(c), 0);
    total.set(k, s);
    return s;
  };

  /** Is `p` inside the analyzed root (or the root itself)? */
  const inside = (p: string) => !!root && (norm(p) === norm(root) || norm(p).startsWith(norm(root) + path.sep));

  async function open(dir: string, skip?: (p: string) => boolean): Promise<AnalyzeView> {
    if (!root || !inside(dir)) throw new Error('Not inside the analyzed folder.');
    const entries: DirEntry[] = (kids.get(norm(dir)) ?? []).filter((d) => !skip?.(d)).map((d) => ({ path: d, name: path.basename(d), size: sizeOf(d), isDir: true }));
    const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      names
        .filter((e) => e.isFile() && !e.isSymbolicLink())
        .map(async (e) => {
          const p = path.join(dir, e.name);
          if (skip?.(p)) return;
          const st = await lstat(p).catch(() => null);
          if (st?.isFile()) entries.push({ path: p, name: e.name, size: st.size, isDir: false });
        }),
    );
    entries.sort((a, b) => b.size - a.size);
    return { root, path: dir, size: sizeOf(dir), entries, topFiles: top.filter((f) => !skip?.(f.path)), inaccessible, scanned: true };
  }

  return {
    inside,
    open,
    cancel: () => (cancel = true),

    async analyze(dir: string, onProgress: (files: number, bytes: number, current: string) => void, skip?: (p: string) => boolean): Promise<AnalyzeView> {
      root = path.resolve(dir);
      own.clear();
      kids.clear();
      total.clear();
      top = [];
      cancel = false;
      let files = 0;
      let bytes = 0;
      let last = 0;
      const r = await walk(
        root,
        {
          skip,
          cancelled: () => cancel,
          onDir: (d, parent, ownBytes) => {
            own.set(norm(d), ownBytes);
            if (!parent) return;
            const list = kids.get(norm(parent));
            if (list) list.push(d);
            else kids.set(norm(parent), [d]);
          },
          onFile: (f) => {
            files++;
            bytes += f.size;
            if (top.length < TOP || f.size > top[top.length - 1].size) {
              top.push({ path: f.path, name: path.basename(f.path), size: f.size, isDir: false });
              top.sort((a, b) => b.size - a.size);
              if (top.length > TOP) top.pop();
            }
            if (Date.now() - last > 250) {
              last = Date.now();
              onProgress(files, bytes, path.dirname(f.path));
            }
          },
        },
        false, // don't keep every file in memory
      );
      inaccessible = r.inaccessible;
      onProgress(files, bytes, '');
      return open(root, skip);
    },
  };
}
