import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, AuditItem, HardwareInfo, TweakView } from '../../shared/types';
import { Badge, Button, MUTED_BADGE, TweakRow, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

type HwResult = Awaited<ReturnType<typeof window.api.hardware>>;

function useHardware() {
  const [res, setRes] = useState<HwResult | null>(null);
  const load = (refresh = false) => window.api.hardware(refresh).then(setRes);
  useEffect(() => void load(), []);
  return { res, load };
}

/** Risky Advanced tweaks need the user to type APPLY, not just click. */
function advancedHandlers(t: TweakView, act: Act, ask: Ask) {
  const set = async (on: boolean, option?: number) => {
    let confirmed = false;
    if (on && t.risk !== 'safe') {
      confirmed = await ask(`Apply ${t.name}?`, `${t.description}\n\n${t.warning ?? ''}\n\nA restart is needed before it takes effect.`, 'Apply', t.risk === 'risky' ? 'APPLY' : undefined);
      if (!confirmed) return;
    }
    await act(() => window.api.setTweak(t.id, on, { confirmed, option }));
  };
  return { onToggle: (on: boolean) => set(on), onOption: (v: number) => set(true, v) };
}

function Spec({ hw }: { hw: HardwareInfo }) {
  const rows: Array<[string, string]> = [
    ['PC', `${hw.maker} ${hw.model}${hw.laptop ? ' (laptop)' : ''}`],
    ['CPU', `${hw.cpu} · ${hw.cores} cores / ${hw.threads} threads`],
    ...hw.gpus.map((g): [string, string] => ['GPU', `${g.name} · driver ${g.driver}`]),
    ['Memory', `${formatBytes(hw.memory.totalBytes)} ${hw.memory.type ?? ''} in ${hw.memory.modules} module(s) at ${hw.memory.runningMTs ?? '?'} MT/s`],
    ['Memory Integrity', hw.hvciRunning ? 'On' : 'Off'],
  ];
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 rounded-xl bg-[var(--card)] p-4 text-sm ring-1 ring-[var(--line)]">
      {rows.map(([k, v], i) => [
        <dt key={`k${i}`} className="text-slate-500">
          {k}
        </dt>,
        <dd key={`v${i}`} className="text-slate-200">
          {v}
        </dd>,
      ])}
    </dl>
  );
}

export function Advanced({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const { res } = useHardware();
  const tweaks = state.tweaks.filter((t) => t.page === 'advanced');
  const sections: Array<[string, (t: TweakView) => boolean]> = [
    ['Timer and CPU power', (t) => t.id.startsWith('timer') || t.id.startsWith('cpu-')],
    ['Interrupts (MSI mode)', (t) => t.id.startsWith('msi-')],
    ['Security trade-offs', (t) => t.id === 'mitigations-off' || t.id === 'memory-integrity-off'],
  ];
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Advanced</h2>
        <p className="text-sm text-slate-400">Hardware-level tweaks. Gains depend on the PC and are often small; each one says what it costs. Every change is backed up.</p>
      </div>
      {res?.hw ? <Spec hw={res.hw} /> : <p className="text-sm text-slate-400">{res?.error ?? 'Detecting hardware…'}</p>}
      {res?.hw?.laptop && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          This is a laptop. The CPU power tweaks change plugged-in values only, but they still raise heat and fan noise.
        </p>
      )}
      {sections.map(([title, match]) => {
        const list = tweaks.filter(match);
        return (
          <div key={title} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
            {list.length === 0 ? (
              <p className="text-sm text-slate-500">No device on this PC exposes MSI settings.</p>
            ) : (
              <ul className="space-y-2">
                {list.map((t) => (
                  <TweakRow key={t.id} t={t} busy={busy} {...advancedHandlers(t, act, ask)} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Memory</h3>
        <div className="space-y-2 rounded-xl bg-[var(--card)] p-4 text-sm text-slate-300 ring-1 ring-[var(--line)]">
          <p>
            <span className="font-medium text-slate-100">RAM cleaners don't add FPS.</span> Windows keeps recently used data in the standby list and hands it to a game instantly when the game needs
            memory. Emptying it only makes Windows read those files from disk again.
          </p>
          <p>
            <span className="font-medium text-slate-100">Keep the paging file on "System managed".</span> Turning it off or making it small can crash games when memory runs out, and doesn't make
            anything faster.
          </p>
          <p>If games stutter because memory is full, closing browsers and launchers (Game Boost can lower them) helps more than any tweak. Adding RAM is the real fix.</p>
        </div>
      </div>
    </section>
  );
}

const STATUS_STYLE: Record<AuditItem['status'], [string, string]> = {
  good: ['OK', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
  check: ['Check', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
  info: ['Info', MUTED_BADGE],
};

export function Bios({ busy, act }: { busy: boolean; act: Act }) {
  const { res, load } = useHardware();
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">BIOS</h2>
          <p className="text-sm text-slate-400">A read-only check of firmware settings Windows can see. The app never changes or flashes the BIOS; you change settings there yourself.</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => load(true)}>
            Re-check
          </Button>
          <Button primary disabled={busy} onClick={() => act(() => window.api.openShortcut('bios'))}>
            Restart to BIOS
          </Button>
        </div>
      </div>
      {res?.hw && (
        <div className="space-y-1 rounded-xl bg-[var(--card)] p-4 text-sm ring-1 ring-[var(--line)]">
          <div className="text-slate-100">{res.hw.board || `${res.hw.maker} ${res.hw.model}`}</div>
          <div className="text-slate-400">
            Support: read-only audit
            {res.hw.biosVendorTool ? `. ${res.hw.biosVendorTool}'s BIOS settings interface is present (changing settings through it is not built yet).` : '. This board has no maker interface Windows can use to change BIOS settings.'}
          </div>
        </div>
      )}
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {!res ? (
        <p className="text-sm text-slate-400">Reading firmware information…</p>
      ) : (
        <ul className="space-y-2">
          {res.audit.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-lg bg-[var(--card)] px-4 py-3 ring-1 ring-[var(--line)]">
              <Badge className={clsx('mt-0.5 w-14 justify-center', STATUS_STYLE[a.status][1])}>{STATUS_STYLE[a.status][0]}</Badge>
              <div>
                <div className="text-sm font-medium text-slate-100">{a.name}</div>
                <p className="text-sm text-slate-400">{a.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {res && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Where to find these: {res.guide.brand}</h3>
          <ol className="list-decimal space-y-1 rounded-xl bg-[var(--card)] p-4 pl-8 text-sm text-slate-300 ring-1 ring-[var(--line)]">
            {res.guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">Menu names change between models and BIOS versions; check your board's manual if a name doesn't match.</p>
        </div>
      )}
    </section>
  );
}
