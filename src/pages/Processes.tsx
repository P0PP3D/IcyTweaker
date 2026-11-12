import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { ProcessHint, ProcessView } from '../../shared/types';
import { Badge, Button, MUTED_BADGE, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

const HINT: Record<ProcessHint, [string, string]> = {
  safe: ['safe to close', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
  caution: ['careful', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
  system: ['Windows', MUTED_BADGE],
  unknown: ['', ''],
};

type Sort = 'cpu' | 'memory' | 'disk' | 'name';

/** Live process list, refreshed every 3 s while the page is open and visible. */
export function Processes({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [list, setList] = useState<ProcessView[] | null>(null);
  const [error, setError] = useState<string>();
  const [sort, setSort] = useState<Sort>('cpu');
  const [filter, setFilter] = useState('');
  const [grouped, setGrouped] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      const r = await window.api.listProcesses();
      if (!alive) return;
      setList(r.processes);
      setError(r.error);
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Grouped: one row per program name (Chrome's 30 processes become one), summed.
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let items = (list ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    if (grouped) {
      const m = new Map<string, ProcessView & { count: number; pids: number[] }>();
      for (const p of items) {
        const g = m.get(p.name.toLowerCase());
        if (g) {
          g.cpu += p.cpu;
          g.memory += p.memory;
          g.disk += p.disk;
          g.count++;
          g.pids.push(p.pid);
        } else m.set(p.name.toLowerCase(), { ...p, count: 1, pids: [p.pid] });
      }
      items = [...m.values()];
    }
    const key: Record<Sort, (p: ProcessView) => number | string> = { cpu: (p) => -p.cpu, memory: (p) => -p.memory, disk: (p) => -p.disk, name: (p) => p.name.toLowerCase() };
    return [...items].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : key[sort](a) > key[sort](b) ? 1 : 0)) as Array<ProcessView & { count?: number; pids?: number[] }>;
  }, [list, filter, sort, grouped]);

  async function end(p: ProcessView & { count?: number; pids?: number[] }) {
    const pids = p.pids ?? [p.pid];
    const ok = await ask(`End ${p.name}?`, `${pids.length > 1 ? `All ${pids.length} ${p.name} processes end` : `${p.name} ends`} immediately. Unsaved work in it is lost.${p.note ? `\n\n${p.note}` : ''}`, 'End task');
    if (!ok) return;
    await act(async () => {
      let last = { ok: true, message: '' };
      for (const pid of pids) last = await window.api.endProcess(pid);
      return pids.length > 1 && last.ok ? { ok: true, message: `${p.name}: ${pids.length} processes ended.` } : last;
    });
  }

  const head = (id: Sort, label: string, right = true) => (
    <button onClick={() => setSort(id)} className={clsx('text-xs', right && 'text-right', sort === id ? 'font-semibold text-sky-300' : 'text-slate-500 hover:text-slate-300')}>
      {label}
    </button>
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-50">Processes</h2>
        <p className="text-sm text-slate-400">What is running and what it costs, updated every 3 seconds. Windows' own processes can't be ended here.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter processes"
          className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Group by program
        </label>
        {list && <span className="ml-auto text-xs text-slate-500">{list.length} processes</span>}
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!list ? (
        <p className="text-sm text-slate-400">Reading processes…</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_5.5rem] gap-3 border-b border-[var(--line)] px-4 py-2">
            {head('name', 'Name', false)}
            {head('cpu', 'CPU')}
            {head('memory', 'Memory')}
            {head('disk', 'Disk')}
            <span />
          </div>
          <ul className="max-h-[65vh] divide-y divide-white/5 overflow-y-auto">
            {rows.slice(0, 200).map((p) => (
              <li key={p.pids?.join(',') ?? p.pid} className="grid grid-cols-[minmax(0,1fr)_5rem_6rem_6rem_5.5rem] items-center gap-3 px-4 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-slate-100" title={p.note || p.name}>
                    {p.name}
                  </span>
                  {(p.count ?? 1) > 1 && <span className="text-xs text-slate-500">×{p.count}</span>}
                  {HINT[p.hint][0] && <Badge className={HINT[p.hint][1]}>{HINT[p.hint][0]}</Badge>}
                </span>
                <span className={clsx('text-right tabular-nums', p.cpu >= 10 ? 'text-amber-300' : 'text-slate-300')}>{p.cpu.toFixed(1)}%</span>
                <span className="text-right tabular-nums text-slate-300">{formatBytes(p.memory)}</span>
                <span className="text-right tabular-nums text-slate-400">{p.disk > 0 ? `${formatBytes(p.disk)}/s` : '—'}</span>
                <span className="text-right">
                  {p.hint !== 'system' && (
                    <Button disabled={busy} onClick={() => end(p)}>
                      End
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
