import type { AppState } from '../../shared/types';
import { Banner, TweakRow, type Ask } from '../ui';
import { tweakHandlers, type Act } from './General';

/** Windows optional features you can switch off (Turn Windows features on or off), each with what it's for. */
export function WinFeatures({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const list = state.tweaks.filter((t) => t.page === 'features');
  const unreadable = list.every((t) => t.status === 'unavailable');
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Windows Features</h2>
        <p className="text-sm text-slate-400">
          Built-in parts of Windows most people never use. Turning one off removes it from Windows (it can be turned back on any time, and Undo all changes does that). A
          restart finishes the change.
        </p>
      </div>
      {unreadable && <Banner tone="info">Windows only lists its features to administrators. Relaunch IcyTweaker as admin to see and change them.</Banner>}
      <ul className="space-y-2">
        {list.map((t) => (
          <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
        ))}
      </ul>
    </section>
  );
}
