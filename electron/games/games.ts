// Game profiles: find installs and config files, read current values, apply a profile, reset it.
// Writing is: back up each key (safety layer), patch only the keys the profile owns, read back to verify.
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ActionReport, GameFlag, GameValues, GameView } from '../../shared/types';
import { refId, runningProcesses, type SettingRef, type Value } from '../system/adapter';
import type { Safety } from '../system/safety';
import type { GameProfile, Key, Write } from './profiles';

export interface GameEnv {
  /** Environment variables for %VAR% in paths. */
  vars: Record<string, string | undefined>;
  steamPath: string;
  programData: string;
}

type Files = Record<string, string | null>;
type Ref = Extract<SettingRef, { kind: 'configKey' }>;

/** Expands %VAR% and {steam}; each * segment matches any folder. The newest existing file wins. */
export async function resolvePath(pattern: string, env: GameEnv): Promise<string | null> {
  const full = pattern.replace(/%(\w+)%/g, (m, v: string) => env.vars[v] ?? m).replace('{steam}', env.steamPath);
  const [root, ...parts] = path.normalize(full).split(path.sep);
  let cands = [root + path.sep];
  for (const part of parts) {
    if (part !== '*') {
      cands = cands.map((c) => path.join(c, part));
      continue;
    }
    const next: string[] = [];
    for (const c of cands) {
      const dirs = await readdir(c, { withFileTypes: true }).catch(() => []);
      next.push(...dirs.filter((d) => d.isDirectory()).map((d) => path.join(c, d.name))); // links are not followed
    }
    cands = next;
  }
  const found = await Promise.all(cands.map(async (c) => ({ c, s: await stat(c).catch(() => null) })));
  const files = found.filter((f) => f.s?.isFile()).sort((a, b) => b.s!.mtimeMs - a.s!.mtimeMs);
  return files[0]?.c ?? null;
}

export const steamLibraries = async (steamPath: string) => {
  const vdf = await readFile(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
  const libs = [...vdf.matchAll(/^\s*"path"\s+"(.+)"\s*$/gm)].map((m) => m[1].replace(/\\\\/g, '\\'));
  return libs.length ? libs : [steamPath];
};

/** Install folders the icon tokens point at, or null when that launcher doesn't have the game. */
async function tokenDir(token: string, env: GameEnv): Promise<string | null> {
  const [kind, id] = token.split(':');
  if (kind === 'steamapp') {
    for (const lib of await steamLibraries(env.steamPath)) {
      const acf = await readFile(path.join(lib, 'steamapps', `appmanifest_${id}.acf`), 'utf8').catch(() => null);
      const dir = acf && /"installdir"\s+"([^"]+)"/.exec(acf)?.[1];
      if (dir) return path.join(lib, 'steamapps', 'common', dir);
    }
    return null;
  }
  if (kind === 'epic') {
    const dat = await readFile(path.join(env.programData, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat'), 'utf8').catch(() => '{}');
    const list: Array<{ AppName?: string; InstallLocation?: string }> = (JSON.parse(dat) as { InstallationList?: [] }).InstallationList ?? [];
    return list.find((i) => i.AppName?.toLowerCase() === id.toLowerCase())?.InstallLocation ?? null;
  }
  if (kind === 'riot') {
    const json = await readFile(path.join(env.programData, 'Riot Games', 'RiotClientInstalls.json'), 'utf8').catch(() => '{}');
    const dirs = Object.keys((JSON.parse(json) as { associated_client?: Record<string, string> }).associated_client ?? {});
    const hit = dirs.find((d) => d.toLowerCase().includes(id.toLowerCase()));
    return hit ? path.normalize(hit) : null;
  }
  return null;
}

/** The game's installed .exe (for its icon), or null when it isn't installed. Read-only. */
/** resolvePath plus a leading {steamapp:ID} / {epic:AppName} / {riot:name} install-folder token. */
export async function resolvePattern(pattern: string, env: GameEnv): Promise<string | null> {
  const token = /^\{(\w+:[^}]+)\}/.exec(pattern);
  let full = pattern;
  if (token) {
    const dir = await tokenDir(token[1], env).catch(() => null);
    if (!dir) return null;
    full = dir + pattern.slice(token[0].length);
  }
  return resolvePath(full, env).catch(() => null);
}

export async function findGameExe(p: GameProfile, env: GameEnv): Promise<string | null> {
  for (const pattern of p.icon) {
    const found = await resolvePattern(pattern, env);
    if (found) return found;
  }
  return null;
}

export type LaunchTarget = { url: string } | { exe: string; args: string[] };

/** How to start the game through its own launcher (Steam, Epic, Riot), else its installed .exe. null = not installed. Read-only. */
export async function launchTarget(p: GameProfile, env: GameEnv): Promise<LaunchTarget | null> {
  if (p.install.steam && (await tokenDir(`steamapp:${p.install.steam}`, env).catch(() => null))) return { url: `steam://rungameid/${p.install.steam}` };
  if (p.install.riot) {
    const [product, patchline] = p.install.riot.split('.');
    const json = await readFile(path.join(env.programData, 'Riot Games', 'RiotClientInstalls.json'), 'utf8').catch(() => '{}');
    const rc = (JSON.parse(json) as { rc_default?: string }).rc_default;
    if (rc && existsSync(rc) && (await tokenDir(`riot:${product}`, env).catch(() => null)))
      return { exe: path.normalize(rc), args: [`--launch-product=${product}`, `--launch-patchline=${patchline}`] };
  }
  const exe = await findGameExe(p, env);
  if (!exe) return null;
  // Epic games can't start from their own exe (they need the launcher's login), even when Epic's install list misses them.
  const epic = p.icon.map((x) => /^\{epic:([^}]+)\}/.exec(x)?.[1]).find(Boolean);
  return epic ? { url: `com.epicgames.launcher://apps/${encodeURIComponent(epic)}?action=launch&silent=true` } : { exe, args: [] };
}

/** Checks the values against what this game supports. null = valid. */
export function validateValues(p: GameProfile, v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'Invalid request.';
  const x = v as Record<string, unknown>;
  const int = (n: unknown, min: number, max: number) => n === undefined || (Number.isInteger(n) && (n as number) >= min && (n as number) <= max);
  if ((x.width === undefined) !== (x.height === undefined)) return 'Width and height go together.';
  if (x.width !== undefined && !p.resolution) return 'This game has no resolution setting here.';
  if (!int(x.width, 640, 7680) || !int(x.height, 360, 4320)) return 'Resolution must be between 640×360 and 7680×4320.';
  if (x.fps !== undefined && !p.fps) return 'This game has no FPS cap setting here.';
  if (!int(x.fps, 0, 1000)) return 'FPS cap must be 0 (unlimited) to 1000.';
  if (x.aa !== undefined && !int(x.aa, 0, (p.aa?.length ?? 0) - 1)) return 'Invalid anti-aliasing choice.';
  if (x.reflex !== undefined && !int(x.reflex, 0, (p.reflex?.length ?? 0) - 1)) return 'Invalid NVIDIA Reflex choice.';
  if (!Array.isArray(x.flags) || new Set(x.flags).size !== x.flags.length || x.flags.some((f) => !(f in p.flags))) return 'Invalid options.';
  if (x.flags.includes('fullscreen') && x.flags.includes('borderless')) return 'Pick fullscreen or borderless windowed, not both.';
  return null;
}

/** The keys and values a profile writes. Fields left out write nothing. */
export function toWrites(p: GameProfile, v: GameValues): Write[] {
  const out: Write[] = [];
  if (p.resolution && v.width !== undefined && v.height !== undefined) {
    out.push(...p.resolution.w.map((k): Write => [k, String(v.width)]), ...p.resolution.h.map((k): Write => [k, String(v.height)]));
  }
  if (p.fps && v.fps !== undefined) {
    out.push([p.fps.key, v.fps === 0 && p.fps.unlimited ? p.fps.unlimited : p.fps.float ? `${v.fps}.000000` : String(v.fps)]);
  }
  if (p.aa && v.aa !== undefined) out.push(...p.aa[v.aa].set);
  if (p.reflex && v.reflex !== undefined) out.push(...p.reflex[v.reflex].set);
  for (const f of v.flags) out.push(...(p.flags[f] ?? []));
  return out;
}

const same = (a: Value | null, b: string) => a !== null && String(a).toLowerCase() === b.toLowerCase();

export function createGames(profiles: GameProfile[], safety: Safety, env: GameEnv) {
  const ref = (p: GameProfile, k: Key, files: Files): Ref | null => {
    const file = files[k.file];
    return file ? { kind: 'configKey', file, format: p.files[k.file].format, section: k.section, name: k.name, owner: p.id } : null;
  };
  const owned = (p: GameProfile) => safety.changedRefs().filter((r): r is Ref => r.kind === 'configKey' && r.owner === p.id);

  async function filesOf(p: GameProfile): Promise<Files> {
    const out: Files = {};
    for (const [id, f] of Object.entries(p.files)) out[id] = await resolvePattern(f.path, env);
    return out;
  }

  async function installs() {
    const steam = new Set<number>();
    const libs = await steamLibraries(env.steamPath);
    for (const p of profiles) {
      if (p.install.steam && libs.some((l) => existsSync(path.join(l, 'steamapps', `appmanifest_${p.install.steam}.acf`)))) steam.add(p.install.steam);
    }
    // Epic: each install has a manifest with its display name.
    const epicDir = path.join(env.programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    const epic = new Set<string>();
    for (const f of await readdir(epicDir).catch(() => [])) {
      if (!f.endsWith('.item')) continue;
      const name = await readFile(path.join(epicDir, f), 'utf8').then((t) => String(JSON.parse(t).DisplayName ?? ''), () => '');
      epic.add(name.toLowerCase());
    }
    return (p: GameProfile) =>
      (!!p.install.steam && steam.has(p.install.steam)) ||
      epic.has(p.name.toLowerCase()) ||
      (!!p.install.riot && existsSync(path.join(env.programData, 'Riot Games', 'Metadata', p.install.riot)));
  }

  async function current(p: GameProfile, files: Files): Promise<GameValues> {
    const read = async (k: Key) => {
      const r = ref(p, k, files);
      return r ? safety.read(r) : null;
    };
    const matches = async (w: Write[]) => w.length > 0 && (await Promise.all(w.map(async ([k, v]) => same(await read(k), v)))).every(Boolean);
    const pick = async (choices?: Array<{ set: Write[] }>) => {
      for (const [i, c] of (choices ?? []).entries()) if (await matches(c.set)) return i;
      return undefined;
    };
    const num = (v: Value | null) => (v === null || Number.isNaN(parseFloat(String(v))) ? undefined : Math.round(parseFloat(String(v))));
    const flags: GameFlag[] = [];
    for (const [f, w] of Object.entries(p.flags) as Array<[GameFlag, Write[]]>) if (await matches(w)) flags.push(f);
    return {
      width: p.resolution ? num(await read(p.resolution.w[0])) : undefined,
      height: p.resolution ? num(await read(p.resolution.h[0])) : undefined,
      fps: p.fps ? await read(p.fps.key).then((v) => (p.fps!.unlimited && same(v, p.fps!.unlimited) ? 0 : num(v))) : undefined,
      aa: await pick(p.aa),
      reflex: await pick(p.reflex),
      flags,
    };
  }

  return {
    async list(): Promise<GameView[]> {
      const isInstalled = await installs();
      const procs = await runningProcesses(safety.adapter);
      return Promise.all(
        profiles.map(async (p) => {
          const files = await filesOf(p);
          const hasConfig = files[Object.keys(p.files)[0]] !== null;
          const status = owned(p).length ? 'optimized' : hasConfig ? 'not-optimized' : isInstalled(p) ? 'no-config' : 'not-installed';
          return {
            id: p.id,
            name: p.name,
            publisher: p.publisher,
            status,
            running: p.exe.some((e) => procs.has(e)),
            checkedVersion: p.checkedVersion,
            note: p.note,
            configPaths: Object.values(files).filter((f): f is string => !!f),
            supports: {
              resolution: !!p.resolution,
              fps: !!p.fps,
              aa: p.aa?.map((c) => c.label) ?? null,
              reflex: p.reflex?.map((c) => c.label) ?? null,
              flags: Object.keys(p.flags) as GameFlag[],
            },
            current: hasConfig ? await current(p, files) : { flags: [] },
            recommended: { ...p.recommended },
            // When IcyTweaker first changed this game's settings (the backup's time): sessions before vs after it.
            optimizedAt: owned(p).map((r) => safety.savedAt(r)).filter((x): x is string => !!x).sort()[0] ?? null,
          };
        }),
      );
    },

    /** Values must have passed validateValues. */
    async apply(p: GameProfile, values: GameValues): Promise<ActionReport> {
      const procs = await runningProcesses(safety.adapter);
      if (p.exe.some((e) => procs.has(e))) return { ok: false, message: `Close ${p.name} first: it rewrites its settings when it exits.` };
      const files = await filesOf(p);
      if (files[Object.keys(p.files)[0]] === null) return { ok: false, message: `${p.name} has no settings file yet. Start the game once, then try again.` };

      const writes = toWrites(p, values).map(([k, v]) => ({ k, v, r: ref(p, k, files) }));
      // A key the file doesn't have means the game changed since this profile was written: change nothing.
      const missing: string[] = [];
      for (const w of writes) if (!w.r || (await safety.read(w.r)) === null) missing.push(w.k.name);
      if (missing.length) {
        return {
          ok: false,
          message: `${p.name}: nothing was changed. These settings are not in its config file: ${[...new Set(missing)].join(', ')}. The game may have renamed them (profile checked against ${p.checkedVersion}).`,
        };
      }

      // Keys this profile no longer sets go back to what the user had.
      const ids = new Set(writes.map((w) => refId(w.r!)));
      for (const r of owned(p)) if (!ids.has(refId(r))) await safety.restore(r);
      for (const w of writes) await safety.set(w.r!, w.v);

      const wrong: string[] = [];
      for (const w of writes) if (!same(await safety.read(w.r!), w.v)) wrong.push(w.k.name);
      if (wrong.length) return { ok: false, message: `${p.name}: written, but these did not read back as set: ${wrong.join(', ')}. Reset puts the originals back.` };
      return { ok: true, message: `${p.name} profile applied: ${writes.length} setting(s)${safety.adapter.live ? '' : ' (dry-run: nothing written)'}. Reset puts your originals back.` };
    },

    async reset(p: GameProfile): Promise<ActionReport> {
      const refs = owned(p);
      if (refs.length === 0) return { ok: true, message: `${p.name}: nothing to reset.` };
      const procs = await runningProcesses(safety.adapter);
      if (p.exe.some((e) => procs.has(e))) return { ok: false, message: `Close ${p.name} first: it rewrites its settings when it exits.` };
      for (const r of refs) await safety.restore(r);
      return { ok: true, message: `${p.name}: ${refs.length} setting(s) put back${safety.adapter.live ? '' : ' (dry-run)'}.` };
    },
  };
}
