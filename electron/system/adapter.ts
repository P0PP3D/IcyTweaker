// System adapter: the only code that touches the system. Every write in the app goes through a SystemAdapter.
//
//   dry-run (default): reads the real system, keeps writes in memory, never runs commands.
//   live:              real writes and commands. Only when OPTIMIZER_LIVE=1.
//
// A "setting" is one readable, writable piece of system state (a registry value, a scheduled task's
// enabled flag, a service start type, ...). The safety layer backs each one up before the first change.
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getKey, setKey, type ConfigFormat } from '../games/config';

export type Hive = 'HKLM' | 'HKCU';
export interface RegRef {
  hive: Hive;
  key: string;
  name: string;
}
/** REG_BINARY data is upper-case hex, e.g. '020000000000000000000000'. */
export type RegValue = { type: 'REG_DWORD'; data: number } | { type: 'REG_SZ'; data: string } | { type: 'REG_BINARY'; data: string };
export type StartType = 'boot' | 'system' | 'auto' | 'delayed-auto' | 'demand' | 'disabled';

export type SettingRef =
  | ({ kind: 'reg' } & RegRef)
  /** Scheduled task. Value 'enabled' | 'disabled'. */
  | { kind: 'task'; path: string }
  /** Service start type (StartType). */
  | { kind: 'service'; name: string }
  /** Power setting index on a scheme ('current' = the active one). Value number. */
  | { kind: 'power'; scheme: string; sub: string; setting: string; ac: boolean }
  /** The active power scheme GUID. Value string. */
  | { kind: 'activeScheme' }
  /** A power scheme the app owns, copied from `base`. Value true = exists, null = absent. */
  | { kind: 'scheme'; guid: string; base: string; name: string }
  /** Hibernation enabled. Value boolean. */
  | { kind: 'hibernate' }
  /** NTFS DisableDeleteNotify (0 = TRIM on). Value number. */
  | { kind: 'trim' }
  /** A `netsh int tcp set global` parameter. Value its keyword, e.g. 'enabled' or 'normal'. */
  | { kind: 'tcpGlobal'; name: 'rss' | 'autotuninglevel' | 'ecncapability' }
  /** IPv4 DNS servers of one network adapter. Value 'a,b' or 'dhcp' (automatic). */
  | { kind: 'dns'; guid: string }
  /** The hosts file. Value its full text. */
  | { kind: 'hosts' }
  /** One key in a game or app config file. Value string (ini/kv/cfg) or a JSON scalar. owner = game id, for Reset. */
  | { kind: 'configKey'; file: string; format: ConfigFormat; section?: string; name: string; owner?: string }
  /** One advanced property of a network adapter (Device Manager > Advanced), by its standard registry keyword. Value its registry value. */
  | { kind: 'netAdv'; adapter: string; keyword: string }
  /** A registry key's existence (created with an empty default value). Value true = exists, null = absent. */
  | { kind: 'regKey'; hive: Hive; key: string };

export type Value = RegValue | string | number | boolean;

/**
 * Kinds whose value can be created when absent. A missing task, service, adapter or unreadable setting can't be,
 * and neither can a key a game's own config file doesn't have (JSON app settings can).
 */
export const creatable = (ref: SettingRef) =>
  ref.kind === 'configKey' ? ref.format === 'json' || ref.format === 'prefs' : !['task', 'service', 'power', 'tcpGlobal', 'dns', 'hosts', 'netAdv'].includes(ref.kind);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Live output (long repairs). */
  onOutput?: (chunk: string) => void;
  /** Exit codes that are not errors (e.g. chkdsk 1 = "found and fixed"). */
  okCodes?: number[] | 'any';
}

export interface SystemAdapter {
  readonly live: boolean;
  /** null = absent. */
  read(ref: SettingRef): Promise<Value | null>;
  /** null = delete / remove. */
  write(ref: SettingRef, value: Value | null): Promise<void>;
  /** Run a command that changes the system. Dry-run records it and runs nothing. A number = timeout in ms. */
  exec(file: string, args: string[], opts?: number | ExecOptions): Promise<ExecResult>;
  /** Run a read-only command. Runs in both modes. */
  query(file: string, args: string[], timeoutMs?: number): Promise<string>;
  /** Delete one file (never a directory or link). */
  removeFile(file: string): Promise<void>;
  /** Remove a directory only if it is empty. */
  removeEmptyDir(dir: string): Promise<void>;
  /** Move a file or folder to the Recycle Bin. */
  trash(target: string): Promise<void>;
  /** Copy a file the app backed up back to where it was (privacy snapshots). Never overwrites. */
  restoreFile(from: string, to: string): Promise<void>;
  /** Dry-run: true for paths it pretended to delete, so scans stop counting them. */
  isRemoved?(file: string): boolean;
}

export const dword = (data: number): RegValue => ({ type: 'REG_DWORD', data });
export const sz = (data: string): RegValue => ({ type: 'REG_SZ', data });
export const binary = (hex: string): RegValue => ({ type: 'REG_BINARY', data: hex.toUpperCase() });
export const reg = (hive: Hive, key: string, name: string): SettingRef => ({ kind: 'reg', hive, key, name });

export function refId(r: SettingRef): string {
  switch (r.kind) {
    case 'reg':
      return `${r.hive}\\${r.key}\\${r.name}`.toLowerCase();
    case 'task':
      return `task:${r.path}`.toLowerCase();
    case 'service':
      return `service:${r.name}`.toLowerCase();
    case 'power':
      return `power:${r.scheme}:${r.sub}:${r.setting}:${r.ac ? 'ac' : 'dc'}`.toLowerCase();
    case 'scheme':
      return `scheme:${r.guid}`.toLowerCase();
    case 'tcpGlobal':
      return `tcp:${r.name}`;
    case 'dns':
      return `dns:${r.guid}`.toLowerCase();
    case 'netAdv':
      return `netadv:${r.adapter}:${r.keyword}`.toLowerCase();
    case 'regKey':
      return `key:${r.hive}\\${r.key}`.toLowerCase();
    case 'configKey':
      return `cfg:${r.file}|${r.section ?? ''}|${r.name}`.toLowerCase();
    default:
      return r.kind.toLowerCase();
  }
}

export const sameValue = (a: Value | null, b: Value | null) => JSON.stringify(a) === JSON.stringify(b);

const SYSTEM32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const sys = (exe: string) => path.join(SYSTEM32, exe);
export const REG_EXE = sys('reg.exe');
export const SHUTDOWN_EXE = sys('shutdown.exe');
export const TASKLIST_EXE = sys('tasklist.exe');
export const POWERSHELL_EXE = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export const CMD_EXE = sys('cmd.exe');
const SCHTASKS_EXE = sys('schtasks.exe');
export const SC_EXE = sys('sc.exe');
const POWERCFG_EXE = sys('powercfg.exe');
const FSUTIL_EXE = sys('fsutil.exe');

export const NETSH_EXE = sys('netsh.exe');
export const HOSTS_FILE = path.join(SYSTEM32, 'drivers', 'etc', 'hosts');

/** Running process names, lower case. Read-only. */
export async function runningProcesses(adapter: Pick<SystemAdapter, 'query'>): Promise<Set<string>> {
  const out = await adapter.query(TASKLIST_EXE, ['/FO', 'CSV', '/NH']).catch(() => '');
  return new Set([...out.matchAll(/^"([^"]+)"/gm)].map((m) => m[1].toLowerCase()));
}

const BOM = '﻿'; // config files keep their BOM if they had one

/** sfc and some tools write UTF-16 to pipes; drop the NULs so it reads as text. */
const clean = (s: string) => s.replace(/\u0000/g, '');

export function run(file: string, args: string[], opts: number | ExecOptions = 15_000): Promise<ExecResult> {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts;
  return new Promise((resolve, reject) => {
    // cmd.exe parses its own quotes; Node's default \" escaping would break uninstall command lines.
    const child = execFile(
      file,
      args,
      { timeout: o.timeoutMs ?? 15_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, windowsVerbatimArguments: file === CMD_EXE },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        const r = { stdout: clean(stdout), stderr: clean(stderr), code };
        const exited = !!err && typeof err.code === 'number'; // a timeout or kill has no numeric code
        if (!err || (exited && (o.okCodes === 'any' || o.okCodes?.includes(code)))) resolve(r);
        else reject(new Error((r.stderr || r.stdout || err.message).trim().slice(-500)));
      },
    );
    if (o.onOutput) child.stdout?.on('data', (d: Buffer | string) => o.onOutput!(clean(d.toString())));
  });
}

/** Parses `netsh int tcp show global`. Labels are English; on other languages this returns {} (setting unavailable). */
export function parseTcpGlobal(text: string): Partial<Record<'rss' | 'autotuninglevel' | 'ecncapability', string>> {
  const label = { rss: 'Receive-Side Scaling State', autotuninglevel: 'Receive Window Auto-Tuning Level', ecncapability: 'ECN Capability' } as const;
  const out: Partial<Record<keyof typeof label, string>> = {};
  for (const [k, l] of Object.entries(label) as Array<[keyof typeof label, string]>) {
    const m = new RegExp(`^${l}\\s*:\\s*(\\S+)`, 'mi').exec(text);
    if (m) out[k] = m[1].toLowerCase();
  }
  return out;
}

// A state refresh reads a few hundred settings. One process per read (775 reg.exe starts) took 10-30 s, so:
// reads share a small process pool, identical read commands within FRESH_MS share one result, registry keys
// asked for together are read by one PowerShell, and scheduled tasks come from one bulk schtasks call.
// Every live write and exec clears all of it (clearReadCache), so a read after a write is always fresh.
const READ_SLOTS = 6;
const FRESH_MS = 1500;
let readsRunning = 0;
const readQueue: Array<() => void> = [];
async function pooled(file: string, args: string[]): Promise<ExecResult> {
  if (readsRunning >= READ_SLOTS) await new Promise<void>((r) => readQueue.push(r));
  readsRunning++;
  try {
    return await run(file, args, 30_000);
  } finally {
    readsRunning--;
    readQueue.shift()?.();
  }
}

type Fresh<T> = { at: number; value: Promise<T> };
const fresh = <T>(e: Fresh<T> | null | undefined): e is Fresh<T> => !!e && Date.now() - e.at < FRESH_MS;
const readMemo = new Map<string, Fresh<ExecResult>>();
function readRun(file: string, args: string[]): Promise<ExecResult> {
  const id = [file, ...args].join('\0');
  const hit = readMemo.get(id);
  if (fresh(hit)) return hit.value;
  const value = pooled(file, args);
  readMemo.set(id, { at: Date.now(), value });
  value.catch(() => readMemo.get(id)?.value === value && readMemo.delete(id)); // failures aren't kept
  return value;
}

type KeyValues = Map<string, { type: string; raw: string }>;
const regCache = new Map<string, Fresh<KeyValues>>();
let regBatch: Array<{ path: string; resolve: (v: KeyValues) => void }> = [];
let taskCache: Fresh<Map<string, string> | null> | null = null;

/** Forgets cached reads. Called around every live write and exec. */
export const clearReadCache = () => {
  readMemo.clear();
  regCache.clear();
  taskCache = null;
};

const tcpGlobalText = () => readRun(NETSH_EXE, ['int', 'tcp', 'show', 'global']).then((r) => r.stdout, () => '');

/** Parses `reg query <key>` (values of that key only, no subkeys): lower-cased name -> type and text. */
export function parseRegKey(stdout: string): KeyValues {
  const out: KeyValues = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line) ?? /^\s{4}(.+?)\s{4}(REG_\w+)$/.exec(line);
    if (m) out.set(m[1].toLowerCase(), { type: m[2], raw: m[3] ?? '' });
  }
  return out;
}

/** Read-only PowerShell that prints every value of each key, in the same text forms reg.exe uses. */
export const regBatchScript = (paths: string[]) => `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$roots = @{ HKLM = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64'); HKCU = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64') }
$types = @{ DWord = 'REG_DWORD'; QWord = 'REG_QWORD'; Binary = 'REG_BINARY'; String = 'REG_SZ'; ExpandString = 'REG_EXPAND_SZ'; MultiString = 'REG_MULTI_SZ' }
foreach ($k in @(${paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(', ')})) {
  "#KEY $k"
  try {
    $i = $k.IndexOf('\\')
    $s = $roots[$k.Substring(0, $i)].OpenSubKey($k.Substring($i + 1))
    if (-not $s) { continue }
    foreach ($n in $s.GetValueNames()) {
      $kind = [string]$s.GetValueKind($n)
      $v = $s.GetValue($n, $null, 'DoNotExpandEnvironmentNames')
      if ($kind -eq 'DWord' -or $kind -eq 'QWord') { $r = '0x{0:x}' -f $v }
      elseif ($kind -eq 'Binary') { $r = ($v | ForEach-Object { $_.ToString('X2') }) -join '' }
      elseif ($kind -eq 'MultiString') { $r = $v -join '|' }
      else { $r = [string]$v }
      $t = $types[$kind]; if (-not $t) { $t = 'REG_NONE' }
      "#V$([char]9)$n$([char]9)$t$([char]9)$r"
    }
  } catch { }
}`;

/** Parses regBatchScript output: lower-cased key path -> its values. A key that doesn't exist has none. */
export function parseRegBatch(stdout: string): Map<string, KeyValues> {
  const out = new Map<string, KeyValues>();
  let cur: KeyValues | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('#KEY ')) out.set(line.slice(5).toLowerCase(), (cur = new Map()));
    else if (line.startsWith('#V\t') && cur) {
      const [, name, type, ...raw] = line.split('\t');
      cur.set(name.toLowerCase(), { type, raw: raw.join('\t') });
    }
  }
  return out;
}

// ponytail: reg.exe exits 1 for "not found" and for other errors alike, and its message is localized, so any
// failure reads as absent. Switch to a native registry binding if a tweak must tell "absent" from "denied".
const regExeKey = (p: string) => readRun(REG_EXE, ['query', p, '/reg:64']).then((r) => parseRegKey(r.stdout), (): KeyValues => new Map());

function flushRegBatch() {
  const items = regBatch;
  regBatch = [];
  // Chunks keep each command line well under Windows' 32K limit (-EncodedCommand is UTF-16 in base64).
  for (let i = 0; i < items.length; ) {
    const chunk: typeof items = [];
    for (let len = 0; i < items.length && len < 8000; i++) {
      chunk.push(items[i]);
      len += items[i].path.length + 4;
    }
    const encoded = Buffer.from(regBatchScript(chunk.map((c) => c.path)), 'utf16le').toString('base64');
    pooled(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded])
      .then((r) => parseRegBatch(r.stdout))
      .then(
        (keys) => chunk.forEach((c) => (keys.has(c.path.toLowerCase()) ? c.resolve(keys.get(c.path.toLowerCase())!) : regExeKey(c.path).then(c.resolve))),
        () => chunk.forEach((c) => regExeKey(c.path).then(c.resolve)), // PowerShell unavailable: one reg.exe per key
      );
  }
}

const keyValues = (hive: Hive, key: string): Promise<KeyValues> => {
  const id = `${hive}\\${key}`.toLowerCase();
  const hit = regCache.get(id);
  if (fresh(hit)) return hit.value;
  const value = new Promise<KeyValues>((resolve) => {
    if (!regBatch.length) setTimeout(flushRegBatch, 0); // collects every key asked for in this tick
    regBatch.push({ path: `${hive}\\${key}`, resolve });
  });
  regCache.set(id, { at: Date.now(), value });
  return value;
};

/** Splits `schtasks /Query /XML` (every task, each after a <!-- \path --> comment): lower-cased path -> its XML. */
export function parseTaskList(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = xml.split(/<!--\s*(\\.*?)\s*-->/);
  for (let i = 1; i + 1 < parts.length; i += 2) out.set(parts[i].toLowerCase(), parts[i + 1]);
  return out;
}

async function taskXml(taskPath: string): Promise<string | null> {
  if (!fresh(taskCache)) taskCache = { at: Date.now(), value: pooled(SCHTASKS_EXE, ['/Query', '/XML']).then((r) => parseTaskList(r.stdout), () => null) };
  const all = await taskCache.value;
  if (all) return all.get(taskPath.toLowerCase()) ?? null;
  return readRun(SCHTASKS_EXE, ['/Query', '/TN', taskPath, '/XML']).then((r) => r.stdout, () => null); // bulk list failed
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** `keyword<TAB>value` lines -> lower-cased keyword -> registry value (multi-values joined by ','). */
export const parseNetAdv = (out: string) =>
  new Map(
    out
      .split(/\r?\n/)
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([k, v]) => [k.trim().toLowerCase(), v.trim()] as const),
  );

/** One adapter's advanced properties (one PowerShell per adapter per refresh). */
const netAdvValues = (name: string) =>
  readRun(POWERSHELL_EXE, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-NetAdapterAdvancedProperty -Name ${psq(name)} -ErrorAction SilentlyContinue | ForEach-Object { $_.RegistryKeyword + [char]9 + ($_.RegistryValue -join ',') }`,
  ]).then((r) => parseNetAdv(r.stdout), () => new Map<string, string>());

/** Read-only registry query through reg.exe (64-bit view). */
export async function regQuery(ref: RegRef): Promise<RegValue | null> {
  const v = (await keyValues(ref.hive, ref.key)).get(ref.name.toLowerCase());
  if (!v) return null;
  if (v.type === 'REG_DWORD') return dword(parseInt(v.raw, 16));
  if (v.type === 'REG_SZ') return sz(v.raw);
  if (v.type === 'REG_BINARY') return binary(v.raw);
  throw new Error(`${ref.hive}\\${ref.key}\\${ref.name} has unsupported type ${v.type}`);
}

const dwordOf = async (hive: Hive, key: string, name: string) => {
  const v = await regQuery({ hive, key, name });
  return v?.type === 'REG_DWORD' ? v.data : null;
};

const START_TYPES: Record<number, StartType> = { 0: 'boot', 1: 'system', 2: 'auto', 3: 'demand', 4: 'disabled' };
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const activeScheme = async () => GUID.exec((await readRun(POWERCFG_EXE, ['/getactivescheme'])).stdout)?.[0].toLowerCase() ?? null;
const schemeOf = async (s: string) => (s === 'current' ? activeScheme() : s);

/** Live reads. All read-only. */
export async function liveRead(ref: SettingRef): Promise<Value | null> {
  switch (ref.kind) {
    case 'reg':
      return regQuery(ref);
    case 'task': {
      // XML, because schtasks' status column is localized. A task is enabled unless Settings says false.
      const xml = await taskXml(ref.path);
      if (xml === null) return null;
      const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(xml)?.[1] ?? '';
      return /<Enabled>\s*false\s*<\/Enabled>/i.test(settings) ? 'disabled' : 'enabled';
    }
    case 'service': {
      const key = `SYSTEM\\CurrentControlSet\\Services\\${ref.name}`;
      const start = await dwordOf('HKLM', key, 'Start');
      if (start === null) return null;
      if (start === 2 && (await dwordOf('HKLM', key, 'DelayedAutostart')) === 1) return 'delayed-auto';
      return START_TYPES[start] ?? null;
    }
    case 'power': {
      const scheme = await schemeOf(ref.scheme);
      if (!scheme) return null;
      // /qh also shows hidden settings (core parking, boost mode, idle disable); same output as /query.
      const out = await readRun(POWERCFG_EXE, ['/qh', scheme, ref.sub, ref.setting]).then((r) => r.stdout, () => null);
      // The labels are localized; the last two hex numbers are always the current AC then DC index.
      const hex = out?.match(/0x[0-9a-f]{8}/gi);
      if (!hex || hex.length < 2) return null;
      return parseInt(hex[hex.length - (ref.ac ? 2 : 1)], 16);
    }
    case 'activeScheme':
      return activeScheme();
    case 'scheme': {
      const list = (await readRun(POWERCFG_EXE, ['/list'])).stdout.toLowerCase();
      return list.includes(ref.guid.toLowerCase()) ? true : null;
    }
    case 'hibernate': {
      const v = await dwordOf('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Power', 'HibernateEnabled');
      return v === null ? null : v !== 0;
    }
    case 'trim':
      return dwordOf('HKLM', 'SYSTEM\\CurrentControlSet\\Control\\FileSystem', 'DisableDeleteNotification');
    case 'tcpGlobal':
      return parseTcpGlobal(await tcpGlobalText())[ref.name] ?? null;
    case 'dns': {
      // Static servers live in NameServer; empty means DHCP. A missing key means the adapter is gone.
      const v = await regQuery({ hive: 'HKLM', key: `SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\${ref.guid}`, name: 'NameServer' });
      if (v === null) return null;
      const servers = String(v.data).split(/[\s,]+/).filter(Boolean);
      return servers.length ? servers.join(',') : 'dhcp';
    }
    case 'hosts':
      return readFile(HOSTS_FILE, 'utf8').catch(() => null);
    case 'netAdv':
      return (await netAdvValues(ref.adapter)).get(ref.keyword.toLowerCase()) ?? null;
    case 'regKey':
      return readRun(REG_EXE, ['query', `${ref.hive}\\${ref.key}`, '/reg:64']).then(() => true, () => null);
    case 'configKey': {
      const text = await readFile(ref.file, 'utf8').catch(() => null);
      return text === null ? null : getKey(text.replace(BOM, ''), ref.format, ref.section, ref.name);
    }
  }
}

async function liveWrite(ref: SettingRef, value: Value | null): Promise<void> {
  switch (ref.kind) {
    case 'reg': {
      const target = `${ref.hive}\\${ref.key}`;
      if (value === null) {
        try {
          await run(REG_EXE, ['delete', target, '/v', ref.name, '/f', '/reg:64']);
        } catch (err) {
          if ((await regQuery(ref)) !== null) throw err; // already absent is fine
        }
        return;
      }
      const v = value as RegValue;
      await run(REG_EXE, ['add', target, '/v', ref.name, '/t', v.type, '/d', String(v.data), '/f', '/reg:64']);
      return;
    }
    case 'task':
      if (value === null) return; // can't recreate a task; nothing to do
      await run(SCHTASKS_EXE, ['/Change', '/TN', ref.path, value === 'disabled' ? '/DISABLE' : '/ENABLE']);
      return;
    case 'service':
      if (value === null || value === 'boot' || value === 'system') return; // never touch driver start types
      await run(SC_EXE, ['config', ref.name, 'start=', String(value)]);
      return;
    case 'power': {
      const scheme = await schemeOf(ref.scheme);
      if (value === null || !scheme) return;
      await run(POWERCFG_EXE, [ref.ac ? '/setacvalueindex' : '/setdcvalueindex', scheme, ref.sub, ref.setting, String(value)]);
      if (scheme === (await activeScheme())) await run(POWERCFG_EXE, ['/setactive', scheme]); // re-apply
      return;
    }
    case 'activeScheme':
      if (typeof value === 'string') await run(POWERCFG_EXE, ['/setactive', value]);
      return;
    case 'scheme':
      if (value === null) {
        if ((await liveRead(ref)) !== null) await run(POWERCFG_EXE, ['/delete', ref.guid]);
      } else {
        await run(POWERCFG_EXE, ['/duplicatescheme', ref.base, ref.guid]);
        await run(POWERCFG_EXE, ['/changename', ref.guid, ref.name]);
      }
      return;
    case 'hibernate':
      if (value !== null) await run(POWERCFG_EXE, ['/hibernate', value ? 'on' : 'off']);
      return;
    case 'trim':
      if (value !== null) await run(FSUTIL_EXE, ['behavior', 'set', 'DisableDeleteNotify', String(value)]);
      return;
    case 'tcpGlobal':
      if (typeof value === 'string') await run(NETSH_EXE, ['int', 'tcp', 'set', 'global', `${ref.name}=${value}`]);
      return;
    case 'dns': {
      if (typeof value !== 'string') return;
      const servers = value === 'dhcp' ? '-ResetServerAddresses' : `-ServerAddresses ${value.split(',').map((s) => `'${s.replace(/'/g, '')}'`).join(',')}`;
      await run(POWERSHELL_EXE, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-NetAdapter | Where-Object InterfaceGuid -eq '${ref.guid.replace(/'/g, '')}' | Set-DnsClientServerAddress ${servers}`,
      ]);
      return;
    }
    case 'hosts':
      if (typeof value === 'string') await writeFile(HOSTS_FILE, value, 'utf8'); // never deleted
      return;
    case 'netAdv':
      // Windows restarts the adapter to apply it (a few seconds offline). A property can't be removed, so null is a no-op.
      if (typeof value === 'string') await run(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', `Set-NetAdapterAdvancedProperty -Name ${psq(ref.adapter)} -RegistryKeyword ${psq(ref.keyword)} -RegistryValue ${psq(value)}`], 60_000);
      return;
    case 'regKey': {
      const target = `${ref.hive}\\${ref.key}`;
      if (value === null) {
        if ((await liveRead(ref)) !== null) await run(REG_EXE, ['delete', target, '/f', '/reg:64']);
      } else await run(REG_EXE, ['add', target, '/ve', '/f', '/reg:64']);
      return;
    }
    case 'configKey': {
      const text = await readFile(ref.file, 'utf8').catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' && value === null) return null; // file gone: the key is already absent
        throw err;
      });
      if (text === null || (value !== null && typeof value === 'object')) return;
      const bom = text.startsWith(BOM) ? BOM : '';
      await writeFile(ref.file, bom + setKey(text.slice(bom.length), ref.format, ref.section, ref.name, value), 'utf8');
      return;
    }
  }
}

/**
 * Settings overlay kept in memory. Reads fall through to `base` for settings never written.
 * Dry-run mode = memoryAdapter(liveRead, real query). Tests = memoryAdapter() (an empty fake system).
 */
export function memoryAdapter(
  base: (ref: SettingRef) => Promise<Value | null> = async () => null,
  baseQuery: (file: string, args: string[], timeoutMs?: number) => Promise<string> = async () => '',
) {
  const values = new Map<string, Value | null>(); // null = deleted
  const commands: string[][] = [];
  // ponytail: one entry per pretend-deleted file; a dry-run session that "cleans" millions of files grows memory.
  const removed = new Set<string>();
  const key = (p: string) => path.resolve(p).toLowerCase();
  return {
    live: false as const,
    values,
    commands,
    removed,
    async removeFile(file: string) {
      removed.add(key(file));
    },
    async removeEmptyDir(_dir: string) {},
    async trash(target: string) {
      removed.add(key(target));
    },
    async restoreFile(from: string, to: string) {
      commands.push(['copy', from, to]);
    },
    isRemoved: (file: string) => removed.has(key(file)),
    async read(ref: SettingRef) {
      const id = refId(ref);
      return values.has(id) ? values.get(id)! : base(ref);
    },
    async write(ref: SettingRef, value: Value | null) {
      values.set(refId(ref), value);
    },
    async exec(file: string, args: string[], _opts?: number | ExecOptions): Promise<ExecResult> {
      commands.push([file, ...args]);
      return { stdout: '', stderr: '', code: 0 };
    },
    query: baseQuery,
  };
}

const liveQuery = async (file: string, args: string[], timeoutMs?: number) => (await run(file, args, timeoutMs)).stdout;

export function liveAdapter(): SystemAdapter {
  return {
    live: true,
    read: liveRead,
    async write(ref, value) {
      clearReadCache();
      try {
        await liveWrite(ref, value);
      } finally {
        clearReadCache();
      }
    },
    exec: (file, args, opts = 180_000) =>
      run(file, args, typeof opts === 'number' ? opts : { timeoutMs: 180_000, ...opts }).finally(clearReadCache),
    query: liveQuery,
    async removeFile(file) {
      if ((await lstat(file)).isFile()) await unlink(file); // lstat: a link is never followed or deleted here
    },
    removeEmptyDir: (dir) => rmdir(dir).catch(() => {}), // non-recursive: fails (ignored) unless empty
    async trash(target) {
      const p = target.replace(/'/g, "''");
      const method = (await lstat(target)).isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
      await run(POWERSHELL_EXE, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${p}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
      ]);
    },
    async restoreFile(from, to) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to, fsConstants.COPYFILE_EXCL); // never overwrites a file that is there now
    },
  };
}

/**
 * Live mode. Development (not packaged): only with OPTIMIZER_LIVE=1. Installed builds (packaged): live unless
 * OPTIMIZER_LIVE=0, which forces dry-run (used to test an installed copy safely).
 */
export const isLiveEnv = (env: NodeJS.ProcessEnv, packaged = false) => (packaged ? env.OPTIMIZER_LIVE !== '0' : env.OPTIMIZER_LIVE === '1');

export const createSystemAdapter = (env: NodeJS.ProcessEnv, packaged = false): SystemAdapter =>
  isLiveEnv(env, packaged) ? liveAdapter() : memoryAdapter(liveRead, liveQuery);
