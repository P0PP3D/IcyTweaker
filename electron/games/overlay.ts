// In-game overlay data: FPS and frame time from PresentMon (streamed), GPU temperature and load from nvidia-smi
// (streamed every 2 s), CPU load from the OS. Read-only measuring; the window itself lives in main.ts.
// The overlay shows over borderless/windowed games; exclusive fullscreen draws over it (a Windows limit).
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { OverlayStats } from '../../shared/types';
import { startCpuTemp } from '../system/sensors';

/** Rolling frame-time window -> fps, frame time and 1% low. */
export function frameStats(frames: Array<{ t: number; ms: number }>, now: number) {
  const last1 = frames.filter((f) => now - f.t <= 1000);
  const last5 = frames.filter((f) => now - f.t <= 5000).map((f) => f.ms).sort((a, b) => a - b);
  if (!last1.length) return { fps: null, frametime: null, low1: null };
  const avg = last1.reduce((a, f) => a + f.ms, 0) / last1.length;
  const p99 = last5[Math.min(last5.length - 1, Math.floor(last5.length * 0.99))];
  const r = (n: number) => Math.round(n * 10) / 10;
  return { fps: Math.round(1000 / avg), frametime: r(avg), low1: p99 ? Math.round(1000 / p99) : null };
}

export function createOverlayFeed(o: { systemRoot: string; send: (s: OverlayStats) => void }) {
  let pm: ChildProcess | null = null;
  let smi: ChildProcess | null = null;
  let temp: ChildProcess | null = null;
  let cpuTemp: number | null = null;
  let timer: NodeJS.Timeout | null = null;
  let game: string | null = null;
  let frames: Array<{ t: number; ms: number }> = [];
  let gpu: { temp: number | null; load: number | null } = { temp: null, load: null };
  const cpuTimes = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
  let lastCpu = cpuTimes();

  function stop() {
    pm?.kill();
    smi?.kill();
    temp?.kill();
    temp = null;
    cpuTemp = null;
    if (timer) clearInterval(timer);
    pm = smi = null;
    timer = null;
    game = null;
    frames = [];
  }

  return {
    running: () => pm !== null,
    game: () => game,
    /** Starts streaming for `exe` with the PresentMon at `presentMon`. Needs administrator (event tracing). lhmDir = CPU temperature library, if set up. */
    start(presentMon: string, exe: string, name: string, lhmDir?: string | null) {
      stop();
      game = name;
      pm = spawn(presentMon, ['--process_name', exe, '--output_stdout', '--v1_metrics', '--no_console_stats', '--stop_existing_session', '--session_name', 'IcyTweakerOverlay'], { windowsHide: true });
      let col = -1;
      let partial = '';
      pm.stdout?.on('data', (buf: Buffer) => {
        const lines = (partial + buf.toString()).split(/\r?\n/);
        partial = lines.pop() ?? '';
        for (const line of lines) {
          const cells = line.split(',');
          if (col < 0) {
            col = cells.findIndex((c) => c.trim().toLowerCase() === 'msbetweenpresents');
            continue;
          }
          const ms = Number(cells[col]);
          if (ms > 0) frames.push({ t: Date.now(), ms });
        }
        if (frames.length > 20_000) frames = frames.slice(-10_000);
      });
      pm.on('exit', () => (pm = null));
      // NVIDIA only; on other GPUs this fails quietly and temperature/load stay unknown.
      smi = spawn(path.join(o.systemRoot, 'System32', 'nvidia-smi.exe'), ['--query-gpu=temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits', '-l', '2'], { windowsHide: true });
      smi.stdout?.on('data', (buf: Buffer) => {
        const [t, l] = buf.toString().trim().split(/\r?\n/).pop()!.split(',').map((x) => Number(x.trim()));
        gpu = { temp: Number.isFinite(t) ? t : null, load: Number.isFinite(l) ? l : null };
      });
      smi.on('error', () => (smi = null));
      if (lhmDir) temp = startCpuTemp(lhmDir, (c) => (cpuTemp = c));
      timer = setInterval(() => {
        const now = Date.now();
        frames = frames.filter((f) => now - f.t <= 5000);
        const c = cpuTimes();
        const total = c.total - lastCpu.total;
        const cpu = total > 0 ? Math.round(100 * (1 - (c.idle - lastCpu.idle) / total)) : null;
        lastCpu = c;
        o.send({ game, ...frameStats(frames, now), gpuTemp: gpu.temp, gpuLoad: gpu.load, cpu, cpuTemp });
      }, 1000);
    },
    stop,
  };
}
