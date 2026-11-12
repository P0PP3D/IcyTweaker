// Latency check: how much CPU time drivers spend in interrupts (ISR) and deferred procedure calls (DPC), the
// usual cause of stutter and audio crackle. Read-only performance counters, sampled once a second per core.
// The counter check says whether to look; traceDrivers (below, Windows Performance Toolkit) names the driver.
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DriverLatency, LatencyCheck } from '../../shared/types';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

export const latencyScript = (seconds: number) =>
  // "Processor Information" exists on every current Windows; the older "Processor" set is missing on some PCs.
  `$s = Get-Counter '\\Processor Information(*)\\% DPC Time','\\Processor Information(*)\\% Interrupt Time' -SampleInterval 1 -MaxSamples ${seconds} -ErrorAction Stop; ` +
  "$s | ForEach-Object { $_.CounterSamples | Where-Object { $_.InstanceName -notmatch '_total' } | ForEach-Object { '{0}|{1}|{2}' -f ($(if ($_.Path -match 'dpc time') { 'dpc' } else { 'isr' })), $_.InstanceName, [math]::Round($_.CookedValue, 3) } }";

/** Lines of kind|core|percent -> averages, per-core worst and a verdict. */
export function summarizeLatency(out: string): LatencyCheck {
  const rows = out
    .split(/\r?\n/)
    .map((l) => l.trim().split('|'))
    .filter((p) => p.length === 3 && (p[0] === 'dpc' || p[0] === 'isr') && Number.isFinite(Number(p[2])))
    .map(([kind, core, v]) => ({ kind, core, v: Number(v) }));
  if (!rows.length) throw new Error('No counter data (on non-English Windows the counter names differ).');
  const stat = (kind: string) => {
    const xs = rows.filter((r) => r.kind === kind);
    const avg = xs.reduce((a, r) => a + r.v, 0) / Math.max(xs.length, 1);
    const worst = xs.reduce((m, r) => (r.v > m.v ? r : m), { core: '', v: 0 });
    return { avg: Math.round(avg * 100) / 100, peak: Math.round(worst.v * 100) / 100, core: worst.core };
  };
  const dpc = stat('dpc');
  const isr = stat('isr');
  // Rough guide: a healthy desktop averages well under 1% across cores; the core that takes most interrupts
  // commonly peaks at a few percent (6% seen on the dev PC at idle). verify: thresholds tuned on one PC only.
  const peak = Math.max(dpc.peak, isr.peak);
  const avg = Math.max(dpc.avg, isr.avg);
  const verdict = peak >= 25 || avg >= 3 ? 'bad' : peak >= 10 || avg >= 1 ? 'check' : 'good';
  return {
    dpc,
    isr,
    verdict,
    advice:
      verdict === 'good'
        ? 'Drivers are spending very little time in interrupts. Stutter, if any, is not coming from here.'
        : `One or more drivers are using a lot of interrupt time (peak ${peak}% on core ${dpc.peak >= isr.peak ? dpc.core : isr.core}). Usual causes: network (Wi-Fi especially), audio, GPU, storage and USB drivers. Update or reinstall those first; to name the exact driver, run LatencyMon.`,
  };
}

// ---- Naming the driver: a short kernel trace with Microsoft's Windows Performance Toolkit (xperf), then its
// own DPC/ISR report. The toolkit is part of the Windows ADK; installed through winget with only that feature.

export const XPERF = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'Windows Performance Toolkit', 'xperf.exe');

export const WPT_INSTALL_ARGS = [
  'install',
  '--id',
  'Microsoft.WindowsADK',
  '--exact',
  '--silent',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity',
  '--override',
  '/quiet /norestart /features OptionId.WindowsPerformanceToolkit',
];

/**
 * xperf -a dpcisr report -> per driver: how many DPCs/ISRs and the longest one (upper bound of the highest
 * non-empty "Elapsed Time" bucket). Worst first.
 * verify: report layout ("Total = N for module X" then "Elapsed Time, > a usecs AND <= b usecs, count" rows)
 * from xperf documentation; not run on the dev PC (needs administrator and the toolkit).
 */
export function parseDpcIsr(text: string): DriverLatency[] {
  const out = new Map<string, DriverLatency>();
  let kind: 'DPC' | 'ISR' = 'DPC';
  let current: DriverLatency | null = null;
  for (const line of text.split(/\r?\n/)) {
    const sec = /\b(DPC|ISR)\b/i.exec(line);
    if (sec && /info|distribution|histogram/i.test(line)) kind = sec[1].toUpperCase() as 'DPC' | 'ISR';
    const total = /Total\s*=\s*(\d+)\s+for module\s+(\S+)/i.exec(line);
    if (total) {
      const key = `${kind}|${total[2].toLowerCase()}`;
      current = out.get(key) ?? { module: total[2], kind, count: 0, maxUs: 0 };
      current.count += Number(total[1]);
      out.set(key, current);
      continue;
    }
    const bucket = /Elapsed Time,\s*>\s*(\d+)\s*usecs AND <=\s*(\d+)\s*usecs,\s*(\d+)/i.exec(line);
    if (bucket && current && Number(bucket[3]) > 0) current.maxUs = Math.max(current.maxUs, Number(bucket[2]));
  }
  return [...out.values()].filter((d) => d.count > 0).sort((a, b) => b.maxUs - a.maxUs || b.count - a.count);
}

/** Records `seconds` of DPC/ISR activity and reports the drivers. Needs administrator. Read-only for the system. */
export async function traceDrivers(adapter: Pick<SystemAdapter, 'query'>, xperf: string, seconds: number, workDir: string): Promise<DriverLatency[]> {
  const etl = path.join(workDir, 'latency.etl');
  const report = path.join(workDir, 'latency-dpcisr.txt');
  await mkdir(workDir, { recursive: true });
  await adapter.query(xperf, ['-on', 'PROC_THREAD+LOADER+DPC+INTERRUPT'], 30_000);
  try {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  } finally {
    await adapter.query(xperf, ['-d', etl], 120_000); // always stop the kernel logger
  }
  await adapter.query(xperf, ['-i', etl, '-o', report, '-a', 'dpcisr'], 300_000);
  const result = parseDpcIsr(await readFile(report, 'utf8'));
  await rm(etl, { force: true }); // traces are large
  return result;
}

export async function latencyCheck(adapter: Pick<SystemAdapter, 'query'>, seconds = 20): Promise<LatencyCheck> {
  return summarizeLatency(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', latencyScript(seconds)], (seconds + 30) * 1000));
}
