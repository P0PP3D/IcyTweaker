// Cleaner: data-driven clean targets. A target is folders to empty (optionally only matching files),
// or a PowerShell script for things Windows must clear itself (Recycle Bin, update caches).
// Every delete goes through the adapter, and only for files this module's own walk found under the
// target's roots: no links, nothing outside the root, never the root itself.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CleanResult, CleanTargetView, DriveInfo, ScanResult } from '../../shared/types';
import { POWERSHELL_EXE, runningProcesses, type SystemAdapter } from '../system/adapter';
import { walk } from './walk';

export interface CleanTarget extends Omit<CleanTargetView, 'running'> {
  /** Folders whose contents are cleaned. */
  roots: string[];
  match?: RegExp;
  depth?: number;
  minAgeHours?: number;
  /** Process names (lowercase, with .exe) of the app that owns these files. */
  processes?: string[];
  /** Clean with this instead of deleting files (the roots are still scanned for size). */
  script?: string;
}

export interface Env {
  LOCALAPPDATA: string;
  APPDATA: string;
  TEMP: string;
  SystemRoot: string;
  ProgramData: string;
  ProgramFilesX86: string;
  USERPROFILE: string;
  /** Recycle Bin folders for the current user, one per drive. */
  recycleBins: string[];
  steamPath: string;
}

const DAY_HOURS = 24;
const t = (x: Omit<CleanTarget, 'requiresAdmin' | 'defaultSelected' | 'needsClosed' | 'risk'> & Partial<CleanTarget>): CleanTarget => ({
  risk: 'safe',
  requiresAdmin: false,
  defaultSelected: x.risk === undefined || x.risk === 'safe',
  needsClosed: false,
  ...x,
});
const shaderNote = 'Games rebuild these shaders, so the first launch of each game afterwards may stutter briefly.';

/** %TEMP% comes from the environment: only clean it when it really is a Temp folder (not, say, Documents). */
export const isTempDir = (dir: string) => /^(temp|tmp)$/i.test(path.basename(path.resolve(dir)));

function systemTargets(e: Env): CleanTarget[] {
  const W = e.SystemRoot;
  return [
    t({ id: 'user-temp', group: 'system', name: 'Your temporary files', description: 'Files apps left in your Temp folder. Files changed in the last 24 hours are kept.', roots: isTempDir(e.TEMP) ? [e.TEMP] : [], minAgeHours: DAY_HOURS }),
    t({ id: 'windows-temp', group: 'system', name: 'Windows temporary files', description: 'Files left in the Windows Temp folder. Files changed in the last 24 hours are kept.', roots: [path.join(W, 'Temp')], minAgeHours: DAY_HOURS, requiresAdmin: true }),
    t({ id: 'thumbnail-cache', group: 'system', name: 'Thumbnail cache', description: 'Picture and video previews in File Explorer. Rebuilt as you browse folders.', roots: [path.join(e.LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer')], match: /^thumbcache_.*\.db$/i, depth: 0 }),
    t({ id: 'icon-cache', group: 'system', name: 'Icon cache', description: 'Cached app and file icons. Icons may look blank until Explorer restarts or you sign out.', risk: 'caution', roots: [path.join(e.LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer')], match: /^iconcache_.*\.db$/i, depth: 0 }),
    t({ id: 'directx-shader-cache', group: 'system', name: 'DirectX shader cache', description: shaderNote, risk: 'caution', roots: [path.join(e.LOCALAPPDATA, 'D3DSCache')] }),
    t({ id: 'user-crash-dumps', group: 'system', name: 'App crash dumps', description: 'Memory dumps saved when apps crashed. Only needed if you send them to a developer.', roots: [path.join(e.LOCALAPPDATA, 'CrashDumps')] }),
    t({
      id: 'system-crash-dumps',
      group: 'system',
      name: 'Windows crash dumps',
      description: 'Blue-screen memory dumps (Minidump folder and MEMORY.DMP). Only needed to diagnose a crash.',
      roots: [path.join(W, 'Minidump')],
      requiresAdmin: true,
    }),
    t({ id: 'system-memory-dump', group: 'system', name: 'Full memory dump', description: 'MEMORY.DMP from the last blue screen. Can be several GB.', roots: [W], match: /^MEMORY\.DMP$/i, depth: 0, requiresAdmin: true }),
    t({ id: 'user-error-reports', group: 'system', name: 'Your error reports', description: 'Windows Error Reporting files for your account, already sent or never needed.', roots: [path.join(e.LOCALAPPDATA, 'Microsoft', 'Windows', 'WER')] }),
    t({
      id: 'system-error-reports',
      group: 'system',
      name: 'Windows error reports',
      description: 'Queued and archived Windows Error Reporting files.',
      roots: [path.join(e.ProgramData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(e.ProgramData, 'Microsoft', 'Windows', 'WER', 'ReportQueue')],
      requiresAdmin: true,
    }),
    t({
      id: 'delivery-optimization',
      group: 'system',
      name: 'Delivery Optimization cache',
      description: 'Update files kept to share with other PCs. Windows clears it with its own cmdlet.',
      roots: [path.join(W, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache')],
      requiresAdmin: true,
      script: 'Delete-DeliveryOptimizationCache -Force',
    }),
    t({
      id: 'windows-update-cache',
      group: 'system',
      name: 'Windows Update download cache',
      description: 'Downloaded update files. If an update is still pending, Windows downloads it again.',
      risk: 'caution',
      roots: [path.join(W, 'SoftwareDistribution', 'Download')],
      requiresAdmin: true,
      script: `Stop-Service -Name wuauserv -Force; Get-ChildItem -LiteralPath '${path.join(W, 'SoftwareDistribution', 'Download')}' -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Start-Service -Name wuauserv`,
    }),
    t({
      id: 'recycle-bin',
      group: 'system',
      name: 'Recycle Bin',
      description: 'Everything in your Recycle Bin, on every drive. Emptied files cannot be restored.',
      risk: 'caution',
      roots: e.recycleBins,
      script: 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue',
    }),
  ];
}

function appTargets(e: Env): CleanTarget[] {
  const L = e.LOCALAPPDATA;
  const A = e.APPDATA;
  const LOW = path.join(path.dirname(L), 'LocalLow');
  const chromiumCache = (base: string) => ['Cache', 'Code Cache', 'GPUCache'].map((d) => path.join(base, d));
  const teams = path.join(L, 'Packages', 'MSTeams_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'MSTeams', 'EBWebView', 'Default');
  const epicSaved = path.join(L, 'EpicGamesLauncher', 'Saved');
  const epicCaches = existsSync(epicSaved) ? readdirSync(epicSaved).filter((n) => /^webcache/i.test(n)).map((n) => path.join(epicSaved, n)) : [];
  return [
    t({ id: 'discord', group: 'app', name: 'Discord cache', description: 'Images and code Discord cached. Re-downloaded as needed.', roots: chromiumCache(path.join(A, 'discord')), processes: ['discord.exe'] }),
    t({
      id: 'spotify',
      group: 'app',
      name: 'Spotify cache',
      description: 'Streamed music cache. This also removes songs downloaded for offline listening; Spotify downloads them again.',
      risk: 'caution',
      roots: [path.join(L, 'Spotify', 'Storage')],
      processes: ['spotify.exe'],
    }),
    t({ id: 'slack', group: 'app', name: 'Slack cache', description: 'Images and code Slack cached.', roots: [...chromiumCache(path.join(A, 'Slack')), path.join(A, 'Slack', 'Service Worker', 'CacheStorage')], processes: ['slack.exe'] }),
    t({ id: 'teams', group: 'app', name: 'Teams cache', description: 'Cached web content for new and classic Teams.', roots: [...chromiumCache(teams), ...chromiumCache(path.join(A, 'Microsoft', 'Teams'))], processes: ['ms-teams.exe', 'teams.exe'] }),
    t({ id: 'steam-web', group: 'app', name: 'Steam web cache', description: 'Store and community pages Steam cached.', roots: [path.join(e.steamPath, 'appcache', 'httpcache'), path.join(L, 'Steam', 'htmlcache')], processes: ['steam.exe', 'steamwebhelper.exe'] }),
    t({ id: 'steam-shaders', group: 'app', name: 'Steam shader cache', description: `${shaderNote} Steam may download pre-built shaders again.`, risk: 'caution', roots: [path.join(e.steamPath, 'steamapps', 'shadercache')], processes: ['steam.exe'] }),
    // Game launchers' own junk (folders found on the dev PC, 2026-11-12). Logs younger than a day are kept.
    t({ id: 'steam-logs', group: 'app', name: 'Steam logs and crash dumps', description: 'Steam\'s log files and crash dumps. Steam starts new ones as needed.', roots: [path.join(e.steamPath, 'logs'), path.join(e.steamPath, 'dumps')], minAgeHours: DAY_HOURS }),
    t({
      id: 'steam-depotcache',
      group: 'app',
      name: 'Steam download cache',
      description: 'Records of past game downloads. Steam fetches what it needs again; the next update of a game may take a little longer to start.',
      risk: 'caution',
      roots: [path.join(e.steamPath, 'depotcache')],
      processes: ['steam.exe'],
      needsClosed: true,
    }),
    t({ id: 'epic-logs', group: 'app', name: 'Epic Games Launcher logs', description: 'The launcher\'s log and crash files.', roots: [path.join(L, 'EpicGamesLauncher', 'Saved', 'Logs'), path.join(L, 'EpicGamesLauncher', 'Saved', 'Crashes')], minAgeHours: DAY_HOURS }),
    t({ id: 'riot-logs', group: 'app', name: 'Riot Client logs', description: 'Riot Client\'s log files (hundreds of small files build up).', roots: [path.join(L, 'Riot Games', 'Riot Client', 'Logs')], minAgeHours: DAY_HOURS }),
    t({
      id: 'ubisoft-logs',
      group: 'app',
      name: 'Ubisoft Connect logs',
      description: 'The launcher\'s log files.',
      roots: [path.join(e.ProgramFilesX86, 'Ubisoft', 'Ubisoft Game Launcher', 'logs')],
      minAgeHours: DAY_HOURS,
      requiresAdmin: true,
    }),
    t({
      id: 'ubisoft-cache',
      group: 'app',
      name: 'Ubisoft Connect cache',
      description: 'Images and store data the launcher downloaded. It downloads them again; clearing it also fixes many launcher glitches.',
      risk: 'caution',
      roots: [path.join(e.ProgramFilesX86, 'Ubisoft', 'Ubisoft Game Launcher', 'cache')],
      processes: ['upc.exe', 'ubisoftconnect.exe'],
      needsClosed: true,
      requiresAdmin: true,
    }),
    t({
      id: 'game-logs',
      group: 'app',
      name: 'Game log files',
      description: 'Logs Fortnite, VALORANT and Roblox write every session. Fortnite\'s alone can reach hundreds of MB.',
      roots: [path.join(L, 'FortniteGame', 'Saved', 'Logs'), path.join(L, 'VALORANT', 'Saved', 'Logs'), path.join(L, 'Roblox', 'logs')],
      minAgeHours: DAY_HOURS,
    }),
    t({ id: 'epic', group: 'app', name: 'Epic Games Launcher cache', description: 'Store pages the launcher cached.', roots: epicCaches, processes: ['epicgameslauncher.exe'] }),
    t({ id: 'vscode', group: 'app', name: 'VS Code cache', description: 'Cached code and extension data. Rebuilt on next start.', roots: [...chromiumCache(path.join(A, 'Code')), path.join(A, 'Code', 'CachedData')], processes: ['code.exe'] }),
    t({ id: 'adobe-media-cache', group: 'app', name: 'Adobe media cache', description: 'Premiere and After Effects rebuild this when you next open a project, which takes a while.', risk: 'caution', roots: [path.join(A, 'Adobe', 'Common', 'Media Cache Files'), path.join(A, 'Adobe', 'Common', 'Media Cache')] }),
    t({ id: 'nvidia-shaders', group: 'app', name: 'NVIDIA shader cache', description: shaderNote, risk: 'caution', roots: [path.join(L, 'NVIDIA', 'DXCache'), path.join(L, 'NVIDIA', 'GLCache'), path.join(LOW, 'NVIDIA', 'PerDriverVersion', 'DXCache'), path.join(LOW, 'NVIDIA', 'PerDriverVersion', 'GLCache')] }),
    t({ id: 'amd-shaders', group: 'app', name: 'AMD shader cache', description: shaderNote, risk: 'caution', roots: ['DxCache', 'DxcCache', 'VkCache', 'GLCache'].map((d) => path.join(L, 'AMD', d)) }),
    t({ id: 'intel-shaders', group: 'app', name: 'Intel shader cache', description: shaderNote, risk: 'caution', roots: [path.join(LOW, 'Intel', 'ShaderCache')] }),
  ];
}

interface Browser {
  id: string;
  name: string;
  /** Chromium "User Data" folder (profiles inside), or a single-profile folder. */
  dataDir: string;
  /** Where the cache lives, when it is not the profile folder (Opera). */
  cacheDir?: string;
  singleProfile?: boolean;
  exe: string;
}

function chromiumProfiles(b: Browser): Array<{ dir: string; label: string; cache: string }> {
  if (!existsSync(b.dataDir)) return [];
  if (b.singleProfile) return [{ dir: b.dataDir, label: b.name, cache: b.cacheDir ?? b.dataDir }];
  let names: Record<string, { name?: string }> = {};
  try {
    names = JSON.parse(readFileSync(path.join(b.dataDir, 'Local State'), 'utf8')).profile?.info_cache ?? {};
  } catch {}
  return readdirSync(b.dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name)))
    .map((d) => {
      const dir = path.join(b.dataDir, d.name);
      return { dir, label: `${b.name}: ${names[d.name]?.name ?? d.name}`, cache: dir };
    });
}

function browserTargets(e: Env): CleanTarget[] {
  const L = e.LOCALAPPDATA;
  const A = e.APPDATA;
  const chromium: Browser[] = [
    { id: 'chrome', name: 'Chrome', dataDir: path.join(L, 'Google', 'Chrome', 'User Data'), exe: 'chrome.exe' },
    { id: 'edge', name: 'Edge', dataDir: path.join(L, 'Microsoft', 'Edge', 'User Data'), exe: 'msedge.exe' },
    { id: 'brave', name: 'Brave', dataDir: path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data'), exe: 'brave.exe' },
    { id: 'vivaldi', name: 'Vivaldi', dataDir: path.join(L, 'Vivaldi', 'User Data'), exe: 'vivaldi.exe' },
    // verify: Opera keeps its profile in Roaming and its cache in Local; not installed on the dev PC.
    { id: 'opera', name: 'Opera', dataDir: path.join(A, 'Opera Software', 'Opera Stable'), cacheDir: path.join(L, 'Opera Software', 'Opera Stable'), singleProfile: true, exe: 'opera.exe' },
    { id: 'operagx', name: 'Opera GX', dataDir: path.join(A, 'Opera Software', 'Opera GX Stable'), cacheDir: path.join(L, 'Opera Software', 'Opera GX Stable'), singleProfile: true, exe: 'opera.exe' },
  ];
  const out: CleanTarget[] = [];
  for (const b of chromium) {
    chromiumProfiles(b).forEach(({ dir, label, cache }, i) => {
      const id = `${b.id}:${i}`;
      const processes = [b.exe];
      out.push(
        t({ id: `${id}:cache`, group: 'browser', subgroup: label, name: 'Cache', description: 'Cached pages, images and scripts. Files the open browser is using are skipped.', roots: ['Cache', 'Code Cache', 'GPUCache'].map((d) => path.join(cache, d)), processes }),
        t({ id: `${id}:cookies`, group: 'browser', subgroup: label, name: 'Cookies', description: 'Signs you out of every website in this profile.', risk: 'caution', defaultSelected: false, needsClosed: true, roots: [path.join(dir, 'Network'), dir], match: /^Cookies(-journal)?$/, depth: 0, processes }),
        t({ id: `${id}:history`, group: 'browser', subgroup: label, name: 'History', description: 'Browsing and download history for this profile.', risk: 'caution', defaultSelected: false, needsClosed: true, roots: [dir], match: /^History(-journal)?$/, depth: 0, processes }),
        t({
          id: `${id}:passwords`,
          group: 'browser',
          subgroup: label,
          name: 'Saved passwords',
          description: 'Deletes the passwords saved in this profile. If browser sync is on, they come back from your account; otherwise they are gone for good.',
          risk: 'risky',
          defaultSelected: false,
          needsClosed: true,
          roots: [dir],
          match: /^Login Data( For Account)?(-journal)?$/,
          depth: 0,
          processes,
        }),
      );
    });
  }
  // Firefox: profile in Roaming, cache in Local. History lives in places.sqlite with bookmarks, so it is not offered.
  const ffRoaming = path.join(A, 'Mozilla', 'Firefox', 'Profiles');
  if (existsSync(ffRoaming)) {
    for (const p of readdirSync(ffRoaming)) {
      const label = `Firefox: ${p.replace(/^[^.]+\./, '')}`;
      const dir = path.join(ffRoaming, p);
      const processes = ['firefox.exe'];
      out.push(
        t({ id: `firefox:${p}:cache`, group: 'browser', subgroup: label, name: 'Cache', description: 'Cached pages, images and scripts.', roots: [path.join(L, 'Mozilla', 'Firefox', 'Profiles', p, 'cache2')], processes }),
        t({ id: `firefox:${p}:cookies`, group: 'browser', subgroup: label, name: 'Cookies', description: 'Signs you out of every website in this profile.', risk: 'caution', defaultSelected: false, needsClosed: true, roots: [dir], match: /^cookies\.sqlite(-wal|-shm)?$/, depth: 0, processes }),
        t({ id: `firefox:${p}:passwords`, group: 'browser', subgroup: label, name: 'Saved passwords', description: 'Deletes the passwords saved in this profile.', risk: 'risky', defaultSelected: false, needsClosed: true, roots: [dir], match: /^logins(-backup)?\.json$/, depth: 0, processes }),
      );
    }
  }
  return out;
}

export const buildTargets = (e: Env) => [...systemTargets(e), ...browserTargets(e), ...appTargets(e)];

/** Roots so broad that only a single-file match may run in them. */
export function unsafeRoot(root: string, e: Env, target: CleanTarget): string | null {
  const r = path.resolve(root).toLowerCase();
  const broad = [e.USERPROFILE, e.SystemRoot, e.LOCALAPPDATA, e.APPDATA, e.ProgramData, e.ProgramFilesX86].map((p) => path.resolve(p).toLowerCase());
  if (r === path.parse(r).root || r.split(path.sep).filter(Boolean).length < 2) return 'drive root';
  if (broad.includes(r) && !(target.depth === 0 && target.match)) return 'too broad without a file filter';
  return null;
}

export function createCleaner(adapter: SystemAdapter, env: Env) {
  let targets = buildTargets(env);
  const isRunning = (x: CleanTarget, procs: Set<string>) => !!x.processes?.some((p) => procs.has(p));

  async function scanOne(x: CleanTarget, onFile?: () => void) {
    let bytes = 0;
    let files = 0;
    let inaccessible = 0;
    for (const root of x.roots) {
      if (unsafeRoot(root, env, x)) throw new Error(`Refusing to clean ${root}: ${unsafeRoot(root, env, x)}`);
      if (!existsSync(root)) continue;
      const r = await walk(root, {
        match: x.match,
        depth: x.depth,
        minAgeMs: (x.minAgeHours ?? 0) * 3_600_000,
        skip: adapter.isRemoved,
        onFile,
      });
      bytes += r.bytes;
      files += r.files.length;
      inaccessible += r.inaccessible;
    }
    return { bytes, files, inaccessible };
  }

  return {
    async list(): Promise<CleanTargetView[]> {
      targets = buildTargets(env);
      const procs = await runningProcesses(adapter);
      return targets.map(({ roots, match, depth, minAgeHours, processes, script, ...view }) => ({ ...view, running: !!processes?.some((p) => procs.has(p)) }));
    },

    get: (id: unknown) => targets.find((x) => x.id === id),

    async scan(x: CleanTarget): Promise<ScanResult> {
      try {
        const r = await scanOne(x);
        return { id: x.id, bytes: r.bytes, files: r.files, inaccessible: r.inaccessible };
      } catch (err) {
        return { id: x.id, bytes: 0, files: 0, inaccessible: 0, error: (err as Error).message };
      }
    },

    async clean(x: CleanTarget, procs: Set<string>): Promise<CleanResult> {
      if (x.needsClosed && isRunning(x, procs)) return { id: x.id, freed: 0, files: 0, locked: 0, skipped: 'Close the app first.' };
      const scanned = await scanOne(x);
      if (x.script) {
        await adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', x.script], 600_000);
        return { id: x.id, freed: scanned.bytes, files: scanned.files, locked: 0 };
      }
      let freed = 0;
      let files = 0;
      let locked = 0;
      for (const root of x.roots) {
        if (!existsSync(root)) continue;
        const r = await walk(root, { match: x.match, depth: x.depth, minAgeMs: (x.minAgeHours ?? 0) * 3_600_000, skip: adapter.isRemoved });
        const rootPrefix = path.resolve(root).toLowerCase() + path.sep;
        for (const f of r.files) {
          if (!path.resolve(f.path).toLowerCase().startsWith(rootPrefix)) continue; // belt and braces
          try {
            await adapter.removeFile(f.path);
            freed += f.size;
            files++;
          } catch {
            locked++; // in use, or no permission
          }
        }
        for (const d of r.dirs) await adapter.removeEmptyDir(d); // deepest first, never the root
      }
      return { id: x.id, freed, files, locked };
    },
  };
}

const DRIVE_SCRIPT =
  "$d = Get-PhysicalDisk | ForEach-Object { $r = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue; [pscustomobject]@{ name=$_.FriendlyName; media=\"$($_.MediaType)\"; bus=\"$($_.BusType)\"; health=\"$($_.HealthStatus)\"; status=\"$($_.OperationalStatus -join ', ')\"; size=$_.Size; wear=$r.Wear; temperature=$r.Temperature; powerOnHours=$r.PowerOnHours; readErrors=$r.ReadErrorsTotal; writeErrors=$r.WriteErrorsTotal } }; @($d) | ConvertTo-Json -Compress";

/** Read-only. Reliability counters (wear, temperature, hours, errors) need administrator. */
export async function driveHealth(adapter: SystemAdapter): Promise<DriveInfo[]> {
  const out = (await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', DRIVE_SCRIPT], 60_000)).trim();
  if (!out) return [];
  const raw = JSON.parse(out);
  return Array.isArray(raw) ? raw : [raw];
}

