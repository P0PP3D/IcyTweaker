// Share codes, Minecraft's key:value format, FPS-drop detection, Game Boost display mode, the new game profiles.
// Fake adapter and ./.test-tmp/extras only; nothing written to Windows.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { parseStores, scanLibrary } from './games/library';
import { advancedTweaks } from './advanced/advanced';
import { presets } from './tweaks/presets';
import { TWEAK_TAGS, hasTag } from './tweaks/tags';
import { buildTargets } from './cleaner/cleaner';
import { DEFAULT_FOCUS, createFocus, parseAppChoices, validateFocus } from './games/focus';
import { createStartup, exeOf, parseLogonTasks, startupSources } from './apps/startup';
import { createDebloater } from './system/debloat';
import { parseBoot } from './system/boot';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isTempDir } from './cleaner/cleaner';
import { keptOut } from './cleaner/finder';
import { listRecycleBin, parseIRecord } from './cleaner/recycle';
import { walk } from './cleaner/walk';
import { getKey, setKey } from './games/config';
import { toWrites, validateValues } from './games/games';
import { createBoost, DEFAULT_BOOST, validateBoost } from './games/boost';
import { gameProfiles } from './games/profiles';
import { createSessionRecorder, DROP, isDrop, tempSeries } from './games/session';
import { memoryAdapter, parseFeatures, sz } from './system/adapter';
import { cmpVersion, olderVersions, parseEnumDrivers } from './system/driverstore';
import { buildConfig, fromShareCode, parseConfig, toShareCode } from './system/configfile';
import { validMode } from './system/monitors';
import { createSafety } from './system/safety';
import { createEngine, tweak } from './tweaks/engine';
import { generalTweaks } from './tweaks/general';
import type { TweakView } from '../shared/types';

const TMP = path.join(process.cwd(), '.test-tmp', 'extras');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;
const dir = () => path.join(TMP, String(n++));

describe('share code', () => {
  it('round-trips the export and rejects other text', () => {
    const known = [{ id: 'a', status: 'applied' }, { id: 'b', status: 'applied', options: [{ value: 2 }], currentOption: 2 }, { id: 'c', status: 'default' }] as unknown as TweakView[];
    const code = toShareCode(buildConfig(known, 26200, { enabled: true }));
    expect(code).toMatch(/^ICY1\.[A-Za-z0-9_-]+$/);
    const { config, skipped } = parseConfig(fromShareCode(`  ${code}\n`), known);
    expect(config.tweaks).toEqual([{ id: 'a' }, { id: 'b', option: 2 }]);
    expect(config.boost).toEqual({ enabled: true });
    expect(skipped).toBe(0);
    expect(() => fromShareCode('hello')).toThrow(/not hold/);
    expect(() => fromShareCode('ICY1.!!!!')).toThrow(/damaged/);
  });
});

describe('colon format (Minecraft options.txt)', () => {
  const text = 'version:4671\r\nenableVsync:true\r\nrenderClouds:"true"\r\nkey_key.attack:key.mouse.left\r\n';
  it('reads and patches one key, leaving the rest', () => {
    expect(getKey(text, 'colon', undefined, 'enableVsync')).toBe('true');
    expect(getKey(text, 'colon', undefined, 'key_key.attack')).toBe('key.mouse.left');
    const out = setKey(setKey(text, 'colon', undefined, 'enableVsync', 'false'), 'colon', undefined, 'renderClouds', '"false"');
    expect(out).toBe('version:4671\r\nenableVsync:false\r\nrenderClouds:"false"\r\nkey_key.attack:key.mouse.left\r\n');
    expect(() => setKey(text, 'colon', undefined, 'madeUp', '1')).toThrow();
  });
});

describe('FPS drops', () => {
  it('needs a warm-up, then flags readings under 60 % of the recent average', () => {
    expect(isDrop(Array(DROP.warmup - 1).fill(200), 10)).toBeNull();
    const steady = Array(40).fill(200);
    expect(isDrop(steady, 130)).toBeNull();
    expect(isDrop(steady, 110)).toBe(200);
  });
  it('the recorder reports a drop and keeps stutters in the session report', async () => {
    const d = dir();
    await mkdir(d, { recursive: true });
    const rec = createSessionRecorder(path.join(d, 'sessions.json'));
    rec.start('Game');
    for (let i = 0; i < 30; i++) expect(rec.sample({ fps: 144 })).toBeNull();
    expect(rec.sample({ fps: 40 })).toBe(144);
    rec.stutter({ at: '2026-11-11T00:00:00Z', fps: 40, before: 144, top: [{ name: 'chrome', cpu: 22 }] });
    const r = await rec.end();
    expect(r?.stutters).toEqual([{ at: '2026-11-11T00:00:00Z', fps: 40, before: 144, top: [{ name: 'chrome', cpu: 22 }] }]);
  });
});

describe('Game Boost display mode', () => {
  it('validates modes', () => {
    expect(validMode({ width: 1920, height: 1080, hz: 240 })).toEqual({ width: 1920, height: 1080, hz: 240 });
    expect(validMode({ width: 1920.5, height: 1080, hz: 240 })).toBeNull();
    expect(validMode({ width: 1920, height: 1080, hz: '240; Remove-Item' })).toBeNull();
    expect(validateBoost({ ...DEFAULT_BOOST, display: { width: 1, height: 1, hz: 1 } }, [])!.display).toBeNull();
  });
  it('sets the mode when the game starts and puts the saved one back when it closes', async () => {
    const procs = { value: '' };
    const fake = memoryAdapter(undefined, async () => procs.value);
    const safety = await createSafety(fake, dir());
    const settings = validateBoost({ ...DEFAULT_BOOST, enabled: true, plan: false, lowerApps: [], display: { width: 1280, height: 720, hz: 144 } }, [])!;
    const boost = createBoost(safety, [{ id: 'g', name: 'G', exe: ['g.exe'] }], settings);
    const script = () => fake.commands.map((c) => c.at(-1) ?? '').filter((s) => s.includes('IcyDisplayMode'));
    procs.value = '"g.exe","1","Console","1","1 K"\r\n';
    await boost.tick();
    expect(script().at(-1)).toMatch(/::Set\(1280, 720, 144\)/);
    procs.value = '';
    await boost.tick();
    expect(script().at(-1)).toMatch(/::Reset\(\)/);
    expect(script()).toHaveLength(2);
  });
});

describe('cleaner safety', () => {
  it('the duplicate / old-file finders keep out of games, programs and app data on any drive', () => {
    for (const p of [
      'D:\\SteamLibrary\\steamapps\\common\\Game\\x.dll',
      'C:\\Riot Games\\VALORANT\\live\\a.pak',
      'E:\\XboxGames\\Halo\\Content\\b.pak',
      'C:\\Users\\Me\\AppData\\Local\\Discord\\app-1.0.9\\c.dll',
      'D:\\Program Files\\Tool\\d.exe',
      'C:\\Users\\Me\\code\\proj\\node_modules\\e.js',
      'C:/Users/Me/AppData/Roaming/x',
    ])
      expect(keptOut(p), p).toBe(true);
    for (const p of ['C:\\Users\\Me\\Videos\\clip.mp4', 'D:\\Downloads\\setup.iso', 'C:\\Users\\Me\\Documents\\Programs list.txt']) expect(keptOut(p), p).toBe(false);
  });
  it('the Temp target only runs on a real Temp folder', () => {
    expect(isTempDir('C:\\Users\\Me\\AppData\\Local\\Temp')).toBe(true);
    expect(isTempDir('D:\\tmp\\')).toBe(true);
    expect(isTempDir('C:\\Users\\Me\\Documents')).toBe(false);
  });
});

describe('library and startup impact', () => {
  it('always-running Steam tools (docks, wallpapers, scalers) are not treated as games', async () => {
    const steam = path.join(dir(), 'steam');
    const apps = path.join(steam, 'steamapps');
    await mkdir(apps, { recursive: true });
    await writeFile(path.join(apps, 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    for (const [id, name] of [['1', 'MyDockFinder'], ['2', 'Wallpaper Engine'], ['3', 'Lossless Scaling'], ['4', 'Real Game']]) {
      await writeFile(path.join(apps, `appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"g${id}"\n}\n`);
      await mkdir(path.join(apps, 'common', `g${id}`), { recursive: true });
      await writeFile(path.join(apps, 'common', `g${id}`, 'app.exe'), Buffer.alloc(10));
    }
    const list = await scanLibrary({ vars: {}, steamPath: steam, programData: path.join(TMP, 'none') });
    expect(list.map((g) => g.name)).toEqual(['Real Game']);
  });
  it('boot info keeps the slow app\'s file name (to match startup entries)', () => {
    const b = parseBoot(JSON.stringify({ lastBoot: 'x', boots: [], slow: [{ name: 'Microsoft OneDrive', file: 'OneDrive.exe', total: 5000, degradation: 2300 }], error: null }), true);
    expect(b.slowApps).toEqual([{ name: 'Microsoft OneDrive', degradationMs: 2300, file: 'OneDrive.exe' }]);
  });
});

describe('toggle status honesty', () => {
  it('a setting already at its Windows default ("on" = "off") does not make a group look partial', async () => {
    const fake = memoryAdapter();
    const svc = (name: string) => ({ kind: 'service' as const, name });
    await fake.write(svc('RemoteRegistry'), 'disabled');
    await fake.write(svc('TermService'), 'demand');
    const safety = await createSafety(fake, dir());
    const t = tweak({ id: 'g', name: 'G', category: 'services', description: '', risk: 'safe' } as never, [
      { ref: svc('RemoteRegistry'), on: 'disabled', off: 'disabled' },
      { ref: svc('TermService'), on: 'disabled', off: 'demand' },
    ]);
    expect(await t.readState(safety)).toBe('not_applied');
    await t.apply(safety);
    expect(await t.readState(safety)).toBe('applied');
  });
  it('turning off something IcyTweaker never changed (no default to go back to) says so', async () => {
    const fake = memoryAdapter();
    const ref = { kind: 'tcpGlobal' as const, name: 'rss' as const };
    await fake.write(ref, 'enabled');
    const safety = await createSafety(fake, dir());
    const t = tweak({ id: 'tcp', name: 'TCP', category: 'network', description: '', risk: 'safe', builds: { min: 0 } } as never, [{ ref, on: 'enabled', off: null }]);
    const engine = createEngine({ tweaks: [t], presets: [], fixes: [], safety, live: false, isAdmin: true, build: 26200, hardware: { laptop: false, ssd: true }, antiCheats: [] });
    const r = await engine.setTweak('tcp', false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already set this way before IcyTweaker/);
  });
});

describe('shared DirectX graphics value', () => {
  it('windowed optimizations and Auto HDR share one value: turning one off keeps the other and the user\'s own parts', async () => {
    const ref = { kind: 'reg' as const, hive: 'HKCU' as const, key: 'Software\\Microsoft\\DirectX\\UserGpuPreferences', name: 'DirectXUserGlobalSettings' };
    const fake = memoryAdapter();
    await fake.write(ref, sz('VRROptimizeEnable=0;'));
    const safety = await createSafety(fake, dir());
    const win = generalTweaks.find((t) => t.id === 'windowed-game-optimizations')!;
    const hdr = generalTweaks.find((t) => t.id === 'auto-hdr-on')!;
    await win.apply(safety);
    await hdr.apply(safety);
    expect(await fake.read(ref)).toEqual(sz('VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;AutoHDREnable=1;'));
    await win.revert(safety);
    expect(await fake.read(ref)).toEqual(sz('VRROptimizeEnable=0;AutoHDREnable=1;'));
    expect(await hdr.readState(safety)).toBe('applied');
    expect(await win.readState(safety)).toBe('not_applied');
    await hdr.revert(safety);
    expect(await fake.read(ref)).toEqual(sz('VRROptimizeEnable=0;'));
    expect(safety.backupCount()).toBe(0);
  });
});

describe('borderless windowed and Do Not Disturb', () => {
  it('borderless writes the windowed-fullscreen values, and fullscreen + borderless together is refused', () => {
    const val = gameProfiles.find((g) => g.id === 'valorant')!;
    expect(toWrites(val, { flags: ['borderless'] }).map(([k, v]) => `${k.name}=${v}`)).toEqual(['FullscreenMode=1', 'PreferredFullscreenMode=1', 'LastConfirmedFullscreenMode=1']);
    const dl = gameProfiles.find((g) => g.id === 'deadlock')!;
    expect(toWrites(dl, { flags: ['borderless'] }).map(([k, v]) => `${k.name}=${v}`)).toEqual(['setting.fullscreen=0', 'setting.nowindowborder=1']);
    expect(validateValues(val, { flags: ['fullscreen', 'borderless'] })).toMatch(/not both/);
    expect(validateValues(val, { flags: ['borderless'] })).toBeNull();
  });
  it('Game Boost silences notifications during play and puts the user\'s setting back after', async () => {
    const procs = { value: '' };
    const fake = memoryAdapter(undefined, async () => procs.value);
    const ref = { kind: 'reg' as const, hive: 'HKCU' as const, key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings', name: 'NOC_GLOBAL_SETTING_TOASTS_ENABLED' };
    const safety = await createSafety(fake, dir());
    const settings = validateBoost({ ...DEFAULT_BOOST, enabled: true, plan: false, lowerApps: [], quietNotifications: true }, [])!;
    const boost = createBoost(safety, [{ id: 'g', name: 'G', exe: ['g.exe'] }], settings);
    procs.value = '"g.exe","1","Console","1","1 K"\r\n';
    await boost.tick();
    expect(await fake.read(ref)).toEqual({ type: 'REG_DWORD', data: 0 });
    procs.value = '';
    await boost.tick();
    expect(await fake.read(ref)).toBeNull(); // absent before = notifications on
    expect(safety.backupCount()).toBe(0);
  });
});

describe('Focus Mode', () => {
  it('validates lists: known services only, never Windows-critical ones or core programs', () => {
    const v = validateFocus({ services: ['SysMain', 'RpcSs', 'Nope'], apps: ['OneDrive.exe', 'explorer.exe', 'bad;rm.exe'], custom: ['obs64.exe'], exceptions: ['discord.exe'], reopen: true })!;
    expect(v.services).toEqual(['SysMain']);
    expect(v.apps).toEqual(['onedrive.exe']);
    expect(v.custom).toEqual(['obs64.exe']);
    expect(validateFocus({ services: [] })).toBeNull();
  });
  it('stops only running services, starts exactly those again, and a leftover session is put back on resume', async () => {
    const running = new Set(['SysMain', 'WSearch']);
    // `sc query` lists running services only.
    const fake = memoryAdapter(undefined, async (_f, args) => (args[0] === 'query' ? [...running].map((n) => `SERVICE_NAME: ${n}\r\nDISPLAY_NAME: x\r\n`).join('\r\n') : ''));
    const d = dir();
    await mkdir(d, { recursive: true });
    const log = async () => {};
    const f = createFocus(fake, d, log);
    await f.on({ ...DEFAULT_FOCUS, services: ['SysMain', 'WSearch', 'Spooler'], apps: [], custom: [] });
    expect(f.state()?.services).toEqual(['SysMain', 'WSearch']);
    expect(fake.commands.filter((c) => c[1] === 'stop').map((c) => c[2])).toEqual(['SysMain', 'WSearch']);
    // Crash: a new instance finds the state file and starts the services again.
    const again = createFocus(fake, d, log);
    expect(await again.resume()).toMatch(/2 service\(s\) started again/);
    expect(fake.commands.filter((c) => c[1] === 'start').map((c) => c[2])).toEqual(['WSearch', 'SysMain']);
    expect(again.state()).toBeNull();
    expect(await createFocus(fake, d, log).resume()).toBeNull();
  });
});

describe('startup apps', () => {
  it('reads sign-in tasks from base64 JSON and ignores junk', () => {
    const b64 = Buffer.from(JSON.stringify([{ path: '\\ASUS\\Agent', enabled: true, command: 'C:\\a.exe' }, { path: 'nope' }])).toString('base64');
    expect(parseLogonTasks(b64)).toEqual([{ path: '\\ASUS\\Agent', enabled: true, command: 'C:\\a.exe' }]);
    expect(parseLogonTasks('')).toEqual([]);
  });
  it('deleting a Run entry is backed up (Undo All brings it back); tasks are refused', async () => {
    const fake = memoryAdapter();
    const run = { kind: 'reg' as const, hive: 'HKCU' as const, key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', name: 'Spotify' };
    await fake.write(run, sz('C:\\spotify.exe'));
    const safety = await createSafety(fake, dir());
    const s = createStartup(safety, startupSources({ APPDATA: 'C:\\x', ProgramData: 'C:\\y' }));
    await s.remove('hkcu-run|Spotify');
    expect(await fake.read(run)).toBeNull();
    await safety.undoAll();
    expect(await fake.read(run)).toEqual(sz('C:\\spotify.exe'));
    await expect(s.remove('task|\\ASUS\\Agent')).rejects.toThrow(/only be turned off/);
  });
});

describe('labels, stores and launcher cleaning', () => {
  it('every label points at a real tweak, and presets never include preferences', () => {
    const ids = new Set([...generalTweaks, ...advancedTweaks([])].map((t) => t.id));
    for (const id of Object.keys(TWEAK_TAGS)) expect(ids.has(id), id).toBe(true);
    for (const p of presets) for (const id of p.tweakIds) expect(hasTag(id, 'preference'), `${p.id}: ${id}`).toBe(false);
  });
  it('Ubisoft, GOG and Xbox games from the store query (only ones whose files exist; junk ids refused)', async () => {
    const root = dir();
    await mkdir(path.join(root, 'Ubi', 'Far Cry'), { recursive: true });
    await writeFile(path.join(root, 'Ubi', 'Far Cry', 'FarCry.exe'), Buffer.alloc(100));
    await mkdir(path.join(root, 'XboxGames', 'Mc', 'Content'), { recursive: true });
    await writeFile(path.join(root, 'XboxGames', 'Mc', 'Content', 'Minecraft.Windows.exe'), Buffer.alloc(10));
    await writeFile(path.join(root, 'gog.exe'), Buffer.alloc(10));
    const raw = {
      ubisoft: [{ id: '5', dir: path.join(root, 'Ubi', 'Far Cry') }, { id: 'x;y', dir: root }, { id: '6', dir: path.join(root, 'missing') }],
      gog: { id: '1207', name: 'Witcher', exe: path.join(root, 'gog.exe') },
      xbox: [{ dir: path.join(root, 'XboxGames', 'Mc'), name: 'ms-resource:Name', folder: 'Mc', exe: 'Minecraft.Windows.exe', appId: 'Game', pfn: 'MICROSOFT.MINECRAFTUWP_8wekyb3d8bbwe' }, { dir: root, exe: 'a.exe', appId: 'G', pfn: 'bad pfn' }],
    };
    const list = await parseStores(Buffer.from(JSON.stringify(raw)).toString('base64'), 'C:\\Windows');
    expect(list.map((g) => [g.id, g.name, g.launch])).toEqual([
      ['ubisoft-5', 'Far Cry', { url: 'uplay://launch/5/0' }],
      ['gog-1207', 'Witcher', { exe: path.join(root, 'gog.exe'), args: [] }],
      ['xbox-MICROSOFT.MINECRAFTUWP_8wekyb3d8bbwe', 'Mc', { exe: 'C:\\Windows\\explorer.exe', args: ['shell:AppsFolder\\MICROSOFT.MINECRAFTUWP_8wekyb3d8bbwe!Game'] }],
    ]);
  });
  it('Riot games come from the client metadata and launch through Riot Client', async () => {
    const pd = dir();
    const game = path.join(pd, 'Riot Games', 'League of Legends');
    await mkdir(path.join(pd, 'Riot Games', 'Metadata', 'league_of_legends.live'), { recursive: true });
    await mkdir(game, { recursive: true });
    await writeFile(path.join(game, 'LeagueClient.exe'), Buffer.alloc(50));
    await writeFile(path.join(pd, 'Riot Games', 'RiotClientInstalls.json'), JSON.stringify({ rc_default: 'C:/Riot Games/Riot Client/RiotClientServices.exe' }));
    await writeFile(path.join(pd, 'Riot Games', 'Metadata', 'league_of_legends.live', 'league_of_legends.live.product_settings.yaml'), `product_install_full_path: "${game.replace(/\\/g, '/')}"\n`);
    const list = await scanLibrary({ vars: {}, steamPath: path.join(pd, 'nosteam'), programData: pd });
    expect(list.map((g) => [g.id, g.name, g.launch])).toEqual([
      ['riot-league_of_legends.live', 'League of Legends', { exe: path.normalize('C:/Riot Games/Riot Client/RiotClientServices.exe'), args: ['--launch-product=league_of_legends', '--launch-patchline=live'] }],
    ]);
  });
  it('launcher junk targets exist, keep recent logs, and need the launcher closed where it holds the files', () => {
    const env = { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A', TEMP: 'C:\\Temp', SystemRoot: 'C:\\Windows', ProgramData: 'C:\\P', ProgramFilesX86: 'C:\\PF86', USERPROFILE: 'C:\\U', recycleBins: [], steamPath: 'C:\\Steam' };
    const t = Object.fromEntries(buildTargets(env).map((x) => [x.id, x]));
    for (const id of ['steam-logs', 'epic-logs', 'riot-logs', 'ubisoft-logs', 'game-logs']) expect(t[id]?.minAgeHours, id).toBe(24);
    expect(t['steam-depotcache'].needsClosed).toBe(true);
    expect(t['ubisoft-cache'].risk).toBe('caution');
  });
});

describe('0.1.7 parsers', () => {
  it('DISM feature table: enabled / disabled / pending / payload removed', () => {
    const out = 'Feature Name | State\r\n---------- | -----\r\nSMB1Protocol | Disabled\r\nMicrosoft-Hyper-V-All | Enabled\r\nRecall | Enable Pending\r\nWorkFolders-Client | Disabled with Payload Removed\r\n';
    const m = parseFeatures(out);
    expect([...m]).toEqual([
      ['smb1protocol', 'disabled'],
      ['microsoft-hyper-v-all', 'enabled'],
      ['recall', 'enabled'],
      ['workfolders-client', 'disabled'],
    ]);
  });
  it('old drivers: every version of the same driver and maker except the newest', () => {
    const block = (oem: string, orig: string, prov: string, ver: string) =>
      `Published Name:     ${oem}\r\nOriginal Name:      ${orig}\r\nProvider Name:      ${prov}\r\nClass Name:         Media\r\nDriver Version:     01/02/2025 ${ver}\r\n`;
    const pkgs = parseEnumDrivers(['Microsoft PnP Utility', block('oem1.inf', 'nvhda.inf', 'NVIDIA', '1.4.6.3'), block('oem2.inf', 'nvhda.inf', 'NVIDIA', '1.4.10.0'), block('oem3.inf', 'nvhda.inf', 'NVIDIA', '1.3.40.14'), block('oem4.inf', 'solo.inf', 'X', '1.0')].join('\r\n'));
    expect(pkgs).toHaveLength(4);
    expect(olderVersions(pkgs).map((p) => p.published)).toEqual(['oem1.inf', 'oem3.inf']); // 1.4.10.0 is the newest (numeric, not text, order)
    expect(cmpVersion('1.10', '1.9')).toBeGreaterThan(0);
    // The same maker spelled two ways is still one driver family.
    const amd = parseEnumDrivers([block('oem7.inf', 'amdgpio2.inf', 'Advanced Micro Devices, Inc.', '2.2.0.130'), block('oem8.inf', 'amdgpio2.inf', 'Advanced Micro Devices, Inc', '2.2.0.133')].join('\r\n'));
    expect(olderVersions(amd).map((p) => p.published)).toEqual(['oem7.inf']);
  });
  it('temperature history: per-minute averages from the session start', () => {
    const start = 1_000_000;
    const s = tempSeries(
      [
        { t: start + 10_000, cpu: 60, gpu: 50 },
        { t: start + 50_000, cpu: 70, gpu: null },
        { t: start + 70_000, cpu: 80, gpu: 60 },
      ],
      start,
    );
    expect(s).toEqual([
      { m: 0, cpu: 65, gpu: 50 },
      { m: 1, cpu: 80, gpu: 60 },
    ]);
    expect(tempSeries([], start)).toEqual([]);
  });
  it('Focus Mode keeps withBoost through validation', () => {
    expect(validateFocus({ ...DEFAULT_FOCUS, withBoost: true })!.withBoost).toBe(true);
    expect(validateFocus({ ...DEFAULT_FOCUS })!.withBoost).toBe(false);
  });
});

describe('new game profiles', () => {
  it('Dead by Daylight and The Outlast Trials point at their own files only', () => {
    for (const id of ['dead-by-daylight', 'outlast-trials']) {
      const p = gameProfiles.find((g) => g.id === id)!;
      expect(p).toBeTruthy();
      for (const f of Object.values(p.flags).flat()) expect(Object.keys(p.files)).toContain(f[0].file);
      for (const flag of p.recommended.flags ?? []) expect(p.flags[flag]?.length).toBeGreaterThan(0);
    }
    expect(gameProfiles.find((g) => g.id === 'dead-by-daylight')!.flags.fullscreen).toBeUndefined();
  });
});

describe('Recycle Bin records', () => {
  const rec = (version: number, p: string, size: number, ms: number) => {
    const head = Buffer.alloc(24);
    head.writeBigInt64LE(BigInt(version), 0);
    head.writeBigInt64LE(BigInt(size), 8);
    head.writeBigInt64LE((BigInt(ms) + 11_644_473_600_000n) * 10_000n, 16);
    const name = Buffer.from(`${p}\0`, 'utf16le');
    if (version === 1) return Buffer.concat([head, name, Buffer.alloc(520 - name.length)]);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(p.length + 1);
    return Buffer.concat([head, len, name]);
  };
  const at = Date.UTC(2026, 10, 12, 7, 22, 29);
  it('reads version 2 and version 1 $I records', () => {
    expect(parseIRecord(rec(2, 'C:/Users/me/Downloads/a b.zip', 1234, at))).toEqual({ path: 'C:/Users/me/Downloads/a b.zip', size: 1234, deleted: new Date(at).toISOString() });
    expect(parseIRecord(rec(1, 'D:/x.txt', 5, at))?.path).toBe('D:/x.txt');
    expect(parseIRecord(Buffer.alloc(10))).toBeNull();
    expect(parseIRecord(rec(7, 'C:/x', 1, at))).toBeNull();
  });
  it('lists items that still have their $R file, newest first', async () => {
    const d = dir();
    const bin = path.join(d, '$Recycle.Bin', 'S-1-5-21-1');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, '$IAAA.zip'), rec(2, 'C:/Users/me/old.zip', 10, at - 1000));
    await writeFile(path.join(bin, '$RAAA.zip'), 'x');
    await writeFile(path.join(bin, '$IBBB'), rec(2, 'C:/Users/me/folder', 20, at));
    await mkdir(path.join(bin, '$RBBB'));
    await writeFile(path.join(bin, '$ICCC.txt'), rec(2, 'C:/gone.txt', 1, at)); // its $R is gone: not listed
    const items = await listRecycleBin([d], 'S-1-5-21-1');
    expect(items.map((i) => [i.name, i.folder])).toEqual([
      ['folder', true],
      ['old.zip', false],
    ]);
  });
});

describe('Focus Mode app pickers', () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
  it('lists Start-menu and open apps once each, without uninstallers, Windows programs or core processes', () => {
    const out = b64({
      apps: [
        { name: 'OBS Studio', path: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' },
        { name: 'Uninstall OBS', path: 'C:\\Program Files\\obs-studio\\uninstall.exe' },
        { name: 'Notepad', path: 'C:\\Windows\\System32\\notepad.exe' },
        { name: 'obs64', path: 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' },
        { name: 'Explorer', path: 'D:\\x\\explorer.exe' },
      ],
      appx: 'MSTeams', // one item: ConvertTo-Json unwraps it
      running: ['Discord'],
    });
    const r = parseAppChoices(out, () => false, { SystemRoot: 'C:\\Windows' });
    expect(r.choices).toEqual([{ exe: 'obs64.exe', name: 'OBS Studio' }]);
    expect(r.installed.sort()).toEqual(['discord.exe', 'ms-teams.exe']);
  });
  it('a built-in app counts as installed when its file exists', () => {
    const r = parseAppChoices(b64({}), (p) => p === 'C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' });
    expect(r.installed).toEqual(['spotify.exe']);
    expect(parseAppChoices('garbage', () => false, {})).toEqual({ choices: [], installed: [] });
  });
});

describe('walk', () => {
  it('lists deepest folders first and gives each file its last-used time', async () => {
    const d = dir();
    await mkdir(path.join(d, 'a', 'b', 'c'), { recursive: true });
    await mkdir(path.join(d, 'z'), { recursive: true });
    await writeFile(path.join(d, 'a', 'b', 'c', 'f.txt'), 'hi');
    const r = await walk(d);
    const i = (p: string) => r.dirs.indexOf(path.join(d, p));
    expect(i('a/b/c')).toBeLessThan(i('a/b'));
    expect(i('a/b')).toBeLessThan(i('a'));
    expect(r.dirs).toHaveLength(4);
    expect(r.files[0].lastUsedMs).toBeGreaterThan(0);
  });
});

describe('startup app icons and uninstall', () => {
  const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  it('finds the program a startup command runs', () => {
    expect(exeOf('"C:\\Program Files\\Steam\\steam.exe" -silent', env)).toBe('C:\\Program Files\\Steam\\steam.exe');
    expect(exeOf('C:\\Tools\\agent.exe /min', env)).toBe('C:\\Tools\\agent.exe');
    expect(exeOf('%LOCALAPPDATA%\\Discord\\Update.exe --processStart Discord.exe', env)).toBe('C:\\Users\\me\\AppData\\Local\\Discord\\Update.exe');
    expect(exeOf('rundll32.exe shell32.dll,Control_RunDLL', env)).toBeNull(); // no full path
    expect(exeOf('"C:\\x\\script.cmd"', env)).toBeNull();
  });
  it('matches a program file to its installed app, the most specific folder first, never protected ones', async () => {
    const desktop = [
      { key: 'HKLM\\A', DisplayName: 'Vendor Suite', UninstallString: 'u.exe', InstallLocation: 'C:\\Program Files\\Vendor' },
      { key: 'HKLM\\B', DisplayName: 'Vendor Agent', UninstallString: 'u.exe', InstallLocation: '"C:\\Program Files\\Vendor\\Agent\\"' },
      { key: 'HKLM\\C', DisplayName: 'Spotify', UninstallString: 'u.exe', DisplayIcon: 'C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe,0' },
      { key: 'HKLM\\D', DisplayName: 'Microsoft Edge', UninstallString: 'u.exe', InstallLocation: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application' },
    ];
    const fake = memoryAdapter(undefined, async () => JSON.stringify({ desktop }));
    const d = createDebloater(fake);
    expect(d.listed()).toBe(false);
    await d.list();
    expect(d.findByExe('C:\\Program Files\\Vendor\\Agent\\agent.exe')?.name).toBe('Vendor Agent');
    expect(d.findByExe('C:\\Program Files\\Vendor\\suite.exe')?.name).toBe('Vendor Suite');
    expect(d.findByExe('C:\\Users\\me\\AppData\\Roaming\\Spotify\\Spotify.exe')?.name).toBe('Spotify');
    expect(d.findByExe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBeUndefined(); // protected
    expect(d.findByExe('C:\\Other\\x.exe')).toBeUndefined();
  });
  it('never matches a launcher to one of its games, and an install folder beats another app uninstaller folder', async () => {
    const desktop = [
      { key: 'HKLM\\S', DisplayName: 'Steam', UninstallString: 'C:\\Program Files (x86)\\Steam\\uninstall.exe' },
      { key: 'HKLM\\G', DisplayName: 'Some Game', UninstallString: '"C:\\Program Files (x86)\\Steam\\steam.exe" steam://uninstall/123', DisplayIcon: 'C:\\Program Files (x86)\\Steam\\steam\\games\\a.ico' },
      { key: 'HKCU\\R', DisplayName: 'Riot Client', UninstallString: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --uninstall-product=Riot_Client', InstallLocation: 'C:/Riot Games/Riot Client/' },
      { key: 'HKCU\\V', DisplayName: 'VALORANT', UninstallString: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --uninstall-product=valorant', InstallLocation: 'C:\\Riot Games\\VALORANT\\live' },
      { key: 'HKLM\\X', DisplayName: 'Shared A', UninstallString: '"C:\\Shared\\Tools\\un.exe" /a' },
      { key: 'HKLM\\Y', DisplayName: 'Shared B', UninstallString: '"C:\\Shared\\Tools\\un.exe" /b' },
    ];
    const d = createDebloater(memoryAdapter(undefined, async () => JSON.stringify({ desktop })));
    await d.list();
    expect(d.findByExe('C:\\Program Files (x86)\\Steam\\steam.exe')?.name).toBe('Steam');
    expect(d.findByExe('C:\\Riot Games\\Riot Client\\RiotClientServices.exe')?.name).toBe('Riot Client');
    expect(d.findByExe('C:\\Shared\\Tools\\agent.exe')).toBeUndefined(); // two apps tie: no answer
  });
});
