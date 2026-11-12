import type { ActionReport, AppState } from '../../shared/types';
import { Button } from '../ui';

export function Presets({ state, busy, act }: { state: AppState; busy: boolean; act: (fn: () => Promise<ActionReport>) => void }) {
  const name = (id: string) => state.tweaks.find((t) => t.id === id)?.name ?? id;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Presets</h2>
        <p className="text-sm text-slate-400">Each preset creates a restore point, then applies (or reverts) its tweaks. Tweaks already in place are skipped.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {state.presets.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
            <div className="font-medium text-slate-100">{p.name}</div>
            <p className="text-sm text-slate-400">{p.description}</p>
            <p className="text-xs text-slate-500">{p.tweakIds.includes('*') ? 'Every tweak on every page' : p.tweakIds.map(name).join(' · ')}</p>
            <div className="mt-auto pt-1">
              <Button primary={p.action === 'apply'} disabled={busy} onClick={() => act(() => window.api.applyPreset(p.id))}>
                {p.action === 'apply' ? 'Apply preset' : 'Revert these'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
