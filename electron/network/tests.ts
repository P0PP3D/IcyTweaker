// Latency test and DNS benchmark. These are the app's only network calls: they run only when the user
// presses a button, and contact only the servers listed (or the host the user typed). Nothing is uploaded.
import { Resolver } from 'node:dns/promises';
import { Socket } from 'node:net';
import type { DnsBenchResult, LatencyResult } from '../../shared/types';

/** Well-known anycast endpoints; TCP 443 answers on all of them. */
export const LATENCY_TARGETS = [
  { host: '1.1.1.1', name: 'Cloudflare' },
  { host: '8.8.8.8', name: 'Google' },
  { host: '9.9.9.9', name: 'Quad9' },
];
/** Popular gaming domains, resolved fresh per server. */
export const BENCH_DOMAINS = ['steampowered.com', 'epicgames.com', 'riotgames.com', 'roblox.com', 'discord.com', 'ea.com', 'battle.net', 'xbox.com'];

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const validHost = (h: string) => HOST.test(h) || IPV4.test(h);

/** One TCP handshake time in ms, or null on timeout / refusal. */
export type Probe = (host: string, port: number, timeoutMs: number) => Promise<number | null>;
export const tcpProbe: Probe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const s = new Socket();
    const t0 = performance.now();
    const done = (v: number | null) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(null));
    s.once('error', () => done(null));
    s.connect(port, host, () => done(performance.now() - t0));
  });

export function summarizeLatency(host: string, name: string, samples: Array<number | null>): LatencyResult {
  const ok = samples.filter((x): x is number => x !== null);
  const r = (n: number) => Math.round(n * 10) / 10;
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  // Jitter: mean difference between consecutive successful samples.
  const jitter = ok.length > 1 ? ok.slice(1).reduce((a, b, i) => a + Math.abs(b - ok[i]), 0) / (ok.length - 1) : null;
  return {
    host,
    name,
    min: ok.length ? r(Math.min(...ok)) : null,
    avg: avg === null ? null : r(avg),
    jitter: jitter === null ? null : r(jitter),
    loss: Math.round(((samples.length - ok.length) / samples.length) * 100),
  };
}

export async function latencyTest(targets: Array<{ host: string; name: string }>, probe: Probe = tcpProbe, count = 8): Promise<LatencyResult[]> {
  const out: LatencyResult[] = [];
  for (const t of targets) {
    const samples: Array<number | null> = [];
    for (let i = 0; i < count; i++) samples.push(await probe(t.host, 443, 2000));
    out.push(summarizeLatency(t.host, t.name, samples));
  }
  return out;
}

/** Time to resolve one name through one server, or null on failure. */
export type Lookup = (server: string, domain: string) => Promise<number | null>;
export const dnsLookup: Lookup = async (server, domain) => {
  const r = new Resolver({ timeout: 2000, tries: 1 });
  r.setServers([server]);
  const t0 = performance.now();
  try {
    await r.resolve4(domain);
    return performance.now() - t0;
  } catch {
    return null;
  }
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Each preset's first server resolves every domain once. Sorted fastest first; failures count against it. */
export async function dnsBenchmark(servers: Array<{ id: string; name: string; ip: string }>, lookup: Lookup = dnsLookup, domains = BENCH_DOMAINS): Promise<DnsBenchResult[]> {
  const out: DnsBenchResult[] = [];
  for (const s of servers) {
    const times = await Promise.all(domains.map((d) => lookup(s.ip, d)));
    const ok = times.filter((x): x is number => x !== null);
    out.push({ id: s.id, name: s.name, ip: s.ip, median: ok.length ? Math.round(median(ok) * 10) / 10 : null, failed: times.length - ok.length });
  }
  return out.sort((a, b) => (a.failed - b.failed) || ((a.median ?? Infinity) - (b.median ?? Infinity)));
}
