// Process view, latency check, updates, app usage, Froststrap, overlay math, undo-since, per-game Boost,
// driver backup. Fake adapter and ./.test-tmp/more only; no network, nothing written to Windows.
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFroststrap, FPS_FLAG } from './apps/froststrap';
import { createBoost, DEFAULT_BOOST, parsePlans, validateBoost } from './games/boost';
import { LHM_SHA256, sha256File, tempLoop } from './system/sensors';
import { frameStats } from './games/overlay';
import { desktopIconFile, isUnused, storeLogo } from './system/debloat';
import { backupDrivers, PNPUTIL } from './system/drivers';
import { parseDpcIsr, summarizeLatency } from './system/latency';
import { createProcessSampler, hintFor, parseRaw } from './system/processes';
import { checkUpdates, newerThan } from './system/updates';
import { appExes, lastRun, parseUserAssist, prefetchTimes } from './system/usage';
import { dword, liveRead, memoryAdapter, type SettingRef } from './system/adapter';
import { createSafety } from './system/safety';
import type { AppItem } from '../shared/types';

const TMP = path.join(process.cwd(), '.test-tmp', 'more');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;
const dir = () => path.join(TMP, String(n++));

describe('process view', () => {
  it('turns two samples into CPU and disk rates (CPU spread over all threads), with hints', () => {
    const sample = createProcessSampler(4);
    const first = sample(parseRaw('10|chrome.exe|0|1000|0\r\n4|svchost.exe|0|10|0\r\nbad'), 0);
    expect(first[0]).toMatchObject({ pid: 10, name: 'chrome', cpu: 0, hint: 'safe' });
    // 1 s later chrome used 2 s of CPU time (2e7 x 100 ns) on a 4-thread CPU = 50%, and read 1 MB.
    const list = sample(parseRaw('10|chrome.exe|20000000|1000|1048576\r\n4|svchost.exe|0|10|0'), 1000);
    expect(list[0]).toMatchObject({ cpu: 50, disk: 1048576 });
    expect(list[1].hint).toBe('system');
    // A reused PID with another name is a new process: no bogus rate.
    expect(sample(parseRaw('10|other.exe|90000000|5|5'), 2000)[0].cpu).toBe(0);
    expect(hintFor('explorer.exe').hint).toBe('caution');
    expect(hintFor('mygame').hint).toBe('unknown');
  });
});

describe('latency check', () => {
  it('averages per kind, finds the worst core, and grades it', () => {
    const lines = ['dpc|0,0|1', 'dpc|0,1|3', 'isr|0,0|0.5', 'isr|0,1|0.1', 'junk'].join('\r\n');
    const r = summarizeLatency(lines);
    expect(r.dpc).toEqual({ avg: 2, peak: 3, core: '0,1' });
    expect(r.verdict).toBe('check'); // average 2% across cores
    expect(summarizeLatency('dpc|0,0|0.1\nisr|0,0|0.05').verdict).toBe('good');
    expect(summarizeLatency('dpc|0,3|40\nisr|0,0|0').verdict).toBe('bad');
    expect(() => summarizeLatency('')).toThrow(/No counter data/);
  });
});

describe('updates', () => {
  it('compares versions and reads the latest GitHub release', async () => {
    expect(newerThan('v1.2.10', '1.2.9')).toBe(true);
    expect(newerThan('1.2.0', '1.2.0')).toBe(false);
    expect(newerThan('0.9.9', '1.0.0')).toBe(false);
    const fake = (async () => new Response(JSON.stringify({ tag_name: 'v0.2.0', html_url: 'https://github.com/x/y/releases/tag/v0.2.0' }))) as unknown as typeof fetch;
    expect(await checkUpdates('0.1.0', 'x/y', fake)).toMatchObject({ newer: true, latest: 'v0.2.0', configured: true });
    expect((await checkUpdates('0.1.0', '', fake)).configured).toBe(false);
    const evil = (async () => new Response(JSON.stringify({ tag_name: 'v9', html_url: 'https://evil.example/' }))) as unknown as typeof fetch;
    expect((await checkUpdates('0.1.0', 'x/y', evil)).url).toBeNull();
  });
});

describe('app usage (Debloater suggestions)', () => {
  it('reads Prefetch file times, decodes UserAssist, finds the app exes (not updaters)', async () => {
    const pf = dir();
    await mkdir(pf, { recursive: true });
    await writeFile(path.join(pf, 'GAME.EXE-1A2B3C4D.pf'), '');
    const old = new Date('2024-01-02T00:00:00Z');
    await utimes(path.join(pf, 'GAME.EXE-1A2B3C4D.pf'), old, old);
    expect((await prefetchTimes(pf))!.get('game.exe')).toBe(old.getTime());
    expect(await prefetchTimes(path.join(pf, 'missing'))).toBeNull();

    // ROT13 of C:\Tnzr\tnzr.rkr is C:\Game\game.exe; FILETIME for 2024-01-02.
    const ft = (BigInt(old.getTime()) + 11644473600000n) * 10000n;
    expect(parseUserAssist(`P:\\Tnzr\\tnzr.rkr|${ft}`).get('game.exe')).toBe(old.getTime());

    const app = dir();
    await mkdir(path.join(app, 'bin'), { recursive: true });
    for (const f of ['game.exe', 'unins000.exe', path.join('bin', 'helper-update.exe'), path.join('bin', 'tool.exe')]) await writeFile(path.join(app, f), '');
    const exes = await appExes(app, `"${path.join(app, 'game.exe')}",0`);
    expect(exes.sort()).toEqual(['game.exe', 'tool.exe']);
    expect(lastRun(exes, new Map([['tool.exe', 5], ['game.exe', 9]]))).toBe(9);
  });

  it('suggests apps unopened for 6 months and installed that long, never protected ones', () => {
    const base = { protected: null, installDate: '2023-01-01' } as unknown as AppItem;
    const now = Date.parse('2026-11-11');
    expect(isUnused(base, Date.parse('2026-01-01'), now)).toBe(true);
    expect(isUnused(base, Date.parse('2026-10-01'), now)).toBe(false);
    expect(isUnused({ ...base, protected: 'Driver' }, Date.parse('2020-01-01'), now)).toBe(false);
    expect(isUnused(base, null, now)).toBe(false);
  });
});

describe('Froststrap', () => {
  it('sets the FPS flag (backed up, text value) and puts the original back', async () => {
    const local = dir();
    const fs = path.join(local, 'Froststrap');
    await mkdir(path.join(fs, 'ClientSettings'), { recursive: true });
    await writeFile(path.join(fs, 'Froststrap.exe'), '');
    await writeFile(path.join(fs, 'ClientSettings', 'ClientAppSettings.json'), '{\n  "FFlagHandleAltEnterFullscreenManually": "False"\n}');
    const fake = memoryAdapter(liveRead);
    const safety = await createSafety(fake, path.join(local, 'data'));
    const f = createFroststrap(safety, local);
    expect(await f.info()).toEqual({ installed: true, fpsCap: null, flags: 1, changed: false });
    await f.setFps(240);
    expect(await f.info()).toMatchObject({ fpsCap: 240, changed: true });
    const ref: SettingRef = { kind: 'configKey', file: path.join(fs, 'ClientSettings', 'ClientAppSettings.json'), format: 'json', name: FPS_FLAG };
    expect(await fake.read(ref)).toBe('240');
    await f.setFps(null);
    expect(await fake.read(ref)).toBeNull();
    expect((await f.info()).changed).toBe(false);
  });

  it('refuses while Froststrap runs', async () => {
    const local = dir();
    await mkdir(path.join(local, 'Froststrap', 'ClientSettings'), { recursive: true });
    await writeFile(path.join(local, 'Froststrap', 'Froststrap.exe'), '');
    await writeFile(path.join(local, 'Froststrap', 'ClientSettings', 'ClientAppSettings.json'), '{}');
    const fake = memoryAdapter(liveRead, async () => '"Froststrap.exe","1","Console","1","1 K"\r\n');
    const f = createFroststrap(await createSafety(fake, path.join(local, 'data')), local);
    await expect(f.setFps(144)).rejects.toThrow(/Close Froststrap/);
  });
});

describe('overlay frame math', () => {
  it('fps from the last second, 1% low from the last five', () => {
    const now = 10_000;
    const frames = [...Array.from({ length: 100 }, (_, i) => ({ t: now - 999 + i * 9, ms: 10 })), { t: now - 3000, ms: 50 }, { t: now - 2500, ms: 50 }];
    expect(frameStats(frames, now)).toEqual({ fps: 100, frametime: 10, low1: 20 });
    expect(frameStats([], now)).toEqual({ fps: null, frametime: null, low1: null });
  });
});

describe('undo since a point in history', () => {
  it('puts back only settings first changed at or after the point', async () => {
    const fake = memoryAdapter();
    const safety = await createSafety(fake, dir());
    const a: SettingRef = { kind: 'reg', hive: 'HKCU', key: 'K', name: 'A' };
    const b: SettingRef = { kind: 'reg', hive: 'HKCU', key: 'K', name: 'B' };
    await safety.set(a, dword(1));
    await new Promise((r) => setTimeout(r, 15));
    const point = new Date().toISOString();
    await safety.set(b, dword(1));
    expect(await safety.undoSince(point)).toEqual({ count: 1, errors: [] });
    expect(await fake.read(b)).toBeNull();
    expect(await fake.read(a)).toEqual(dword(1));
  });
});

describe('Game Boost per game', () => {
  it('uses a game\'s own options; pauses and resumes Windows Update only if it was running', async () => {
    const procs = { value: '' };
    const fake = memoryAdapter(undefined, async (file, args) => (args[0] === 'query' && args[1] === 'wuauserv' ? 'STATE              : 4  RUNNING' : procs.value));
    const safety = await createSafety(fake, dir());
    const settings = validateBoost({ ...DEFAULT_BOOST, enabled: true, perGame: { roblox: { plan: false, lowerApps: [], pauseUpdates: true, pauseOneDrive: false }, nope: {} } }, ['roblox'])!;
    expect(Object.keys(settings.perGame)).toEqual(['roblox']);
    const boost = createBoost(safety, [{ id: 'roblox', name: 'Roblox', exe: ['robloxplayerbeta.exe'] }], settings);
    procs.value = '"RobloxPlayerBeta.exe","1","Console","1","1 K"\r\n';
    await boost.tick();
    expect(fake.commands.some((c) => c.slice(1).join(' ') === 'stop wuauserv')).toBe(true);
    expect(fake.commands.some((c) => c.join(' ').includes('BelowNormal'))).toBe(false); // its own list is empty
    procs.value = '';
    await boost.tick();
    expect(fake.commands.some((c) => c.slice(1).join(' ') === 'start wuauserv')).toBe(true);
    expect(validateBoost({ enabled: 'yes' }, [])).toBeNull();
  });
});

describe('driver backup', () => {
  it('dry-run records the pnputil export into the app folder', async () => {
    const fake = memoryAdapter();
    const r = await backupDrivers(fake, path.join(TMP, 'drivers'));
    expect(fake.commands[0].slice(0, 3)).toEqual([PNPUTIL, '/export-driver', '*']);
    expect(fake.commands[0][3].startsWith(path.join(TMP, 'drivers'))).toBe(true);
    expect(r.message).toMatch(/dry-run/);
  });
});

describe('power plan per game', () => {
  const LIST = [
    'Existing Power Schemes (* Active)',
    'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)',
    'Power Scheme GUID: 5ff03616-d299-44c6-b4b5-dcfb5b9cacbb  (Ultimate Performance)',
    'Power Scheme GUID: 7e6b8c66-7496-440a-82ce-6c3a60a2c35c  (Ultimate Performance) *',
  ].join('\r\n');

  it('parses powercfg /list, keeping duplicate names apart and marking the active plan', () => {
    const plans = parsePlans(LIST);
    expect(plans).toHaveLength(3);
    expect(plans[2]).toEqual({ guid: '7e6b8c66-7496-440a-82ce-6c3a60a2c35c', name: 'Ultimate Performance', active: true });
  });

  it('a game\'s chosen plan is used during its session; a bad GUID is dropped', async () => {
    const CHOSEN = '5ff03616-d299-44c6-b4b5-dcfb5b9cacbb';
    const procs = { value: '' };
    const fake = memoryAdapter(undefined, async () => procs.value);
    await fake.write({ kind: 'activeScheme' }, '381b4222-f694-41f0-9685-ff5bb260df2e');
    await fake.write({ kind: 'scheme', guid: CHOSEN, base: '', name: '' }, true);
    const safety = await createSafety(fake, dir());
    const settings = validateBoost({ ...DEFAULT_BOOST, enabled: true, perGame: { cs2: { plan: true, planGuid: CHOSEN.toUpperCase(), lowerApps: [] } } }, ['cs2'])!;
    expect(settings.perGame.cs2.planGuid).toBe(CHOSEN);
    expect(validateBoost({ ...DEFAULT_BOOST, planGuid: 'not-a-guid' }, [])!.planGuid).toBeNull();
    const boost = createBoost(safety, [{ id: 'cs2', name: 'CS2', exe: ['cs2.exe'] }], settings);
    procs.value = '"cs2.exe","1","Console","1","1 K"\r\n';
    await boost.tick();
    expect(await fake.read({ kind: 'activeScheme' })).toBe(CHOSEN);
    procs.value = '';
    await boost.tick();
    expect(await fake.read({ kind: 'activeScheme' })).toBe('381b4222-f694-41f0-9685-ff5bb260df2e');
  });
});

describe('naming the driver (xperf DPC/ISR report)', () => {
  it('collects counts and the longest bucket per driver, worst first', () => {
    const report = [
      '--------------------------------------------------------------',
      'DPC Info',
      '--------------------------------------------------------------',
      'Total = 5000 for module ndis.sys',
      'Elapsed Time, >        0 usecs AND <=        1 usecs,   4000, or  80.00%',
      'Elapsed Time, >      500 usecs AND <=     1000 usecs,     12, or   0.24%',
      'Elapsed Time, >     1000 usecs AND <=     2000 usecs,      0, or   0.00%',
      'Total = 900 for module nvlddmkm.sys',
      'Elapsed Time, >        2 usecs AND <=        4 usecs,    900, or 100.00%',
      'ISR Info',
      'Total = 300 for module USBPORT.SYS',
      'Elapsed Time, >      100 usecs AND <=      250 usecs,      3, or   1.00%',
    ].join('\r\n');
    expect(parseDpcIsr(report)).toEqual([
      { module: 'ndis.sys', kind: 'DPC', count: 5000, maxUs: 1000 },
      { module: 'USBPORT.SYS', kind: 'ISR', count: 300, maxUs: 250 },
      { module: 'nvlddmkm.sys', kind: 'DPC', count: 900, maxUs: 4 },
    ]);
    expect(parseDpcIsr('nothing useful')).toEqual([]);
  });
});

describe('CPU temperature library', () => {
  it('hash check reads the file\'s SHA-256', async () => {
    const f = path.join(dir(), 'x.bin');
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, 'abc');
    expect(await sha256File(f)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(LHM_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(tempLoop('C:\\x').includes("'C:\\x\\LibreHardwareMonitorLib.dll'")).toBe(true);
  });
});

describe('Debloater icons', () => {
  it('picks a Store app logo variant and a desktop app exe', async () => {
    const pkg = dir();
    await mkdir(path.join(pkg, 'Assets'), { recursive: true });
    await writeFile(path.join(pkg, 'AppxManifest.xml'), '<Package><Properties><Logo>Assets\\StoreLogo.png</Logo></Properties><uap:VisualElements Square44x44Logo="Assets\\App.png" /></Package>');
    for (const f of ['App.scale-200.png', 'App.targetsize-32_altform-unplated.png', 'App.scale-100.png', 'StoreLogo.png']) await writeFile(path.join(pkg, 'Assets', f), '');
    expect(await storeLogo(pkg)).toBe(path.join(pkg, 'Assets', 'App.targetsize-32_altform-unplated.png'));
    expect(await storeLogo(dir())).toBeNull(); // no manifest

    const app = dir();
    await mkdir(app, { recursive: true });
    for (const f of ['unins000.exe', 'Tool.exe', 'app.ico']) await writeFile(path.join(app, f), '');
    expect(await desktopIconFile(app, `"${path.join(app, 'app.ico')}",0`)).toBe(path.join(app, 'app.ico'));
    expect(await desktopIconFile(app, 'C:\\missing\\x.exe')).toBe(path.join(app, 'Tool.exe')); // skips the uninstaller
    expect(await desktopIconFile(undefined, undefined)).toBeNull();
  });
});
