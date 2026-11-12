// Recycle Bin listing straight from disk (read-only). Each deleted item is a pair in X:\$Recycle.Bin\<SID>\: $R... (the
// item itself) and $I... (a small record: original path, size, deletion time). Reading the records takes milliseconds;
// asking the Shell for each item's size (the old way) re-measured every deleted folder and took many seconds.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RecycleItem } from '../../shared/types';

/**
 * One $I record. Version 1 (Vista to 8): 8-byte header, 8-byte size, 8-byte FILETIME, 520-byte UTF-16 path.
 * Version 2 (Windows 10+): same, then a 4-byte path length in characters (with the final NUL) and the path.
 */
export function parseIRecord(buf: Buffer): { path: string; size: number; deleted: string | null } | null {
  if (buf.length < 24) return null;
  const version = Number(buf.readBigInt64LE(0));
  const size = Number(buf.readBigInt64LE(8));
  const ft = buf.readBigInt64LE(16);
  let raw: Buffer;
  if (version === 2 && buf.length >= 28) {
    const chars = buf.readUInt32LE(24);
    raw = buf.subarray(28, Math.min(buf.length, 28 + chars * 2));
  } else if (version === 1) raw = buf.subarray(24, Math.min(buf.length, 24 + 520));
  else return null;
  const p = raw.toString('utf16le').replace(/\0.*$/s, '');
  if (!p) return null;
  // FILETIME: 100 ns ticks since 1601-01-01 UTC.
  const ms = ft > 0n ? Number(ft / 10_000n) - 11_644_473_600_000 : NaN;
  return { path: p, size: Math.max(0, size), deleted: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null };
}

/** Everything in this user's Recycle Bin on the given drives (e.g. 'C:\\'), newest deleted first. */
export async function listRecycleBin(drives: string[], sid: string): Promise<RecycleItem[]> {
  const perDrive = await Promise.all(
    drives.map(async (d) => {
      const dir = path.join(d, '$Recycle.Bin', sid);
      const names = await readdir(dir).catch(() => [] as string[]);
      const items = await Promise.all(
        names
          .filter((n) => /^\$I/i.test(n))
          .map(async (n): Promise<RecycleItem | null> => {
            const rec = parseIRecord(await readFile(path.join(dir, n)).catch(() => Buffer.alloc(0)));
            const item = await stat(path.join(dir, `$R${n.slice(2)}`)).catch(() => null); // gone = emptied already
            if (!rec || !item) return null;
            return { name: path.win32.basename(rec.path), from: path.win32.dirname(rec.path), deleted: rec.deleted, size: rec.size, folder: item.isDirectory() };
          }),
      );
      return items.filter((x): x is RecycleItem => x !== null);
    }),
  );
  return perDrive.flat().sort((a, b) => (b.deleted ?? '').localeCompare(a.deleted ?? ''));
}
