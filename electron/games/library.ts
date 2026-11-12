// Game library: every installed Steam and Epic game (not just the ones with a profile), with its main .exe and how
// to launch it. Read-only: install manifests and folder listings only.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryGame } from '../../shared/types';
import { NOT_A_LAUNCH } from '../system/usage';
import { steamLibraries, type GameEnv, type LaunchTarget } from './games';

/** Steam entries that are tools, not games. */
const NOT_A_GAME = /redistributable|steamworks|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|benchmark tool/i;
/**
 * Steam "Software" that runs all the time (docks, wallpapers, overlays, scalers). Listed as games they'd keep Game
 * Boost on permanently. Steam's app type is only in its binary appinfo cache, so these are named.
 */
const ALWAYS_ON_TOOL = /^(wallpaper engine|lossless scaling|mydockfinder|crosshair x|fps monitor|soundpad|voicemod|vtube studio|rainmeter|groupy|start11|fences|displayfusion|translucenttb|deskscapes|cursor fx|rivatuner|msi afterburner|obs studio|streamlabs|discord|nvidia broadcast|aseprite|blender|krita|rpg maker.*|game ?maker.*|clip studio paint.*|sound ?forge.*|fl studio.*|ableton.*|3dmark|pcmark.*|superposition benchmark|heaven benchmark|cinebench|aida64.*)$/i;
/** Folders that hold installers, runtimes and anti-cheat, never the game itself. */
const SKIP_DIR = /^(setup|tools|sdk|streamingassets|_commonredist|commonredist|redist|redistributables?|directx|vcredist|dotnet|support|installers?|easyanticheat|battleye|__installer|prerequisites|thirdparty|crashreport.*|engine)$/i;

export type LibraryEntry = LibraryGame & { launch: LaunchTarget };

/** `"key"  "value"` pairs of a Valve KeyValues file (flat; enough for appmanifest_*.acf). */
export const acfValue = (text: string, key: string) => new RegExp(`^\\s*"${key}"\\s+"([^"]*)"`, 'mi').exec(text)?.[1] ?? null;

/** Programs that ship next to games but aren't the game. */
const NOT_THE_GAME = /crash|launcher|redist|dxsetup|dotnetfx|physx|oalinst|xnafx|ue4prereq|cefprocess|anticheat|editor|viewer|vconsole|uploader|workshop|server|hlds|hltv|srcds|dedicated|stockfish|ildasm|benchmark|config|settings/i;

/**
 * The game's main program, a best guess (up to 3 folders deep): an Unreal "-Shipping.exe" if there is one, else the
 * largest program in the game's own folder, else the largest found deeper. Installers, runtimes, tools and editors
 * are skipped.
 */
export async function mainExe(dir: string): Promise<string | null> {
  const found: Array<{ file: string; size: number; depth: number }> = [];
  const walk = async (d: string, depth: number) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (depth < 3 && !SKIP_DIR.test(e.name)) await walk(full, depth + 1);
      } else if (e.isFile() && /\.exe$/i.test(e.name) && !NOT_A_LAUNCH.test(e.name) && !NOT_THE_GAME.test(e.name)) {
        found.push({ file: full, size: (await stat(full).catch(() => null))?.size ?? 0, depth });
      }
    }
  };
  await walk(dir, 0);
  const largest = (xs: typeof found) => xs.sort((a, b) => b.size - a.size)[0]?.file ?? null;
  return largest(found.filter((f) => /-shipping\.exe$/i.test(f.file))) ?? largest(found.filter((f) => f.depth === 0)) ?? largest(found);
}

/** Riot product ids -> names (folder names under ProgramData\Riot Games\Metadata). */
const RIOT_NAMES: Record<string, string> = {
  valorant: 'VALORANT',
  league_of_legends: 'League of Legends',
  bacon: 'Legends of Runeterra',
  lion: '2XKO',
};

/**
 * Riot games: each Metadata\<product>.<patchline> folder has a product_settings.yaml with product_install_full_path
 * (read on the dev PC, 2026-11). Only live patchlines whose folder exists. Launched through Riot Client like its own
 * Start menu shortcuts. teamfighttactics shares League's client, so it's not listed separately.
 */
async function riotGames(env: GameEnv): Promise<LibraryEntry[]> {
  const root = path.join(env.programData, 'Riot Games');
  const rc = await readFile(path.join(root, 'RiotClientInstalls.json'), 'utf8').then((t) => (JSON.parse(t) as { rc_default?: string }).rc_default, () => undefined);
  if (!rc) return [];
  const out: LibraryEntry[] = [];
  for (const dir of await readdir(path.join(root, 'Metadata')).catch(() => [] as string[])) {
    const m = /^([a-z0-9_]+)\.live$/.exec(dir);
    if (!m || m[1] === 'teamfighttactics') continue;
    const yaml = await readFile(path.join(root, 'Metadata', dir, `${dir}.product_settings.yaml`), 'utf8').catch(() => '');
    const install = /product_install_full_path:\s*"([^"]+)"/.exec(yaml)?.[1];
    if (!install || !(await stat(install).catch(() => null))) continue;
    const exe = await mainExe(path.normalize(install));
    if (!exe) continue;
    const name = RIOT_NAMES[m[1]] ?? m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    out.push({ id: `riot-${dir}`, name, source: 'riot', exe, launch: { exe: path.normalize(rc), args: [`--launch-product=${m[1]}`, '--launch-patchline=live'] } });
  }
  return out;
}

/**
 * Registry- and manifest-based stores, read in one PowerShell query (base64 JSON):
 *   Ubisoft Connect: HKLM\...\Ubisoft\Launcher\Installs\<id> InstallDir (key read on the dev PC).
 *   GOG: HKLM\...\GOG.com\Games\<id> gameName / exe / path. verify: no GOG game on the dev PC.
 *   Xbox app / Game Pass: <drive>:\XboxGames\<game>\Content\MicrosoftGame.config (Identity Name, Executable) and the
 *   package family name from Get-AppxPackage (folders read on the dev PC).
 */
export const STORES_SCRIPT =
  "$o = @{ ubisoft = @(); gog = @(); xbox = @() }; " +
  "$o.ubisoft = @(Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id = $_.PSChildName; dir = [string](Get-ItemProperty $_.PSPath).InstallDir } }); " +
  "$o.gog = @(Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games' -ErrorAction SilentlyContinue | ForEach-Object { $g = Get-ItemProperty $_.PSPath; [pscustomobject]@{ id = $_.PSChildName; name = [string]$g.gameName; exe = [string]$g.exe } }); " +
  "$o.xbox = @(Get-PSDrive -PSProvider FileSystem | ForEach-Object { Get-ChildItem (Join-Path $_.Root 'XboxGames') -Directory -ErrorAction SilentlyContinue } | ForEach-Object { $cfg = Join-Path $_.FullName 'Content\\MicrosoftGame.config'; if (Test-Path $cfg) { " +
  "[xml]$x = Get-Content $cfg -Raw; $g = $x.Game; $e = @($g.ExecutableList.Executable)[0]; $p = Get-AppxPackage -Name $g.Identity.Name -ErrorAction SilentlyContinue | Select-Object -First 1; " +
  "[pscustomobject]@{ dir = $_.FullName; name = [string]$g.ShellVisuals.DefaultDisplayName; folder = $_.Name; exe = [string]$e.Name; appId = [string]$e.Id; pfn = [string]$p.PackageFamilyName } } }); " +
  '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $o -Compress -Depth 4)))';

type StoresRaw = {
  ubisoft?: Array<{ id?: string; dir?: string }>;
  gog?: Array<{ id?: string; name?: string; exe?: string }>;
  xbox?: Array<{ dir?: string; name?: string; folder?: string; exe?: string; appId?: string; pfn?: string }>;
};

/** Ubisoft, GOG and Xbox entries from STORES_SCRIPT's output. Only games whose files exist. */
export async function parseStores(base64: string, systemRoot = 'C:\\Windows'): Promise<LibraryEntry[]> {
  const json = Buffer.from(base64.trim(), 'base64').toString('utf8').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!json) return [];
  const raw = JSON.parse(json) as StoresRaw;
  const arr = <T>(v: T[] | T | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const out: LibraryEntry[] = [];
  for (const u of arr(raw.ubisoft)) {
    if (!u.id || !/^\d+$/.test(u.id) || !u.dir || !(await stat(u.dir).catch(() => null))) continue;
    const exe = await mainExe(path.normalize(u.dir));
    if (exe) out.push({ id: `ubisoft-${u.id}`, name: path.basename(path.normalize(u.dir)), source: 'ubisoft', exe, launch: { url: `uplay://launch/${u.id}/0` } });
  }
  for (const g of arr(raw.gog)) {
    if (!g.id || !/^\d+$/.test(g.id) || !g.name || !g.exe || !(await stat(g.exe).catch(() => null))) continue;
    out.push({ id: `gog-${g.id}`, name: g.name, source: 'gog', exe: g.exe, launch: { exe: g.exe, args: [] } });
  }
  for (const x of arr(raw.xbox)) {
    if (!x.dir || !x.exe || !x.appId || !x.pfn || !/^[\w.-]+_[a-z0-9]+$/i.test(x.pfn) || !/^[\w.-]+$/.test(x.appId)) continue;
    const exe = path.join(x.dir, 'Content', x.exe);
    if (!(await stat(exe).catch(() => null))) continue;
    const name = x.name && !/^ms-resource:/i.test(x.name) ? x.name : (x.folder ?? path.basename(x.dir));
    out.push({ id: `xbox-${x.pfn}`, name, source: 'xbox', exe, launch: { exe: path.join(systemRoot, 'explorer.exe'), args: [`shell:AppsFolder\\${x.pfn}!${x.appId}`] } });
  }
  return out;
}

export async function scanLibrary(env: GameEnv, query?: (file: string, args: string[]) => Promise<string>): Promise<LibraryEntry[]> {
  const out: LibraryEntry[] = [];
  out.push(...(await riotGames(env).catch(() => [])));
  if (query) {
    const ps = path.join(env.vars.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const raw = await query(ps, ['-NoProfile', '-NonInteractive', '-Command', STORES_SCRIPT]).catch(() => '');
    out.push(...(await parseStores(raw, env.vars.SystemRoot ?? 'C:\\Windows').catch(() => [])));
  }
  // Steam: every library folder's appmanifest_<id>.acf names the game and its folder under steamapps\common.
  for (const lib of await steamLibraries(env.steamPath)) {
    const apps = path.join(lib, 'steamapps');
    for (const f of await readdir(apps).catch(() => [] as string[])) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      const acf = await readFile(path.join(apps, f), 'utf8').catch(() => '');
      const [id, name, dir] = [acfValue(acf, 'appid'), acfValue(acf, 'name'), acfValue(acf, 'installdir')];
      if (!id || !name || !dir || NOT_A_GAME.test(name) || ALWAYS_ON_TOOL.test(name.trim())) continue;
      const exe = await mainExe(path.join(apps, 'common', dir));
      if (exe) out.push({ id: `steam-${id}`, name, source: 'steam', exe, launch: { url: `steam://rungameid/${id}` } });
    }
  }
  // Epic: the launcher's .item manifests (JSON) give the folder, the exe and the app name it launches by.
  const manifests = path.join(env.programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  for (const f of await readdir(manifests).catch(() => [] as string[])) {
    if (!f.toLowerCase().endsWith('.item')) continue;
    const m = await readFile(path.join(manifests, f), 'utf8').then((t) => JSON.parse(t) as Record<string, unknown>, () => null);
    const [name, dir, exe, app] = [m?.DisplayName, m?.InstallLocation, m?.LaunchExecutable, m?.AppName].map((v) => (typeof v === 'string' ? v : ''));
    if (!name || !dir || !exe || !app || m?.bIsIncompleteInstall === true) continue;
    out.push({ id: `epic-${app}`, name, source: 'epic', exe: path.join(dir, exe), launch: { url: `com.epicgames.launcher://apps/${encodeURIComponent(app)}?action=launch&silent=true` } });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
