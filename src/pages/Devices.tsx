import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { AppSettings, AppState, DeviceInfo } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { Button, FeatureCard, Toggle, TweakRow, type Ask } from '../ui';
import { tweakHandlers, type Act } from './General';

/** Mouse polling rate: counts every pointer sample (including the ones Chromium coalesces) over the last half second. */
function PollingTest() {
  const [hz, setHz] = useState<number | null>(null);
  const [best, setBest] = useState(0);
  const samples = useRef<number[]>([]);
  const onMove = (e: React.PointerEvent) => {
    const now = performance.now();
    const n = e.nativeEvent.getCoalescedEvents?.().length || 1;
    for (let i = 0; i < n; i++) samples.current.push(now);
    samples.current = samples.current.filter((t) => now - t <= 500);
    const rate = samples.current.length * 2;
    setHz(rate);
    setBest((b) => Math.max(b, rate));
  };
  // Common rates, so a reading of ~980 shows as "1000 Hz class".
  const klass = (r: number) => [125, 250, 500, 1000, 2000, 4000, 8000].reduce((p, c) => (Math.abs(c - r) < Math.abs(p - r) ? c : p), 125);
  return (
    <FeatureCard icon="pulse" title="Mouse polling rate" subtitle="Move the mouse quickly in circles inside the box">
      <div
        onPointerMove={onMove}
        onPointerLeave={() => setHz(null)}
        className="flex h-36 cursor-crosshair select-none items-center justify-center rounded-xl border border-dashed border-sky-500/40 bg-[var(--card-2)]"
      >
        <div className="text-center">
          <div className="text-3xl font-semibold tabular-nums text-slate-50">{hz ?? '—'} Hz</div>
          <div className="text-xs text-slate-400">{best ? `Highest: ${best} Hz (about a ${klass(best)} Hz mouse)` : 'Move the mouse here'}</div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Readings bounce while moving slowly; the highest while moving fast is your mouse's rate. Set it in your mouse's own software.</p>
    </FeatureCard>
  );
}

const TYPES: Array<{ id: AppSettings['deviceType']; name: string; icon: IconName; text: string }> = [
  { id: 'auto', name: 'Automatic', icon: 'sparkles', text: 'Use what IcyTweaker detected.' },
  { id: 'desktop', name: 'Desktop', icon: 'chip', text: 'All tweaks, including ones that trade power for speed.' },
  { id: 'laptop', name: 'Laptop', icon: 'bolt', text: 'Skips tweaks that cost battery and heat; battery-aware power plans.' },
];

export function Devices({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [d, setD] = useState<DeviceInfo | null>(null);
  const load = async () => {
    setS(await window.api.getSettings());
    setD(await window.api.device());
  };
  useEffect(() => void load(), []);
  const save = async (patch: Partial<AppSettings>) => {
    if (!s) return;
    const { lastCleanAt: _skip, ...rest } = { ...s, ...patch };
    setS(await window.api.setSettings(rest));
    setD(await window.api.device());
    await act(async () => ({ ok: true, message: 'Device settings saved.' }));
  };
  const input = state.tweaks.filter((t) => t.id === 'raw-aim-curve' || t.page === 'devices');

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-50">Devices</h2>
        <p className="text-sm text-slate-400">Tell IcyTweaker what kind of PC this is, and tune your mouse and keyboard.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {TYPES.map((t) => {
          const active = s?.deviceType === t.id;
          return (
            <button
              key={t.id}
              disabled={busy || !s}
              aria-pressed={active}
              onClick={() => save({ deviceType: t.id })}
              className={clsx('tweak-card rounded-2xl border bg-[var(--card)] p-4 text-left', active ? 'border-sky-500/50' : 'border-[var(--line)]')}
              data-state={active ? 'applied' : 'off'}
            >
              <div className="flex items-center gap-3">
                <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--card-2)]', active ? 'text-sky-300' : 'text-slate-400')}>
                  <Icon name={t.icon} className="h-5 w-5" />
                </span>
                <span className="font-semibold text-slate-100">
                  {t.name}
                  {t.id === 'auto' && d && <span className="block text-xs font-normal text-slate-400">Detected: {d.detected}</span>}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{t.text}</p>
            </button>
          );
        })}
      </div>
      {d && (
        <p className="text-sm text-slate-400">
          Optimizing for a <span className="font-semibold text-slate-100">{d.type}</span>.{' '}
          {d.type === 'laptop' ? 'Tweaks meant for desktops are marked "not for this PC" and Apply All skips them.' : 'Every tweak is available.'}
        </p>
      )}

      <FeatureCard
        icon="bolt"
        title="Laptop power profile"
        subtitle={d ? `Now on ${d.onBattery ? 'battery' : 'the charger'}` : undefined}
        footer={
          <Button
            primary
            disabled={busy}
            onClick={async () => {
              if (!(await ask(`Optimize for this ${d?.type ?? 'PC'}?`, 'Applies every General tweak that suits this device (Risky ones and ones not meant for it are skipped). A restore point is created first.', 'Optimize'))) return;
              await act(() => window.api.applyAll());
            }}
          >
            Optimize for this {d?.type ?? 'PC'}
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-4">
          <p>On battery, switch to the Balanced plan and keep Game Boost from changing it; back on the charger, your plan returns. Only for laptops.</p>
          <Toggle on={!!s?.laptopProfile} label="Laptop power profile" disabled={busy || !s || d?.type !== 'laptop'} onChange={(v) => save({ laptopProfile: v })} />
        </div>
      </FeatureCard>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Mouse and keyboard</h3>
        <ul className="space-y-2">
          {input.map((t) => (
            <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
          ))}
        </ul>
      </div>
      <PollingTest />
    </section>
  );
}
