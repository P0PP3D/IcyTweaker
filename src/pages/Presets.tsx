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
                <div className="min-w-0 flex-1 font-medium text-slate-100">{p.name}</div>
                {p.estimate && (
                  <span
                    title={`${p.estimateNote ?? ''} Estimated range, not measured on your PC.`}
                    className={clsx(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
                      revert ? 'bg-white/5 text-slate-300 ring-white/10' : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
                    )}
                  >
                    {p.estimate}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400">{p.description}</p>
              {p.estimateNote && <p className="text-xs text-slate-500">{p.estimateNote}</p>}
              <div className="mt-auto pt-1">
                <Button primary={!revert} disabled={busy} onClick={() => act(() => window.api.applyPreset(p.id))}>
                  {revert ? 'Revert these' : 'Apply preset'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">
        FPS figures are estimated ranges for these kinds of changes, not measurements of your PC: the real gain depends on your CPU, graphics card and game. To measure it, use
        Frametime capture on the Game Profiles page (Performance tab) before and after applying a preset.
      </p>
    </section>
  );
}
