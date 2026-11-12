import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, MonitorInfo, Stats } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { Button, Ring } from '../ui';
import { appliedCount } from './General';

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
type Go = (page: 'general' | 'health' | 'games' | 'apps' | 'resources') => void;

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Late night session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export function Home({ state, go }: { state: AppState; go: Go }) {
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

  const applied = appliedCount(state.tweaks);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-50">{greeting()}</h2>
          <p className="text-sm text-slate-400">Here is how your PC is doing right now.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Chip on={state.live} label={state.live ? 'Live' : 'Dry-run'} />
          <Chip on={state.isAdmin} label={state.isAdmin ? 'Administrator' : 'Not admin'} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Ring label="CPU" value={stats?.cpu ?? null} />
        <Ring label="GPU" value={stats ? stats.gpu : null} detail="3D engine" />
        <Ring label="RAM" value={stats ? Math.round((100 * stats.ramUsed) / stats.ramTotal) : null} detail={stats ? `${gb(stats.ramUsed)} / ${gb(stats.ramTotal)} GB` : undefined} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Action icon="sliders" title="Tweaks" text={`${applied} applied`} onClick={() => go('general')} />
        <Action icon="pulse" title="Health Check" text="Clean safe junk in one click" onClick={() => go('health')} />
        <Action icon="gamepad" title="Game profiles" text="Competitive settings and Game Boost" onClick={() => go('games')} />
      </div>

      <Checkups go={go} />
    </section>
  );
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1', on ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' : 'bg-white/5 text-slate-400 ring-white/10')}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', on ? 'bg-emerald-400' : 'bg-slate-500')} />
      {label}
    </span>
  );
}

function Action({ icon, title, text, onClick }: { icon: IconName; title: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl bg-[var(--card)] px-4 py-3 text-left ring-1 ring-[var(--line)] transition hover:-translate-y-0.5 hover:bg-white/[0.04] hover:ring-sky-500/40 motion-reduce:hover:translate-y-0"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20 transition group-hover:bg-sky-500/20">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-slate-100">{title}</span>
        <span className="block truncate text-xs text-slate-400">{text}</span>
      </span>
      <span className="ml-auto text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-sky-300">›</span>
    </button>
  );
}

type Tone = 'good' | 'warn' | 'info';
const DOT: Record<Tone, string> = { good: 'bg-emerald-400', warn: 'bg-amber-400', info: 'bg-slate-500' };
const DRIVER_OLD_DAYS = 90;
/** Chipset drivers change less often than graphics drivers. */
const CHIPSET_OLD_DAYS = 365;
const SHADER_BIG_GB = 10;

/** Checkups: display refresh rate, GPU driver age, shader cache size. Read-only. */
function Checkups({ go }: { go: Go }) {
  const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
  const [c, setC] = useState<Awaited<ReturnType<typeof window.api.checkups>> | null>(null);
  useEffect(() => void window.api.monitors().then(setMonitors), []);
  useEffect(() => void window.api.checkups().then(setC, () => {}), []);

  const rows: Array<{ tone: Tone; title: string; text: string; action?: { label: string; run: () => void } }> = [];
  for (const m of monitors ?? []) {
    const low = m.hz < m.maxHz;
    rows.push({
      tone: low ? 'warn' : 'good',
      title: `${m.name}: ${m.width}×${m.height} at ${m.hz} Hz`,
      text: low ? `It supports ${m.maxHz} Hz. Pick it in Advanced display settings.` : 'Running at its highest refresh rate.',
      action: low ? { label: `Set ${m.maxHz} Hz`, run: () => void window.api.openShortcut('display') } : undefined,
    });
  }
  for (const g of c?.gpus ?? []) {
    const date = g.driverDate ? new Date(`${g.driverDate}T00:00`) : null; // local midnight: a bare date would be UTC
    const days = date ? Math.floor((Date.now() - date.getTime()) / 86_400_000) : null;
    const old = days !== null && days > DRIVER_OLD_DAYS;
    rows.push({
      tone: days === null ? 'info' : old ? 'warn' : 'good',
      title: `${g.name} driver`,
      text: days === null ? 'Driver date unknown.' : `${date!.toLocaleDateString()} (${days} days old)${old ? '. Newer drivers often fix game performance.' : '.'}`,
      action: !old
        ? undefined
        : g.vendor === 'NVIDIA'
          ? { label: 'Driver tools', run: () => go('resources') }
          : g.vendor === 'AMD' || g.vendor === 'Intel'
            ? { label: 'Get latest driver', run: () => void window.api.openVendorPage(g.vendor === 'AMD' ? 'amd' : 'intel') }
            : undefined,
    });
  }
  if (c?.chipset) {
    const ch = c.chipset;
    const date = new Date(`${ch.driverDate}T00:00`);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    const old = days > CHIPSET_OLD_DAYS;
    rows.push({
      tone: old ? 'warn' : 'good',
      title: `${ch.vendor} chipset drivers`,
      text: `${date.toLocaleDateString()} (${days} days old)${old ? '. Newer chipset drivers can fix USB, power and stutter problems.' : '.'}`,
      action: old ? { label: 'Get latest driver', run: () => void window.api.openVendorPage(ch.vendor === 'AMD' ? 'amd' : 'intel') } : undefined,
    });
  }
  if (c) {
    const big = c.shaderBytes > SHADER_BIG_GB * 1024 ** 3;
    rows.push({
      tone: big ? 'warn' : 'good',
      title: `Shader caches: ${gb(c.shaderBytes)} GB`,
      text: big ? 'Large caches waste disk space; games rebuild what they need (expect a short stutter on first launch).' : 'A normal size.',
      action: big ? { label: 'Clean in App Caches', run: () => go('apps') } : undefined,
    });
  }

  return (
    <div className="rounded-xl bg-[var(--card)] ring-1 ring-[var(--line)]">
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="font-medium text-slate-100">Checkups</div>
        {(!monitors || !c) && <span className="text-xs text-slate-500">Checking…</span>}
      </div>
      <ul className="divide-y divide-[var(--line)] px-2 pb-2 pt-1">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3 px-3 py-2.5">
            <span className={clsx('h-2 w-2 shrink-0 rounded-full', DOT[r.tone], r.tone === 'warn' && 'motion-safe:animate-pulse')} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-100">{r.title}</div>
              <div className="text-xs text-slate-400">{r.text}</div>
            </div>
            {r.action && (
              <Button primary onClick={r.action.run}>
                {r.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
