import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AppState, ServiceInfo, ServiceLevel, ServiceStartType, TweakStatus } from '../../shared/types';
import { Badge, Button, MUTED_BADGE, Tabs, TweakRow, type Ask, Loading } from '../ui';
import { tweakHandlers, type Act } from './General';

const LEVELS: Array<{ id: ServiceLevel; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'Windows defaults: puts back every service the app changed.' },
  { id: 'minimum', label: 'Minimum', hint: 'Telemetry, diagnostics tracking, retail demo, and Xbox services if the Xbox app is not installed. Nothing you would notice.' },
  { id: 'medium', label: 'Medium', hint: 'Adds printing, Bluetooth, remote access, sensors, local discovery and sharing. Shows what stops working first.' },
  { id: 'extreme', label: 'Extreme', hint: 'Adds search indexing, Windows Update and Store installs. Needs typed confirmation.' },
];

/** Services wording: a sub-group switch that is "applied" has its services disabled. */
const SERVICE_STATUS: Record<TweakStatus, string> = {
  applied: 'Disabled',
  not_applied: 'Enabled',
  partial: 'Partially enabled',
  unknown: 'Unknown',
  unavailable: 'N/A',
};

const START_TYPES: Array<[ServiceStartType, string]> = [
  ['auto', 'Automatic'],
  ['delayed-auto', 'Automatic (delayed)'],
  ['demand', 'Manual'],
  ['disabled', 'Disabled'],
];

function LevelSelector({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [cur, setCur] = useState<{ level: ServiceLevel; custom: boolean; xboxInUse: boolean } | null>(null);
  const load = useCallback(async () => setCur(await window.api.servicesLevel()), []);
  useEffect(() => void load(), [load]);

  async function choose(level: ServiceLevel) {
    let p;
    try {
      p = await window.api.previewServiceLevel(level);
    } catch (e) {
      await act(async () => ({ ok: false, message: `Could not check this level: ${(e as Error).message}` })); // no silent failures
      return;
    }
    const lines = [
      p.disable.length ? `Turns off ${p.disable.length} service(s):` : 'Turns off nothing new.',
      ...p.disable.map((d) => `• ${d.displayName}${d.running ? ' (running)' : ''}: ${d.breaks}`),
      ...(p.restore.length ? ['', `Puts back ${p.restore.length} service(s) the app turned off earlier: ${p.restore.join(', ')}.`] : []),
      ...(p.dependents.length ? ['', 'These depend on a service being turned off and will stop working too:', ...p.dependents.map((d) => `• ${d.dependent} (needs ${d.service})`)] : []),
      ...(level === 'minimum' && p.xboxInUse ? ['', 'The Xbox app is installed, so Xbox services stay on (they move to Medium).'] : []),
      '',
      'A restore point is created first.',
    ];
    const label = LEVELS.find((l) => l.id === level)!.label;
    const ok = await ask(`Set services to ${label}?`, lines.join('\n'), `Apply ${label}`, level === 'extreme' ? 'EXTREME' : undefined);
    if (!ok) return;
    await act(() => window.api.setServiceLevel(level, true));
    await load();
  }

  return (
    <div className="space-y-2 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Level</h3>
        {cur?.custom && <span className="text-xs text-amber-300">Custom: some services above this level are also off.</span>}
      </div>
      <div role="radiogroup" aria-label="Services level" className="grid grid-cols-4 gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={cur?.level === l.id}
            disabled={busy || !cur}
            onClick={() => choose(l.id)}
            className={clsx(
              'rounded-lg px-3 py-2 text-left ring-1 transition disabled:opacity-50',
              cur?.level === l.id ? 'bg-sky-500/20 text-sky-100 ring-sky-500/50' : 'bg-[var(--card)] text-slate-300 ring-white/10 hover:bg-white/10',
              l.id === 'extreme' && 'hover:ring-rose-500/50',
            )}
          >
            <div className="text-sm font-semibold">{l.label}</div>
            <div className="text-xs text-slate-400">{l.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceManager({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [list, setList] = useState<{ services: ServiceInfo[]; error?: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState<'all' | 'running' | 'disabled'>('all');
  const load = useCallback(async () => setList(await window.api.listServices()), []);
  useEffect(() => void load(), [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list?.services ?? [])
      .filter((s) => (show === 'running' ? s.state === 'Running' : show === 'disabled' ? s.startType === 'disabled' : true))
      .filter((s) => !q || `${s.name} ${s.displayName} ${s.description}`.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [list, filter, show]);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => act(fn).then(load);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search services…"
          aria-label="Search services"
          className="rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
          <option value="all" className="bg-slate-900">All</option>
          <option value="running" className="bg-slate-900">Running</option>
          <option value="disabled" className="bg-slate-900">Disabled</option>
        </select>
        <span className="text-xs text-slate-500">{shown.length} service(s)</span>
        <div className="ml-auto">
          <Button disabled={busy} onClick={load}>
            Refresh
          </Button>
        </div>
      </div>
      {list?.error && <p className="text-sm text-rose-300">{list.error}</p>}
      {!list ? (
        <Loading text="Reading services…" />
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
          {shown.map((s) => {
            const readOnly = s.perUser;
            return (
              <li key={s.name} className="flex items-start gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{s.displayName}</span>
                    <span className="font-mono text-xs text-slate-500">{s.name}</span>
                    {s.protected && <Badge className={MUTED_BADGE}>protected</Badge>}
                    {s.perUser && <Badge className={MUTED_BADGE}>per-user</Badge>}
                    {s.dependents.length > 0 && <span className="text-xs text-slate-500">{s.dependents.length} depend on it</span>}
                  </div>
                  {s.description && <p className="line-clamp-2 text-xs text-slate-400" title={s.description}>{s.description}</p>}
                </div>
                <span className={clsx('w-16 pt-0.5 text-right text-xs', s.state === 'Running' ? 'text-emerald-300' : 'text-slate-500')}>{s.state}</span>
                <select
                  value={s.startType}
                  disabled={busy || readOnly || s.startType === 'boot' || s.startType === 'system'}
                  aria-label={`Start type of ${s.displayName}`}
                  onChange={async (e) => {
                    const type = e.target.value as ServiceStartType;
                    if (type === 'disabled' && s.dependents.length) {
                      const ok = await ask(`Disable ${s.displayName}?`, `These services need it and will stop working too:\n${s.dependents.map((d) => `• ${d}`).join('\n')}`, 'Disable');
                      if (!ok) return;
                    }
                    await run(() => window.api.setServiceStartType(s.name, type));
                  }}
                  className="w-44 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 disabled:opacity-50"
                >
                  {START_TYPES.map(([v, label]) => (
                    <option key={v} value={v} className="bg-slate-900" disabled={!!s.protected && (v === 'disabled' || v === 'demand')}>
                      {label}
                    </option>
                  ))}
                  {(s.startType === 'boot' || s.startType === 'system') && <option value={s.startType}>{s.startType}</option>}
                </select>
                <Button
                  disabled={busy || readOnly || (s.state === 'Running' && !!s.protected) || s.startType === 'disabled'}
                  onClick={() => run(() => window.api.controlService(s.name, s.state === 'Running' ? 'stop' : 'start'))}
                >
                  {s.state === 'Running' ? 'Stop' : 'Start'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Services({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [tab, setTab] = useState<'groups' | 'manager'>('groups');
  const tweaks = state.tweaks.filter((t) => t.page === 'services');
  const groups = [...new Set(tweaks.map((t) => t.group ?? ''))];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Services</h2>
        <p className="text-sm text-slate-400">
          Turn off Windows services you don't use. Each service's original start type is backed up before the first change; turning a group back on, the Off level, or Undo All restores it.
        </p>
      </div>
      <Tabs
        tabs={[
          { id: 'groups', label: 'Groups & levels', icon: 'layers' },
          { id: 'manager', label: 'Service manager', icon: 'services' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'manager' ? (
        <ServiceManager busy={busy} act={act} ask={ask} />
      ) : (
        <>
          <LevelSelector busy={busy} act={act} ask={ask} />
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((g) => (
              <div key={g} className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{g}</h3>
                <ul className="space-y-2">
                  {tweaks
                    .filter((t) => t.group === g)
                    .map((t) => (
                      <TweakRow key={t.id} t={t} busy={busy} statusText={SERVICE_STATUS} {...tweakHandlers(t, act, ask)} />
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
