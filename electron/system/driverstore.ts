// Old driver cleanup. Windows keeps every driver version it ever installed in the Driver Store; only the newest of each
// driver (same original .inf, same provider) is offered to devices. Older versions are listed with their size (read
// from DriverStore\FileRepository, matched by the .inf's DriverVer line). Removal: each package is exported to the
// app's driver-backups folder first (pnputil /export-driver, so it can be added back), then deleted with
// pnputil /delete-driver WITHOUT /force, which Windows refuses for any driver a device is using.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { OldDriver } from '../../shared/types';
import type { SystemAdapter } from './adapter';
import { walk } from '../cleaner/walk';

export interface DriverPackage {
  published: string;
  original: string;
  provider: string;
  cls: string;
  date: string;
  version: string;
}

/** `pnputil /enum-drivers` (English labels) -> packages. */
export function parseEnumDrivers(out: string): DriverPackage[] {
  return out
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const f = (label: string) => new RegExp(`^${label}:\\s*(.+)$`, 'mi').exec(block)?.[1].trim() ?? '';
      const [date = '', version = ''] = f('Driver Version').split(/\s+/);
      return { published: f('Published Name'), original: f('Original Name'), provider: f('Provider Name'), cls: f('Class Name'), date, version };
    })
    .filter((p) => /^oem\d+\.inf$/i.test(p.published) && p.original && p.version);
}

/** Compares dotted versions numerically (1.10 > 1.9). */
export const cmpVersion = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Makers spell their names differently across drivers ("Advanced Micro Devices, Inc." / "…Inc"): compare without that. */
export const makerKey = (provider: string) =>
  provider
    .toLowerCase()
    .replace(/[.,']/g, ' ')
    .replace(/\b(inc|corp|corporation|co|ltd|llc|gmbh|int l)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every package that has a newer version of the same driver (same original .inf and maker) installed. */
export function olderVersions(pkgs: DriverPackage[]): DriverPackage[] {
  const groups = new Map<string, DriverPackage[]>();
  for (const p of pkgs) {
    const k = `${p.original.toLowerCase()}|${makerKey(p.provider)}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()].flatMap((g) => (g.length < 2 ? [] : [...g].sort((a, b) => cmpVersion(b.version, a.version)).slice(1)));
}

/** DriverVer = mm/dd/yyyy,version from an .inf. */
const driverVer = (inf: string) => /^\s*DriverVer\s*=\s*([\d/]+)\s*,\s*([\d.]+)/im.exec(inf);

export async function listOldDrivers(adapter: Pick<SystemAdapter, 'query'>, systemRoot: string): Promise<OldDriver[]> {
  const out = await adapter.query(path.join(systemRoot, 'System32', 'pnputil.exe'), ['/enum-drivers'], 120_000);
  const old = olderVersions(parseEnumDrivers(out));
  const repo = path.join(systemRoot, 'System32', 'DriverStore', 'FileRepository');
  const dirs = await readdir(repo).catch(() => [] as string[]);
  return Promise.all(
    old.map(async (p) => {
      // FileRepository\<original>_<arch>_<hash>; several folders per driver, told apart by their DriverVer.
      let bytes: number | null = null;
      for (const d of dirs.filter((x) => x.toLowerCase().startsWith(`${p.original.toLowerCase()}_`))) {
        const inf = await readFile(path.join(repo, d, p.original), 'latin1').catch(() => '');
        const m = driverVer(inf);
        if (m && m[2] === p.version) {
          bytes = (await walk(path.join(repo, d), {}, false)).bytes;
          break;
        }
      }
      return { ...p, bytes };
    }),
  );
}
