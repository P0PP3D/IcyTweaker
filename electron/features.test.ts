// Game library, per-game Windows settings, session reports, network adapter tweaks, standby memory, Boost option.
// Fake adapter and ./.test-tmp/features only; nothing written to Windows, no network.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_BOOST, validateBoost } from './games/boost';
import { acfValue, mainExe, scanLibrary } from './games/library';
import { createSessionRecorder, summarize } from './games/session';
import { applyWinSettings, compatRef, compatValue, gpuRef, priorityRef, readWinSettings, resetWinSettings, validateWinSettings } from './games/winsettings';
import { networkTweaks, nicTweaks } from './network/network';
import { dword, memoryAdapter, parseNetAdv, sz, type SettingRef, type Value } from './system/adapter';
import { parseLists, purgeStandby } from './system/memory';
import { createSafety } from './system/safety';
import { createEngine } from './tweaks/engine';
import type { GameWinSettings } from '../shared/types';

const TMP = path.join(process.cwd(), '.test-tmp', 'features');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;
const dir = () => path.join(TMP, String(n++));
const touch = async (file: string, bytes = 0) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.alloc(bytes));
};

describe('game library', () => {
  it('finds Steam games (largest exe, skipping redists and tools) and Epic games', async () => {
    const root = dir();
    const steam = path.join(root, 'steam');
    const apps = path.join(steam, 'steamapps');
    await mkdir(apps, { recursive: true });
    await writeFile(path.join(apps, 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
    await writeFile(path.join(apps, 'appmanifest_100.acf'), '"AppState"\n{\n\t"appid"\t\t"100"\n\t"name"\t\t"Space Game"\n\t"installdir"\t\t"Space Game"\n}\n');
    await writeFile(path.join(apps, 'appmanifest_228980.acf'), '"AppState"\n{\n\t"appid"\t\t"228980"\n\t"name"\t\t"Steamworks Common Redistributables"\n\t"installdir"\t\t"Steamworks Shared"\n}\n');
    const game = path.join(apps, 'common', 'Space Game');
    await touch(path.join(game, 'SpaceGame.exe'), 10);
    await touch(path.join(game, 'Space', 'Binaries', 'Win64', 'SpaceGame-Win64-Shipping.exe'), 500);
    await touch(path.join(game, '_CommonRedist', 'vcredist', 'huge.exe'), 5000);
    await touch(path.join(game, 'unins000.exe'), 9000);
    await touch(path.join(apps, 'common', 'Steamworks Shared', 'x.exe'), 10);

    const pd = path.join(root, 'pd');
    const manifests = path.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    await mkdir(manifests, { recursive: true });
    await writeFile(path.join(manifests, 'A.item'), JSON.stringify({ DisplayName: 'Kart Racer', InstallLocation: 'D:\\Games\\Kart', LaunchExecutable: 'Bin\\Kart.exe', AppName: 'Kart1' }));
    await writeFile(path.join(manifests, 'B.item'), JSON.stringify({ DisplayName: 'Half Done', InstallLocation: 'D:\\x', LaunchExecutable: 'x.exe', AppName: 'Half', bIsIncompleteInstall: true }));

    const lib = await scanLibrary({ vars: {}, steamPath: steam, programData: pd });
    expect(lib.map((g) => g.name)).toEqual(['Kart Racer', 'Space Game']);
    expect(lib[1]).toMatchObject({ id: 'steam-100', source: 'steam', exe: path.join(game, 'Space', 'Binaries', 'Win64', 'SpaceGame-Win64-Shipping.exe'), launch: { url: 'steam://rungameid/100' } });
    expect(lib[0]).toMatchObject({ id: 'epic-Kart1', exe: path.join('D:\\Games\\Kart', 'Bin\\Kart.exe'), launch: { url: 'com.epicgames.launcher://apps/Kart1?action=launch&silent=true' } });
    expect(acfValue('"AppState"\n{\n\t"name"\t\t"X"\n}', 'name')).toBe('X');
    expect(await mainExe(path.join(root, 'missing'))).toBeNull();
  });
});

describe('per-game Windows settings', () => {
  const exe = 'C:\\Games\\Space\\SpaceGame.exe';
  const all: GameWinSettings = { gpu: 2, fso: true, dpi: true, admin: false, priority: 'high' };
  const none: GameWinSettings = { gpu: 0, fso: false, dpi: false, admin: false, priority: 'default' };

  it('apply -> detect -> reset -> original restored, when nothing was set before', async () => {
    const fake = memoryAdapter();
    const safety = await createSafety(fake, dir());
    expect(await readWinSettings(safety, exe)).toEqual(none);
    await applyWinSettings(safety, exe, all);
    expect(await readWinSettings(safety, exe)).toEqual(all);
    expect(await fake.read(gpuRef(exe))).toEqual(sz('GpuPreference=2;'));
    expect(await fake.read(compatRef(exe))).toEqual(sz('~ DISABLEDXMAXIMIZEDWINDOWEDMODE HIGHDPIAWARE'));
    expect(await fake.read(priorityRef(exe))).toEqual(dword(3));
    expect((priorityRef(exe) as { key: string }).key).toMatch(/Image File Execution Options\\SpaceGame\.exe\\PerfOptions$/);
    await resetWinSettings(safety, exe);
    for (const r of [gpuRef(exe), compatRef(exe), priorityRef(exe)]) expect(await fake.read(r)).toBeNull();
  });

  it("keeps the user's own compatibility flags and puts the previous values back", async () => {
    const fake = memoryAdapter();
    await fake.write(compatRef(exe), sz('~ WIN7RTM RUNASADMIN'));
    await fake.write(gpuRef(exe), sz('GpuPreference=1;'));
    const safety = await createSafety(fake, dir());
    expect(await readWinSettings(safety, exe)).toMatchObject({ gpu: 1, admin: true, fso: false });
    await applyWinSettings(safety, exe, { ...none, fso: true, gpu: 2 });
    expect(await fake.read(compatRef(exe))).toEqual(sz('~ WIN7RTM DISABLEDXMAXIMIZEDWINDOWEDMODE'));
    await resetWinSettings(safety, exe);
    expect(await fake.read(compatRef(exe))).toEqual(sz('~ WIN7RTM RUNASADMIN'));
    expect(await fake.read(gpuRef(exe))).toEqual(sz('GpuPreference=1;'));
  });

  it('compatValue and validation', () => {
    expect(compatValue('', { fso: false, dpi: false, admin: false })).toBeNull();
    expect(compatValue('~ HIGHDPIAWARE', { fso: false, dpi: false, admin: true })).toBe('~ RUNASADMIN');
    expect(validateWinSettings({ ...all, gpu: 5 })).toBeNull();
    expect(validateWinSettings({ ...all, priority: 'realtime' })).toBeNull();
    expect(validateWinSettings(all)).toEqual(all);
  });
});

describe('session reports', () => {
  it('summarizes FPS, temperatures and throttling warnings; keeps history newest first', async () => {
    const r = summarize('Space Game', '2026-11-11T10:00:00Z', '2026-11-11T10:45:00Z', [
      { fps: 140, low1: 90, cpu: 40, cpuTemp: 80, gpuTemp: 70, gpuLoad: 95 },
      { fps: 160, low1: 100, cpu: 60, cpuTemp: 96, gpuTemp: 75, gpuLoad: 97 },
      { cpu: 50 },
    ]);
    expect(r).toMatchObject({ minutes: 45, fpsAvg: 150, low1: 100, cpuAvg: 50, cpuTempMax: 96, gpuTempMax: 75, gpuLoadAvg: 96 });
    expect(r.hot).toHaveLength(1);
    expect(summarize('x', '2026-11-11T10:00:00Z', '2026-11-11T10:01:00Z', [])).toMatchObject({ fpsAvg: null, hot: [] });

    const d = dir();
    await mkdir(d, { recursive: true });
    const rec = createSessionRecorder(path.join(d, 'sessions.json'));
    for (const game of ['A', 'B']) {
      rec.start(game);
      rec.sample({ game, fps: 100 });
      rec.sample({ game: 'Other', fps: 1 }); // another game's overlay data is ignored
      await rec.end();
    }
    expect((await rec.history()).map((s) => [s.game, s.fpsAvg])).toEqual([['B', 100], ['A', 100]]);
    expect(await rec.end()).toBeNull();
  });
});

describe('network adapter tweaks', () => {
  const nics = [{ name: 'Ethernet 3', description: 'Realtek PCIe GbE Family Controller', wifi: false }, { name: 'Wi-Fi 2', description: 'RZ616', wifi: true }];
  const ref = (adapter: string, keyword: string): SettingRef => ({ kind: 'netAdv', adapter, keyword });

  it('apply -> detect -> revert -> original; missing keywords are skipped; no card for an adapter without them', async () => {
    const fake = memoryAdapter();
    const seed: Array<[SettingRef, Value]> = [
      [ref('Ethernet 3', '*EEE'), '1'],
      [ref('Ethernet 3', 'EnableGreenEthernet'), '1'],
      [ref('Ethernet 3', 'AdvancedEEE'), '0'],
      [ref('Ethernet 3', '*InterruptModeration'), '1'],
      [ref('Ethernet 3', '*FlowControl'), '3'],
    ];
    for (const [r, v] of seed) await fake.write(r, v);
    const safety = await createSafety(fake, dir());
    const engine2 = createEngine({ tweaks: nicTweaks(nics), presets: [], safety, live: false, isAdmin: true, build: 26200 });
    const status = async (id: string) => (await engine2.getState()).tweaks.find((t) => t.id === id)!.status;
    expect(await status('nic-ethernet-3-energy')).toBe('partial'); // AdvancedEEE already off
    expect(await status('nic-wi-fi-2-energy')).toBe('unavailable'); // none of these keywords
    for (const id of ['nic-ethernet-3-energy', 'nic-ethernet-3-interrupt-moderation', 'nic-ethernet-3-flow-control']) {
      expect((await engine2.setTweak(id, true)).ok).toBe(true);
      expect(await status(id)).toBe('applied');
    }
    expect(await fake.read(ref('Ethernet 3', 'GigaLite'))).toBeNull(); // missing keyword: never created
    for (const id of ['nic-ethernet-3-energy', 'nic-ethernet-3-interrupt-moderation', 'nic-ethernet-3-flow-control']) {
      expect((await engine2.setTweak(id, false)).ok).toBe(true);
    }
    for (const [r, v] of seed) expect(await fake.read(r)).toEqual(v);
  });

  it('Wi-Fi power saving: apply -> detect -> revert -> original (Medium Power Saving before)', async () => {
    const fake = memoryAdapter();
    const t = networkTweaks([], nics).find((x) => x.id === 'wifi-power-saving-off')!;
    await fake.write(t.settings[0].ref, 2);
    const safety = await createSafety(fake, dir());
    const engine = createEngine({ tweaks: [t], presets: [], safety, live: false, isAdmin: true, build: 26200 });
    expect((await engine.setTweak(t.id, true)).ok).toBe(true);
    expect(await fake.read(t.settings[0].ref)).toBe(0);
    expect((await engine.getState()).tweaks[0].status).toBe('applied');
    expect((await engine.setTweak(t.id, false)).ok).toBe(true);
    expect(await fake.read(t.settings[0].ref)).toBe(2);
  });

  it('adds the Wi-Fi power saving tweak only with a Wi-Fi adapter; parses adapter properties', () => {
    expect(networkTweaks([], nics).some((t) => t.id === 'wifi-power-saving-off')).toBe(true);
    expect(networkTweaks([], [nics[0]]).some((t) => t.id === 'wifi-power-saving-off')).toBe(false);
    const p = parseNetAdv('*EEE\t1\r\nNetworkAddress\t\r\n*FlowControl\t3\r\n');
    expect(p.get('*eee')).toBe('1');
    expect(p.get('networkaddress')).toBe('');
  });
});

describe('standby memory', () => {
  it('parses the list sizes; purging in dry-run is only recorded', async () => {
    expect(parseLists('2048 9000\r\n')).toEqual({ freeMb: 2048, standbyMb: 9000 });
    expect(parseLists('error')).toBeNull();
    const fake = memoryAdapter();
    expect(await purgeStandby(fake, true)).toBe(false);
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0][0]).toMatch(/powershell\.exe$/i);
  });

  it('Game Boost option is validated and off by default', () => {
    expect(DEFAULT_BOOST.purgeStandby).toBe(false);
    expect(validateBoost({ ...DEFAULT_BOOST, purgeStandby: true }, [])?.purgeStandby).toBe(true);
    expect(validateBoost({ ...DEFAULT_BOOST, purgeStandby: 'yes' }, [])?.purgeStandby).toBe(false);
  });
});
