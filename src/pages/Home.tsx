import { useEffect, useState } from 'react';
import type { AppState, MonitorInfo, Stats } from '../../shared/types';
import { Button, Ring } from '../ui';
import { appliedCount } from './General';

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

export function Home({ state, onOpenTweaks }: { state: AppState; onOpenTweaks: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    // Minimized or covered: skip, so the main process can stop its GPU reader.
    const tick = () => (document.hidden ? undefined : window.api.getStats().then((s) => alive && setStats(s), () => {}));
    void tick();
    const timer = setInterval(tick, 2000); // every 2 s: half the redraws of 1 s, and still live
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);


  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold text-slate-100">Home</h2>
      <div className="grid grid-cols-3 gap-4">
        <Ring label="CPU" value={stats?.cpu ?? null} />
        <Ring label="GPU" value={stats ? stats.gpu : null} detail="3D engine" />
        <Ring
          label="RAM"
          value={stats ? Math.round((100 * stats.ramUsed) / stats.ramTotal) : null}
          detail={stats ? `${gb(stats.ramUsed)} / ${gb(stats.ramTotal)} GB` : undefined}
        />
      </div>
      <div className="flex items-center justify-between rounded-xl bg-[var(--card)] px-5 py-4 ring-1 ring-[var(--line)]">
        <div>
          <div className="text-sm text-slate-400">General tweaks</div>
          <div className="text-lg font-semibold text-slate-100">
            {appliedCount(state.tweaks)} applied
          </div>
        </div>
        <Button primary onClick={onOpenTweaks}>
          Review tweaks
        </Button>
      </div>
      <Monitors />
    </section>
  );
}

/** Monitor refresh check: flags a display running below the refresh rate it supports. */
function Monitors() {
  const [list, setList] = useState<MonitorInfo[] | null>(null);
  useEffect(() => void window.api.monitors().then(setList), []);
  if (!list?.length) return null;
  return (
    <div className="space-y-2 rounded-xl bg-[var(--card)] px-5 py-4 ring-1 ring-[var(--line)]">
      <div className="text-sm text-slate-400">Displays</div>
      {list.map((m, i) => {
        const low = m.hz < m.maxHz;
        return (
          <div key={i} className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium text-slate-100">{m.name}</span>{' '}
              <span className="text-slate-400">
                {m.width}×{m.height} at <span className={low ? 'font-semibold text-amber-300' : 'text-emerald-300'}>{m.hz} Hz</span>
                {low ? ` (supports ${m.maxHz} Hz)` : ' (its highest)'}
              </span>
            </div>
            {low && (
              <Button primary onClick={() => void window.api.openShortcut('display')}>
                Set {m.maxHz} Hz
              </Button>
            )}
          </div>
        );
      })}
      {list.some((m) => m.hz < m.maxHz) && <p className="text-xs text-slate-500">In Advanced display settings, pick the monitor and choose the higher refresh rate.</p>}
    </div>
  );
}
