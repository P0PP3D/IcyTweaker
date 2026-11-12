import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { FocusInfo, FocusSettings } from '../../shared/types';
import { Icon } from '../icons';
import { Button, Loading, Toggle, ago } from '../ui';
import type { Act } from './General';

type Choice = { exe: string; name: string };

/** Focus Mode: stop non-essential services and close background apps while you play, all back with one click. */
export function Focus({ busy, act }: { busy: boolean; act: Act }) {
  const [info, setInfo] = useState<FocusInfo | null>(null);
  const [apps, setApps] = useState<{ choices: Choice[]; installed: string[] } | null>(null);
  const [switching, setSwitching] = useState(false);
  const load = useCallback(async () => setInfo(await window.api.focusInfo()), []);
  useEffect(() => {
    void load();
    void window.api.focusApps().then(setApps, () => setApps({ choices: [], installed: [] }));
    const t = setInterval(() => void load(), 5000); // the tray can switch it too
    return () => clearInterval(t);
  }, [load]);
  if (!info) return <Loading text="Loading Focus Mode…" />;
  const s = info.settings;
  const active = !!info.state;
  const save = async (patch: Partial<FocusSettings>) => setInfo(await window.api.setFocusSettings({ ...s, ...patch }));
  const toggleIn = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  // Only built-in apps this PC has (installed or running).
  const builtIn = apps ? info.apps.filter((a) => apps.installed.includes(a.exe)) : [];
  const nameOf = (exe: string) => apps?.choices.find((c) => c.exe === exe)?.name ?? info.apps.find((a) => a.exe === exe)?.label;
  const willClose = s.apps.filter((x) => !apps || apps.installed.includes(x)).length + s.custom.length;
  const flip = async () => {
    setSwitching(true);
    try {
      await act(() => window.api.setFocus(!active));
      await load();
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Focus Mode</h2>
        <p className="text-sm text-slate-400">
          An aggressive game mode you switch on and off: non-essential Windows services pause and background apps close, freeing CPU, memory and disk for your game. Turn it off and
          everything comes back. Nothing is disabled for good. Also in the tray menu.
        </p>
      </div>

      <div className={clsx('flex flex-wrap items-center gap-5 rounded-xl p-5 ring-1 transition', active ? 'bg-emerald-500/10 ring-emerald-500/40' : 'bg-[var(--card)] ring-[var(--line)]')}>
        <span className={clsx('relative grid h-14 w-14 place-items-center rounded-2xl ring-1', active ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/50' : 'bg-sky-500/10 text-sky-300 ring-sky-500/30')}>
          {switching && <span className="absolute inset-0 animate-spin rounded-2xl border-2 border-transparent border-t-sky-400" aria-hidden />}
          <Icon name="bolt" className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-slate-50">{switching ? (active ? 'Turning Focus Mode off…' : 'Turning Focus Mode on…') : active ? 'Focus Mode is on' : 'Focus Mode is off'}</div>
          <p className="text-sm text-slate-400">
            {switching
              ? active
                ? 'Starting services again and reopening apps.'
                : 'Pausing services and closing apps (each gets up to 3 seconds to close by itself).'
              : active
                ? `Since ${ago(info.state!.since)}: ${info.state!.services.length} service(s) paused, ${info.state!.apps.length} app(s) closed.`
                : `Will pause ${s.services.length} service(s) and close ${willClose} kind(s) of app if they're running.`}
          </p>
        </div>
        <Button primary={!active} danger={active} disabled={busy || switching} onClick={() => void flip()}>
          {active ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
          <div className="font-medium text-slate-100">Services to pause</div>
          <p className="mb-2 text-xs text-slate-500">Only ones that are running get stopped, and only those are started again. Windows-critical services are never on this list.</p>
          <ul className="space-y-1.5">
            {info.services.map((x) => (
              <li key={x.name}>
                <label className="flex items-start gap-2 text-sm text-slate-300">
                  <input type="checkbox" className="mt-0.5" checked={s.services.includes(x.name)} disabled={busy || active} onChange={(e) => void save({ services: toggleIn(s.services, x.name, e.target.checked) })} />
                  <span>
                    <span className="text-slate-100">{x.label}</span>
                    <span className="block text-xs text-slate-500">{x.note}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
            <div className="font-medium text-slate-100">Apps to close</div>
            <p className="mb-2 text-xs text-slate-500">Each is asked to close first (like clicking X), and ended only if it's still open after 3 seconds.</p>
            {!apps ? (
              <Loading text="Finding your apps…" />
            ) : builtIn.length ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {builtIn.map((a) => (
                  <label key={a.exe} className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={s.apps.includes(a.exe)} disabled={busy || active} onChange={(e) => void save({ apps: toggleIn(s.apps, a.exe, e.target.checked) })} />
                    {a.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">None of the usual background apps are on this PC. Add your own below.</p>
            )}
            <AppList
              title="Your own apps"
              list={s.custom}
              choices={apps?.choices}
              nameOf={nameOf}
              disabled={busy || active}
              onAdd={(exe) => void save({ custom: [...s.custom, exe] })}
              onRemove={(x) => void save({ custom: s.custom.filter((y) => y !== x) })}
            />
          </div>
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
            <div className="font-medium text-slate-100">Exceptions</div>
            <p className="text-xs text-slate-500">Never closed by Focus Mode, even if a list above includes them.</p>
            <AppList
              title=""
              list={s.exceptions}
              choices={apps?.choices}
              nameOf={nameOf}
              disabled={busy || active}
              onAdd={(exe) => void save({ exceptions: [...s.exceptions, exe] })}
              onRemove={(x) => void save({ exceptions: s.exceptions.filter((y) => y !== x) })}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--card)] px-4 py-3 text-sm text-slate-200 ring-1 ring-[var(--line)]">
            <span>
              Turn on with Game Boost
              <span className="block text-xs text-slate-500">On by itself when Game Boost starts a game, off again when the game closes.</span>
            </span>
            <Toggle on={!!s.withBoost} label="Turn on with Game Boost" disabled={busy} onChange={(v) => void save({ withBoost: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--card)] px-4 py-3 text-sm text-slate-200 ring-1 ring-[var(--line)]">
            <span>
              Reopen closed apps when Focus Mode turns off
              <span className="block text-xs text-slate-500">They reopen as normal (not administrator) programs.</span>
            </span>
            <Toggle on={s.reopen} label="Reopen closed apps" disabled={busy} onChange={(v) => void save({ reopen: v })} />
          </label>
        </div>
      </div>
      {active && <p className="text-xs text-slate-500">Turn Focus Mode off to change the lists.</p>}
    </section>
  );
}

/** Chosen apps as chips, plus a searchable drop-down of the user's apps (by name or exe). */
function AppList(p: { title: string; list: string[]; choices?: Choice[]; nameOf: (exe: string) => string | undefined; disabled: boolean; onAdd: (exe: string) => void; onRemove: (x: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (p.choices ?? []).filter((c) => !p.list.includes(c.exe) && (!t || c.name.toLowerCase().includes(t) || c.exe.includes(t)));
  }, [q, p.choices, p.list]);
  const add = (exe: string) => {
    p.onAdd(exe);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="mt-3 space-y-2">
      {p.title && <div className="text-sm text-slate-300">{p.title}</div>}
      {p.list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {p.list.map((x) => (
            <span key={x} title={x} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-200 ring-1 ring-white/10">
              {p.nameOf(x) ?? x}
              <button type="button" aria-label={`Remove ${x}`} disabled={p.disabled} onClick={() => p.onRemove(x)} className="text-slate-500 hover:text-rose-300 disabled:opacity-40">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div ref={box} className="relative">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && shown[0]) add(shown[0].exe);
          }}
          placeholder="Search your apps…"
          disabled={p.disabled}
          aria-label="Search your apps"
          className="w-full rounded-md bg-white/5 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        {open && !p.disabled && (
          <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-[var(--panel)] py-1 shadow-xl ring-1 ring-[var(--line)]">
            {!p.choices ? (
              <li className="px-3 py-2">
                <Loading text="Finding your apps…" />
              </li>
            ) : shown.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">No apps match "{q}".</li>
            ) : (
              shown.slice(0, 100).map((c) => (
                <li key={c.exe} role="option" aria-selected={false}>
                  <button type="button" onClick={() => add(c.exe)} className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-white/5">
                    <span className="truncate text-slate-100">{c.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{c.exe}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
