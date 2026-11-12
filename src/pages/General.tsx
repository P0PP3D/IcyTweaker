import { useState } from 'react';
import clsx from 'clsx';
import type { ActionReport, AppState, Category, TweakView } from '../../shared/types';
import { Button, TweakCard, type Ask } from '../ui';
import { Icon, type IconName } from '../icons';

/** Runs an action and shows its result. `undo`, if given, puts an Undo button on the result. */
export type Act = (fn: () => Promise<ActionReport>, undo?: () => Promise<ActionReport>) => Promise<void>;

/** Toggle or adjust a tweak; Risky, unfit and anti-cheat-sensitive ones ask first. Used by this page and by global search. */
export function tweakHandlers(t: TweakView, act: Act, ask: Ask) {
  const set = async (on: boolean, option?: number) => {
    let confirmed = false;
    // Risky tweaks, service groups (which switch off whole features), and tweaks that don't suit this PC or may
    // upset an installed anti-cheat say what they cost first.
    if (on && (t.risk === 'risky' || t.page === 'services' || t.unfit || t.anticheatWarning)) {
      const title = t.page === 'services' ? `${t.name}?` : `Apply ${t.name}?`;
      const notes = [t.warning ?? (t.risk === 'risky' ? 'This tweak is Risky.' : ''), t.unfit, t.anticheatWarning && `Anti-cheat: ${t.anticheatWarning}`].filter(Boolean).join('\n\n');
      confirmed = await ask(title, `${t.description}\n\n${notes}`, t.page === 'services' ? 'Turn off' : 'Apply anyway');
      if (!confirmed) return;
    }
    // Undo goes back to how it was: off, or the previous adjustable value.
    const wasOn = t.status === 'applied';
    const prev = t.currentOption;
    const undo = () => (wasOn ? window.api.setTweak(t.id, true, { confirmed: true, option: t.options && prev != null ? prev : undefined }) : window.api.setTweak(t.id, false));
    await act(() => window.api.setTweak(t.id, on, { confirmed, option }), undo);
  };
  return { onToggle: (on: boolean) => set(on), onOption: (v: number) => set(true, v) };
}

export const appliedCount = (tweaks: TweakView[]) => {
  const counted = tweaks.filter((t) => (t.page ?? 'general') === 'general' && t.supported && t.status !== 'unavailable');
  return `${counted.filter((t) => t.status === 'applied').length}/${counted.length}`;
};

type Tab = Category | 'all' | 'changed';
type Sort = 'default' | 'name' | 'status' | 'risk';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'all', label: 'All Tweaks', icon: 'grid' },
  { id: 'performance', label: 'Performance', icon: 'bolt' },
  { id: 'system', label: 'System', icon: 'sliders' },
  { id: 'graphics', label: 'Graphics', icon: 'sparkles' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'changed', label: 'Changed', icon: 'restore' },
];
const STATUS_ORDER: Record<TweakView['status'], number> = { applied: 0, partial: 1, not_applied: 2, unknown: 3, unavailable: 4 };
const RISK_ORDER: Record<TweakView['risk'], number> = { safe: 0, balanced: 1, risky: 2 };

export function General({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('default');
  const category = tab === 'all' || tab === 'changed' ? undefined : tab;
  const general = state.tweaks.filter((t) => (t.page ?? 'general') === 'general');
  const inTab = general.filter((t) => (tab === 'changed' ? !!t.changedAt : !category || t.category === category));
  const q = query.trim().toLowerCase();
  const shown = inTab
    .filter((t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'status' ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] : sort === 'risk' ? RISK_ORDER[a.risk] - RISK_ORDER[b.risk] : 0,
    );
  const tabs = TABS.filter((x) => x.id === 'all' || x.id === 'changed' || general.some((t) => t.category === x.id)); // hide empty tabs

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-50">General Tweaks</h2>
        <p className="text-sm text-slate-400">Windows settings that trade background work and visual extras for responsiveness. Every one is backed up and can be turned back off.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                tab === x.id ? 'bg-white/[0.07] font-medium text-slate-50 ring-1 ring-white/10' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              <Icon name={x.icon} className="h-4 w-4" />
              {x.label}
              {x.id === 'changed' && <span className="text-xs text-slate-500">{general.filter((t) => t.changedAt).length}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">
            <span className="font-semibold text-slate-100">{appliedCount(inTab)}</span> tweaks applied
          </span>
          <Button primary disabled={busy} onClick={() => act(() => window.api.applyAll(category))}>
            Apply All
          </Button>
          <Button disabled={busy} onClick={() => act(() => window.api.revertAll(category))}>
            Revert All
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 focus-within:border-sky-500/50 sm:max-w-xs">
          <Icon name="search" className="h-4 w-4 text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search General tweaks" className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-sm text-slate-300">
          <Icon name="sort" className="h-4 w-4 text-slate-500" />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="bg-transparent text-sm text-slate-100 focus:outline-none">
            <option value="default">Sort: default</option>
            <option value="name">Sort: name</option>
            <option value="status">Sort: applied first</option>
            <option value="risk">Sort: safest first</option>
          </select>
        </label>
        <span className="hidden text-xs text-slate-500 lg:inline">Apply All skips Risky tweaks and ones not meant for this PC.</span>
        <div className="ml-auto">
          <Button disabled={busy} onClick={() => act(async () => ({ ok: true, message: 'Refreshed from system.' }))}>
            <Icon name="restore" className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-slate-500">{q ? `No tweaks match "${query.trim()}".` : 'Nothing here yet.'}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <TweakCard key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
          ))}
        </ul>
      )}
    </section>
  );
}
