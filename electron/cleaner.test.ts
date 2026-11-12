// Cleaner tests. Real files, but only inside ./.test-tmp/cleaner (removed afterwards). File deletion is
// tested both through the dry-run fake (nothing deleted) and through the live adapter's file operations.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAnalyzer } from './cleaner/analyzer';
import { buildTargets, createCleaner, unsafeRoot, type CleanTarget, type Env } from './cleaner/cleaner';
import { walk } from './cleaner/walk';
import { liveAdapter, memoryAdapter } from './system/adapter';

const TMP = path.join(process.cwd(), '.test-tmp', 'cleaner');
afterAll(() => rm(TMP, { recursive: true, force: true }));

let n = 0;
let base = '';
let env: Env;
const old = new Date(Date.now() - 3 * 24 * 3_600_000);

async function file(p: string, bytes: number, age = old) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, Buffer.alloc(bytes));
  await utimes(p, age, age);
}

beforeEach(async () => {
  base = path.join(TMP, String(n++));
  const d = (s: string) => path.join(base, s);
  env = {
    LOCALAPPDATA: d('Local'),
    APPDATA: d('Roaming'),
    TEMP: d('Local\\Temp'),
    SystemRoot: d('Windows'),
    ProgramData: d('ProgramData'),
    ProgramFilesX86: d('PFx86'),
    USERPROFILE: base,
    recycleBins: [],
    steamPath: d('PFx86\\Steam'),
  };
  await mkdir(base, { recursive: true });
});

const target = (env: Env, id: string) => buildTargets(env).find((t) => t.id === id)!;

describe('walk', () => {
  it('never follows or yields a junction, skips what it is told to', async () => {
    await file(path.join(base, 'root', 'a.bin'), 100);
    await file(path.join(base, 'root', 'sub', 'b.bin'), 50);
    await file(path.join(base, 'precious', 'keep.bin'), 999);
    await symlink(path.join(base, 'precious'), path.join(base, 'root', 'link'), 'junction');
    const r = await walk(path.join(base, 'root'));
    expect(r.bytes).toBe(150);
    expect(r.files.map((f) => path.basename(f.path)).sort()).toEqual(['a.bin', 'b.bin']);
    expect(r.dirs).toEqual([path.join(base, 'root', 'sub')]);
  });
});

describe('clean', () => {
  it('live file ops: deletes only files under the root, keeps the root, never touches a junction target', async () => {
    const root = env.TEMP;
    await file(path.join(root, 'old.tmp'), 100);
    await file(path.join(root, 'nested', 'old2.tmp'), 30);
    await file(path.join(root, 'fresh.tmp'), 10, new Date()); // changed recently: kept
    await file(path.join(base, 'precious', 'keep.bin'), 999);
    await symlink(path.join(base, 'precious'), path.join(root, 'link'), 'junction');

    const r = await createCleaner(liveAdapter(), env).clean(target(env, 'user-temp'), new Set());
    expect(r).toMatchObject({ freed: 130, files: 2, locked: 0 });
    expect(existsSync(path.join(root, 'old.tmp'))).toBe(false);
    expect(existsSync(path.join(root, 'nested'))).toBe(false); // emptied folder removed
    expect(existsSync(path.join(root, 'fresh.tmp'))).toBe(true);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(path.join(root, 'link'))).toBe(true); // the junction itself is left alone
    expect(await readFile(path.join(base, 'precious', 'keep.bin'))).toHaveLength(999);
  });

  it('dry-run deletes nothing, and a rescan stops counting what it pretended to delete', async () => {
    await file(path.join(env.TEMP, 'old.tmp'), 100);
    const fake = memoryAdapter();
    const cleaner = createCleaner(fake, env);
    const t = target(env, 'user-temp');
    expect((await cleaner.scan(t)).bytes).toBe(100);
    expect((await cleaner.clean(t, new Set())).freed).toBe(100);
    expect(existsSync(path.join(env.TEMP, 'old.tmp'))).toBe(true);
    expect((await cleaner.scan(t)).bytes).toBe(0);
  });

  it('single-file targets only touch matching files directly in the folder', async () => {
    const explorer = path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Explorer');
    await file(path.join(explorer, 'thumbcache_256.db'), 40);
    await file(path.join(explorer, 'iconcache_32.db'), 20);
    await file(path.join(explorer, 'other.db'), 5);
    await file(path.join(explorer, 'sub', 'thumbcache_1.db'), 7);
    const fake = memoryAdapter();
    expect((await createCleaner(fake, env).clean(target(env, 'thumbnail-cache'), new Set())).freed).toBe(40);
    expect([...fake.removed]).toEqual([path.join(explorer, 'thumbcache_256.db').toLowerCase()]);
  });

  it('script targets run their script through the adapter instead of deleting files', async () => {
    const t: CleanTarget = { ...target(env, 'user-temp'), id: 'x', script: 'Clear-RecycleBin -Force' };
    await file(path.join(env.TEMP, 'a.tmp'), 10);
    const fake = memoryAdapter();
    await createCleaner(fake, env).clean(t, new Set());
    expect(fake.commands[0].join(' ')).toContain('Clear-RecycleBin');
    expect(fake.removed.size).toBe(0);
  });

  it('cookies, history and passwords are skipped while the browser runs; cache is not', async () => {
    const profile = path.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default');
    await file(path.join(profile, 'Network', 'Cookies'), 10);
    await file(path.join(profile, 'Cache', 'Cache_Data', 'f_0001'), 20);
    const fake = memoryAdapter();
    const cleaner = createCleaner(fake, env);
    const running = new Set(['brave.exe']);
    expect((await cleaner.clean(target(env, 'brave:0:cookies'), running)).skipped).toMatch(/Close/);
    expect((await cleaner.clean(target(env, 'brave:0:cache'), running)).freed).toBe(20);
    expect((await cleaner.clean(target(env, 'brave:0:cookies'), new Set())).freed).toBe(10);
  });

  it('refuses drive roots, and broad folders without a single-file filter', () => {
    const t = target(env, 'user-temp');
    expect(unsafeRoot('C:\\', env, t)).toBeTruthy();
    expect(unsafeRoot(env.USERPROFILE, env, t)).toBeTruthy();
    expect(unsafeRoot(env.SystemRoot, env, t)).toBeTruthy();
    expect(unsafeRoot(env.SystemRoot, env, target(env, 'system-memory-dump'))).toBeNull(); // MEMORY.DMP only
    expect(unsafeRoot(env.TEMP, env, t)).toBeNull();
  });
});

describe('targets', () => {
  it('every built-in target is safe to run and ids are unique', () => {
    const all = buildTargets(env);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) for (const r of t.roots) expect(unsafeRoot(r, env, t)).toBeNull();
  });

  it('finds browser profiles with their display names; passwords are Risky and opt-in', async () => {
    const ud = path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
    await mkdir(path.join(ud, 'Default'), { recursive: true });
    await mkdir(path.join(ud, 'Profile 2'), { recursive: true });
    await mkdir(path.join(ud, 'System Profile'), { recursive: true }); // not a user profile
    await writeFile(path.join(ud, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 2': { name: 'Work' } } } }));
    const chrome = buildTargets(env).filter((t) => t.id.startsWith('chrome:'));
    expect([...new Set(chrome.map((t) => t.subgroup))].sort()).toEqual(['Chrome: Default', 'Chrome: Work']);
    const pw = chrome.find((t) => t.name === 'Saved passwords')!;
    expect(pw).toMatchObject({ risk: 'risky', defaultSelected: false, needsClosed: true });
    expect(chrome.find((t) => t.name === 'Cache')!.defaultSelected).toBe(true);
  });

  it('Health Check material: only Safe targets are preselected', () => {
    for (const t of buildTargets(env)) if (t.defaultSelected) expect(t.risk).toBe('safe');
  });
});

describe('analyzer', () => {
  it('sizes folders, lists biggest files, does not follow links, and only opens paths inside the root', async () => {
    const root = path.join(base, 'disk');
    await file(path.join(root, 'big.iso'), 5000);
    await file(path.join(root, 'games', 'a.pak'), 3000);
    await file(path.join(root, 'games', 'deep', 'b.pak'), 1000);
    await file(path.join(base, 'elsewhere', 'huge.bin'), 9000);
    await symlink(path.join(base, 'elsewhere'), path.join(root, 'link'), 'junction');

    const a = createAnalyzer();
    const view = await a.analyze(root, () => {});
    expect(view.size).toBe(9000);
    expect(view.entries.map((e) => [e.name, e.size])).toEqual([
      ['big.iso', 5000],
      ['games', 4000],
    ]);
    expect(view.topFiles.map((f) => f.name)).toEqual(['big.iso', 'a.pak', 'b.pak']);
    expect((await a.open(path.join(root, 'games'))).size).toBe(4000);
    expect(a.inside(path.join(base, 'elsewhere', 'huge.bin'))).toBe(false);
    await expect(a.open(base)).rejects.toThrow(/Not inside/);
  });
});
