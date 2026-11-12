// Live CPU / RAM / GPU usage for the home rings. Read-only: nothing here changes the system.
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import type { Stats } from '../../shared/types';
import { POWERSHELL_EXE } from './adapter';

type CpuTimes = { idle: number; total: number };
const cpuTimes = (): CpuTimes =>
  os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      return { idle: acc.idle + t.idle, total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq };
    },
    { idle: 0, total: 0 },
  );

/** CPU busy percent between two samples. */
export const cpuPercent = (a: CpuTimes, b: CpuTimes) => {
  const total = b.total - a.total;
  return total > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : 0;
};

// Sums the 3D-engine utilization of every process, the number Task Manager shows for "3D".
// ponytail: counter names are localized, so on non-English Windows this prints nothing and the GPU
// ring shows n/a. Look counters up by index (PDH) if that matters.
// Processes come and go mid-sample, which makes Get-Counter report errors; keep the valid samples.
const GPU_LOOP =
  "while ($true) { $c = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -ErrorAction SilentlyContinue).CounterSamples | Where-Object Status -eq 0; " +
  "if ($c) { [Console]::Out.WriteLine([math]::Round([math]::Min(($c | Measure-Object CookedValue -Sum).Sum, 100))) } " +
  "else { [Console]::Out.WriteLine('na'); Start-Sleep 5 } }";

/** The GPU reader (a PowerShell process, ~90 MB and ~3% of a core) only runs while someone is reading stats. */
export const GPU_IDLE_MS = 10_000;

export function createStatsSampler(spawnReader: () => ChildProcess = () => spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', GPU_LOOP], { windowsHide: true })) {
  let last = cpuTimes();
  let gpu: number | null = null;
  let child: ChildProcess | null = null;
  let unavailable = false; // the counter doesn't exist here: never respawn
  let idleTimer: NodeJS.Timeout | null = null;

  function startGpu() {
    child = spawnReader();
    child.stdout?.on('data', (buf: Buffer) => {
      const line = buf.toString().trim().split(/\r?\n/).pop();
      const n = Number(line);
      if (line === 'na') unavailable = true;
      gpu = line !== '' && Number.isFinite(n) ? n : null;
    });
    child.on('error', () => (gpu = null));
    child.on('exit', () => {
      child = null;
      gpu = null;
    });
  }

  function stop() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    child?.kill();
    child = null;
  }

  return {
    /** Starts the GPU reader if needed; it stops by itself GPU_IDLE_MS after the last call (Home closed or hidden). */
    get(): Stats {
      if (!child && !unavailable) startGpu();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, GPU_IDLE_MS);
      const now = cpuTimes();
      const cpu = cpuPercent(last, now);
      last = now;
      return { cpu, ramUsed: os.totalmem() - os.freemem(), ramTotal: os.totalmem(), gpu };
    },
    stop,
    /** For tests. */
    running: () => child !== null,
  };
}
