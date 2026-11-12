// Share codes, Minecraft's key:value format, FPS-drop detection, Game Boost display mode, the new game profiles.
// Fake adapter and ./.test-tmp/extras only; nothing written to Windows.
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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
