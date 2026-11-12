// Quick benchmark: a short, local before/after measure. CPU (SHA-256 on one core, then on every core), memory copy
// speed, and disk write/read speed with a 256 MB file in the app's own data folder (deleted afterwards). Nothing is
// downloaded or sent. Results are kept in benchmarks.json (last 20) so a run after tweaks can be compared.
import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { BenchResult } from '../../shared/types';

const CPU_MS = 2000;
const MEM_MS = 1500;
const DISK_BYTES = 256 * 1024 * 1024;
const KEEP = 20;

// MB of SHA-256 per second for workerData ms, as worker source (workers can't import from the bundle).
const WORKER = `
const { createHash, randomBytes } = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const block = randomBytes(1 << 20);
const end = performance.now() + workerData;
let mb = 0;
while (performance.now() < end) { createHash('sha256').update(block).digest(); mb++; }
parentPort.postMessage(mb / (workerData / 1000));
`;

// GB per second copying a 64 MB buffer (in a worker too, so the app never freezes).
const MEM_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const a = Buffer.alloc(64 << 20, 1), b = Buffer.alloc(64 << 20);
const end = performance.now() + workerData;
let bytes = 0;
while (performance.now() < end) { a.copy(b); bytes += a.length; }
parentPort.postMessage(bytes / (workerData / 1000) / 1024 ** 3);
`;

const inWorker = (src: string, ms: number) =>
  new Promise<number>((resolve, reject) => new Worker(src, { eval: true, workerData: ms }).once('message', resolve).once('error', reject));

/** Sum of every core's hash rate (one worker per logical core, all at once). */
async function allCores(ms: number): Promise<number> {
  const n = Math.max(1, os.cpus().length);
  const rates = await Promise.all(Array.from({ length: n }, () => inWorker(WORKER, ms)));
  return rates.reduce((a, b) => a + b, 0);
}

/** MB/s writing (flushed to disk) and reading back DISK_BYTES. The read may partly come from Windows' cache. */
async function diskRate(dir: string): Promise<{ write: number; read: number }> {
  const file = path.join(dir, 'bench.tmp');
  const chunk = randomBytes(8 << 20);
  try {
    const fh = await open(file, 'w');
    let t = performance.now();
    for (let done = 0; done < DISK_BYTES; done += chunk.length) await fh.write(chunk);
    await fh.sync();
    await fh.close();
    const write = DISK_BYTES / 1024 ** 2 / ((performance.now() - t) / 1000);
    t = performance.now();
    await readFile(file);
    const read = DISK_BYTES / 1024 ** 2 / ((performance.now() - t) / 1000);
    return { write, read };
  } finally {
    await rm(file, { force: true });
  }
}

export async function runBenchmark(dataDir: string, onStep: (step: string, done: number) => void): Promise<BenchResult> {
  onStep('CPU, one core', 0);
  const single = await inWorker(WORKER, CPU_MS);
  onStep('CPU, all cores', 1);
  const multi = await allCores(CPU_MS);
  onStep('Memory', 2);
  const mem = await inWorker(MEM_WORKER, MEM_MS);
  onStep('Disk', 3);
  const disk = await diskRate(dataDir);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { at: new Date().toISOString(), cpuSingle: r(single), cpuMulti: r(multi), memory: r(mem), diskWrite: r(disk.write), diskRead: r(disk.read) };
}

export function createBenchHistory(file: string) {
  const list = async (): Promise<BenchResult[]> => readFile(file, 'utf8').then((t) => JSON.parse(t) as BenchResult[], () => []);
  return {
    list,
    async add(r: BenchResult) {
      const next = [r, ...(await list())].slice(0, KEEP);
      await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${file}.tmp`, file);
      return next;
    },
  };
}
