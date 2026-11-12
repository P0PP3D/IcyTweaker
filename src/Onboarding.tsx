import { useState } from 'react';
import type { ActionReport, AppState } from '../shared/types';
import { Button } from './ui';

/** First-run walkthrough: what the app does, a restore point offer, then the recommended preset. */
export function Onboarding({ state, onDone }: { state: AppState; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionReport | null>(null);
  const recommended = state.presets.find((p) => p.id === 'safe-optimize');

  async function run(fn: () => Promise<ActionReport>) {
    setBusy(true);
    setResult(await fn().catch((e) => ({ ok: false, message: String(e) })));
    setBusy(false);
  }
  const next = () => {
    setResult(null);
    setStep(step + 1);
  };

  const steps = [
    {
      title: 'Welcome to IcyCleaner',
      body: (
        <>
          <p>IcyCleaner changes Windows settings that get in the way of games, and cleans up what Windows leaves behind.</p>
          <p>Before the app first changes any value, it saves the original. Every tweak can be reverted, and “Undo all changes” puts back everything the app touched.</p>
          {!state.live && <p className="text-sky-300">You are in dry-run mode: changes are simulated and nothing is written to Windows.</p>}
        </>
      ),
      actions: (
        <Button primary onClick={next}>
          Next
        </Button>
      ),
    },
    {
      title: 'Create a restore point',
      body: (
        <>
          <p>A Windows restore point lets you roll the whole system back, even outside this app. IcyCleaner also creates one before every bulk change.</p>
          {!state.isAdmin && state.live && <p className="text-amber-300">Restore points need administrator rights. Relaunch as admin first, or skip this step.</p>}
        </>
      ),
      actions: (
        <>
          <Button onClick={next}>Skip</Button>
          <Button primary disabled={busy} onClick={() => run(() => window.api.createRestorePoint())}>
            Create restore point
          </Button>
          {result?.ok && (
            <Button primary onClick={next}>
              Next
            </Button>
          )}
        </>
      ),
    },
    {
      title: `Recommended: ${recommended?.name ?? 'Safe Optimize'}`,
      body: (
        <>
          <p>{recommended?.description}</p>
          <p className="text-slate-500">You can change or revert any of it later from General tweaks or Presets.</p>
        </>
      ),
      actions: (
        <>
          <Button onClick={onDone}>{result?.ok ? 'Finish' : 'Not now'}</Button>
          {!result?.ok && (
            <Button primary disabled={busy || !recommended} onClick={() => run(() => window.api.applyPreset(recommended!.id))}>
              Apply preset
            </Button>
          )}
        </>
      ),
    },
  ];
  const s = steps[step];

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-[var(--card)] p-6 ring-1 ring-white/10">
        <div className="text-xs text-slate-500">
          Step {step + 1} of {steps.length}
        </div>
        <h2 id="onboarding-title" className="text-lg font-semibold text-slate-100">
          {s.title}
        </h2>
        <div className="space-y-2 text-sm text-slate-300">{s.body}</div>
        {result && <p className={result.ok ? 'text-sm text-emerald-300' : 'text-sm text-rose-300'}>{result.message}</p>}
        <div className="flex justify-end gap-2">{s.actions}</div>
      </div>
    </div>
  );
}
