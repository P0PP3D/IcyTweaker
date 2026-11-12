// Focus Mode: an on/off "everything quiet" switch for play (tray or page). While on, chosen non-essential Windows
// services are stopped and chosen background apps closed; turning it off starts those services again and, if asked,
// reopens the apps. Nothing is disabled permanently (service start types are untouched), and what was stopped is
// written to focus-state.json first, so a crash or restart still gets everything back on the next start.
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FocusSettings, FocusState } from '../../shared/types';
import { POWERSHELL_EXE, SC_EXE, type SystemAdapter } from '../system/adapter';
import { CRITICAL } from '../services/services';

/** Services that are safe to stop for a while: Windows restarts the ones it needs, and none affects games or input. */
export const FOCUS_SERVICES: Array<{ name: string; label: string; note: string; default: boolean }> = [
  { name: 'SysMain', label: 'SysMain (Superfetch)', note: 'Preloads apps into memory; causes disk and CPU spikes.', default: true },
  { name: 'WSearch', label: 'Windows Search indexing', note: 'Indexes files in the background. Start-menu file search is slower meanwhile.', default: true },
  { name: 'DiagTrack', label: 'Telemetry', note: 'Collects and sends usage data to Microsoft.', default: true },
  { name: 'wuauserv', label: 'Windows Update', note: 'No update downloads or installs mid-game.', default: true },
  { name: 'BITS', label: 'Background downloads (BITS)', note: 'Windows and app background transfers.', default: true },
  { name: 'DoSvc', label: 'Delivery Optimization', note: 'Shares update files with other PCs.', default: true },
  { name: 'WerSvc', label: 'Error reporting', note: 'Crash report collection.', default: true },
  { name: 'PcaSvc', label: 'Program Compatibility Assistant', note: 'Watches programs for compatibility problems.', default: true },
  { name: 'MapsBroker', label: 'Downloaded Maps Manager', note: 'Offline map updates.', default: true },
  { name: 'Spooler', label: 'Print Spooler', note: 'Printing (nothing prints meanwhile).', default: true },
  { name: 'Fax', label: 'Fax', note: 'Faxing.', default: true },
  { name: 'TrkWks', label: 'Distributed Link Tracking', note: 'Keeps shortcuts working when files move between drives.', default: false },
  { name: 'XblGameSave', label: 'Xbox Live Game Save', note: 'Cloud saves for Xbox / Game Pass games: leave on if you play those.', default: false },
];

/** Background apps worth closing for play. Off by default where people often want them (voice chat, music). */
export const FOCUS_APPS: Array<{ exe: string; label: string; default: boolean }> = [
  { exe: 'onedrive.exe', label: 'OneDrive', default: true },
  { exe: 'ms-teams.exe', label: 'Microsoft Teams', default: true },
  { exe: 'phoneexperiencehost.exe', label: 'Phone Link', default: true },
  { exe: 'widgets.exe', label: 'Widgets', default: true },
  { exe: 'copilot.exe', label: 'Copilot', default: true },
  { exe: 'msedgewebview2.exe', label: 'Edge WebView helpers', default: false },
  { exe: 'adobe desktop service.exe', label: 'Adobe Creative Cloud', default: true },
  { exe: 'epicgameslauncher.exe', label: 'Epic Games Launcher', default: false },
  { exe: 'chrome.exe', label: 'Chrome', default: false },
  { exe: 'msedge.exe', label: 'Edge', default: false },
  { exe: 'spotify.exe', label: 'Spotify', default: false },
  { exe: 'discord.exe', label: 'Discord', default: false },
];

export const DEFAULT_FOCUS: FocusSettings = {
  services: FOCUS_SERVICES.filter((s) => s.default).map((s) => s.name),
  apps: FOCUS_APPS.filter((a) => a.default).map((a) => a.exe),
  custom: [],
  exceptions: [],
  reopen: true,
};

const EXE = /^[\w .()&+-]{1,80}\.exe$/i;
const exe = (v: unknown) => (typeof v === 'string' && EXE.test(v.trim()) ? v.trim().toLowerCase() : null);
/** Programs Focus Mode never closes, whatever the lists say. */
const NEVER = new Set(['explorer.exe', 'dwm.exe', 'csrss.exe', 'winlogon.exe', 'lsass.exe', 'services.exe', 'svchost.exe', 'icytweaker.exe', 'electron.exe', 'steam.exe', 'audiodg.exe']);

export function validateFocus(raw: unknown): FocusSettings | null {
  const r = raw as Partial<FocusSettings> | null;
  if (!r || !Array.isArray(r.services) || !Array.isArray(r.apps) || !Array.isArray(r.custom) || !Array.isArray(r.exceptions) || typeof r.reopen !== 'boolean') return null;
  const known = new Set(FOCUS_SERVICES.map((s) => s.name));
  const list = (xs: unknown[]) => [...new Set(xs.map(exe).filter((x): x is string => !!x && !NEVER.has(x)))].slice(0, 100);
  return {
    services: [...new Set(r.services.filter((s): s is string => typeof s === 'string' && known.has(s) && !CRITICAL.has(s)))],
    apps: list(r.apps),
    custom: list(r.custom),
    exceptions: [...new Set(r.exceptions.map(exe).filter((x): x is string => !!x))].slice(0, 100),
    reopen: r.reopen,
  };
}

const ps = (script: string) => ['-NoProfile', '-NonInteractive', '-Command', script];
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function createFocus(adapter: SystemAdapter, dataDir: string, log: (action: string, target: string, ok: boolean, detail?: string) => Promise<void>) {
  const file = path.join(dataDir, 'focus-state.json');
  let state: FocusState | null = null;
  let busy: Promise<unknown> = Promise.resolve();
  const save = () => (state ? writeFile(file, JSON.stringify(state, null, 2)) : rm(file, { force: true }));

  async function on(s: FocusSettings): Promise<string> {
    if (state) return 'Focus Mode is already on.';
    state = { since: new Date().toISOString(), services: [], apps: [] };
    await save();
    // Services: only ones running now, so only those are started again.
    for (const name of s.services) {
      if (CRITICAL.has(name)) continue;
      const q = await adapter.query(SC_EXE, ['query', name]).catch(() => '');
      if (!/STATE\s*:\s*4\b/.test(q)) continue;
      const ok = await adapter.exec(SC_EXE, ['stop', name], 60_000).then(() => true, () => false);
      if (ok) {
        state.services.push(name);
        await save();
      }
    }
    // Apps: ask each to close (like clicking X), then end what is still running after 3 s. Paths are kept to reopen.
    const keep = new Set(s.exceptions);
    const targets = [...new Set([...s.apps, ...s.custom])].filter((x) => !keep.has(x) && !NEVER.has(x));
    if (targets.length) {
      const names = targets.map((x) => quote(x.replace(/\.exe$/i, ''))).join(',');
      const script =
        `$p = @(Get-Process -Name ${names} -ErrorAction SilentlyContinue); $paths = @($p | ForEach-Object { $_.ProcessName + '|' + $_.Path } | Sort-Object -Unique); ` +
        `$p | ForEach-Object { [void]$_.CloseMainWindow() }; Start-Sleep -Seconds 3; ` +
        `$p | Where-Object { -not $_.HasExited } | Stop-Process -Force -ErrorAction SilentlyContinue; $paths`;
      const { stdout } = await adapter.exec(POWERSHELL_EXE, ps(script), 60_000).catch(() => ({ stdout: '' }));
      state.apps = stdout
        .split(/\r?\n/)
        .map((l) => l.trim().split('|'))
        .filter((p) => p.length === 2 && p[1])
        .map(([name, p]) => ({ name: `${name}.exe`, path: p }));
      await save();
    }
    const msg = `${state.services.length} service(s) stopped, ${state.apps.length} app(s) closed`;
    await log('focus-on', 'Focus Mode', true, `${msg}${adapter.live ? '' : ' (dry-run)'}`);
    return `Focus Mode on: ${msg}${adapter.live ? '' : ' (dry-run: nothing was stopped)'}.`;
  }

  async function off(reopen: boolean): Promise<string> {
    if (!state) return 'Focus Mode is already off.';
    const s = state;
    const errors: string[] = [];
    for (const name of [...s.services].reverse()) await adapter.exec(SC_EXE, ['start', name], 60_000).catch((e: Error) => errors.push(`${name}: ${e.message}`));
    let reopened = 0;
    if (reopen) {
      // Through Explorer, so apps start as the normal user (IcyTweaker itself runs as administrator).
      const explorer = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');
      for (const a of s.apps) await adapter.exec(explorer, [a.path], 15_000).then(() => reopened++, () => {});
    }
    state = null;
    await save();
    await log('focus-off', 'Focus Mode', errors.length === 0, errors.join(' | ') || undefined);
    return `Focus Mode off: ${s.services.length} service(s) started again${reopen ? `, ${reopened} app(s) reopened` : ''}.${errors.length ? ` Problems: ${errors.join('; ')}` : ''}`;
  }

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = busy.then(fn);
    busy = next.catch(() => {});
    return next;
  };

  return {
    /** After a crash or restart: put back what the last session stopped. */
    async resume(): Promise<string | null> {
      state = await readFile(file, 'utf8').then((t) => JSON.parse(t) as FocusState, () => null);
      return state ? serial(() => off(false)) : null;
    },
    on: (s: FocusSettings) => serial(() => on(s)),
    off: (reopen: boolean) => serial(() => off(reopen)),
    state: () => state,
  };
}
