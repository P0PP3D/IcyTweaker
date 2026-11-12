// Duplicate Finder and Old Files. Read-only scans built on the safe walker (no links followed).
// Duplicates: same size, then same hash of the first 64 KB, then same full hash, so only true copies are listed.
// Nothing is deleted here; main moves picked files to the Recycle Bin.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import type { DuplicateGroup, OldFile } from '../../shared/types';
import { walk } from './walk';

/**
 * Folders whose files are never offered by the Duplicate Finder or Old Files, on any drive: games (identical DLLs and
 * rarely-touched .pak files are normal there), installed programs, app data, and Windows' own folders. Deleting a
 * "duplicate" or "old" file there breaks the game or app.
 */
const KEEP_OUT =
  /\\(steamapps|steamlibrary|riot games|epic games|xboxgames|gog games|ubisoft game launcher|ea games|battle\.net|program files( \(x86\))?|programdata|windowsapps|appdata|windows|\$recycle\.bin|system volume information|recovery|\$windows\.~bt|\$windows\.~ws|\.git|node_modules)(\\|$)/i;
export const keptOut = (p: string) => KEEP_OUT.test(p.replace(/\//g, '\\'));

async function headHash(file: string): Promise<string | null> {
  const fh = await open(file, 'r').catch(() => null);
  if (!fh) return null;
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex');
  } finally {
    await fh.close();
  }
}

function fullHash(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', () => resolve(null));
  });
}

/** Runs `fn` over items, at most `n` at a time (disk reads: a few at once is fastest; hundreds at once thrash). */
async function limited<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Groups items by key, keeping groups of two or more. */
async function regroup(items: string[], key: (x: string) => Promise<string | null>, n: number): Promise<string[][]> {
  const m = new Map<string, string[]>();
  const keys = await limited(items, n, key);
  items.forEach((x, i) => {
    const k = keys[i];
    if (k === null) return;
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  });
  return [...m.values()].filter((g) => g.length > 1);
}

export async function findDuplicates(
  root: string,
  o: { minSize?: number; skip?: (p: string) => boolean; onProgress?: (done: number, current: string) => void; cancelled?: () => boolean } = {},
): Promise<DuplicateGroup[]> {
  const minSize = o.minSize ?? 1024 * 1024;
  let n = 0;
  const { files } = await walk(root, { skip: o.skip, cancelled: o.cancelled, onFile: (f) => ++n % 500 === 0 && o.onProgress?.(n, f.path) });
  const bySize = new Map<number, string[]>();
  for (const f of files) {
    if (f.size < minSize) continue;
    const g = bySize.get(f.size);
    if (g) g.push(f.path);
    else bySize.set(f.size, [f.path]);
  }
  // Comparing phase: reported too, so a long hash of big files doesn't look stuck. Cancel is checked per file.
  const candidates = [...bySize.values()].filter((p) => p.length > 1).reduce((a, p) => a + p.length, 0);
  let compared = 0;
  let last = 0;
  const step = <T>(fn: (p: string) => Promise<T | null>) => async (p: string) => {
    if (o.cancelled?.()) return null;
    const r = await fn(p);
    if (Date.now() - last > 250) {
      last = Date.now();
      o.onProgress?.(n, `Comparing ${compared} of ${candidates}: ${p}`);
    }
    return r;
  };
  const groups: DuplicateGroup[] = [];
  for (const [size, paths] of bySize) {
    if (paths.length < 2 || o.cancelled?.()) continue;
    compared += paths.length;
    for (const sameHead of await regroup(paths, step(headHash), 8)) {
      for (const same of await regroup(sameHead, step(fullHash), 2)) {
        const withTimes = await Promise.all(same.map(async (p) => ({ path: p, modified: (await stat(p).catch(() => null))?.mtime.toISOString() ?? '' })));
        groups.push({ size, files: withTimes, wasted: size * (same.length - 1) });
      }
    }
  }
  return groups.sort((a, b) => b.wasted - a.wasted).slice(0, 300);
}

/** Large files not opened or changed for `days`. Uses the later of last access and last write (access times are often not updated). */
export async function findOldFiles(
  root: string,
  o: { days?: number; minSize?: number; skip?: (p: string) => boolean; cancelled?: () => boolean; onFile?: (f: { path: string }) => void } = {},
): Promise<OldFile[]> {
  const cutoff = Date.now() - (o.days ?? 180) * 86_400_000;
  const { files } = await walk(root, { skip: o.skip, cancelled: o.cancelled, onFile: o.onFile });
  const out: OldFile[] = [];
  for (const f of files) {
    if (f.size < (o.minSize ?? 50 * 1024 * 1024)) continue;
    const last = f.lastUsedMs ?? 0; // from the walk's own stat (a second stat per file doubled the scan)
    if (last < cutoff) out.push({ path: f.path, size: f.size, lastUsed: new Date(last).toISOString() });
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 500);
}
