import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OldDriver } from '../../shared/types';
import { Button, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

/** Older versions of drivers that have a newer version installed. Removed ones are exported to driver-backups first. */
export function OldDrivers({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [res, setRes] = useState<{ drivers: OldDriver[]; error?: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    setRes(null);
    const r = await window.api.listOldDrivers();
    setRes(r);
    setPicked(new Set(r.drivers.map((d) => d.published)));
  }, []);
  useEffect(() => void load(), [load]);
  const byMaker = useMemo(() => {
    // One group per maker, however the driver spells its name ("…, Inc." vs "…Inc"); shown with the shortest spelling.
    const key = (p: string) => p.toLowerCase().replace(/[.,']/g, ' ').replace(/\b(inc|corp|corporation|co|ltd|llc|gmbh)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const m = new Map<string, { name: string; list: OldDriver[] }>();
    for (const d of res?.drivers ?? []) {
      const g = m.get(key(d.provider)) ?? { name: d.provider, list: [] };
      if (d.provider.length < g.name.length) g.name = d.provider;
      g.list.push(d);
      m.set(key(d.provider), g);
    }
    return [...m.values()].map((g) => [g.name, g.list] as const).sort((a, b) => a[0].localeCompare(b[0]));
  }, [res]);
  const bytes = (res?.drivers ?? []).filter((d) => picked.has(d.published)).reduce((a, d) => a + (d.bytes ?? 0), 0);
  const toggle = (id: string, on: boolean) => setPicked((s) => (on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id))));

  async function remove() {
    const ok = await ask(
      `Remove ${picked.size} old driver version(s)?`,
      `These are older versions; your devices use the newest one of each. A copy of every removed driver is saved to IcyTweaker's driver-backups folder first, and Windows refuses to remove any driver a device is still using. A restore point is made first.`,
      'Remove',
    );
    if (!ok) return;
    await act(() => window.api.removeOldDrivers([...picked]));
    await load();
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Old Drivers</h2>
        <p className="text-sm text-slate-400">Windows keeps every driver version it ever installed. These are older versions of drivers you have a newer version of; your devices don't use them.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
        <span className="text-sm text-slate-300">
          {res ? (
            <>
              <span className="font-semibold text-slate-100">{res.drivers.length}</span> old version(s) · {picked.size} picked · {formatBytes(bytes)}
            </>
          ) : (
            'Reading the Driver Store…'
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button disabled={busy || !res} onClick={() => void load()}>
            Refresh
          </Button>
          <Button primary disabled={busy || picked.size === 0} onClick={() => void remove()}>
            Remove picked
          </Button>
        </div>
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {res && res.drivers.length === 0 && !res.error && <p className="text-sm text-slate-400">No old driver versions: every driver here is the only (or newest) version.</p>}
      {byMaker.map(([maker, list]) => (
        <div key={maker} className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
          <div className="border-b border-[var(--line)] px-4 py-2 text-sm font-medium text-slate-100">{maker}</div>
          <ul className="divide-y divide-[var(--line)]">
            {list.map((d) => (
              <li key={d.published}>
                <label className="flex items-center gap-3 px-4 py-2 text-sm">
                  <input type="checkbox" checked={picked.has(d.published)} disabled={busy} onChange={(e) => toggle(d.published, e.target.checked)} />
                  <span className="min-w-0 flex-1">
                    <span className="text-slate-100">{d.original}</span>
                    <span className="block text-xs text-slate-500">
                      {d.cls} · version {d.version} · {d.date} · {d.published}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">{d.bytes === null ? 'size unknown' : formatBytes(d.bytes)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
