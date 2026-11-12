// Startup manager, runtime installer, network tests. Fake adapter and fake probes only: no network, no writes.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createStartup, parseRegValues, startupSources } from './apps/startup';
import { dnsBenchmark, latencyTest, summarizeLatency, validHost } from './network/tests';
import { RUNTIMES, installRuntimes, summarizeWinget } from './resources/runtimes';
import { binary, memoryAdapter, refId, type SettingRef } from './system/adapter';
import { createSafety } from './system/safety';

const TMP = path.join(process.cwd(), '.test-tmp', 'apps');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;

const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const flag = (name: string, sub = 'Run', hive: 'HKCU' | 'HKLM' = 'HKCU'): SettingRef => ({ kind: 'reg', hive, key: `${APPROVED}\\${sub}`, name });

describe('startup manager', () => {
  const runOut = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    Steam    REG_SZ    "C:\\Steam\\steam.exe" -silent',
    '    Discord    REG_SZ    "C:\\Discord\\Update.exe" --processStart Discord.exe',
    '    SecurityHealth    REG_EXPAND_SZ    %windir%\\system32\\SecurityHealthSystray.exe',
    '',
  ].join('\r\n');

  async function setup() {
    const root = path.join(TMP, String(n++));
    const folder = path.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'Tool.lnk'), '');
    await writeFile(path.join(folder, 'desktop.ini'), '');
    // Only HKCU Run answers; HKLM keys are empty.
    const fake = memoryAdapter(undefined, async (_f, args) => (args[1].startsWith('HKCU') ? runOut : ''));
    await fake.write(flag('Discord'), binary('030000006384EE1FE260DD01')); // already off (timestamped)
    await fake.write(flag('SecurityHealth'), binary('060000000000000000000000')); // 06 = on
    const safety = await createSafety(fake, path.join(root, 'data'));
    return { fake, safety, startup: createStartup(safety, startupSources({ APPDATA: root, ProgramData: path.join(root, 'none') })) };
  }

  it('parses reg query output', () => {
    expect(parseRegValues(runOut).map((v) => v.name)).toEqual(['Steam', 'Discord', 'SecurityHealth']);
  });

  it('lists Run entries and startup-folder shortcuts with their on/off flag', async () => {
    const { startup } = await setup();
    const items = await startup.list();
    expect(items.map((i) => `${i.name}:${i.enabled}`)).toEqual(['Steam:true', 'Discord:false', 'SecurityHealth:true', 'Tool:true']);
    expect(items.find((i) => i.name === 'Tool')!.location).toMatch(/Startup folder/);
  });

  it('turning off sets the low bit (keeping the rest); on clears it; Undo All restores the originals', async () => {
    const { fake, safety, startup } = await setup();
    await startup.setEnabled('hkcu-run|Steam', false); // no flag yet: absent before
    await startup.setEnabled('hkcu-run|SecurityHealth', false);
    await startup.setEnabled('hkcu-run|Discord', true);
    await startup.setEnabled('user-folder|Tool.lnk', false);
    expect(await fake.read(flag('Steam'))).toEqual(binary('030000000000000000000000'));
    expect(await fake.read(flag('SecurityHealth'))).toEqual(binary('070000000000000000000000'));
    expect(await fake.read(flag('Discord'))).toEqual(binary('020000006384EE1FE260DD01'));
    expect(await fake.read(flag('Tool.lnk', 'StartupFolder'))).toEqual(binary('030000000000000000000000'));
    expect((await startup.list()).filter((i) => i.enabled).map((i) => i.name)).toEqual(['Discord']);

    await safety.undoAll();
    expect(await fake.read(flag('Steam'))).toBeNull();
    expect(await fake.read(flag('Discord'))).toEqual(binary('030000006384EE1FE260DD01'));
    expect(fake.values.has(refId(flag('Steam')))).toBe(true); // the delete was written, not skipped
  });

  it('turning on an item with no flag changes nothing', async () => {
    const { safety, startup } = await setup();
    await startup.setEnabled('hkcu-run|Steam', true);
    expect(safety.backupCount()).toBe(0);
  });
});

describe('runtime installer', () => {
  it('runs winget per package, silently, exact id; dry-run installs nothing', async () => {
    const fake = memoryAdapter();
    const ids = ['Microsoft.VCRedist.2015+.x64', 'Microsoft.DirectX'];
    const results = await installRuntimes(fake, 'C:\\winget.exe', ids, () => {});
    expect(fake.commands.map((c) => c.slice(0, 5))).toEqual(ids.map((id) => ['C:\\winget.exe', 'install', '--id', id, '--exact']));
    expect(fake.commands[0]).toContain('--silent');
    expect(results.every((r) => r.ok && r.summary.includes('dry-run'))).toBe(true);
    expect(new Set(RUNTIMES.map((r) => r.id)).size).toBe(RUNTIMES.length);
  });

  it('reads winget result codes', () => {
    expect(summarizeWinget(0, '')).toEqual({ ok: true, summary: 'Installed.' });
    expect(summarizeWinget(-1978335189, '').ok).toBe(true);
    expect(summarizeWinget(-1978335212, 'No package found matching input criteria.\n')).toEqual({ ok: false, summary: 'Failed (code 0x8A150014): No package found matching input criteria.' });
  });
});

describe('network tests', () => {
  it('latency: min, average, jitter and loss from the samples', async () => {
    expect(summarizeLatency('h', 'H', [10, 14, null, 12])).toEqual({ host: 'h', name: 'H', min: 10, avg: 12, jitter: 3, loss: 25 });
    expect(summarizeLatency('h', 'H', [null, null])).toMatchObject({ min: null, avg: null, loss: 100 });
    const probe = async () => 20;
    expect((await latencyTest([{ host: 'x', name: 'X' }], probe, 3))[0]).toMatchObject({ avg: 20, jitter: 0, loss: 0 });
  });

  it('DNS benchmark: fastest first, failures rank last', async () => {
    const speed: Record<string, number | null> = { '1.1.1.1': 12, '8.8.8.8': 20, '9.9.9.9': 8 };
    const lookup = async (server: string, domain: string) => (server === '9.9.9.9' && domain === 'b' ? null : speed[server]);
    const r = await dnsBenchmark(
      [
        { id: 'cf', name: 'Cloudflare', ip: '1.1.1.1' },
        { id: 'g', name: 'Google', ip: '8.8.8.8' },
        { id: 'q', name: 'Quad9', ip: '9.9.9.9' },
      ],
      lookup,
      ['a', 'b'],
    );
    expect(r.map((x) => `${x.id}:${x.median}:${x.failed}`)).toEqual(['cf:12:0', 'g:20:0', 'q:8:1']);
  });

  it('accepts host names and IPv4 only', () => {
    expect(validHost('na.leagueoflegends.com')).toBe(true);
    expect(validHost('1.1.1.1')).toBe(true);
    expect(validHost('1.1.1.1; rm -rf')).toBe(false);
    expect(validHost('')).toBe(false);
  });
});
