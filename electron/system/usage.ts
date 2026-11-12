// When programs were last opened, for the Debloater's "not used in a long time" suggestions. Read-only.
// Sources: Prefetch (C:\Windows\Prefetch, one file per program, rewritten each run; administrator only), then
// UserAssist (Explorer's own launch counter; only when Windows' "track app launches" privacy setting is on).
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

/** exe name (lower case) -> last run (ms). */
export type RunTimes = Map<string, number>;

const PREFETCH = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Prefetch');

export async function prefetchTimes(dir = PREFETCH): Promise<RunTimes | null> {
  const files = await readdir(dir).catch(() => null);
  if (!files) return null; // not administrator
  const out: RunTimes = new Map();
  for (const f of files) {
    const m = /^(.+\.exe)-[0-9A-F]{8}\.pf$/i.exec(f);
    if (!m) continue;
    const t = (await stat(path.join(dir, f)).catch(() => null))?.mtimeMs;
    const exe = m[1].toLowerCase();
    if (t && t > (out.get(exe) ?? 0)) out.set(exe, t);
  }
  return out;
}

// Value names are ROT13 paths; bytes 60-67 hold the last run as a FILETIME (Windows 7+ layout).
export const USERASSIST_SCRIPT =
  "$ErrorActionPreference='SilentlyContinue'; Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist' | ForEach-Object { $k = Get-Item (Join-Path $_.PSPath 'Count'); foreach ($n in $k.GetValueNames()) { $d = $k.GetValue($n); if ($d.Length -ge 68) { $ft = [BitConverter]::ToInt64($d, 60); if ($ft -gt 0) { '{0}|{1}' -f $n, $ft } } } }";

const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c <= 'Z' ? 65 : 97)));
const FILETIME_EPOCH = 11644473600000; // ms between 1601 and 1970

export function parseUserAssist(out: string): RunTimes {
  const times: RunTimes = new Map();
  for (const line of out.split(/\r?\n/)) {
    const [name, ft] = line.split('|');
    if (!name || !ft) continue;
    const exe = path.win32.basename(rot13(name)).toLowerCase();
    if (!exe.endsWith('.exe')) continue;
    const ms = Number(BigInt(ft) / 10000n) - FILETIME_EPOCH;
    if (ms > (times.get(exe) ?? 0)) times.set(exe, ms);
  }
  return times;
}

export async function runTimes(adapter: Pick<SystemAdapter, 'query'>): Promise<{ times: RunTimes; source: 'prefetch' | 'userassist' | null }> {
  const pf = await prefetchTimes();
  if (pf?.size) return { times: pf, source: 'prefetch' };
  const ua = parseUserAssist(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', USERASSIST_SCRIPT], 30_000).catch(() => ''));
  return ua.size ? { times: ua, source: 'userassist' } : { times: new Map(), source: null };
}

/** Helper exes that run without the user opening the app (updaters, uninstallers, crash reporters). */
export const NOT_A_LAUNCH = /unins|uninstall|update|setup|install|crash|helper|report|service|elevat|squirrel/i;

/** The app's exes: its DisplayIcon exe plus .exe files in its install folder (and one level down). */
export async function appExes(installLocation?: string, displayIcon?: string): Promise<string[]> {
  const out = new Set<string>();
  const icon = displayIcon?.replace(/^"|"?(,-?\d+)?$/g, '').trim();
  if (icon?.toLowerCase().endsWith('.exe')) out.add(path.win32.basename(icon).toLowerCase());
  if (installLocation) {
    const dir = installLocation.replace(/^"|"$/g, '');
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (d.isFile() && d.name.toLowerCase().endsWith('.exe')) out.add(d.name.toLowerCase());
      else if (d.isDirectory()) {
        for (const f of await readdir(path.join(dir, d.name)).catch(() => [] as string[])) if (f.toLowerCase().endsWith('.exe')) out.add(f.toLowerCase());
      }
    }
  }
  return [...out].filter((e) => !NOT_A_LAUNCH.test(e));
}

export const lastRun = (exes: string[], times: RunTimes) => exes.reduce<number | null>((m, e) => (times.has(e) && times.get(e)! > (m ?? 0) ? times.get(e)! : m), null);
