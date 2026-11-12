import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, BootInfo, StartupItemView } from '../../shared/types';
import { Badge, Button, Tabs, Toggle, TweakRow, type Ask } from '../ui';
import { tweakHandlers, type Act } from './General';

const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** Boot analysis: Windows' own boot timing and the apps it saw slowing startup. */
function BootTimes({ res }: { res: { info?: BootInfo; error?: string } | null }) {
  const b = res?.info;
  return (
    <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-slate-100">Boot time</span>
        {b && <span className="text-xs text-slate-500">Last start {new Date(b.lastBoot).toLocaleString()}</span>}
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {!res ? (
        <p className="text-sm text-slate-400">Reading boot history…</p>
      ) : b && b.lastBootMs !== null ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Last boot', sec(b.lastBootMs)],
                ['Average (last 10)', sec(b.averageBootMs)],
                ['To the desktop', sec(b.lastMainMs)],
                ['Startup apps after', sec(b.lastPostMs)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-2">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="font-semibold text-slate-100">{v}</div>
              </div>
            ))}
          </div>
          {b.slowApps.length > 0 && (
            <div className="text-sm">
              <div className="text-slate-400">Windows saw these slow down startup:</div>
              <ul className="mt-1 space-y-0.5">
                {b.slowApps.map((a) => (
                  <li key={a.name} className="flex justify-between text-slate-300">
                    <span className="truncate">{a.name}</span>
                    <span className="text-amber-300">+{sec(a.degradationMs)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400">{b?.note}</p>
      )}
    </div>
  );
}

function StartupItems({ busy, act }: { busy: boolean; act: Act }) {
  const [res, setRes] = useState<{ items: StartupItemView[]; error?: string } | null>(null);
  const load = useCallback(async () => setRes(await window.api.listStartup()), []);
  useEffect(() => void load(), [load]);
  const [boot, setBoot] = useState<{ info?: BootInfo; error?: string } | null>(null);
  useEffect(() => void window.api.bootInfo().then(setBoot), []);
  /** Windows' own record of how much this app slowed startup (event 101), matched by its program file. */
  const impact = (i: StartupItemView) =>
    boot?.info?.slowApps.find((s) => (s.file && i.command.toLowerCase().includes(s.file.toLowerCase())) || s.name.toLowerCase() === i.name.toLowerCase())?.degradationMs ?? null;
  const items = [...(res?.items ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (impact(b) ?? 0) - (impact(a) ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-2">
      <BootTimes res={boot} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">
          Apps that start when you sign in. Turning one off works like Task Manager's Startup tab: nothing is deleted, and Undo All turns it back on.
        </p>
        <Button disabled={busy} onClick={load}>
          Refresh
        </Button>
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {!res ? (
        <p className="text-sm text-slate-400">Reading startup items…</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{i.name}</span>
                  {i.requiresAdmin && <Badge className="bg-violet-500/15 text-violet-300 ring-violet-500/30">admin</Badge>}
                  {impact(i) !== null && (
                    <span title="Windows recorded this app slowing your startup by this much" className="rounded-md bg-amber-500/10 px-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                      +{sec(impact(i))} at startup
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{i.location}</span>
                </div>
                <p className="truncate font-mono text-xs text-slate-500" title={i.command}>
                  {i.command}
                </p>
              </div>
              <span className={clsx('w-16 text-right text-xs', i.enabled ? 'text-emerald-300' : 'text-slate-500')}>{i.enabled ? 'Starts' : 'Off'}</span>
              <Toggle on={i.enabled} label={`Start ${i.name} with Windows`} disabled={busy} onChange={(v) => act(() => window.api.setStartupItem(i.id, v)).then(load)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AppOptimizer({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [tab, setTab] = useState<'apps' | 'startup'>('apps');
  const apps = state.tweaks.filter((t) => t.page === 'apps');
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">App Optimizer</h2>
        <p className="text-sm text-slate-400">Cuts what apps do in the background while you play. Each original setting is backed up; turning a card off puts it back.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'apps', label: 'Apps', icon: 'app' },
          { id: 'startup', label: 'Startup items', icon: 'restore' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'startup' ? (
        <StartupItems busy={busy} act={act} />
      ) : (
        <ul className="space-y-2">
          {apps.map((t) => (
            <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
          ))}
        </ul>
      )}
    </section>
  );
}
