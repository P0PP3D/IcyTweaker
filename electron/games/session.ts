// Session report: what a Game Boost session looked like. FPS and temperatures come from the overlay feed when the
// overlay ran; CPU load is sampled every boost tick either way. Kept in sessions.json (newest first, last 50).
import { readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { OverlayStats, SessionReport, Stutter, TempPoint } from '../../shared/types';

/** Temperatures where CPUs and GPUs start slowing themselves down (typical limits; vendors differ a little). */
export const HOT = { cpu: 95, gpu: 87 } as const;
const KEEP = 50;

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const nums = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** Whole-machine CPU load between calls, from os.cpus() times. */
export function cpuMeter() {
  const times = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
  let last = times();
  return () => {
    const now = times();
    const d = now.total - last.total;
    const load = d > 0 ? Math.round(100 * (1 - (now.idle - last.idle) / d)) : null;
    last = now;
    return load;
  };
}

export function summarize(game: string, startedAt: string, endedAt: string, samples: Array<Partial<OverlayStats>>): SessionReport {
  const s = (k: keyof OverlayStats) => nums(samples.map((x) => x[k] as number | null | undefined));
  const cpuTempMax = max(s('cpuTemp'));
  const gpuTempMax = max(s('gpuTemp'));
  const hot: string[] = [];
  if (cpuTempMax !== null && cpuTempMax >= HOT.cpu) hot.push(`CPU reached ${cpuTempMax} °C and may have slowed itself down`);
  if (gpuTempMax !== null && gpuTempMax >= HOT.gpu) hot.push(`GPU reached ${gpuTempMax} °C and may have slowed itself down`);
  return {
    game,
    startedAt,
    endedAt,
    minutes: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000)),
    fpsAvg: avg(s('fps')),
    low1: median(s('low1')),
    cpuAvg: avg(s('cpu')),
    cpuTempMax,
    gpuTempMax,
    gpuLoadAvg: avg(s('gpuLoad')),
    hot,
  };
}

/** A drop: FPS under 60 % of the last 30 readings' average (at least 20 readings in, so loading screens settle). */
export const DROP = { ratio: 0.6, window: 30, warmup: 20, maxPerSession: 20 } as const;
export function isDrop(fps: number[], now: number): number | null {
  const recent = fps.slice(-DROP.window);
  if (fps.length < DROP.warmup) return null;
  const before = recent.reduce((a, b) => a + b, 0) / recent.length;
  return now < before * DROP.ratio ? Math.round(before) : null;
}

/**
 * Temperature history: readings averaged into buckets (1 minute, wider for long sessions so a report keeps at most
 * MAX_POINTS points). m = minutes since the session started.
 */
const MAX_POINTS = 240;
export function tempSeries(readings: Array<{ t: number; cpu: number | null; gpu: number | null }>, start: number): TempPoint[] {
  if (!readings.length) return [];
  const span = Math.max(1, (readings[readings.length - 1].t - start) / 60_000);
  const minutes = Math.max(1, Math.ceil(span / MAX_POINTS));
  const buckets = new Map<number, { cpu: number[]; gpu: number[] }>();
  for (const r of readings) {
    const k = Math.floor((r.t - start) / 60_000 / minutes);
    const b = buckets.get(k) ?? { cpu: [], gpu: [] };
    if (r.cpu !== null) b.cpu.push(r.cpu);
    if (r.gpu !== null) b.gpu.push(r.gpu);
    buckets.set(k, b);
  }
  return [...buckets].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ m: k * minutes, cpu: avg(b.cpu), gpu: avg(b.gpu) }));
}

export function createSessionRecorder(file: string) {
  let current: { game: string; startedAt: string; samples: Array<Partial<OverlayStats>>; stutters: Stutter[]; temps: Array<{ t: number; cpu: number | null; gpu: number | null }> } | null = null;
  const history = async (): Promise<SessionReport[]> => readFile(file, 'utf8').then((t) => JSON.parse(t) as SessionReport[], () => []);
  return {
    start(game: string) {
      current = { game, startedAt: new Date().toISOString(), samples: [], stutters: [], temps: [] };
    },
    /**
     * One reading. Ignored when no session runs. Returns the average FPS before it when this reading is a drop.
     * ponytail: one sample per second for hours is ~10k small objects; fine.
     */
    sample(st: Partial<OverlayStats>): number | null {
      if (!current || (st.game && st.game !== current.game)) return null;
      const drop = typeof st.fps === 'number' ? isDrop(nums(current.samples.map((x) => x.fps)), st.fps) : null;
      current.samples.push(st);
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      if (num(st.cpuTemp) !== null || num(st.gpuTemp) !== null) current.temps.push({ t: Date.now(), cpu: num(st.cpuTemp), gpu: num(st.gpuTemp) });
      return drop;
    },
    /** Records what ran during a drop (see main). */
    stutter(s: Stutter) {
      if (current && current.stutters.length < DROP.maxPerSession) current.stutters.push(s);
    },
    async end(): Promise<SessionReport | null> {
      if (!current) return null;
      const r = {
        ...summarize(current.game, current.startedAt, new Date().toISOString(), current.samples),
        stutters: current.stutters,
        temps: tempSeries(current.temps, Date.parse(current.startedAt)),
      };
      current = null;
      const list = [r, ...(await history())].slice(0, KEEP);
      await writeFile(`${file}.tmp`, JSON.stringify(list, null, 2));
      await rename(`${file}.tmp`, file);
      return r;
    },
    history,
  };
}
