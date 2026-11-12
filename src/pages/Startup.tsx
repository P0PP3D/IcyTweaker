import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { BootInfo, StartupItemView } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { Badge, Button, Toggle, type Ask, Loading } from '../ui';
import type { Act } from './General';

const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const KIND: Record<StartupItemView['kind'], { label: string; icon: IconName }> = {
  registry: { label: 'Registry', icon: 'list' },
  folder: { label: 'Startup folder', icon: 'box' },
  task: { label: 'Scheduled task', icon: 'restore' },
};

/** Windows' own boot timing and the apps it saw slowing startup. */
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
        <Loading text="Reading boot history…" />
      ) : b && b.lastBootMs !== null ? (
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
      ) : (
        <p className="text-sm text-slate-400">{b?.note}</p>
      )}
    </div>
  );
}

/** Everything that starts at sign-in: on/off one by one or all at once, and delete. */
export function Startup({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [res, setRes] = useState<{ items: StartupItemView[]; error?: string } | null>(null);
  const [boot, setBoot] = useState<{ info?: BootInfo; error?: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [finding, setFinding] = useState<string | null>(null); // item whose app is being looked up for Uninstall
  const load = useCallback(async () => {
    setRes(await window.api.listStartup());
    void window.api.startupIcons().then(setIcons, () => {}); // after the list, so the list never waits on icons
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => void window.api.bootInfo().then(setBoot), []);

  /** Windows' record of how much this app slowed startup (event 101), matched by its program file. */
  const impact = useCallback(
    (i: StartupItemView) =>
      boot?.info?.slowApps.find((s) => (s.file && i.command.toLowerCase().includes(s.file.toLowerCase())) || s.name.toLowerCase() === i.name.toLowerCase())?.degradationMs ?? null,
    [boot],
  );
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...(res?.items ?? [])]
      .filter((i) => !q || `${i.name} ${i.command} ${i.location}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (impact(b) ?? 0) - (impact(a) ?? 0) || a.name.localeCompare(b.name));
  }, [res, filter, impact]);
  const on = items.filter((i) => i.enabled);

  async function all(enabled: boolean) {
    const ids = items.filter((i) => i.enabled !== enabled).map((i) => i.id);
    if (!ids.length) return;
    const ok = await ask(
      `${enabled ? 'Turn on' : 'Turn off'} ${ids.length} startup item(s)?`,
      `${enabled ? 'They will start' : 'They will no longer start'} when you sign in. A restore point is made first, and Undo all changes puts every one back.${enabled ? '' : '\n\nSecurity tools (antivirus, drivers\' helpers) are included if listed: turn those back on if you rely on them.'}`,
      enabled ? 'Turn all on' : 'Turn all off',
    );
    if (!ok) return;
    await act(() => window.api.setStartupItems(ids, enabled));
    await load();
  }

  /** Uninstall the program itself (Debloater's uninstaller, restore point first). */
  async function uninstall(i: StartupItemView) {
    setFinding(i.id);
    const found = await window.api.startupApp(i.id).catch(() => null);
    setFinding(null);
    if (!found) {
      await ask(
        `${i.name}: no installed app found`,
        `IcyTweaker couldn't match this startup item to an app it can uninstall (it may be part of Windows, a driver's helper, or a portable program).\n\nYou can still turn it off or delete it from startup here.`,
        'OK',
      );
      return;
    }
    const ok = await ask(
      `Uninstall ${found.name}?`,
      `Removes ${found.name} from this PC, not just from startup. A restore point is made first.${found.interactive ? `\n\n${found.name}'s own uninstaller window will open: follow its steps.` : ''}`,
      'Uninstall',
    );
    if (!ok) return;
    await act(() => window.api.uninstallApps([found.key]));
    await load();
  }

  async function remove(i: StartupItemView) {
    const ok = await ask(
      `Delete ${i.name} from startup?`,
      `${i.command}\n\n${i.kind === 'folder' ? 'The shortcut goes to the Recycle Bin.' : 'The entry is removed; its value is backed up, so Undo all changes can bring it back.'} The program itself is not uninstalled.`,
      'Delete',
    );
    if (!ok) return;
    await act(() => window.api.removeStartupItem(i.id));
    await load();
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Startup Apps</h2>
        <p className="text-sm text-slate-400">
          Everything that starts when you sign in: Run entries, Startup-folder shortcuts and scheduled tasks. Turning one off works like Task Manager's Startup tab; every change can be undone.
        </p>
      </div>
      <BootTimes res={boot} />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
        <span className="text-sm text-slate-300">
          <span className="font-semibold text-slate-100">{on.length}</span> of {items.length} start with Windows
        </span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter startup items"
          className="ml-auto w-56 rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
        />
        <Button disabled={busy} onClick={load}>
          Refresh
        </Button>
        <Button disabled={busy || !items.some((i) => !i.enabled)} onClick={() => void all(true)}>
          Turn all on
        </Button>
        <Button danger disabled={busy || on.length === 0} onClick={() => void all(false)}>
          Turn all off
        </Button>
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {!res ? (
        <Loading text="Reading startup items…" />
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
              {icons[i.id] ? (
                <img src={icons[i.id]!} alt="" className={clsx('h-7 w-7 shrink-0 rounded', !i.enabled && 'opacity-40 grayscale')} />
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white/5">
                  <Icon name={KIND[i.kind].icon} className={clsx('h-4 w-4', i.enabled ? 'text-sky-300' : 'text-slate-500')} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{i.name}</span>
                  <span className="text-xs text-slate-500">{KIND[i.kind].label}</span>
                  {i.requiresAdmin && <Badge className="bg-violet-500/15 text-violet-300 ring-violet-500/30">admin</Badge>}
                  {impact(i) !== null && (
                    <span title="Windows recorded this app slowing your startup by this much" className="rounded-md bg-amber-500/10 px-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                      +{sec(impact(i))} at startup
                    </span>
                  )}
                </div>
                <p className="truncate font-mono text-xs text-slate-500" title={`${i.location}\n${i.command}`}>
                  {i.command}
                </p>
              </div>
              <span className={clsx('w-14 text-right text-xs', i.enabled ? 'text-emerald-300' : 'text-slate-500')}>{i.enabled ? 'Starts' : 'Off'}</span>
              <Toggle on={i.enabled} label={`Start ${i.name} with Windows`} disabled={busy} onChange={(v) => act(() => window.api.setStartupItem(i.id, v)).then(load)} />
              <button
                disabled={busy || finding !== null}
                onClick={() => void uninstall(i)}
                title="Remove the program from this PC"
                className="inline-flex w-20 items-center justify-end gap-1 text-xs text-slate-300 hover:text-slate-100 disabled:opacity-40"
              >
                {finding === i.id && <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" aria-hidden />}
                Uninstall
              </button>
              {i.kind === 'task' ? (
                <span className="w-24" title="Scheduled tasks can only be turned off: their definition can't be backed up." />
              ) : (
                <button disabled={busy} onClick={() => void remove(i)} title="Remove it from startup only" className="w-24 text-right text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40">
                  Remove from startup
                </button>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">Nothing matches.</li>}
        </ul>
      )}
    </section>
  );
}
