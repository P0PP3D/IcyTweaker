import type { AppState } from '../../shared/types';
import { TweakRow, type Ask } from '../ui';
import { tweakHandlers, type Act } from './General';

/** App Optimizer cards. Startup items have their own page (Startup Apps). */
export function AppOptimizer({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const apps = state.tweaks.filter((t) => t.page === 'apps');
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">App Optimizer</h2>
        <p className="text-sm text-slate-400">Cuts what apps do in the background while you play. Each original setting is backed up; turning a card off puts it back.</p>
      </div>
      <ul className="space-y-2">
        {apps.map((t) => (
          <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
        ))}
      </ul>
    </section>
  );
}
