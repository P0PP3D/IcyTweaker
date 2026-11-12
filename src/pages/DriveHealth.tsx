import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, DriveInfo } from '../../shared/types';
import { Badge, Button, MUTED_BADGE, formatBytes } from '../ui';

const value = (v: number | null, unit = '') => (v === null || v === undefined ? '—' : `${v.toLocaleString()}${unit}`);

export function DriveHealth({ state }: { state: AppState }) {
  const [data, setData] = useState<{ drives: DriveInfo[]; error?: string } | null>(null);
  const load = useCallback(async () => {
    setData(null);
    setData(await window.api.driveHealth());
  }, []);
  useEffect(() => void load(), [load]);

  const noCounters = data?.drives.length && data.drives.every((d) => d.temperature === null && d.wear === null && d.powerOnHours === null);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Drive Health</h2>
          <p className="text-sm text-slate-400">What Windows reports for each physical disk. Read-only: nothing is changed.</p>
        </div>
        <Button onClick={load}>Refresh</Button>
      </div>
      {!data ? (
        <p className="text-sm text-slate-400">Reading drives…</p>
      ) : (
        <>
          {data.error && <p className="text-sm text-rose-300">{data.error}</p>}
          {noCounters ? (
            <p className="text-sm text-amber-300">
              {state.isAdmin ? 'These drives do not report wear, temperature or power-on hours to Windows.' : 'Wear, temperature, power-on hours and error counts need administrator. Relaunch as admin to see them.'}
            </p>
          ) : null}
          <ul className="grid gap-3 md:grid-cols-2">
            {data.drives.map((d, i) => (
              <li key={i} className="space-y-3 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-100">{d.name}</span>
                  <Badge
                    className={clsx(
                      d.health === 'Healthy' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : d.health === 'Warning' ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30' : 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
                    )}
                  >
                    {d.health || 'Unknown'}
                  </Badge>
                  <Badge className={MUTED_BADGE}>{d.media}</Badge>
                  <Badge className={MUTED_BADGE}>{d.bus}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-slate-500">Size</dt>
                  <dd className="text-slate-200">{formatBytes(d.size)}</dd>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-slate-200">{d.status || '—'}</dd>
                  <dt className="text-slate-500">Wear used</dt>
                  <dd className="text-slate-200">{value(d.wear, '%')}</dd>
                  <dt className="text-slate-500">Temperature</dt>
                  <dd className="text-slate-200">{value(d.temperature, ' °C')}</dd>
                  <dt className="text-slate-500">Power-on hours</dt>
                  <dd className="text-slate-200">{value(d.powerOnHours)}</dd>
                  <dt className="text-slate-500">Read / write errors</dt>
                  <dd className="text-slate-200">
                    {value(d.readErrors)} / {value(d.writeErrors)}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
