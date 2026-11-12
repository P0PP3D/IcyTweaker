import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, DnsBenchResult, DnsPreset, HostsError, LatencyResult, NetAdapterView } from '../../shared/types';
import { Button, TweakRow, type Ask, Loading } from '../ui';
import { FixCard } from './Fixes';
import { tweakHandlers, type Act } from './General';

function Dns({ busy, act }: { busy: boolean; act: Act }) {
  const [info, setInfo] = useState<{ adapters: NetAdapterView[]; presets: DnsPreset[]; error?: string } | null>(null);
  const load = useCallback(async () => setInfo(await window.api.networkInfo()), []);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">DNS</h3>
      {info?.error && <p className="text-sm text-rose-300">{info.error}</p>}
      {!info ? (
        <Loading text="Reading network adapters…" />
      ) : info.adapters.length === 0 ? (
        <p className="text-sm text-slate-400">No connected network adapter.</p>
      ) : (
        info.adapters.map((a) => (
          <div key={a.guid} className="space-y-3 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-medium text-slate-100">{a.name}</span> <span className="text-sm text-slate-400">{a.description}</span>
              </div>
              <span className="text-xs text-slate-500">
                {a.speed} · DNS: {a.dns === 'dhcp' ? 'automatic' : (a.dns ?? 'unknown')}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {info.presets.map((p) => (
                <button
                  key={p.id}
                  disabled={busy || a.preset === p.id}
                  onClick={() => act(() => window.api.setDns(a.guid, p.id)).then(load)}
                  aria-pressed={a.preset === p.id}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-left text-sm ring-1 transition',
                    a.preset === p.id ? 'bg-sky-500/20 text-sky-100 ring-sky-500/50' : 'bg-white/5 text-slate-200 ring-white/10 hover:bg-white/10 disabled:opacity-40',
                  )}
                >
                  <div>{p.name}</div>
                  <div className="font-mono text-xs text-slate-400">{p.servers === 'dhcp' ? 'DHCP' : p.servers.replace(',', ', ')}</div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      <p className="text-xs text-slate-500">IPv4 only, on the adapter shown. The previous DNS setting is backed up; Undo All restores it.</p>
      <DnsBench busy={busy} act={act} adapter={info?.adapters[0]} reload={load} />
    </div>
  );
}

const ms = (n: number | null) => (n === null ? '—' : `${n} ms`);

function DnsBench({ busy, act, adapter, reload }: { busy: boolean; act: Act; adapter?: NetAdapterView; reload: () => Promise<void> }) {
  const [res, setRes] = useState<{ results: DnsBenchResult[]; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const best = res?.results[0];
  return (
    <div className="space-y-2 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-slate-100">DNS benchmark</div>
          <p className="text-sm text-slate-400">Times each DNS service resolving popular gaming sites from your connection. Contacts only those DNS servers.</p>
        </div>
        <Button
          disabled={busy || running}
          onClick={async () => {
            setRunning(true);
            setRes(await window.api.dnsBenchmark());
            setRunning(false);
          }}
        >
          {running ? 'Testing…' : 'Run benchmark'}
        </Button>
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {res && res.results.length > 0 && (
        <>
          <ul className="space-y-1 text-sm">
            {res.results.map((r, i) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className={i === 0 ? 'text-emerald-300' : 'text-slate-200'}>
                  {r.name} <span className="font-mono text-xs text-slate-500">{r.ip}</span>
                </span>
                <span className="text-slate-400">
                  {ms(r.median)}
                  {r.failed > 0 && <span className="text-rose-300"> · {r.failed} failed</span>}
                </span>
              </li>
            ))}
          </ul>
          {best && best.median !== null && adapter && (
            <Button disabled={busy || adapter.preset === best.id} onClick={() => act(() => window.api.setDns(adapter.guid, best.id)).then(reload)}>
              {adapter.preset === best.id ? `${adapter.name} already uses ${best.name}` : `Use ${best.name} on ${adapter.name}`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Latency({ busy }: { busy: boolean }) {
  const [host, setHost] = useState('');
  const [res, setRes] = useState<{ results: LatencyResult[]; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Latency test</h3>
      <div className="space-y-2 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
        <p className="text-sm text-slate-400">Measures connection time (8 tries) to Cloudflare, Google and Quad9, or to a server you enter. Contacts only those hosts.</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="Optional: host or IP"
            aria-label="Host to test"
            className="rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
          />
          <Button
            disabled={busy || running}
            onClick={async () => {
              setRunning(true);
              setRes(await window.api.latencyTest(host.trim() || undefined));
              setRunning(false);
            }}
          >
            {running ? 'Testing…' : 'Run test'}
          </Button>
        </div>
        {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
        {res && res.results.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="font-normal">Server</th>
                <th className="font-normal">Best</th>
                <th className="font-normal">Average</th>
                <th className="font-normal">Jitter</th>
                <th className="font-normal">Loss</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {res.results.map((r) => (
                <tr key={r.host}>
                  <td>
                    {r.name} {r.name !== r.host && <span className="font-mono text-xs text-slate-500">{r.host}</span>}
                  </td>
                  <td>{ms(r.min)}</td>
                  <td>{ms(r.avg)}</td>
                  <td>{ms(r.jitter)}</td>
                  <td className={r.loss ? 'text-rose-300' : ''}>{r.loss}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function HostsEditor({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [content, setContent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [errors, setErrors] = useState<HostsError[]>([]);
  const load = useCallback(async () => {
    const r = await window.api.getHosts();
    setContent(r.content ?? '');
    setLoaded(r.content ?? '');
    setErrors([]);
  }, []);
  useEffect(() => void load(), [load]);
  const dirty = content !== loaded;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Hosts file</h3>
        <div className="flex gap-2">
          <Button disabled={busy || !dirty} onClick={load}>
            Discard changes
          </Button>
          <Button
            primary
            disabled={busy || !dirty}
            onClick={async () => {
              if (!(await ask('Save the hosts file?', 'Sites listed here resolve to the address you give them. The original file is backed up before the first save.', 'Save'))) return;
              await act(async () => {
                const r = await window.api.saveHosts(content ?? '');
                setErrors(r.errors);
                if (r.report.ok) setLoaded(content);
                return r.report;
              });
            }}
          >
            Save
          </Button>
        </div>
      </div>
      <textarea
        value={content ?? ''}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        aria-label="Hosts file"
        className="h-64 w-full rounded-lg bg-black/30 p-3 font-mono text-xs text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500/50"
      />
      {errors.length > 0 && (
        <ul className="space-y-0.5 text-sm text-rose-300">
          {errors.map((e) => (
            <li key={e.line}>
              Line {e.line}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Network({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Networking</h2>
        <p className="text-sm text-slate-400">TCP settings, DNS, reset tools and the hosts file. Only the latency test and DNS benchmark contact the internet, and only when you start them.</p>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">TCP and stack</h3>
        <ul className="space-y-2">
          {state.tweaks
            .filter((t) => t.page === 'network' && !(t.id.startsWith('nic-') && t.status === 'unavailable')) // adapter cards only for settings that adapter has
            .map((t) => (
              <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
            ))}
        </ul>
      </div>
      <Dns busy={busy} act={act} />
      <Latency busy={busy} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Reset tools</h3>
        <ul className="grid grid-cols-2 gap-3">
          {state.fixes
            .filter((f) => f.page === 'network' || f.id === 'network-reset')
            .map((f) => (
              <FixCard key={f.id} f={f} busy={busy} act={act} ask={ask} />
            ))}
        </ul>
      </div>
      <HostsEditor busy={busy} act={act} ask={ask} />
    </section>
  );
}
