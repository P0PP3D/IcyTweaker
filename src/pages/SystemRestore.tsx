import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { BackupView, LogEntry, RestorePointView } from '../../shared/types';
import { Button } from '../ui';
import type { Act } from './General';

const when = (iso: string) => new Date(iso).toLocaleString();

export function SystemRestore({ busy, act }: { busy: boolean; act: Act }) {
  const [points, setPoints] = useState<{ points: RestorePointView[]; error?: string } | null>(null);
  const [history, setHistory] = useState<{ log: LogEntry[]; changes: BackupView[] } | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const [p, h] = await Promise.all([window.api.listRestorePoints(), window.api.getHistory()]);
    setPoints(p);
    setHistory(h);
  }, []);
  useEffect(() => void load(), [load]);

  const run = (fn: Parameters<Act>[0]) => act(fn).then(load);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">System Restore</h2>
          <p className="text-sm text-slate-400">Roll Windows back to a restore point, or see everything this app has changed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={load}>
            Refresh
          </Button>
          <Button disabled={busy} onClick={() => run(() => window.api.openSystemRestore())}>
            Roll back…
          </Button>
        </div>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => window.api.createRestorePoint(name)).then(() => setName(''));
        }}
      >
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm text-slate-300">
          New restore point
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Name it, e.g. Before driver update"
            className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500/50"
          />
        </label>
        <Button primary disabled={busy} onClick={() => void run(() => window.api.createRestorePoint(name)).then(() => setName(''))}>
          Create restore point
        </Button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Restore points</h3>
        {!points ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : points.error ? (
          <p className="text-sm text-amber-300">{points.error}</p>
        ) : points.points.length === 0 ? (
          <p className="text-sm text-slate-400">No restore points. System Protection may be off for your system drive.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
            {points.points.map((p) => (
              <li key={p.sequence} className="flex justify-between px-4 py-2 text-sm">
                <span className="text-slate-200">{p.description}</span>
                <span className="text-slate-500">{when(p.created)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">"Roll back…" opens the Windows System Restore wizard; nothing changes until you pick a point there and confirm.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Change history ({history?.changes.length ?? 0})</h3>
        <p className="text-xs text-slate-500">
          Newest first. "Undo from here" puts back this change and every one made after it, behind a restore point; earlier changes stay.
        </p>
        {history?.changes.length ? (
          <ol className="relative space-y-0 border-l border-sky-500/30 pl-4">
            {[...history.changes]
              .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
              .map((c) => (
                <li key={c.target} className="relative py-1.5">
                  <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full bg-sky-400 ring-4 ring-[var(--panel)]" />
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs">
                    <span className="w-36 shrink-0 text-slate-500">{when(c.savedAt)}</span>
                    <span className="min-w-0 flex-1 break-all text-slate-300">
                      {c.target} <span className="text-slate-500">· was {c.original}</span>
                    </span>
                    <Button disabled={busy} onClick={() => run(() => window.api.undoSince(c.savedAt))}>
                      Undo from here
                    </Button>
                  </div>
                </li>
              ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-400">Nothing. Every setting is as it was before the app touched it.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Action history</h3>
          <Button disabled={busy} onClick={() => act(() => window.api.exportLog())}>
            Export log
          </Button>
        </div>
        <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
          {history?.log.map((l, i) => (
            <li key={i} className="grid grid-cols-[10rem_7rem_1fr] gap-3 px-4 py-1.5 text-xs">
              <span className="text-slate-500">{when(l.ts)}</span>
              <span className={clsx(l.ok ? 'text-slate-300' : 'text-rose-300')}>
                {l.action}
                {l.mode === 'dry-run' && <span className="text-slate-600"> (dry)</span>}
              </span>
              <span className="break-all text-slate-400">
                {l.target}
                {l.message && <span className="text-slate-600"> — {l.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
