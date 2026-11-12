import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { FocusInfo, FocusSettings } from '../../shared/types';
import { Icon } from '../icons';
import { Button, Toggle, ago } from '../ui';
import type { Act } from './General';

/** Focus Mode: stop non-essential services and close background apps while you play, all back with one click. */
export function Focus({ busy, act }: { busy: boolean; act: Act }) {
  const [info, setInfo] = useState<FocusInfo | null>(null);
  const [custom, setCustom] = useState('');
  const [exception, setException] = useState('');
  const load = useCallback(async () => setInfo(await window.api.focusInfo()), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000); // the tray can switch it too
    return () => clearInterval(t);
  }, [load]);
  if (!info) return <p className="text-sm text-slate-400">Loading…</p>;
  const s = info.settings;
  const active = !!info.state;
  const save = async (patch: Partial<FocusSettings>) => setInfo(await window.api.setFocusSettings({ ...s, ...patch }));
  const toggleIn = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const addExe = (raw: string) => {
    const v = raw.trim().toLowerCase();
    return v && !v.endsWith('.exe') ? `${v}.exe` : v;
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
        <span className={clsx('grid h-14 w-14 place-items-center rounded-2xl ring-1', active ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/50' : 'bg-sky-500/10 text-sky-300 ring-sky-500/30')}>
          <Icon name="bolt" className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-slate-50">{active ? 'Focus Mode is on' : 'Focus Mode is off'}</div>
          <p className="text-sm text-slate-400">
            {active
              ? `Since ${ago(info.state!.since)}: ${info.state!.services.length} service(s) paused, ${info.state!.apps.length} app(s) closed.`
              : `Will pause ${s.services.length} service(s) and close ${s.apps.length + s.custom.length} kind(s) of app if they're running.`}
          </p>
        </div>
        <Button primary={!active} danger={active} disabled={busy} onClick={() => void act(() => window.api.setFocus(!active)).then(load)}>
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
            <div className="grid gap-1.5 sm:grid-cols-2">
              {info.apps.map((a) => (
                <label key={a.exe} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={s.apps.includes(a.exe)} disabled={busy || active} onChange={(e) => void save({ apps: toggleIn(s.apps, a.exe, e.target.checked) })} />
                  {a.label}
                </label>
              ))}
            </div>
            <ExeList
              title="Your own apps"
              hint="e.g. obs64.exe"
              list={s.custom}
              value={custom}
              setValue={setCustom}
              disabled={busy || active}
              onAdd={() => void save({ custom: [...s.custom, addExe(custom)] }).then(() => setCustom(''))}
              onRemove={(x) => void save({ custom: s.custom.filter((y) => y !== x) })}
            />
          </div>
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
            <div className="font-medium text-slate-100">Exceptions</div>
            <p className="text-xs text-slate-500">Never closed by Focus Mode, even if a list above includes them.</p>
            <ExeList
              title=""
              hint="e.g. discord.exe"
              list={s.exceptions}
              value={exception}
              setValue={setException}
              disabled={busy || active}
              onAdd={() => void save({ exceptions: [...s.exceptions, addExe(exception)] }).then(() => setException(''))}
              onRemove={(x) => void save({ exceptions: s.exceptions.filter((y) => y !== x) })}
            />
          </div>
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

function ExeList(p: { title: string; hint: string; list: string[]; value: string; setValue: (v: string) => void; disabled: boolean; onAdd: () => void; onRemove: (x: string) => void }) {
  const valid = /^[\w .()&+-]{1,80}(\.exe)?$/i.test(p.value.trim());
  return (
    <div className="mt-3 space-y-2">
      {p.title && <div className="text-sm text-slate-300">{p.title}</div>}
      <div className="flex flex-wrap gap-1.5">
        {p.list.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-200 ring-1 ring-white/10">
            {x}
            <button aria-label={`Remove ${x}`} disabled={p.disabled} onClick={() => p.onRemove(x)} className="text-slate-500 hover:text-rose-300 disabled:opacity-40">
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) p.onAdd();
        }}
      >
        <input
          value={p.value}
          onChange={(e) => p.setValue(e.target.value)}
          placeholder={p.hint}
          disabled={p.disabled}
          className="min-w-0 flex-1 rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        <Button disabled={p.disabled || !valid} onClick={p.onAdd}>
          Add
        </Button>
      </form>
    </div>
  );
}
