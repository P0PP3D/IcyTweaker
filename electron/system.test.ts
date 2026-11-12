// Phase 5: services levels and manager, networking, resources. Fake system only (memoryAdapter);
// temp files in ./.test-tmp/system.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { activeInterfaces, networkTweaks, validateHosts } from './network/network';
import { CHECK_STEPS, runSystemCheck, summarize } from './resources/resources';
import { catalogServices, serviceTweaks } from './services/catalog';
import { createServices, parseServices } from './services/services';
import { memoryAdapter, parseRegBatch, parseRegKey, parseTaskList, parseTcpGlobal, regBatchScript, type SettingRef } from './system/adapter';
import { createSafety } from './system/safety';
import { createEngine } from './tweaks/engine';
import { generalTweaks } from './tweaks/general';
import { presets } from './tweaks/presets';

const TMP = path.join(process.cwd(), '.test-tmp', 'system');
afterAll(() => rm(TMP, { recursive: true, force: true }));
let n = 0;

/** Fake PC where every catalog service exists with its Windows default. `query` answers the Xbox check and service list. */
async function setup({ xbox = false, rawServices = [] as unknown[] } = {}) {
  const fake = memoryAdapter(undefined, async (_file, args) => (args.join(' ').includes('GamingApp') ? (xbox ? '1' : '0') : JSON.stringify(rawServices)));
  for (const s of catalogServices) await fake.write({ kind: 'service', name: s.name }, s.def === 'disabled' ? 'demand' : s.def);
  const safety = await createSafety(fake, path.join(TMP, String(n++)));
  return { fake, safety, services: createServices(fake, safety) };
}
const start = (fake: ReturnType<typeof memoryAdapter>, name: string) => fake.read({ kind: 'service', name });

describe('services levels', () => {
  it('catalog names are unique', () => {
    const names = catalogServices.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('Minimum disables only Minimum services; Medium adds more; Off puts every original back', async () => {
    const { fake, safety, services } = await setup();
    expect((await services.currentLevel()).level).toBe('off');

    await services.apply('minimum');
    expect(await start(fake, 'DiagTrack')).toBe('disabled');
    expect(await start(fake, 'XblAuthManager')).toBe('disabled'); // no Xbox app
    expect(await start(fake, 'Spooler')).toBe('auto');
    expect(await services.currentLevel()).toEqual({ level: 'minimum', custom: false });

    await services.apply('medium');
    expect(await start(fake, 'Spooler')).toBe('disabled');
    expect(await start(fake, 'wuauserv')).toBe('demand'); // Extreme only
    expect((await services.currentLevel()).level).toBe('medium');

    await services.apply('off');
    for (const s of catalogServices) expect(await start(fake, s.name)).toBe(s.def === 'disabled' ? 'demand' : s.def);
    expect(safety.backupCount()).toBe(0);
  });

  it('going down a level puts back what the higher level turned off', async () => {
    const { fake, services } = await setup();
    await services.apply('extreme');
    expect(await start(fake, 'WSearch')).toBe('disabled');
    await services.apply('minimum');
    expect(await start(fake, 'WSearch')).toBe('delayed-auto');
    expect(await start(fake, 'Spooler')).toBe('auto');
    expect(await start(fake, 'DiagTrack')).toBe('disabled');
  });

  it('services without a level (notifications, AMD) are never touched by levels', async () => {
    const { fake, services } = await setup();
    await services.apply('extreme');
    expect(await start(fake, 'WpnService')).toBe('auto');
  });

  it('with the Xbox app installed, Xbox services move from Minimum to Medium', async () => {
    const { fake, services } = await setup({ xbox: true });
    await services.apply('minimum');
    expect(await start(fake, 'XblAuthManager')).toBe('demand');
    expect((await services.preview('minimum')).xboxInUse).toBe(true);
  });

  it('preview lists what breaks and services that depend on one being turned off', async () => {
    const rawServices = [
      { n: 'Spooler', d: 'Print Spooler', s: '', st: 'Running', m: 'Auto', dl: false, dep: ['PrinterVendorSvc'] },
      { n: 'PrinterVendorSvc', d: 'Vendor printer helper', s: '', st: 'Running', m: 'Auto', dl: false, dep: [] },
    ];
    const { services } = await setup({ rawServices });
    const p = await services.preview('medium');
    expect(p.disable.find((d) => d.name === 'Spooler')).toMatchObject({ displayName: 'Print Spooler', running: true });
    expect(p.dependents).toEqual([{ service: 'Spooler', dependent: 'Vendor printer helper' }]);
    expect((await services.preview('minimum')).disable.some((d) => d.name === 'Spooler')).toBe(false);
  });

  it('sub-group switches are tweaks: N/A when none of their services exist', async () => {
    const fake = memoryAdapter();
    const safety = await createSafety(fake, path.join(TMP, String(n++)));
    const amd = serviceTweaks.find((t) => t.id === 'services-amd-radeon')!;
    expect(await amd.readState(safety)).toBe('unavailable');
  });
});

describe('service manager', () => {
  it('parses services: delayed start, dependents, protected and per-user', () => {
    const list = parseServices(
      JSON.stringify([
        { n: 'WSearch', d: 'Windows Search', s: 'Indexing', st: 'Running', m: 'Auto', dl: true, dep: 'WMPNetworkSvc' },
        { n: 'RpcSs', d: 'RPC', s: null, st: 'Running', m: 'Auto', dl: false, dep: [null, 'DcomLaunch'] }, // Windows lists some dependents as null
        { n: 'CDPUserSvc_c6635', d: 'Connected Devices User', s: '', st: 'Running', m: 'Auto', dl: false, dep: [] },
        { n: 'Fax', d: 'Fax', s: '', st: 'Stopped', m: 'Manual', dl: false, dep: [] },
      ]),
    );
    expect(list[0]).toMatchObject({ startType: 'delayed-auto', dependents: ['WMPNetworkSvc'], protected: null, perUser: false });
    expect(list[1]).toMatchObject({ dependents: ['DcomLaunch'] });
    expect(list[1].protected).toBeTruthy();
    expect(list[2].perUser).toBe(true);
    expect(list[3].startType).toBe('demand');
  });

  it('start type changes are backed up; start/stop goes through the adapter', async () => {
    const { fake, safety, services } = await setup();
    await services.setStartType('Fax', 'disabled');
    expect(safety.changedRefs()).toContainEqual({ kind: 'service', name: 'Fax' });
    await safety.undoAll();
    expect(await start(fake, 'Fax')).toBe('demand');
    await services.control('Fax', 'start');
    expect(fake.commands[0].slice(-2)).toEqual(['start', 'Fax']);
  });
});

describe('networking', () => {
  it('DNS change is backed up and Undo All restores automatic DNS', async () => {
    const fake = memoryAdapter();
    const ref: SettingRef = { kind: 'dns', guid: '{A}' };
    await fake.write(ref, 'dhcp');
    const safety = await createSafety(fake, path.join(TMP, String(n++)));
    await safety.set(ref, '1.1.1.1,1.0.0.1');
    expect(await fake.read(ref)).toBe('1.1.1.1,1.0.0.1');
    await safety.undoAll();
    expect(await fake.read(ref)).toBe('dhcp');
  });

  it('hosts file check catches bad lines and accepts comments, IPv6 and blank lines', () => {
    const ok = '# comment\n127.0.0.1 localhost\n::1 localhost ip6-localhost\n\n0.0.0.0 ads.example.com # blocked\n';
    expect(validateHosts(ok)).toEqual([]);
    expect(validateHosts('127.0.0.1\n999.1.1.1 a.com\n1.2.3.4 bad_host!.com\nlocalhost 127.0.0.1')).toEqual([
      { line: 1, message: 'A host name is missing after the IP address.' },
      { line: 2, message: '"999.1.1.1" is not an IP address.' },
      { line: 3, message: '"bad_host!.com" is not a valid host name.' },
      { line: 4, message: '"localhost" is not an IP address.' },
    ]);
  });

  it('parses netsh TCP global output; another language reads as unavailable', () => {
    const text = 'Querying active state...\n\nTCP Global Parameters\n----\nReceive-Side Scaling State          : enabled \nReceive Window Auto-Tuning Level    : normal \nECN Capability                      : disabled \n';
    expect(parseTcpGlobal(text)).toEqual({ rss: 'enabled', autotuninglevel: 'normal', ecncapability: 'disabled' });
    expect(parseTcpGlobal('Paramètres globaux TCP\nÉtat de mise à l’échelle côté réception : enabled')).toEqual({});
  });

  it('finds interfaces with an IPv4 address; no interfaces means no Nagle tweak', async () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{11111111-1111-1111-1111-111111111111}',
      '    DhcpIPAddress    REG_SZ    192.168.1.20',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{22222222-2222-2222-2222-222222222222}',
      '    DhcpIPAddress    REG_SZ    0.0.0.0',
    ].join('\r\n');
    expect(await activeInterfaces(memoryAdapter(undefined, async () => out))).toEqual(['{11111111-1111-1111-1111-111111111111}']);
    expect(networkTweaks([]).some((t) => t.id === 'nagle-off')).toBe(false);
  });
});

describe('resources', () => {
  it('system check runs chkdsk, sfc, dism in order through the adapter; dry-run runs nothing', async () => {
    const fake = memoryAdapter();
    const steps = await runSystemCheck(fake, () => {});
    expect(fake.commands.map((c) => path.basename(c[0]).toLowerCase())).toEqual(['chkdsk.exe', 'sfc.exe', 'dism.exe']);
    expect(steps.map((s) => s.summary)).toEqual(['Not run (dry-run).', 'Not run (dry-run).', 'Not run (dry-run).']);
    expect(CHECK_STEPS.map((s) => s.id)).toEqual(['chkdsk', 'sfc', 'dism']);
  });

  it('summaries read the exit code (and sfc text)', () => {
    expect(summarize('chkdsk', 0, '').ok).toBe(true);
    expect(summarize('chkdsk', 3, '')).toMatchObject({ ok: false, summary: expect.stringMatching(/restart/) });
    expect(summarize('sfc', 0, 'Windows Resource Protection did not find any integrity violations.').summary).toBe('No damaged system files.');
    expect(summarize('sfc', 0, 'found corrupt files but was unable to fix some of them').ok).toBe(false);
    expect(summarize('dism', -2146498529, '').ok).toBe(false);
  });
});

describe('engine across pages', () => {
  it('General Apply All never touches services or network tweaks; Restore Defaults reverts every page', async () => {
    const { fake, safety } = await setup();
    const tweaks = [...generalTweaks, ...serviceTweaks, ...networkTweaks(['{X}'])];
    const engine = createEngine({ tweaks, presets, safety, live: false, isAdmin: false, build: 26200 });
    await engine.applyAll();
    expect(await start(fake, 'Spooler')).toBe('auto');

    await engine.setTweak('services-print-misc', true);
    expect(await start(fake, 'Spooler')).toBe('disabled');
    await engine.applyPreset('restore-defaults');
    expect(await start(fake, 'Spooler')).toBe('auto');
  });
});

describe('batched live reads: parsers', () => {
  it('parses the registry batch output; a missing key has no values', () => {
    const out = ['#KEY HKCU\\Control Panel\\Mouse', '#V\tMouseSpeed\tREG_SZ\t0', '#V\tFlags\tREG_DWORD\t0xffffffff', '#V\tBlob\tREG_BINARY\t9E1E07', '#KEY HKLM\\Nope'].join('\r\n');
    const keys = parseRegBatch(out);
    expect(keys.get('hkcu\\control panel\\mouse')?.get('mousespeed')).toEqual({ type: 'REG_SZ', raw: '0' });
    expect(keys.get('hkcu\\control panel\\mouse')?.get('flags')).toEqual({ type: 'REG_DWORD', raw: '0xffffffff' });
    expect(keys.get('hklm\\nope')?.size).toBe(0);
    expect(regBatchScript(["HKCU\\It's"])).toContain("'HKCU\\It''s'"); // quotes escaped
  });

  it('parses reg.exe key output, including empty strings', () => {
    const v = parseRegKey('\r\nHKEY_CURRENT_USER\\X\r\n    A    REG_DWORD    0x1\r\n    B    REG_SZ    \r\n    C    REG_SZ\r\n');
    expect(v.get('a')).toEqual({ type: 'REG_DWORD', raw: '0x1' });
    expect(v.get('b')?.raw).toBe('');
    expect(v.get('c')?.raw).toBe('');
  });

  it('splits the bulk task list by path', () => {
    const tasks = parseTaskList('<!-- \\A -->\r\n<Task><Settings><Enabled>false</Enabled></Settings></Task>\r\n<!-- \\Microsoft\\Windows\\B -->\r\n<Task/>');
    expect(tasks.get('\\a')).toContain('<Enabled>false');
    expect(tasks.has('\\microsoft\\windows\\b')).toBe(true);
  });
});
