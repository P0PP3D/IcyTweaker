// Phase 8: hardware parsing, BIOS audit, Game Boost watcher, uninstall Defender restore. Fakes only.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { advancedTweaks } from './advanced/advanced';
import { auditBios, parseHardware, rebarFromSmi } from './advanced/hardware';
import { createBoost, DEFAULT_BOOST } from './games/boost';
import { memoryAdapter, type SettingRef } from './system/adapter';
import { createSafety } from './system/safety';
import { restoreDefender } from './system/uninstall';
import { CORE_PLAN, generalTweaks } from './tweaks/general';

const TMP = path.join(process.cwd(), '.test-tmp', 'advanced');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;

// Shape of the real query output on the dev PC (desktop, DDR4-3200, RTX 4070 SUPER).
const SAMPLE = JSON.stringify({
  maker: 'Micro-Star International Co., Ltd.',
  model: 'MS-7C95',
  hypervisor: true,
  cpu: 'AMD Ryzen 9 5900X 12-Core Processor',
  cpuVendor: 'AuthenticAMD',
  cores: 12,
  threads: 24,
  vtFirmware: true,
  biosVersion: 'H.C0',
  biosDate: '2024-07-14',
  boardMaker: 'Micro-Star International Co., Ltd.',
  board: 'PRO B550M-VC WIFI (MS-7C95)',
  memory: [
    { speed: 3200, configured: 3200, type: 26, size: 17179869184, part: 'X' },
    { speed: 3200, configured: 3200, type: 26, size: 17179869184, part: 'X' },
  ],
  gpus: { name: 'NVIDIA GeForce RTX 4070 SUPER', driver: '32.0.16.2114', pnp: 'PCI\\VEN_10DE&DEV_2783\\4&1' }, // one GPU: PowerShell may emit an object, not an array
  nics: [],
  chassis: [3],
  battery: false,
  secureBoot: 1,
  tpm: null,
  vbs: 2,
  hvciRunning: true,
  biosVendorTool: null,
});

describe('hardware and BIOS audit', () => {
  it('parses the hardware query', () => {
    const hw = parseHardware(SAMPLE);
    expect(hw).toMatchObject({ cpuVendor: 'AMD', laptop: false, secureBoot: true, tpm: null, hvciRunning: true });
    expect(hw.memory).toEqual({ totalBytes: 34359738368, modules: 2, type: 'DDR4', ratedMTs: 3200, runningMTs: 3200 });
    expect(hw.gpus[0].vendor).toBe('NVIDIA');
    expect(parseHardware(JSON.stringify({ ...JSON.parse(SAMPLE), chassis: [10] })).laptop).toBe(true);
  });

  it('reads Resizable BAR from nvidia-smi BAR1 size', () => {
    expect(rebarFromSmi('    BAR1 Memory Usage\r\n        Total                                          : 16384 MiB\r\n')).toBe(true);
    expect(rebarFromSmi('    BAR1 Memory Usage\n        Total : 256 MiB\n')).toBe(false);
    expect(rebarFromSmi('')).toBeNull();
  });

  it('audit: memory below rating or at a JEDEC speed is flagged; Secure Boot off is flagged', () => {
    const hw = parseHardware(SAMPLE);
    const byId = (items: ReturnType<typeof auditBios>) => Object.fromEntries(items.map((i) => [i.id, i.status]));
    expect(byId(auditBios(hw, true))).toMatchObject({ xmp: 'good', rebar: 'good', 'secure-boot': 'good', tpm: 'info' });
    const slow = { ...hw, memory: { ...hw.memory, runningMTs: 2133 }, secureBoot: false };
    expect(byId(auditBios(slow, false))).toMatchObject({ xmp: 'check', rebar: 'check', 'secure-boot': 'check' });
    const ddr5Jedec = { ...hw, memory: { ...hw.memory, type: 'DDR5' as const, ratedMTs: 4800, runningMTs: 4800 } };
    expect(byId(auditBios(ddr5Jedec, null))).toMatchObject({ xmp: 'check', rebar: 'info' });
  });
});

describe('Game Boost', () => {
  const ACTIVE: SettingRef = { kind: 'activeScheme' };
  const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
  const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';

  async function setup(processes: { value: string }) {
    const fake = memoryAdapter(undefined, async () => processes.value);
    await fake.write(ACTIVE, BALANCED);
    await fake.write({ kind: 'scheme', guid: HIGH, base: '', name: '' }, true); // High performance exists; Core plan does not
    const safety = await createSafety(fake, path.join(TMP, String(n++)));
    const boost = createBoost(safety, [{ id: 'fortnite', name: 'Fortnite', exe: ['fortniteclient-win64-shipping.exe'] }], { ...DEFAULT_BOOST, enabled: true });
    return { fake, safety, boost };
  }
  const GAME = '"FortniteClient-Win64-Shipping.exe","1","Console","1","1 K"\r\n';

  it('game starts: performance plan and lower apps; game exits: plan and backup put back', async () => {
    const procs = { value: '' };
    const { fake, safety, boost } = await setup(procs);
    await boost.tick();
    expect(boost.state().active).toBeNull();

    procs.value = GAME;
    await boost.tick();
    expect(boost.state().active).toMatchObject({ game: 'Fortnite', plan: 'High performance' });
    expect(await fake.read(ACTIVE)).toBe(HIGH);
    expect(safety.backupCount()).toBe(1); // a crash now is covered by Undo All
    expect(fake.commands.some((c) => c.join(' ').includes("BelowNormal"))).toBe(true);

    procs.value = '';
    await boost.tick();
    expect(boost.state().active).toBeNull();
    expect(await fake.read(ACTIVE)).toBe(BALANCED);
    expect(safety.backupCount()).toBe(0);
  });

  it('turning Boost off during a session ends it; the Core plan is preferred when it exists', async () => {
    const procs = { value: GAME };
    const { fake, boost } = await setup(procs);
    await fake.write({ kind: 'scheme', guid: CORE_PLAN, base: '', name: '' }, true);
    await boost.tick();
    expect(await fake.read(ACTIVE)).toBe(CORE_PLAN);
    await boost.set({ ...boost.settings, enabled: false });
    expect(boost.state().active).toBeNull();
    expect(await fake.read(ACTIVE)).toBe(BALANCED);
  });

  it('a plan the user set with the Core Power Plan tweak survives a session', async () => {
    const procs = { value: '' };
    const { fake, safety, boost } = await setup(procs);
    await safety.set(ACTIVE, '11111111-1111-1111-1111-111111111111'); // changed by a tweak: backed up as Balanced
    procs.value = GAME;
    await boost.tick();
    procs.value = '';
    await boost.tick();
    expect(await fake.read(ACTIVE)).toBe('11111111-1111-1111-1111-111111111111');
    expect(safety.changes()[0].original).toBe(JSON.stringify(BALANCED)); // the tweak's backup is untouched
  });
});

describe('Advanced power tweaks', () => {
  it('reverting one that was already on (no backup, no known default) changes nothing', async () => {
    const t = advancedTweaks([]).find((x) => x.id === 'cpu-core-parking-off')!;
    const fake = memoryAdapter();
    await fake.write(t.settings[0].ref, 100); // the plan already has it, as Ultimate Performance does
    const safety = await createSafety(fake, path.join(TMP, String(n++)));
    expect(await t.readState(safety)).toBe('applied');
    await t.revert(safety);
    expect(await fake.read(t.settings[0].ref)).toBe(100);
    expect(safety.backupCount()).toBe(0);
  });
});

describe('uninstaller Defender restore', () => {
  const defender = generalTweaks.find((t) => t.id === 'disable-defender')!;

  it('restores only Defender values the app changed; other changes stay', async () => {
    const dir = path.join(TMP, String(n++));
    const fake = memoryAdapter();
    const safety = await createSafety(fake, dir);
    await defender.apply(safety);
    await safety.set({ kind: 'reg', hive: 'HKCU', key: 'X', name: 'Other' }, { type: 'REG_DWORD', data: 1 });
    expect(await restoreDefender(fake, dir)).toBe(defender.settings.length);
    for (const s of defender.settings) expect(await fake.read(s.ref)).toBeNull();
    expect(await fake.read({ kind: 'reg', hive: 'HKCU', key: 'X', name: 'Other' })).toEqual({ type: 'REG_DWORD', data: 1 });
  });

  it('no live backup: changes nothing', async () => {
    const fake = memoryAdapter();
    expect(await restoreDefender(fake, path.join(TMP, 'never-ran'))).toBe(0);
    expect(fake.values.size).toBe(0);
  });
});

describe('driver reinstall', () => {
  const XML = '<LookupValueSearch><LookupValues><LookupValue ParentID="127"><Name>NVIDIA GeForce RTX 4070 Ti SUPER</Name><Value>1040</Value></LookupValue><LookupValue ParentID="127"><Name>NVIDIA GeForce RTX 4070 SUPER</Name><Value>1039</Value></LookupValue><LookupValue ParentID="129"><Name>GeForce RTX 4070 Laptop GPU</Name><Value>1006</Value></LookupValue></LookupValues></LookupValueSearch>';
  const answer = (name: string, url: string) => JSON.stringify({ Success: '1', IDS: [{ downloadInfo: { Version: '621.14', DownloadURL: url, Name: encodeURIComponent(name), ReleaseDateTime: 'Wed Nov 04, 2026', DownloadURLFileSize: '1.04 GB' } }] });
  const GOOD = 'https://us.download.nvidia.com/Windows/621.14/621.14-desktop-win10-win11-64bit-international-dch-whql.exe';

  it('matches the exact GPU name (with or without the NVIDIA prefix), never a near miss', async () => {
    const { findNvidiaProduct, nvidiaVersion } = await import('./resources/driver');
    expect(findNvidiaProduct(XML, 'NVIDIA GeForce RTX 4070 SUPER')).toEqual({ psid: '127', pfid: '1039' });
    expect(findNvidiaProduct(XML, 'NVIDIA GeForce RTX 4070 Laptop GPU')).toEqual({ psid: '129', pfid: '1006' });
    expect(findNvidiaProduct(XML, 'NVIDIA GeForce RTX 4070')).toBeNull();
    expect(nvidiaVersion('32.0.16.2114')).toBe('621.14');
  });

  it('refuses data-center drivers and foreign download hosts', async () => {
    const { parseNvidiaLookup } = await import('./resources/driver');
    expect(parseNvidiaLookup(answer('GeForce Game Ready Driver', GOOD)).version).toBe('621.14');
    expect(() => parseNvidiaLookup(answer('Data Center Driver for Windows', GOOD.replace('Windows', 'tesla')))).toThrow(/Unexpected/);
    expect(() => parseNvidiaLookup(answer('GeForce Game Ready Driver', 'https://evil.example.com/621.14.exe'))).toThrow(/Unexpected/);
    expect(() => parseNvidiaLookup('{"IDS":[]}')).toThrow(/no driver/);
  });

  it('driverInfo: no exact product match means no latest driver (never a guessed one)', async () => {
    const { driverInfo } = await import('./resources/driver');
    const hw = parseHardware(SAMPLE);
    const get = async (url: string) => (url.includes('lookupValueSearch') ? XML : answer('GeForce Game Ready Driver', GOOD));
    expect((await driverInfo(hw, get)).latest?.version).toBe('621.14');
    const other = { ...hw, gpus: [{ ...hw.gpus[0], name: 'NVIDIA GeForce RTX 9999' }] };
    const info = await driverInfo(other, get);
    expect(info.latest).toBeNull();
    expect(info.error).toMatch(/no exact match/);
  });

  it('dry-run job: records DDU and the installer, adds and removes the elevated sign-in task, downloads nothing', async () => {
    const { createDriverJob, DDU_ARGS, NVIDIA_INSTALL_ARGS } = await import('./resources/driver');
    const { DRIVER_TASK, SCHTASKS } = await import('./system/tasks');
    const dir = path.join(TMP, String(n++));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const fake = memoryAdapter();
    const ddu = String.raw`C:\DDU\ddu.exe`;
    const job = createDriverJob({ adapter: fake, dataDir: dir, resumeCommand: '"app.exe" --resume-driver-job', winget: 'winget.exe', dduExe: ddu, log: async () => {}, progress: () => {} });
    const started = await job.begin({ version: '621.14', url: GOOD, name: 'GeForce', released: '', size: '' }, 'RTX');
    expect(started.step, started.message).toBe('cleaning');
    // Task first (so the app comes back after DDU's restart, elevated), then DDU.
    expect(fake.commands[0].slice(0, 6)).toEqual([SCHTASKS, '/Create', '/TN', DRIVER_TASK, '/TR', '"app.exe" --resume-driver-job']);
    expect(fake.commands[0]).toEqual(expect.arrayContaining(['ONLOGON', 'HIGHEST', '/IT']));
    expect(fake.commands[1]).toEqual([ddu, ...DDU_ARGS]);
    const done = await job.resume();
    expect(done?.step).toBe('done');
    expect(fake.commands[2]).toEqual([started.installer, ...NVIDIA_INSTALL_ARGS]);
    expect(fake.commands[3]).toEqual([SCHTASKS, '/Delete', '/TN', DRIVER_TASK, '/F']);
    await job.clear();
    expect(await job.status()).toBeNull();
  });
});

describe('frametime capture', () => {
  it('parses PresentMon CSV and computes average and lows', async () => {
    const { frametimeStats, parseFrametimes } = await import('./resources/frametime');
    const csv = 'Application,ProcessID,MsBetweenPresents,MsUntilDisplayed\r\n' + Array.from({ length: 99 }, () => 'game.exe,1,4.0,5').join('\r\n') + '\r\ngame.exe,1,20.0,5\r\n';
    const ms = parseFrametimes(csv);
    expect(ms).toHaveLength(100);
    const r = frametimeStats('game.exe', 10, ms);
    expect(r).toMatchObject({ frames: 100, avgMs: 4.2, maxMs: 20, low01: 50 });
    expect(r.avgFps).toBe(240.4); // 1000 / 4.16 ms (the exact mean, not the rounded 4.2)
    expect(() => parseFrametimes('a,b\n1,2')).toThrow(/column/);
    expect(() => frametimeStats('game.exe', 10, [])).toThrow(/No frames/);
  });
});
