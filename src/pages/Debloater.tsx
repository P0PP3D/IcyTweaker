import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AppItem, Progress } from '../../shared/types';
import { Badge, Button, MUTED_BADGE, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

type Sort = 'name' | 'size' | 'date' | 'used';

export function Debloater({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [apps, setApps] = useState<AppItem[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [tab, setTab] = useState<'desktop' | 'store' | 'unused'>('desktop');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [icons, setIcons] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    setApps(null);
    const r = await window.api.listApps();
    setApps(r.apps);
    setError(r.error);
    setSelected(new Set());
    void window.api.appIcons().then(setIcons, () => {}); // after the list: icons fill in without holding it up
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => window.api.onProgress((p) => p.task === 'uninstall' && setProgress(p)), []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (apps ?? []).filter((a) => (tab === 'unused' ? a.unused : a.kind === tab) && (!q || `${a.name} ${a.publisher ?? ''}`.toLowerCase().includes(q)));
    const by: Record<Sort, (a: AppItem, b: AppItem) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
      date: (a, b) => (b.installDate ?? '').localeCompare(a.installDate ?? ''),
      used: (a, b) => (a.lastUsed ?? '9999').localeCompare(b.lastUsed ?? '9999'), // longest unused first
    };
    return list.sort(by[sort]);
  }, [apps, tab, filter, sort]);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const picked = (apps ?? []).filter((a) => selected.has(a.key));

  async function uninstall() {
    const interactive = picked.filter((a) => a.interactive).length;
    const ok = await ask(
      `Uninstall ${picked.length} app(s)?`,
      `${picked.map((a) => `• ${a.name}`).join('\n')}\n\nA restore point is created first, and the list is saved so removed Store apps can be found again.` +
        (interactive ? `\n\n${interactive} app(s) have no silent uninstaller; their own uninstall window will open.` : ''),
      'Uninstall',
    );
    if (!ok) return;
    await act(() => window.api.uninstallApps(picked.map((a) => a.key)));
    setProgress(null);
    await load();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Debloater</h2>
          <p className="text-sm text-slate-400">Drivers, runtimes, the Store and Windows Security are protected and cannot be selected. "Not used" needs Windows' launch records: run as administrator for the most complete list.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !apps} onClick={load}>
            Refresh
          </Button>
          <Button disabled={busy || !apps} onClick={() => setSelected(new Set((apps ?? []).filter((a) => a.suggested && !a.protected).map((a) => a.key)))}>
            Select suggested
          </Button>
          <Button disabled={busy || !apps || !(apps ?? []).some((a) => a.unused)} onClick={() => setSelected(new Set((apps ?? []).filter((a) => a.unused && !a.protected).map((a) => a.key)))}>
            Select unused
          </Button>
          <Button danger disabled={busy || picked.length === 0} onClick={uninstall}>
            Uninstall ({picked.length})
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1">
          {(['desktop', 'store', 'unused'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={clsx('rounded-md px-3 py-1 text-sm', tab === k ? 'bg-sky-500/15 text-sky-200' : 'text-slate-400 hover:bg-white/5')}
            >
              {k === 'desktop' ? 'Desktop apps' : k === 'store' ? 'Store apps' : 'Not used in 6+ months'} ({(apps ?? []).filter((a) => (k === 'unused' ? a.unused : a.kind === k)).length})
            </button>
          ))}
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter apps…"
          aria-label="Filter apps"
          className="ml-auto rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort by"
          className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10"
        >
          <option value="name" className="bg-slate-900">Name</option>
          <option value="size" className="bg-slate-900">Size</option>
          <option value="date" className="bg-slate-900">Install date</option>
          <option value="used" className="bg-slate-900">Least recently used</option>
        </select>
      </div>

      {progress && progress.total > 0 && (
        <div className="space-y-1" role="status">
          <div className="text-sm text-slate-300">
            {progress.done < progress.total ? `Uninstalling ${progress.current}… (${progress.done + 1}/${progress.total})` : 'Finishing…'}
          </div>
          <div className="h-2 overflow-hidden rounded bg-white/10">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${(100 * progress.done) / progress.total}%` }} />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!apps ? (
        <p className="text-sm text-slate-400">Reading installed apps…</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
          {shown.map((a) => (
            <li key={a.key} className={clsx('flex items-start gap-3 px-4 py-2.5', a.protected && 'opacity-60')}>
              <input
                type="checkbox"
                className="mt-2 accent-sky-500"
                aria-label={`Select ${a.name}`}
                disabled={!!a.protected || busy}
                checked={selected.has(a.key)}
                onChange={() => toggle(a.key)}
              />
              {icons[a.key] ? (
                <img src={icons[a.key]!} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" />
              ) : (
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--card-2)] text-xs font-semibold text-slate-400 ring-1 ring-[var(--line)]">
                  {a.name.replace(/^Microsoft\./, '').charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{a.name}</span>
                  {a.protected && <Badge className={MUTED_BADGE}>protected: {a.protected}</Badge>}
                  {a.suggested && !a.protected && <Badge className="bg-sky-500/15 text-sky-300 ring-sky-500/30">suggested</Badge>}
                  {a.interactive && <Badge className={MUTED_BADGE}>opens uninstaller</Badge>}
                  {a.unused && <Badge className="bg-amber-500/15 text-amber-300 ring-amber-500/30">unused 6+ months</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  {a.publisher ?? 'Unknown publisher'} · {a.version ?? 'N/A'}
                  {a.lastUsed && ` · last opened ${new Date(a.lastUsed).toLocaleDateString()}`}
                </div>
                {a.vendorNote && <p className="mt-1 text-xs text-amber-200/90">{a.vendorNote}</p>}
              </div>
              <div className="w-20 text-right text-xs text-slate-400">{formatBytes(a.sizeBytes)}</div>
              <div className="w-24 text-right text-xs text-slate-400">{a.installDate ?? 'Unknown'}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
