// Phase 6: config parsing, game profiles, App Optimizer guard. Fixture files are real files in ./.test-tmp/games,
// read through liveRead like dry-run does; every write is the fake adapter's (nothing written to disk by the app).
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NO_APPS, appTweaks } from './apps/apps';
import { getKey, setKey } from './games/config';
import { createGames, resolvePath, toWrites, validateValues, type GameEnv } from './games/games';
import { gameProfiles, type GameProfile, type Key } from './games/profiles';
import type { GameFlag } from '../shared/types';
import { liveRead, memoryAdapter } from './system/adapter';
import { createSafety } from './system/safety';
import { createEngine } from './tweaks/engine';
import { presets } from './tweaks/presets';

const TMP = path.join(process.cwd(), '.test-tmp', 'games');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;

describe('config files', () => {
  const ini = ';METADATA=x\r\n[A]\r\nKey=1\r\nOther=2\r\n\r\n[B]\r\nKey=3\r\n';
  it('ini: reads and patches one key in the right section, keeping CRLF and every other line', () => {
    expect(getKey(ini, 'ini', 'B', 'key')).toBe('3');
    expect(getKey(ini, 'ini', 'A', 'Missing')).toBeNull();
    expect(setKey(ini, 'ini', 'B', 'Key', '9')).toBe(ini.replace('Key=3', 'Key=9'));
    expect(setKey(ini, 'ini', 'A', 'Other', null)).toBe(ini.replace('Other=2\r\n', ''));
    expect(() => setKey(ini, 'ini', 'A', 'New', '1')).toThrow(/not in this file/); // never invents keys
  });

  it('kv, cfg and json', () => {
    const kv = '"VideoConfig"\n{\n\t"setting.fullscreen"\t\t"0"\n}\n';
    expect(getKey(kv, 'kv', undefined, 'setting.fullscreen')).toBe('0');
    expect(setKey(kv, 'kv', undefined, 'setting.fullscreen', '1')).toBe(kv.replace('"0"', '"1"'));
    const cfg = 'bind "x" "+jump"\ngfx_nvnUseLowLatency "1"\n';
    expect(setKey(cfg, 'cfg', undefined, 'gfx_nvnUseLowLatency', '0')).toBe(cfg.replace('"1"', '"0"'));
    const json = '{\n  "a": 1,\n  "enableHardwareAcceleration": true\n}';
    expect(getKey(json, 'json', undefined, 'enableHardwareAcceleration')).toBe(true);
    expect(JSON.parse(setKey(json, 'json', undefined, 'enableHardwareAcceleration', null))).toEqual({ a: 1 });
    expect(JSON.parse(setKey('{}', 'json', undefined, 'x', false))).toEqual({ x: false });
  });

  it('nested json keeps minified files minified; prefs may add a key; xml patches the element text', () => {
    const local = '{"hardware_acceleration_mode":{"enabled":true},"other":1}';
    expect(getKey(local, 'json', undefined, 'hardware_acceleration_mode.enabled')).toBe(true);
    expect(setKey(local, 'json', undefined, 'background_mode.enabled', false)).toBe('{"hardware_acceleration_mode":{"enabled":true},"other":1,"background_mode":{"enabled":false}}');
    expect(setKey(local, 'json', undefined, 'missing.key', null)).toBe(local);

    const prefs = 'app.autostart-configured=true\nstorage.last-location="C:\\\\x"\n';
    expect(setKey(prefs, 'prefs', undefined, 'ui.hardware_acceleration', 'false')).toBe(`${prefs}ui.hardware_acceleration=false\n`);
    expect(setKey(`${prefs}ui.hardware_acceleration=false\n`, 'prefs', undefined, 'ui.hardware_acceleration', null)).toBe(prefs);

    const xml = '<Item>\r\n      <int name="FramerateCap">9999</int>\r\n      <bool name="Fullscreen">false</bool>\r\n</Item>';
    expect(getKey(xml, 'xml', undefined, 'Fullscreen')).toBe('false');
    expect(setKey(xml, 'xml', undefined, 'FramerateCap', '240')).toBe(xml.replace('9999', '240'));
    expect(() => setKey(xml, 'xml', undefined, 'Nope', '1')).toThrow();
  });
});

const ORIGINAL = '9'; // differs from every value a profile writes

/** Writes a config file per profile file holding every key the profile can touch, set to ORIGINAL. */
/** Every option a profile has, except borderless: it is the other display mode to fullscreen (same keys). */
const allFlags = (p: GameProfile) => (Object.keys(p.flags) as GameFlag[]).filter((f) => f !== 'borderless') as never;

async function fixture(p: GameProfile, drop?: string) {
  const root = path.join(TMP, String(n++));
  const env: GameEnv = { vars: { LOCALAPPDATA: root, USERPROFILE: root, APPDATA: root }, steamPath: path.join(root, 'steam'), programData: path.join(root, 'pd') };
  const keys: Key[] = toWrites(p, { width: 1920, height: 1080, fps: p.fps ? 1 : undefined, aa: p.aa ? 0 : undefined, reflex: p.reflex ? 0 : undefined, flags: Object.keys(p.flags) as never })
    .map(([k]) => k)
    .concat(...(p.aa ?? []).flatMap((c) => c.set.map(([k]) => k)), ...(p.reflex ?? []).flatMap((c) => c.set.map(([k]) => k)))
    .filter((k) => k.name !== drop);
  for (const [id, f] of Object.entries(p.files)) {
    const mine = [...new Map(keys.filter((k) => k.file === id).map((k) => [`${k.section}|${k.name}`, k])).values()];
    const text =
      f.format === 'ini'
        ? [...new Set(mine.map((k) => k.section))].map((s) => `[${s}]\r\n${mine.filter((k) => k.section === s).map((k) => `${k.name}=${ORIGINAL}`).join('\r\n')}`).join('\r\n\r\n')
        : f.format === 'kv'
          ? `"VideoConfig"\r\n{\r\n${mine.map((k) => `\t"${k.name}"\t\t"${ORIGINAL}"`).join('\r\n')}\r\n}\r\n`
          : f.format === 'xml'
            ? `<Item>\r\n${mine.map((k) => `  <int name="${k.name}">${ORIGINAL}</int>`).join('\r\n')}\r\n</Item>\r\n`
            : f.format === 'colon'
              ? mine.map((k) => `${k.name}:${ORIGINAL}`).join('\r\n')
              : mine.map((k) => `${k.name} "${ORIGINAL}"`).join('\r\n');
    // {steamapp:ID}: a Steam library with that app's manifest, installed in steamapps\common\app<ID>.
    const app = /^\{steamapp:(\d+)\}/.exec(f.path);
    if (app) {
      await mkdir(path.join(env.steamPath, 'steamapps'), { recursive: true });
      await writeFile(path.join(env.steamPath, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${env.steamPath.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
      await writeFile(path.join(env.steamPath, 'steamapps', `appmanifest_${app[1]}.acf`), `"AppState"\n{\n\t"installdir"\t\t"app${app[1]}"\n}\n`);
    }
    const file = f.path
      .replace(/^\{steamapp:(\d+)\}/, (_, id: string) => path.join(env.steamPath, 'steamapps', 'common', `app${id}`))
      .replace(/%(\w+)%/g, (_, v: string) => env.vars[v]!)
      .replace('{steam}', env.steamPath)
      .replace('*', 'account1');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return env;
}

async function setup(p: GameProfile, opts: { drop?: string; processes?: string } = {}) {
  const env = await fixture(p, opts.drop);
  const fake = memoryAdapter(liveRead, async () => opts.processes ?? '');
  const safety = await createSafety(fake, path.join(TMP, `data${n++}`));
  return { fake, safety, games: createGames([p], safety, env) };
}

describe('game profile data', () => {
  it.each(gameProfiles)('$name: keys point at its files, recommended values are valid', (p) => {
    const keys = [...toWrites(p, { flags: allFlags(p) }), ...(p.aa ?? []).flatMap((c) => c.set), ...(p.reflex ?? []).flatMap((c) => c.set)];
    for (const [k] of keys) expect(Object.keys(p.files)).toContain(k.file);
    expect(validateValues(p, p.recommended)).toBeNull();
    expect(p.exe.every((e) => e === e.toLowerCase())).toBe(true);
  });

  it('rejects values a game does not support', () => {
    const val = gameProfiles.find((g) => g.id === 'valorant')!;
    expect(validateValues(val, { flags: [], fps: 144 })).toMatch(/no FPS/);
    expect(validateValues(val, { flags: [], aa: 0 })).toMatch(/anti-aliasing/);
    expect(validateValues(val, { flags: ['nope'] })).toMatch(/Invalid/);
    expect(validateValues(val, { flags: [], width: 100, height: 100 })).toMatch(/between/);
    expect(validateValues(val, { flags: [], width: 1920 })).toMatch(/together/);
  });

  it('Roblox: FPS cap 0 means no cap, written as the value Roblox uses for that', () => {
    const rbx = gameProfiles.find((g) => g.id === 'roblox')!;
    expect(toWrites(rbx, { fps: 0, flags: [] })).toEqual([[rbx.fps!.key, '9999']]);
    expect(toWrites(rbx, { fps: 144, flags: [] })).toEqual([[rbx.fps!.key, '144']]);
  });
});

describe.each(gameProfiles)('$name profile', (p) => {
  const values = {
    width: p.resolution ? 1600 : undefined,
    height: p.resolution ? 900 : undefined,
    fps: p.fps ? 240 : undefined,
    aa: p.aa ? 0 : undefined,
    reflex: p.reflex ? p.reflex.length - 1 : undefined,
    flags: allFlags(p),
  };

  it('apply backs up, patches only its keys, reads back; reset restores every original', async () => {
    const { safety, games } = await setup(p);
    const [before] = await games.list();
    expect(before.status).toBe('not-optimized');
    expect(before.current.flags).toEqual([]);

    const r = await games.apply(p, values);
    expect(r.ok, r.message).toBe(true);
    const [after] = await games.list();
    expect(after.status).toBe('optimized');
    expect(after.current).toMatchObject({ width: values.width, height: values.height, fps: values.fps, aa: values.aa, reflex: values.reflex });
    expect([...after.current.flags].sort()).toEqual([...values.flags].sort());

    // Applying again with fewer options puts the dropped keys back.
    expect((await games.apply(p, { flags: [] })).ok).toBe(true);
    expect((await games.list())[0].current.flags).toEqual([]);

    await games.apply(p, values);
    const touched = safety.changedRefs();
    expect(touched.length).toBe(new Set(toWrites(p, values).map(([k]) => `${k.file}|${k.section}|${k.name}`)).size);
    expect((await games.reset(p)).ok).toBe(true);
    expect(safety.backupCount()).toBe(0);
    for (const ref of touched) expect(await safety.read(ref)).toBe(ORIGINAL);
    expect((await games.list())[0].status).toBe('not-optimized');
  });

  it('a key missing from the file (renamed by a game update) refuses the whole apply', async () => {
    const drop = toWrites(p, values).at(-1)![0].name;
    const { safety, games } = await setup(p, { drop });
    const r = await games.apply(p, values);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(drop);
    expect(safety.backupCount()).toBe(0);
  });

  it('refused while the game runs (launch detection)', async () => {
    const { safety, games } = await setup(p, { processes: `"${p.exe[0]}","1234","Console","1","100 K"\r\n` });
    expect((await games.list())[0].running).toBe(true);
    expect((await games.apply(p, values)).ok).toBe(false);
    expect(safety.backupCount()).toBe(0);
  });
});

describe('game discovery', () => {
  it('a * folder picks the newest settings file; no file means not installed', async () => {
    const root = path.join(TMP, `glob${n++}`);
    const env: GameEnv = { vars: { LOCALAPPDATA: root }, steamPath: root, programData: root };
    for (const [d, t] of [['old', 1_000_000], ['new', 2_000_000]] as const) {
      await mkdir(path.join(root, d), { recursive: true });
      await writeFile(path.join(root, d, 'x.ini'), '');
      await utimes(path.join(root, d, 'x.ini'), t, t);
    }
    expect(await resolvePath('%LOCALAPPDATA%\\*\\x.ini', env)).toBe(path.join(root, 'new', 'x.ini'));
    expect(await resolvePath('%LOCALAPPDATA%\\*\\missing.ini', env)).toBeNull();

    const fake = memoryAdapter(liveRead);
    const games = createGames(gameProfiles, await createSafety(fake, path.join(root, 'data')), env);
    expect((await games.list()).every((g) => g.status === 'not-installed')).toBe(true);
  });

  it('a Steam library with the app manifest counts as installed (no settings yet)', async () => {
    const root = path.join(TMP, `steam${n++}`);
    const lib = path.join(root, 'lib');
    await mkdir(path.join(root, 'steamapps'), { recursive: true });
    await mkdir(path.join(lib, 'steamapps'), { recursive: true });
    await writeFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${lib.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    await writeFile(path.join(lib, 'steamapps', 'appmanifest_1422450.acf'), '');
    const games = createGames(gameProfiles, await createSafety(memoryAdapter(liveRead), path.join(root, 'data')), { vars: {}, steamPath: root, programData: root });
    expect((await games.list()).find((g) => g.id === 'deadlock')!.status).toBe('no-config');
  });
});

describe('App Optimizer', () => {
  it('Discord Optimization is refused while Discord runs', async () => {
    const fake = memoryAdapter(undefined, async () => '"Discord.exe","42","Console","1","90 K"\r\n');
    const safety = await createSafety(fake, path.join(TMP, `app${n++}`));
    const engine = createEngine({ tweaks: appTweaks({ ...NO_APPS, discord: 'C:/fake/discord/settings.json' }), presets, safety, live: false, isAdmin: false, build: 26200 });
    const r = await engine.setTweak('app-discord', true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Close discord\.exe/);
    expect(safety.backupCount()).toBe(0);
  });

  it('no Discord settings file means no Discord card', () => {
    expect(appTweaks(NO_APPS).some((t) => t.id === 'app-discord')).toBe(false);
  });
});

describe('game icons: finding the installed exe', () => {
  it('resolves Steam, Epic, Riot and version-folder installs; null when not installed', async () => {
    const { findGameExe } = await import('./games/games');
    const root = path.join(TMP, `icons${n++}`);
    const steam = path.join(root, 'steam');
    const pd = path.join(root, 'pd');
    const touch = async (...p: string[]) => {
      await mkdir(path.join(...p.slice(0, -1)), { recursive: true });
      await writeFile(path.join(...p), '');
    };
    // Steam: the manifest's installdir under the library.
    await mkdir(path.join(steam, 'steamapps'), { recursive: true });
    await writeFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    await writeFile(path.join(steam, 'steamapps', 'appmanifest_1422450.acf'), '"AppState"\n{\n\t"installdir"\t\t"Deadlock"\n}\n');
    await touch(steam, 'steamapps', 'common', 'Deadlock', 'game', 'bin', 'win64', 'deadlock.exe');
    // Epic and Riot install records.
    const fn = path.join(root, 'Fortnite');
    await touch(fn, 'FortniteGame', 'Binaries', 'Win64', 'FortniteClient-Win64-Shipping.exe');
    await mkdir(path.join(pd, 'Epic', 'UnrealEngineLauncher'), { recursive: true });
    await writeFile(path.join(pd, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat'), JSON.stringify({ InstallationList: [{ AppName: 'Fortnite', InstallLocation: fn }] }));
    const val = path.join(root, 'Riot Games', 'VALORANT', 'live');
    await touch(val, 'VALORANT.exe');
    await mkdir(path.join(pd, 'Riot Games'), { recursive: true });
    await writeFile(path.join(pd, 'Riot Games', 'RiotClientInstalls.json'), JSON.stringify({ associated_client: { [`${val.replace(/\\/g, '/')}/`]: 'x' } }));
    // Roblox: newest version folder.
    await touch(root, 'Roblox', 'Versions', 'version-abc', 'RobloxPlayerBeta.exe');

    const env: GameEnv = { vars: { LOCALAPPDATA: root, ProgramFiles: path.join(root, 'none') }, steamPath: steam, programData: pd };
    const exe = async (id: string) => findGameExe(gameProfiles.find((g) => g.id === id)!, env);
    expect(await exe('deadlock')).toBe(path.join(steam, 'steamapps', 'common', 'Deadlock', 'game', 'bin', 'win64', 'deadlock.exe'));
    expect(await exe('fortnite')).toBe(path.join(fn, 'FortniteGame', 'Binaries', 'Win64', 'FortniteClient-Win64-Shipping.exe'));
    expect((await exe('valorant'))?.toLowerCase()).toBe(path.join(val, 'VALORANT.exe').toLowerCase());
    expect(await exe('roblox')).toBe(path.join(root, 'Roblox', 'Versions', 'version-abc', 'RobloxPlayerBeta.exe'));
    expect(await exe('dead-by-daylight')).toBeNull();

    // Launch: Steam/Epic URLs, Riot Client with product args, Roblox's own exe; null when not installed.
    const { launchTarget } = await import('./games/games');
    const rc = path.join(root, 'Riot Client', 'RiotClientServices.exe');
    await touch(root, 'Riot Client', 'RiotClientServices.exe');
    await writeFile(path.join(pd, 'Riot Games', 'RiotClientInstalls.json'), JSON.stringify({ associated_client: { [`${val.replace(/\\/g, '/')}/`]: rc }, rc_default: rc }));
    const launch = (id: string) => launchTarget(gameProfiles.find((g) => g.id === id)!, env);
    expect(await launch('deadlock')).toEqual({ url: 'steam://rungameid/1422450' });
    expect(await launch('fortnite')).toEqual({ url: 'com.epicgames.launcher://apps/Fortnite?action=launch&silent=true' });
    expect(await launch('valorant')).toEqual({ exe: rc, args: ['--launch-product=valorant', '--launch-patchline=live'] });
    expect(await launch('roblox')).toEqual({ exe: path.join(root, 'Roblox', 'Versions', 'version-abc', 'RobloxPlayerBeta.exe'), args: [] });
    expect(await launch('dead-by-daylight')).toBeNull();
  });
});
