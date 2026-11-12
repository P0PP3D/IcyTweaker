import clsx from 'clsx';
import type { ActionReport, AppState } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { Button } from '../ui';

/** One icon per preset; anything new falls back to the generic layers icon. */
const ICON: Record<string, IconName> = {
  'safe-optimize': 'shield',
  'max-fps': 'bolt',
  'low-latency': 'wave',
  competitive: 'gamepad',
  'debloat-only': 'trash',
  streamer: 'play',
  'restore-defaults': 'undo',
};

export function Presets({ state, busy, act }: { state: AppState; busy: boolean; act: (fn: () => Promise<ActionReport>) => void }) {
  const name = (id: string) => state.tweaks.find((t) => t.id === id)?.name ?? id;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Presets</h2>
        <p className="text-sm text-slate-400">Each preset creates a restore point, then applies (or reverts) its tweaks. Tweaks already in place are skipped.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {state.presets.map((p) => {
          const revert = p.action === 'revert';
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-lg ring-1',
                    revert ? 'bg-rose-500/10 text-rose-300 ring-rose-500/25' : 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
                  )}
                >
                  <Icon name={ICON[p.id] ?? 'layers'} className="h-5 w-5" />
                </span>
                <div className="font-medium text-slate-100">{p.name}</div>
              </div>
              <p className="text-sm text-slate-400">{p.description}</p>
              <p className="text-xs text-slate-500">{p.tweakIds.includes('*') ? 'Every tweak on every page' : p.tweakIds.map(name).join(' · ')}</p>
              <div className="mt-auto pt-1">
                <Button primary={!revert} disabled={busy} onClick={() => act(() => window.api.applyPreset(p.id))}>
                  {revert ? 'Revert these' : 'Apply preset'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
