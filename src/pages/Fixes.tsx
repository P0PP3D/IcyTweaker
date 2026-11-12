import type { AppState, FixMeta } from '../../shared/types';
import { Badge, Button, Flags, WarningChip, type Ask } from '../ui';
import type { Act } from './General';

/** One fix card with its Run button. Risky and permanent fixes ask first. Also used by Networking. */
export function FixCard({ f, busy, act, ask }: { f: FixMeta; busy: boolean; act: Act; ask: Ask }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div className="font-medium text-slate-100">{f.name}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Flags
          risk={f.risk}
          requiresAdmin={f.requiresAdmin}
          requiresReboot={f.requiresReboot}
          extra={f.permanent && <Badge className="bg-orange-500/15 text-orange-300 ring-orange-500/30">permanent</Badge>}
        />
        <WarningChip text={f.warning} />
      </div>
      <p className="text-sm text-slate-400">{f.description}</p>
      <div className="mt-auto pt-1">
        <Button
          primary
          disabled={busy}
          onClick={async () => {
            const needsAsk = f.risk === 'risky' || f.permanent;
            const confirmed =
              !needsAsk ||
              (await ask(
                `Run ${f.name}?`,
                `${f.description}${f.warning ? `\n\n${f.warning}` : ''}${f.permanent ? '\n\nPart of this cannot be undone from the app, only from the restore point.' : ''}`,
                'Run fix',
              ));
            if (confirmed) await act(() => window.api.runFix(f.id, confirmed));
          }}
        >
          Run Fix
        </Button>
      </div>
    </li>
  );
}

export function Fixes({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Fixes</h2>
        <p className="text-sm text-slate-400">
          Each fix creates a restore point first. Settings a fix changes are backed up and can be undone; fixes marked Permanent also run actions only a
          restore point can undo.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {state.fixes
          .filter((f) => (f.page ?? 'fixes') === 'fixes')
          .map((f) => (
            <FixCard key={f.id} f={f} busy={busy} act={act} ask={ask} />
          ))}
      </ul>
    </section>
  );
}
