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

/**
 * Background apps worth closing for play. Off by default where people often want them (voice chat, music).
 * `paths` (%VAR% expanded) / `appx` (Store package name): how to tell it's installed; running counts too.
 */
export const FOCUS_APPS: Array<{ exe: string; label: string; default: boolean; paths?: string[]; appx?: string }> = [
  { exe: 'onedrive.exe', label: 'OneDrive', default: true, paths: ['%LOCALAPPDATA%\\Microsoft\\OneDrive\\OneDrive.exe', '%ProgramFiles%\\Microsoft OneDrive\\OneDrive.exe'] },
  { exe: 'ms-teams.exe', label: 'Microsoft Teams', default: true, appx: 'MSTeams' },
  { exe: 'phoneexperiencehost.exe', label: 'Phone Link', default: true, appx: 'Microsoft.YourPhone' },
  { exe: 'widgets.exe', label: 'Widgets', default: true, appx: 'MicrosoftWindows.Client.WebExperience' },
  { exe: 'copilot.exe', label: 'Copilot', default: true, appx: 'Microsoft.Copilot' },
  { exe: 'msedgewebview2.exe', label: 'Edge WebView helpers', default: false, paths: ['%ProgramFiles(x86)%\\Microsoft\\EdgeWebView\\Application'] },
  { exe: 'adobe desktop service.exe', label: 'Adobe Creative Cloud', default: true, paths: ['%ProgramFiles(x86)%\\Common Files\\Adobe\\Adobe Desktop Common', '%ProgramFiles%\\Common Files\\Adobe\\Adobe Desktop Common'] },
  { exe: 'epicgameslauncher.exe', label: 'Epic Games Launcher', default: false, paths: ['%ProgramFiles(x86)%\\Epic Games\\Launcher', '%ProgramFiles%\\Epic Games\\Launcher'] },
  { exe: 'chrome.exe', label: 'Chrome', default: false, paths: ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe'] },
  { exe: 'msedge.exe', label: 'Edge', default: false, paths: ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe'] },
  { exe: 'spotify.exe', label: 'Spotify', default: false, paths: ['%APPDATA%\\Spotify\\Spotify.exe'], appx: 'SpotifyAB.SpotifyMusic' },
  { exe: 'discord.exe', label: 'Discord', default: false, paths: ['%LOCALAPPDATA%\\Discord'] },
];

/**
 * The user's apps, for the Focus Mode pickers: Start-menu shortcuts to .exe files, programs with a window open now,
 * plus installed Store package names and every running process name (to tell which FOCUS_APPS are on this PC).
 * Read-only. Base64 UTF-8 JSON (names can hold any character).
 */
export const APPS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$sh = New-Object -ComObject WScript.Shell; $apps = @()',
  'foreach ($d in @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")) {',
  "  Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk | ForEach-Object { $t = $sh.CreateShortcut($_.FullName).TargetPath; if ($t -like '*.exe') { $apps += [pscustomobject]@{ name = $_.BaseName; path = $t } } }",
  '}',
  '$procs = @(Get-Process)',
  '$procs | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | ForEach-Object { $apps += [pscustomobject]@{ name = $(if ($_.Description) { $_.Description } else { $_.ProcessName }); path = $_.Path } }',
  '$j = [pscustomobject]@{ apps = $apps; appx = @(Get-AppxPackage | ForEach-Object { $_.Name }); running = @($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) } | ConvertTo-Json -Depth 3 -Compress',
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j))',
].join('\n');

const JUNK = /uninstall|readme|read me|help|manual|website|setup|install|update|license|release notes|documentation|support/i;

/** APPS_SCRIPT output -> picker choices (one per exe, Start-menu name first) and which FOCUS_APPS this PC has. */
export function parseAppChoices(b64: string, exists: (p: string) => boolean, env: Record<string, string | undefined>): { choices: Array<{ exe: string; name: string }>; installed: string[] } {
  let raw: { apps?: unknown; appx?: unknown; running?: unknown } = {};
  try {
    raw = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8')) ?? {};
  } catch {
    // nothing listed
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []); // ConvertTo-Json unwraps 1-item arrays
  const winDir = (env.SystemRoot ?? 'C:\\Windows').toLowerCase();
  const byExe = new Map<string, string>();
  for (const a of arr(raw.apps) as Array<{ name?: unknown; path?: unknown }>) {
    if (typeof a?.name !== 'string' || typeof a.path !== 'string') continue;
    const file = a.path.split('\\').pop()!.toLowerCase();
    if (!EXE.test(file) || NEVER.has(file) || JUNK.test(a.name) || JUNK.test(file) || a.path.toLowerCase().startsWith(winDir)) continue;
    if (!byExe.has(file)) byExe.set(file, a.name.trim().slice(0, 80));
  }
  const appx = new Set((arr(raw.appx) as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()));
  const running = new Set((arr(raw.running) as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => `${x.toLowerCase()}.exe`));
  const expand = (p: string) => p.replace(/%([^%]+)%/g, (_, v: string) => env[v] ?? env[v.toUpperCase()] ?? `%${v}%`);
  const installed = FOCUS_APPS.filter(
    (a) => running.has(a.exe) || byExe.has(a.exe) || (a.appx && appx.has(a.appx.toLowerCase())) || a.paths?.some((p) => !expand(p).includes('%') && exists(expand(p))),
  ).map((a) => a.exe);
  const choices = [...byExe].map(([exe, name]) => ({ exe, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { choices, installed };
}

export const DEFAULT_FOCUS: FocusSettings = {
  services: FOCUS_SERVICES.filter((s) => s.default).map((s) => s.name),
  apps: FOCUS_APPS.filter((a) => a.default).map((a) => a.exe),
  custom: [],
  exceptions: [],
  reopen: true,
  withBoost: false,
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
    withBoost: r.withBoost === true,
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
    const st = state;
    // Services: only ones running now, so only those are started again. One listing of running services, then all
    // stops at once (sc stop doesn't wait for the service to finish stopping).
    const services = async () => {
      const running = new Set([...(await adapter.query(SC_EXE, ['query']).catch(() => '')).matchAll(/SERVICE_NAME:\s*(\S+)/g)].map((m) => m[1].toLowerCase()));
      const todo = s.services.filter((n) => !CRITICAL.has(n) && running.has(n.toLowerCase()));
      const ok = await Promise.all(todo.map((n) => adapter.exec(SC_EXE, ['stop', n], 60_000).then(() => true, () => false)));
      st.services = todo.filter((_, i) => ok[i]);
      await save();
    };
    // Apps: ask each to close (like clicking X), then end what is still open after 3 s (stops waiting as soon as all
    // have closed). Paths are kept to reopen. Runs alongside the services.
    const apps = async () => {
      const keep = new Set(s.exceptions);
      const targets = [...new Set([...s.apps, ...s.custom])].filter((x) => !keep.has(x) && !NEVER.has(x));
      if (!targets.length) return;
      const names = targets.map((x) => quote(x.replace(/\.exe$/i, ''))).join(',');
      const script =
        `$p = @(Get-Process -Name ${names} -ErrorAction SilentlyContinue); $paths = @($p | ForEach-Object { $_.ProcessName + '|' + $_.Path } | Sort-Object -Unique); ` +
        `$p | ForEach-Object { [void]$_.CloseMainWindow() }; $t = [Diagnostics.Stopwatch]::StartNew(); ` +
        `while (@($p | Where-Object { -not $_.HasExited }).Count -and $t.ElapsedMilliseconds -lt 3000) { Start-Sleep -Milliseconds 100 }; ` +
        `$p | Where-Object { -not $_.HasExited } | Stop-Process -Force -ErrorAction SilentlyContinue; $paths`;
      const { stdout } = await adapter.exec(POWERSHELL_EXE, ps(script), 60_000).catch(() => ({ stdout: '' }));
      st.apps = stdout
        .split(/\r?\n/)
        .map((l) => l.trim().split('|'))
        .filter((p) => p.length === 2 && p[1])
        .map(([name, p]) => ({ name: `${name}.exe`, path: p }));
    };
    await Promise.all([services(), apps()]);
    await save();
    const msg = `${state.services.length} service(s) stopped, ${state.apps.length} app(s) closed`;
    await log('focus-on', 'Focus Mode', true, `${msg}${adapter.live ? '' : ' (dry-run)'}`);
    return `Focus Mode on: ${msg}${adapter.live ? '' : ' (dry-run: nothing was stopped)'}.`;
  }

  async function off(reopen: boolean): Promise<string> {
    if (!state) return 'Focus Mode is already off.';
    const s = state;
    const errors: string[] = [];
    // All at once: sc start returns as soon as Windows has the request.
    await Promise.all([...s.services].reverse().map((name) => adapter.exec(SC_EXE, ['start', name], 60_000).catch((e: Error) => errors.push(`${name}: ${e.message}`))));
    let reopened = 0;
    if (reopen) {
      // Through Explorer, so apps start as the normal user (IcyTweaker itself runs as administrator).
      const explorer = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');
      await Promise.all(s.apps.map((a) => adapter.exec(explorer, [a.path], 15_000).then(() => reopened++, () => {})));
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
