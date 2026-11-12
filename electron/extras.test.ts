// Share codes, Minecraft's key:value format, FPS-drop detection, Game Boost display mode, the new game profiles.
// Fake adapter and ./.test-tmp/extras only; nothing written to Windows.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { scanLibrary } from './games/library';
import { parseBoot } from './system/boot';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isTempDir } from './cleaner/cleaner';
import { keptOut } from './cleaner/finder';
import { getKey, setKey } from './games/config';
import { createBoost, DEFAULT_BOOST, validateBoost } from './games/boost';
import { gameProfiles } from './games/profiles';
import { createSessionRecorder, DROP, isDrop } from './games/session';
import { memoryAdapter } from './system/adapter';
import { buildConfig, fromShareCode, parseConfig, toShareCode } from './system/configfile';
import { validMode } from './system/monitors';
import { createSafety } from './system/safety';
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

describe('new game profiles', () => {
  it('Minecraft, Dead by Daylight and The Outlast Trials point at their own files only', () => {
    for (const id of ['minecraft', 'dead-by-daylight', 'outlast-trials']) {
      const p = gameProfiles.find((g) => g.id === id)!;
      expect(p).toBeTruthy();
      for (const f of Object.values(p.flags).flat()) expect(Object.keys(p.files)).toContain(f[0].file);
      for (const flag of p.recommended.flags ?? []) expect(p.flags[flag]?.length).toBeGreaterThan(0);
    }
    expect(gameProfiles.find((g) => g.id === 'dead-by-daylight')!.flags.fullscreen).toBeUndefined();
  });
});
