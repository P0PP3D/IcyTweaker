// Frametime capture with Intel's PresentMon (MIT, downloaded from its GitHub releases on first use, Intel-signed).
// Read-only: it records frame timing of one running game for a few seconds and writes a CSV in the app data folder.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FrametimeResult } from '../../shared/types';
import type { SystemAdapter } from '../system/adapter';
import { download, verifySignature } from '../system/download';

const RELEASES = 'https://api.github.com/repos/GameTechDev/PresentMon/releases/latest';
const ASSET = /^PresentMon-[\d.]+-x64\.exe$/;

/** The console PresentMon in `toolsDir`, downloading the latest release if there is none. */
export async function ensurePresentMon(adapter: SystemAdapter, toolsDir: string): Promise<string> {
  const have = (await readdir(toolsDir).catch(() => [] as string[])).filter((f) => ASSET.test(f)).sort().at(-1);
  const exe = have ? path.join(toolsDir, have) : null;
  if (exe) {
    await verifySignature(adapter, exe, 'Intel Corporation');
    return exe;
  }
  const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`Could not reach PresentMon's releases (HTTP ${res.status}).`);
  const asset = ((await res.json()) as { assets?: Array<{ name: string; browser_download_url: string }> }).assets?.find((a) => ASSET.test(a.name));
  if (!asset) throw new Error('The latest PresentMon release has no console x64 build.');
  const dest = path.join(toolsDir, asset.name);
  await download(asset.browser_download_url, dest);
  await verifySignature(adapter, dest, 'Intel Corporation');
  return dest;
}

/** Frame times in ms from a PresentMon CSV (--v1_metrics: MsBetweenPresents). */
export function parseFrametimes(csv: string): number[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim().toLowerCase());
  const col = header.findIndex((h) => h === 'msbetweenpresents' || h === 'frametime');
  if (col < 0) throw new Error('PresentMon output has no frame time column.');
  return lines.map((l) => Number(l.split(',')[col])).filter((v) => Number.isFinite(v) && v > 0);
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

export function frametimeStats(process: string, seconds: number, ms: number[]): FrametimeResult {
  if (ms.length === 0) throw new Error(`No frames recorded from ${process}. Is the game in the foreground and rendering?`);
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  // Chart: at most 400 points, each the worst frame of its bucket so spikes stay visible.
  const bucket = Math.ceil(ms.length / 400);
  const points: number[] = [];
  for (let i = 0; i < ms.length; i += bucket) points.push(r1(Math.max(...ms.slice(i, i + bucket))));
  return {
    process,
    seconds,
    frames: ms.length,
    avgFps: r1(1000 / mean),
    low1: r1(1000 / pct(sorted, 99)),
    low01: r1(1000 / pct(sorted, 99.9)),
    avgMs: r1(mean),
    maxMs: r1(sorted[sorted.length - 1]),
    points,
  };
}

/** Records `process` for `seconds`. Needs administrator (or the Performance Log Users group). */
export async function captureFrametimes(adapter: SystemAdapter, exe: string, process: string, seconds: number, csvPath: string): Promise<FrametimeResult> {
  await adapter.query(
    exe,
    ['--process_name', process, '--output_file', csvPath, '--timed', String(seconds), '--terminate_after_timed', '--stop_existing_session', '--no_console_stats', '--v1_metrics', '--session_name', 'IcyCleanerCapture'],
    (seconds + 30) * 1000,
  );
  if (!existsSync(csvPath)) throw new Error('PresentMon wrote no output. Run IcyCleaner as administrator and try again.');
  return frametimeStats(process, seconds, parseFrametimes(await readFile(csvPath, 'utf8')));
}
