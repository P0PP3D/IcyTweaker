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

export async function scanLibrary(env: GameEnv): Promise<LibraryEntry[]> {
  const out: LibraryEntry[] = [];
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
