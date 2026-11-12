// Safe filesystem walk: never follows or yields symlinks/junctions (so OneDrive-style links and junctions
// such as "Application Data" are not followed or double counted), skips what it can't read, keeps going.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface WalkFile {
  path: string;
  size: number;
  /** The later of last access and last write (ms). */
  lastUsedMs?: number;
}

export interface WalkOptions {
  /** Only files whose name matches. */
  match?: RegExp;
  /** 0 = only files directly in the root. Default unlimited. */
  depth?: number;
  /** Skip files modified more recently than this (still in use by running apps). */
  minAgeMs?: number;
  /** Skip paths (dry-run: pretend-deleted files). */
  skip?: (p: string) => boolean;
  /** Called per file found (progress). */
  onFile?: (f: WalkFile) => void;
  /** Called per directory with the size of the files directly in it. */
  onDir?: (dir: string, parent: string | null, ownBytes: number) => void;
  /** Return true to stop early. */
  cancelled?: () => boolean;
}

export interface WalkResult {
  files: WalkFile[];
  /** Subdirectories, deepest first (for removing emptied folders). Never includes the root. */
  dirs: string[];
  bytes: number;
  inaccessible: number;
}

export async function walk(root: string, opts: WalkOptions = {}, keepFiles = true): Promise<WalkResult> {
  const result: WalkResult = { files: [], dirs: [], bytes: 0, inaccessible: 0 };
  const now = Date.now();

  // At most 16 folders read at once. A slot covers only reading one folder's own entries, never its subtree, so a
  // folder never waits on a slot its parent holds.
  let reading = 0;
  const waiting: Array<() => void> = [];
  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (reading >= 16) await new Promise<void>((r) => waiting.push(r));
    reading++;
    try {
      return await fn();
    } finally {
      reading--;
      waiting.shift()?.();
    }
  }

  async function visit(dir: string, parent: string | null, level: number) {
    if (opts.cancelled?.()) return;
    const subdirs = await slot(() => readOne(dir, parent, level));
    // Subfolders side by side (one at a time was most of a scan's time: each readdir waits on the disk). A folder is
    // added to `dirs` only after all of its own subfolders, so `dirs` stays deepest first.
    await Promise.all(
      (subdirs ?? []).map(async (s) => {
        await visit(s, dir, level + 1);
        result.dirs.push(s);
      }),
    );
  }

  /** Lists one folder: its files are reported, its subfolders returned. */
  async function readOne(dir: string, parent: string | null, level: number): Promise<string[] | null> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      result.inaccessible++;
      return null;
    }
    let own = 0;
    const subdirs: string[] = [];
    // lstat in batches: enough parallelism to be quick without opening thousands of handles at once.
    for (let i = 0; i < entries.length; i += 64) {
      await Promise.all(
        entries.slice(i, i + 64).map(async (e) => {
          const p = path.join(dir, e.name);
          if (e.isSymbolicLink() || opts.skip?.(p)) return;
          let st;
          try {
            st = await lstat(p);
          } catch {
            result.inaccessible++;
            return;
          }
          if (st.isSymbolicLink()) return; // junctions show up here on Windows
          if (st.isDirectory()) {
            if (opts.depth === undefined || level < opts.depth) subdirs.push(p);
            return;
          }
          if (!st.isFile()) return;
          if (opts.match && !opts.match.test(e.name)) return;
          if (opts.minAgeMs && now - st.mtimeMs < opts.minAgeMs) return;
          const f = { path: p, size: st.size, lastUsedMs: Math.max(st.atimeMs, st.mtimeMs) };
          own += st.size;
          result.bytes += st.size;
          if (keepFiles) result.files.push(f);
          opts.onFile?.(f);
        }),
      );
    }
    opts.onDir?.(dir, parent, own);
    return subdirs;
  }

  await visit(root, null, 0);
  return result;
}
