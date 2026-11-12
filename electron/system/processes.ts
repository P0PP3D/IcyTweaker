// Process view: live CPU, memory and disk per process, an end-task action that refuses Windows' own processes,
// and plain "safe to close" hints. Read-only query: Win32_Process (always present; the formatted performance
// classes are missing on some PCs). It reports cumulative CPU time and I/O bytes, so rates come from the change
// between two refreshes.
import os from 'node:os';
import type { ProcessHint, ProcessView } from '../../shared/types';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

export const PROCESS_SCRIPT =
  "Get-CimInstance Win32_Process -Property ProcessId,Name,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount,OtherTransferCount | Where-Object ProcessId -gt 0 | " +
  "ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId, $_.Name, ($_.KernelModeTime + $_.UserModeTime), $_.WorkingSetSize, ($_.ReadTransferCount + $_.WriteTransferCount + $_.OtherTransferCount) }";

/** Windows needs these to run (ending them crashes or signs you out). Never ended from here. */
const SYSTEM = new Set(
  ['system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'fontdrvhost', 'memory compression', 'secure system', 'sihost', 'ctfmon', 'spoolsv', 'audiodg', 'msmpeng', 'nissrv', 'securityhealthservice', 'wudfhost', 'conhost', 'dllhost', 'runtimebroker', 'taskhostw', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost', 'system idle process'].map((n) => n.toLowerCase()),
);
/** Apps that are fine to close mid-game; they only stop doing their own job until reopened. */
const SAFE: Array<[RegExp, string]> = [
  [/^(chrome|msedge|brave|firefox|opera|vivaldi)$/i, 'Browser: closing it frees memory; reopen tabs later.'],
  [/^(discord|slack|teams|ms-teams|telegram|whatsapp)$/i, 'Chat app: you will miss messages until you reopen it.'],
  [/^(spotify|itunes)$/i, 'Music app.'],
  [/^(onedrive|dropbox|googledrivefs)$/i, 'Cloud sync: files sync when it is running again.'],
  [/^(steamwebhelper|epicgameslauncher|eadesktop|battle\.net|ubisoftconnect|galaxyclient)$/i, 'Launcher part: close only when no game from it is running.'],
  [/^(widgets|widgetservice|phoneexperiencehost|yourphone|gamebar|gamebarftserver|xboxpcappft)$/i, 'Windows extra: restarts when you open it again.'],
  [/^(icue|lghub|lghub_agent|razer.*|steelseriesgg.*|armourycrate.*)$/i, 'Device utility: RGB or button settings may reset until it runs again.'],
];

export function hintFor(name: string): { hint: ProcessHint; note: string } {
  const n = name.toLowerCase().replace(/\.exe$/, '');
  if (SYSTEM.has(n)) return { hint: 'system', note: 'Part of Windows: not ended here.' };
  const safe = SAFE.find(([re]) => re.test(n));
  if (safe) return { hint: 'safe', note: safe[1] };
  if (n === 'explorer') return { hint: 'caution', note: 'Taskbar and desktop: they disappear until Explorer restarts.' };
  return { hint: 'unknown', note: '' };
}

interface Raw {
  pid: number;
  name: string;
  /** CPU time, 100 ns units. */
  cpu: number;
  mem: number;
  /** I/O bytes so far. */
  io: number;
}

export function parseRaw(out: string): Raw[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.split('|'))
    .filter((p) => p.length === 5 && Number(p[0]) > 0)
    .map(([pid, name, cpu, mem, io]) => ({ pid: Number(pid), name: name.replace(/\.exe$/i, ''), cpu: Number(cpu) || 0, mem: Number(mem) || 0, io: Number(io) || 0 }));
}

/** Turns two samples into rates. The first sample shows 0 CPU and disk until the next refresh. */
export function createProcessSampler(threads = os.cpus().length) {
  let prev = new Map<number, Raw>();
  let prevAt: number | null = null;
  return (raw: Raw[], now = Date.now()): ProcessView[] => {
    const dtMs = prevAt === null ? 0 : now - prevAt;
    const out = raw.map((p) => {
      const before = prev.get(p.pid);
      const same = before && before.name === p.name; // a reused PID is a new process
      const cpu = same && dtMs > 0 ? ((p.cpu - before.cpu) / 10_000 / dtMs / threads) * 100 : 0;
      const disk = same && dtMs > 0 ? ((p.io - before.io) * 1000) / dtMs : 0;
      return { pid: p.pid, name: p.name, cpu: Math.max(0, Math.round(cpu * 10) / 10), memory: p.mem, disk: Math.max(0, Math.round(disk)), ...hintFor(p.name) };
    });
    prev = new Map(raw.map((p) => [p.pid, p]));
    prevAt = now;
    return out;
  };
}

export async function queryProcesses(adapter: Pick<SystemAdapter, 'query'>): Promise<Raw[]> {
  return parseRaw(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SCRIPT], 30_000));
}
