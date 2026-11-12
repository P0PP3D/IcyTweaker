// All tests use memoryAdapter() as a fake system: nothing here can touch the real one.
// Temp files go to ./.test-tmp (inside the project) and are removed afterwards.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSystemAdapter, creatable, dword, isLiveEnv, memoryAdapter, refId, sz, type SettingRef, type Value } from './system/adapter';
import { createDebloater, parseApps, uninstallCommand } from './system/debloat';
import { createSafety } from './system/safety';
import { cpuPercent } from './system/stats';
import { createEngine, type Setting } from './tweaks/engine';
import { fixes } from './tweaks/fixes';
import { generalTweaks } from './tweaks/general';
import { serviceTweaks } from './services/catalog';
import { networkTweaks } from './network/network';
import { appTweaks } from './apps/apps';
import { advancedTweaks } from './advanced/advanced';

/** Every tweak on every page; the network tweaks built for one fake interface. */
const allTweaks = [...generalTweaks, ...serviceTweaks, ...networkTweaks(['{00000000-0000-0000-0000-000000000001}']), ...appTweaks({ discord: 'C:/fake/discord/settings.json', opera: 'C:/fake/opera/Local State', operaGx: 'C:/fake/gx/Local State', spotify: 'C:/fake/spotify/prefs', obs: 'C:/fake/obs/global.ini' }), ...advancedTweaks([{ name: 'GPU', pnp: 'PCI\\VEN_10DE&DEV_0000\\1' }]), ...featureTweaks];
import { presets } from './tweaks/presets';
import { featureTweaks } from './tweaks/features';

const TMP = path.join(process.cwd(), '.test-tmp', 'tweaks');
let dirCount = 0;
const newDir = () => path.join(TMP, String(dirCount++));
afterAll(() => rm(TMP, { recursive: true, force: true }));

async function setup(seed: Array<[SettingRef, Value]> = [], dir = newDir()) {
  const fake = memoryAdapter();
  for (const [ref, value] of seed) await fake.write(ref, value);
  return { fake, safety: await createSafety(fake, dir), dir };
}

/** Any value that differs from `v`. */
function other(v: Value): Value {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 7;
  if (typeof v === 'string') return v === 'disabled' ? 'enabled' : v === 'enabled' ? 'disabled' : `${v}-other`;
  return v.type === 'REG_DWORD' ? dword(v.data + 7) : sz(v.data + '7');
}

/** A value that is not "applied" and differs from the Windows default where possible. */
const notOn = (s: Setting): Value => (s.matches ? s.off! : other(s.on));

const readLog = async (dir: string) =>
  (await readFile(path.join(dir, 'actions.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const byId = (id: string) => generalTweaks.find((t) => t.id === id)!;
const opts = { tweaks: generalTweaks, presets, fixes, live: false, isAdmin: false, build: 26200 };

describe('tweak list', () => {
  it('has unique ids and every tweak has at least one setting', () => {
    expect(new Set(generalTweaks.map((t) => t.id)).size).toBe(generalTweaks.length);
    for (const t of generalTweaks) expect(t.settings.length).toBeGreaterThan(0);
  });
});

describe.each(allTweaks)('$name', (tweak) => {
  it('settings present before: apply, detect applied, revert, originals restored', async () => {
    // The Windows default where it differs from ours (some services are off by default), else any other value.
    const seed = tweak.settings.map((s): [SettingRef, Value] => [s.ref, s.off !== null && !s.matches?.(s.off) && JSON.stringify(s.off) !== JSON.stringify(s.on) ? s.off : notOn(s)]);
    const { fake, safety } = await setup(seed);

    expect(await tweak.readState(safety)).toBe('not_applied');
    await tweak.apply(safety);
    expect(await tweak.readState(safety)).toBe('applied');
    for (const s of tweak.settings) expect(await fake.read(s.ref)).toEqual(s.on);

    await tweak.revert(safety);
    expect(await tweak.readState(safety)).toBe('not_applied');
    for (const [ref, value] of seed) expect(await fake.read(ref)).toEqual(value);
    expect(safety.backupCount()).toBe(0);
  });

  it('settings absent before: apply, detect, revert, absent again', async () => {
    const { fake, safety } = await setup();
    const canCreate = tweak.settings.some((s) => creatable(s.ref));

    expect(await tweak.readState(safety)).toBe(canCreate ? 'not_applied' : 'unavailable');
    await tweak.apply(safety);
    expect(await tweak.readState(safety)).toBe(canCreate ? 'applied' : 'unavailable');
    for (const s of tweak.settings) expect(await fake.read(s.ref)).toEqual(creatable(s.ref) ? s.on : null);

    await tweak.revert(safety);
    for (const s of tweak.settings) expect(await fake.read(s.ref)).toBeNull();
    expect(safety.backupCount()).toBe(0);
  });

  it('revert after an app restart uses the backup on disk', async () => {
    const seed = tweak.settings.map((s): [SettingRef, Value] => [s.ref, notOn(s)]);
    const { fake, safety, dir } = await setup(seed);
    await tweak.apply(safety);

    const reloaded = await createSafety(fake, dir);
    await tweak.revert(reloaded);
    for (const [ref, value] of seed) expect(await fake.read(ref)).toEqual(value);
  });
});

describe('tweak kinds', () => {
  it('adjustable tweak: applies the chosen option, reports it, revert restores the original', async () => {
    const t = byId('win32-priority');
    const ref = t.settings[0].ref;
    const { fake, safety } = await setup([[ref, dword(2)]]);
    await t.apply(safety, 0x16);
    expect(await t.readState(safety)).toBe('applied');
    expect(await t.readOption!(safety)).toBe(0x16);
    await t.apply(safety, 0x28);
    expect(await t.readOption!(safety)).toBe(0x28);
    await t.revert(safety);
    expect(await fake.read(ref)).toEqual(dword(2));
  });

  it('StickyKeys Guard works on the hotkey bit only and keeps the user’s other flags', async () => {
    const t = byId('stickykeys-guard');
    const [sticky, toggle, filter] = t.settings.map((s) => s.ref);
    // Hotkeys already off with custom flags (seen on a real PC): counts as applied, nothing to write.
    const custom = await setup([[sticky, sz('386')], [toggle, sz('50')], [filter, sz('114')]]);
    expect(await t.readState(custom.safety)).toBe('applied');
    // StickyKeys permanently on (511): apply clears only the hotkey bit; revert restores 511.
    const { fake, safety } = await setup([[sticky, sz('511')], [toggle, sz('62')], [filter, sz('126')]]);
    await t.apply(safety);
    expect(await fake.read(sticky)).toEqual(sz('507'));
    expect(await fake.read(toggle)).toEqual(sz('58'));
    await t.revert(safety);
    expect(await fake.read(sticky)).toEqual(sz('511'));
  });

  it('dry-run safety starts with a fresh backup instead of resuming an old one', async () => {
    const { fake, safety, dir } = await setup();
    await byId('do-solo-mode').apply(safety);
    expect((await createSafety(fake, dir, { resume: false })).backupCount()).toBe(0);
    expect((await createSafety(fake, dir)).backupCount()).toBe(1);
  });

  it('a missing task is skipped, the rest of the tweak still applies', async () => {
    const t = byId('troubleshooter-scans-off');
    const [scheduled, , reg] = t.settings;
    const { fake, safety } = await setup([[scheduled.ref, 'enabled']]); // RecommendedTroubleshootingScanner missing
    await t.apply(safety);
    expect(await t.readState(safety)).toBe('applied');
    expect(await fake.read(scheduled.ref)).toBe('disabled');
    expect(await fake.read(reg.ref)).toEqual(dword(1));
  });

  it('Core Power Plan revert switches back to the previous plan before deleting its own', async () => {
    const t = byId('core-power-plan');
    const active = { kind: 'activeScheme' } as const;
    const { fake, safety } = await setup([[active, 'previous-guid']]);
    await t.apply(safety);
    expect(await fake.read(active)).toBe(t.settings.at(-1)!.on);
    const order: string[] = [];
    const write = fake.write;
    fake.write = async (ref, v) => (order.push(ref.kind), write(ref, v));
    await t.revert(safety);
    expect(order.indexOf('activeScheme')).toBeLessThan(order.indexOf('scheme'));
    expect(await fake.read(active)).toBe('previous-guid');
  });
});

describe('safety layer', () => {
  const doSolo = byId('do-solo-mode');
  const cloudSync = byId('cloud-sync-off');
  const silentInstalls = byId('silent-app-installs-off');

  it('backs up the original before the first write, only once', async () => {
    const { safety, dir } = await setup([[doSolo.settings[0].ref, dword(3)]]);
    await doSolo.apply(safety);
    await doSolo.apply(safety);
    const backup = JSON.parse(await readFile(path.join(dir, 'backup.json'), 'utf8'));
    expect(Object.values(backup)).toEqual([expect.objectContaining({ ref: doSolo.settings[0].ref, original: dword(3) })]);
  });

  it('partial state: only settings that change are backed up', async () => {
    const [a, b, c] = silentInstalls.settings;
    const { fake, safety } = await setup([[a.ref, dword(0)], [b.ref, dword(1)], [c.ref, dword(1)]]);
    expect(await silentInstalls.readState(safety)).toBe('partial');
    await silentInstalls.apply(safety);
    expect(safety.backupCount()).toBe(2);
    await silentInstalls.revert(safety);
    // a already held our value before the app touched it; revert falls back to the Windows default.
    expect(await fake.read(a.ref)).toEqual(dword(1));
    expect(await fake.read(b.ref)).toEqual(dword(1));
  });

  it('revert with no backup only resets settings that hold our value', async () => {
    const [disable, override] = cloudSync.settings;
    const { fake, safety } = await setup([[disable.ref, dword(2)], [override.ref, dword(0)]]);
    await cloudSync.revert(safety);
    expect(await fake.read(disable.ref)).toBeNull();
    expect(await fake.read(override.ref)).toEqual(dword(0));
  });

  it('Undo All restores every setting the app changed, including absent ones', async () => {
    const seedRef = silentInstalls.settings[0].ref;
    const { fake, safety } = await setup([[seedRef, dword(1)]]);
    for (const t of generalTweaks) await t.apply(safety);
    expect(safety.backupCount()).toBeGreaterThan(20);

    expect(await safety.undoAll()).toEqual([]);
    expect(safety.backupCount()).toBe(0);
    expect(await fake.read(seedRef)).toEqual(dword(1));
    for (const [id, v] of fake.values) if (id !== refId(seedRef)) expect(v).toBeNull();
  });

  it('reads Phase 1 backup files (flat registry entries)', async () => {
    const dir = newDir();
    await mkdir(dir, { recursive: true });
    const r = doSolo.settings[0].ref as { hive: 'HKLM'; key: string; name: string };
    await writeFile(path.join(dir, 'backup.json'), JSON.stringify({ x: { hive: r.hive, key: r.key, name: r.name, original: dword(3), savedAt: 'then' } }));
    const fake = memoryAdapter();
    const safety = await createSafety(fake, dir);
    expect(await safety.undoAll()).toEqual([]);
    expect(await fake.read(doSolo.settings[0].ref)).toEqual(dword(3));
  });

  it('refuses to start on a corrupt backup file instead of losing originals', async () => {
    const dir = newDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'backup.json'), '{ not json');
    await expect(createSafety(memoryAdapter(), dir)).rejects.toThrow(/Backup file unreadable/);
  });

  it('restore points: one per window (Windows skips the rest anyway), kept across restarts; manual ones always run', async () => {
    const dir = newDir();
    const fake = memoryAdapter();
    const count = () => fake.commands.filter((c) => c.join(' ').includes('Checkpoint-Computer')).length;
    const safety = await createSafety(fake, dir, { restorePointWindowMs: 60_000 });
    await safety.restorePoint('a');
    await safety.restorePoint('b'); // covered by "a"
    expect(count()).toBe(1);
    const again = await createSafety(fake, dir, { restorePointWindowMs: 60_000 }); // app restarted
    await again.restorePoint('c');
    expect(count()).toBe(1);
    await again.restorePoint('manual', true);
    expect(count()).toBe(2);
    const log = await readLog(dir);
    expect(log.some((e) => e.action === 'restore-point' && /covered by/.test(e.message ?? ''))).toBe(true);
  });
});

describe('engine', () => {
  it('a single restart-required tweak applies without a restore point (Restart now offers one)', async () => {
    const { fake, safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    const t = generalTweaks.find((x) => x.requiresReboot && x.risk !== 'risky')!;
    expect((await engine.setTweak(t.id, true)).ok).toBe(true);
    expect(fake.commands.some((c) => c.join(' ').includes('Checkpoint-Computer'))).toBe(false);
  });

  it('Apply All: restore point first, applies every non-Risky tweak, logs each one', async () => {
    const { fake, safety, dir } = await setup();
    const engine = createEngine({ ...opts, safety });
    expect((await engine.applyAll()).ok).toBe(true);
    expect(fake.commands[0].join(' ')).toContain('Checkpoint-Computer');

    const log = await readLog(dir);
    expect(log[0]).toMatchObject({ action: 'restore-point', ok: true, mode: 'dry-run' });
    const state = await engine.getState();
    const general = state.tweaks.filter((t) => (t.page ?? 'general') === 'general'); // Apply All belongs to the General page
    for (const t of general) {
      if (t.risk === 'risky') expect(t.status).toBe('not_applied');
      else expect(['applied', 'unavailable']).toContain(t.status);
    }
    for (const t of state.tweaks.filter((x) => x.page === 'devices')) expect(t.status, t.id).toBe('not_applied');
    expect(log.filter((l) => l.action === 'apply').length).toBe(general.filter((t) => t.risk !== 'risky' && t.status === 'applied').length);
  });

  it('Apply All for one category only touches that category', async () => {
    const { safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    await engine.applyAll('performance');
    for (const t of (await engine.getState()).tweaks) {
      if (t.category !== 'performance') expect(['not_applied', 'unavailable']).toContain(t.status);
    }
  });

  it('a failed restore point aborts the bulk action with nothing changed', async () => {
    const { fake, safety, dir } = await setup();
    fake.exec = async () => {
      throw new Error('System Protection is off');
    };
    const engine = createEngine({ ...opts, safety });
    expect((await engine.applyAll()).ok).toBe(false);
    expect(fake.values.size).toBe(0);
    expect((await readLog(dir))[0]).toMatchObject({ action: 'restore-point', ok: false });
  });

  it('Risky tweaks need confirmation', async () => {
    const { fake, safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    expect((await engine.setTweak('security-quiet', true)).ok).toBe(false);
    expect(fake.values.size).toBe(0);
    expect((await engine.setTweak('security-quiet', true, { confirmed: true })).ok).toBe(true);
  });

  it('adjustable tweaks reject values that are not one of their options', async () => {
    const { safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    expect((await engine.setTweak('win32-priority', true, { option: 999 })).ok).toBe(false);
    expect((await engine.setTweak('win32-priority', true, { option: 0x28 })).ok).toBe(true);
    expect((await engine.getState()).tweaks.find((t) => t.id === 'win32-priority')?.currentOption).toBe(0x28);
  });

  it('Revert All and Undo All return everything to the original state', async () => {
    const { fake, safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    await engine.applyAll();
    expect((await engine.revertAll()).ok).toBe(true);
    for (const t of (await engine.getState()).tweaks) expect(['not_applied', 'unavailable']).toContain(t.status);

    await engine.applyAll();
    expect((await engine.undoAll()).ok).toBe(true);
    expect([...fake.values.values()].every((v) => v === null)).toBe(true);
  });

  it('live mode refuses admin tweaks when not elevated, and logs the error', async () => {
    const { fake, safety, dir } = await setup();
    const engine = createEngine({ ...opts, live: true, safety });
    expect((await engine.setTweak('do-solo-mode', true)).ok).toBe(false);
    expect(fake.values.size).toBe(0);
    expect((await readLog(dir))[0]).toMatchObject({ action: 'apply', target: 'do-solo-mode', ok: false });
  });

  it('rejects unknown ids and unsupported builds', async () => {
    const { safety } = await setup();
    expect((await createEngine({ ...opts, safety }).setTweak('nope', true)).ok).toBe(false);
    expect((await createEngine({ ...opts, build: 10240, safety }).setTweak('do-solo-mode', true)).message).toMatch(/Not supported/);
  });
});

describe('presets', () => {
  const ids = generalTweaks.map((t) => t.id);

  it('only reference tweaks that exist; Restore Defaults covers every tweak ("*")', () => {
    for (const p of presets) for (const id of p.tweakIds) if (id !== '*') expect(ids).toContain(id);
    expect(presets.find((p) => p.id === 'restore-defaults')!.tweakIds).toEqual(['*']); // every tweak on every page
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
  });

  it('a preset creates a restore point, then applies only its tweaks', async () => {
    const { fake, safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    expect((await engine.applyPreset('debloat-only')).ok).toBe(true);
    expect(fake.commands[0].join(' ')).toContain('Checkpoint-Computer');
    const st = Object.fromEntries((await engine.getState()).tweaks.map((t) => [t.id, t.status]));
    expect(st).toMatchObject({ 'silent-app-installs-off': 'applied', 'search-box-local': 'applied', 'do-solo-mode': 'not_applied' });
  });

  it('Restore Defaults reverts everything to the original values', async () => {
    const seed = generalTweaks.flatMap((t) => t.settings.map((s): [SettingRef, Value] => [s.ref, notOn(s)]));
    const { fake, safety } = await setup(seed);
    const engine = createEngine({ ...opts, safety });
    await engine.applyPreset('safe-optimize');
    expect((await engine.applyPreset('restore-defaults')).ok).toBe(true);
    for (const [ref, value] of seed) expect(await fake.read(ref)).toEqual(value);
  });

  it('a preset reports its progress: checking, each tweak, then finished', async () => {
    const { safety } = await setup();
    const seen: Array<[number, number, string]> = [];
    const engine = createEngine({ ...opts, safety, onProgress: (label, done, total, current) => (expect(label).toBe('Debloat Only'), seen.push([done, total, current])) });
    expect((await engine.applyPreset('debloat-only')).ok).toBe(true);
    expect(seen[0]).toEqual([0, 0, 'Checking your current settings…']);
    expect(seen.at(-1)).toEqual([0, 0, '']);
    const steps = seen.filter(([, total]) => total > 0);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map(([d]) => d)).toEqual(steps.map((_, i) => i));
  });

  it('a Windows Features change marks a restart without the slow DISM before/after read', async () => {
    const { safety } = await setup();
    const engine = createEngine({ ...opts, tweaks: featureTweaks, safety, isAdmin: true });
    const t = featureTweaks[0];
    expect((await engine.setTweak(t.id, true)).ok).toBe(true);
    expect((await engine.getState()).rebootPending).toContain(t.name);
  });

  it('says so when Windows skips a manual restore point (one per 24 h)', async () => {
    const { fake, safety } = await setup();
    fake.exec = async () => ({ stdout: 'WARNING: A new system restore point cannot be created because one has already been created within the past 1440 minutes.', stderr: '', code: 0 });
    const r = await createEngine({ ...opts, safety }).createRestorePoint('x');
    expect(r.message).toMatch(/already made a restore point/);
  });

  it('rejects unknown preset ids', async () => {
    const { safety } = await setup();
    expect((await createEngine({ ...opts, safety }).applyPreset('nope')).ok).toBe(false);
  });
});

describe('fixes', () => {
  it('have unique ids; non-permanent fixes only use backed-up changes', () => {
    expect(new Set(fixes.map((f) => f.id)).size).toBe(fixes.length);
    // The NVIDIA fix's script only launches an app, so it changes nothing.
    for (const f of fixes) if (!f.permanent && f.id !== 'nvidia-control-panel') expect(f.script).toBeUndefined();
  });

  it.each(fixes.filter((f) => f.changes))('$name: restore point, changes backed up, Undo All reverses them', async (f) => {
    const seed = f.changes!.map(([ref]): [SettingRef, Value] => [ref, ref.kind === 'service' ? 'disabled' : dword(1)]);
    const { fake, safety } = await setup(seed);
    const engine = createEngine({ ...opts, safety });
    expect((await engine.runFix(f.id, true)).ok).toBe(true);
    expect(fake.commands[0].join(' ')).toContain('Checkpoint-Computer');
    for (const [ref, value] of f.changes!) expect(await fake.read(ref)).toEqual(value);

    expect((await engine.undoAll()).ok).toBe(true);
    for (const [ref, value] of seed) expect(await fake.read(ref)).toEqual(value);
  });

  it('scripts go through the adapter (dry-run records them, runs nothing)', async () => {
    const { fake, safety } = await setup();
    await createEngine({ ...opts, safety }).runFix('print-spooler');
    expect(fake.commands.some((c) => c.join(' ').includes('Spooler'))).toBe(true);
  });

  it('Risky fixes need confirmation', async () => {
    const { fake, safety } = await setup();
    expect((await createEngine({ ...opts, safety }).runFix('network-reset')).ok).toBe(false);
    expect(fake.commands).toHaveLength(0);
  });

  it("Re-Enable Defender reverts the app's Defender tweaks", async () => {
    const { safety } = await setup();
    const engine = createEngine({ ...opts, safety });
    await engine.setTweak('rt-scan-trim', true, { confirmed: true });
    await engine.setTweak('security-quiet', true, { confirmed: true });
    await engine.runFix('re-enable-defender');
    const st = (await engine.getState()).tweaks;
    expect(st.find((t) => t.id === 'rt-scan-trim')?.status).toBe('not_applied');
    expect(st.find((t) => t.id === 'security-quiet')?.status).toBe('not_applied');
  });
});

describe('debloater', () => {
  const json = JSON.stringify({
    desktop: [
      { key: 'HKLM\\U\\a', DisplayName: 'Some Game', DisplayVersion: '1.0', Publisher: 'X', EstimatedSize: 2, InstallDate: '20260101', UninstallString: 'MsiExec.exe /I{12345678-1234-1234-1234-123456789ABC}' },
      { key: 'HKLM\\WOW\\a', DisplayName: 'Some Game', DisplayVersion: '1.0', UninstallString: 'x' },
      { key: 'HKLM\\U\\b', DisplayName: 'Microsoft Visual C++ 2022 X64 Minimum Runtime', UninstallString: 'y' },
      { key: 'HKLM\\U\\c', DisplayName: 'Armoury Crate', UninstallString: '"C:\\Program Files\\AC\\uninst.exe" /x' },
    ],
    store: [
      { Name: 'Microsoft.BingNews', PackageFullName: 'Microsoft.BingNews_1_x64__8wekyb3d8bbwe', Version: '1', Publisher: 'CN=Microsoft Corporation, O=x', IsFramework: false, NonRemovable: false, SignatureKind: 'Store' },
      { Name: 'Microsoft.WindowsStore', PackageFullName: 'Microsoft.WindowsStore_1', Version: '1', Publisher: 'CN=M', IsFramework: false, NonRemovable: false, SignatureKind: 'Store' },
      { Name: 'Microsoft.VCLibs.140.00', PackageFullName: 'v', Version: '1', Publisher: 'CN=M', IsFramework: true, NonRemovable: false, SignatureKind: 'Store' },
    ],
  });

  it('flags protected, vendor and suggested apps, skips frameworks and duplicates', () => {
    const items = Object.fromEntries(parseApps(json).map((e) => [e.item.name, e.item]));
    expect(Object.keys(items).sort()).toEqual(['Armoury Crate', 'Microsoft Visual C++ 2022 X64 Minimum Runtime', 'Microsoft.BingNews', 'Microsoft.WindowsStore', 'Some Game']);
    expect(items['Microsoft Visual C++ 2022 X64 Minimum Runtime'].protected).toBeTruthy();
    expect(items['Microsoft.WindowsStore'].protected).toBeTruthy();
    expect(items['Microsoft.BingNews']).toMatchObject({ suggested: true, protected: null, publisher: 'Microsoft Corporation' });
    expect(items['Armoury Crate'].vendorNote).toMatch(/fans|RGB/);
    expect(items['Some Game']).toMatchObject({ sizeBytes: 2048, installDate: '2026-01-01', interactive: false });
  });

  it('MSI uninstalls run silently; others use the vendor uninstaller', () => {
    expect(uninstallCommand({ UninstallString: 'MsiExec.exe /I{12345678-1234-1234-1234-123456789ABC}' })).toEqual({
      command: 'MsiExec.exe /X{12345678-1234-1234-1234-123456789ABC} /qn /norestart',
      interactive: false,
    });
    expect(uninstallCommand({ UninstallString: 'u.exe', QuietUninstallString: 'u.exe /S' })).toEqual({ command: 'u.exe /S', interactive: false });
    expect(uninstallCommand({ UninstallString: 'u.exe' }).interactive).toBe(true);
  });

  it('only uninstalls listed, unprotected apps, through the adapter', async () => {
    const fake = memoryAdapter(undefined, async () => json);
    const d = createDebloater(fake);
    const apps = await d.list();
    const store = apps.find((a) => a.kind === 'store' && a.name === 'Microsoft.WindowsStore')!;
    expect(d.lookup(store.key)).toBeUndefined();
    expect(d.lookup('desktop:made-up')).toBeUndefined();
    await d.uninstall(d.lookup(apps.find((a) => a.name === 'Microsoft.BingNews')!.key)!);
    await d.uninstall(d.lookup(apps.find((a) => a.name === 'Armoury Crate')!.key)!);
    expect(fake.commands[0].join(' ')).toContain("Remove-AppxPackage -Package 'Microsoft.BingNews_1_x64__8wekyb3d8bbwe'");
    expect(fake.commands[1]).toEqual([expect.stringMatching(/cmd\.exe$/i), '/d', '/s', '/c', '""C:\\Program Files\\AC\\uninst.exe" /x"']);
  });
});

describe('adapter, restart and stats', () => {
  it('live only when OPTIMIZER_LIVE is exactly "1"', () => {
    expect(isLiveEnv({})).toBe(false);
    expect(isLiveEnv({ OPTIMIZER_LIVE: 'true' })).toBe(false);
    expect(isLiveEnv({ OPTIMIZER_LIVE: '1' })).toBe(true);
    // Installed builds: live by default, OPTIMIZER_LIVE=0 forces dry-run.
    expect(isLiveEnv({}, true)).toBe(true);
    expect(isLiveEnv({ OPTIMIZER_LIVE: '0' }, true)).toBe(false);
    expect(createSystemAdapter({ OPTIMIZER_LIVE: '0' }, true).live).toBe(false);
    expect(createSystemAdapter({}).live).toBe(false);
  });

  it('dry-run writes stay in memory', async () => {
    const dry = createSystemAdapter({});
    const ref: SettingRef = { kind: 'reg', hive: 'HKCU', key: 'Software\\IcyTweakerTest', name: 'X' };
    await dry.write(ref, dword(1));
    expect(await dry.read(ref)).toEqual(dword(1));
    await dry.write(ref, null);
    expect(await dry.read(ref)).toBeNull();
    const task: SettingRef = { kind: 'task', path: '\\IcyTweakerTest' };
    await dry.write(task, 'disabled');
    expect(await dry.read(task)).toBe('disabled');
  });

  it('restart goes through the adapter: dry-run records it and runs nothing', async () => {
    const { fake, safety, dir } = await setup();
    await safety.restart();
    expect(fake.commands[0][0]).toMatch(/shutdown\.exe$/i);
    expect((await readLog(dir))[0]).toMatchObject({ action: 'restart', ok: true, message: 'dry-run: not restarted' });
  });

  it('cpuPercent is busy time over total time', () => {
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 25, total: 100 })).toBe(75);
    expect(cpuPercent({ idle: 10, total: 10 }, { idle: 10, total: 10 })).toBe(0);
  });
});
