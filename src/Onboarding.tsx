import { useState } from 'react';
import clsx from 'clsx';
import type { ActionReport, AppState } from '../shared/types';
import { Icon, type IconName } from './icons';
import { Button } from './ui';

/** Pages the guide can open. */
export type GuidePage = 'general' | 'presets' | 'health' | 'games' | 'focus' | 'restore' | 'startup' | 'devices';

/** Opens the beginner guide from anywhere (Home, Settings). */
export const openGuide = () => window.dispatchEvent(new Event('icy:guide'));

interface Step {
  icon: IconName;
  title: string;
  body: React.ReactNode;
}

/**
 * Beginner guide: what IcyTweaker does in plain words, why it's safe, a tour of the main areas, then the first three
 * things to do. Shown on first start; reopen it from Home or Settings.
 */
export function Onboarding({ state, onDone, go }: { state: AppState; onDone: () => void; go: (p: GuidePage) => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, ActionReport>>({});
  const recommended = state.presets.find((p) => p.id === 'safe-optimize');

  async function run(key: string, fn: () => Promise<ActionReport>) {
    setBusy(true);
    const r = await fn().catch((e) => ({ ok: false, message: String(e) }));
    setDone((d) => ({ ...d, [key]: r }));
    setBusy(false);
  }
  const open = (p: GuidePage) => {
    onDone();
    go(p);
  };

  const Area = ({ icon, title, text, page }: { icon: IconName; title: string; text: string; page: GuidePage }) => (
    <li className="flex items-start gap-3 rounded-lg bg-[var(--card-2)] p-3 ring-1 ring-[var(--line)]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-100">{title}</span>
        <span className="block text-xs text-slate-400">{text}</span>
      </span>
      <button onClick={() => open(page)} className="shrink-0 text-xs text-sky-300 hover:text-sky-200">
        Take me there ›
      </button>
    </li>
  );

  const steps: Step[] = [
    {
      icon: 'sparkles',
      title: 'Welcome to IcyTweaker',
      body: (
        <>
          <p>IcyTweaker makes Windows better for gaming. It does three things:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b className="text-slate-100">Tweaks:</b> switches for Windows settings that slow games down or run in the background.
            </li>
            <li>
              <b className="text-slate-100">Cleaning:</b> removes junk files Windows and apps leave behind.
            </li>
            <li>
              <b className="text-slate-100">Gaming tools:</b> game settings, Game Boost and Focus Mode for while you play.
            </li>
          </ul>
          <p>This short guide takes about a minute. You can skip it and reopen it any time from Home or Settings.</p>
          {!state.live && <p className="text-sky-300">You're in dry-run mode: changes are only simulated, nothing is written to Windows.</p>}
        </>
      ),
    },
    {
      icon: 'shield',
      title: 'Nothing here is permanent',
      body: (
        <>
          <p>Every switch can be turned back off. Before IcyTweaker changes a setting the first time, it saves what was there.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b className="text-slate-100">Turn a switch off</b> to put that one setting back.
            </li>
            <li>
              <b className="text-slate-100">Undo all changes</b> (bottom of Settings) puts back everything IcyTweaker ever changed.
            </li>
            <li>
              <b className="text-slate-100">Restore points</b> let Windows itself roll back, even without IcyTweaker. One is made before every big change.
            </li>
          </ul>
          <p className="text-slate-400">
            Labels help you choose: <span className="text-emerald-300">Safe</span> tweaks have no downside, <span className="text-amber-300">Balanced</span> ones trade something, and{' '}
            <span className="text-rose-300">Risky</span> ones always ask first.
          </p>
        </>
      ),
    },
    {
      icon: 'grid',
      title: 'A quick tour',
      body: (
        <ul className="space-y-2">
          <Area icon="layers" title="Presets" text="One click applies a set of tweaks, with an estimated FPS gain for each." page="presets" />
          <Area icon="sliders" title="General tweaks" text="Every tweak as a card, so you can pick them one by one." page="general" />
          <Area icon="pulse" title="Health Check" text="Scans and cleans only safe junk (temp files, caches, crash reports)." page="health" />
          <Area icon="gamepad" title="Game Profiles" text="Competitive settings for your games, Play buttons and Game Boost." page="games" />
          <Area icon="bolt" title="Focus Mode" text="Pauses background services and apps while you play, back with one click." page="focus" />
        </ul>
      ),
    },
    {
      icon: 'check',
      title: 'Your first three steps',
      body: (
        <>
          <p>Do these in order. Each one is optional.</p>
          <ol className="space-y-2">
            {[
              {
                key: 'rp',
                n: 1,
                title: 'Make a restore point',
                text: 'A safety snapshot of Windows. Takes under a minute.',
                action: () => run('rp', () => window.api.createRestorePoint('Before IcyTweaker')),
                label: 'Create',
                hint: !state.isAdmin && state.live ? 'Needs administrator: relaunch as admin first, or skip.' : '',
              },
              {
                key: 'preset',
                n: 2,
                title: `Apply ${recommended?.name ?? 'Safe Optimize'}`,
                text: 'Only tweaks with no downside. The recommended start.',
                action: () => run('preset', () => window.api.applyPreset(recommended!.id)),
                label: 'Apply',
                hint: '',
              },
              { key: 'clean', n: 3, title: 'Run a Health Check', text: 'Find out how much safe junk can go.', action: () => open('health'), label: 'Open', hint: '' },
            ].map((x) => {
              const r = done[x.key];
              return (
                <li key={x.key} className="flex items-center gap-3 rounded-lg bg-[var(--card-2)] p-3 ring-1 ring-[var(--line)]">
                  <span
                    className={clsx(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold',
                      r?.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/15 text-sky-300',
                    )}
                  >
                    {r?.ok ? '✓' : x.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-100">{x.title}</span>
                    <span className={clsx('block text-xs', r ? (r.ok ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-400')}>{r ? r.message : x.hint || x.text}</span>
                  </span>
                  {!r?.ok && (
                    <Button primary disabled={busy || (x.key === 'preset' && !recommended)} onClick={() => void x.action()}>
                      {x.label}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="text-slate-400">Tip: hover a label (like Beta or Power hungry) to see what it means.</p>
        </>
      ),
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="page-in w-full max-w-xl space-y-4 rounded-2xl bg-[var(--panel)] p-6 shadow-2xl ring-1 ring-[var(--line)]">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={clsx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-sky-400' : i < step ? 'w-3 bg-sky-400/50' : 'w-3 bg-white/15')} />
            ))}
          </div>
          <button onClick={onDone} className="text-xs text-slate-400 hover:text-slate-200">
            Skip guide
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25">
            <Icon name={s.icon} className="h-5 w-5" />
          </span>
          <h2 id="guide-title" className="text-xl font-semibold text-slate-50">
            {s.title}
          </h2>
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-slate-300">{s.body}</div>
        <div className="flex justify-between gap-2 pt-1">
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <Button primary onClick={() => (last ? onDone() : setStep(step + 1))}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
