import { useState } from 'react';
import clsx from 'clsx';
import type { ActionReport, AppMode, AppState, SimpleOptimizeResult } from '../shared/types';
import { Icon, type IconName } from './icons';
import { Button, formatBytes, useModal } from './ui';

/** Pages the guide can open. */
export type GuidePage = 'general' | 'presets' | 'health' | 'games' | 'focus' | 'restore' | 'startup' | 'devices';

/** Opens the beginner guide from anywhere (Home, Settings). */
export const openGuide = () => window.dispatchEvent(new Event('icy:guide'));

interface Step {
  icon: IconName;
  title: string;
  body: React.ReactNode;
}

/** Plain-words summary of Simple mode's Optimize (also on Simple Home). */
export const optimizeSummary = (r: SimpleOptimizeResult, live: boolean) =>
  r.ok
    ? `${r.improved ? `${r.improved} setting(s) improved` : 'Your settings were already in good shape'}, ${formatBytes(r.freed)} of junk ${live ? 'cleaned' : 'would be cleaned (dry-run)'}.${r.estimate ? ` Expected: ${r.estimate} (an estimate).` : ''} Everything can be undone.`
    : r.message;

/**
 * First screen: Simple or Advanced, with what each one shows. Then a short tutorial for the chosen mode: Simple ends
 * with its Optimize button; Advanced is the full tour and first steps. Shown on first start; reopen it from Settings
 * (which also lets you switch modes).
 */
export function Onboarding({
  state,
  mode,
  onMode,
  onDone,
  go,
}: {
  state: AppState;
  mode: AppMode | null;
  onMode: (m: AppMode) => void;
  onDone: () => void;
  go: (p: GuidePage) => void;
}) {
  const [chosen, setChosen] = useState<AppMode | null>(null); // null: the choice screen
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // the step running; the guide can't be closed meanwhile
  const [done, setDone] = useState<Record<string, ActionReport>>({});
  const recommended = state.presets.find((p) => p.id === 'safe-optimize');

  async function run(key: string, fn: () => Promise<ActionReport>) {
    setBusy(key);
    const r = await fn().catch((e) => ({ ok: false, message: String(e) }));
    setDone((d) => ({ ...d, [key]: r }));
    setBusy(null);
  }
  const close = () => !busy && onDone();
  const open = (p: GuidePage) => {
    if (busy) return;
    onDone();
    go(p);
  };
  const choose = (m: AppMode) => {
    onMode(m);
    setChosen(m);
    setStep(0);
  };
  const dialog = useModal(close, chosen); // the guide's element exists only once a mode is chosen

  if (!chosen) return <ModeChoice current={mode} onChoose={choose} onSkip={mode ? close : undefined} />;

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

  const Page = ({ icon, title, text }: { icon: IconName; title: string; text: string }) => (
    <li className="flex items-start gap-3 rounded-lg bg-[var(--card-2)] p-3 ring-1 ring-[var(--line)]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-100">{title}</span>
        <span className="block text-xs text-slate-400">{text}</span>
      </span>
    </li>
  );

  const optimized = done.optimize as SimpleOptimizeResult | undefined;
  const simpleSteps: Step[] = [
    {
      icon: 'home',
      title: 'Four easy pages',
      body: (
        <>
          <p>Simple mode keeps just what you need, in plain words. Find these on the left:</p>
          <ul className="space-y-2">
            <Page icon="home" title="Home" text="One Optimize my PC button, and a quick health check with a one-click fix for anything that needs it." />
            <Page icon="trash" title="Clean up" text="Frees space by removing junk files and emptying the Recycle Bin." />
            <Page icon="gamepad" title="Games" text="Game Boost and Focus Mode: two switches that help while you play." />
            <Page icon="undo" title="Undo" text="Puts everything back if something doesn't feel right." />
          </ul>
          {!state.live && <p className="text-sky-300">You're in dry-run mode: changes are only simulated, nothing is written to Windows.</p>}
        </>
      ),
    },
    {
      icon: 'shield',
      title: "You can't break anything",
      body: (
        <>
          <p>IcyTweaker only makes safe changes in Simple mode, and it keeps a copy of everything before changing it.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A Windows restore point is made before every change, so Windows itself can roll back.</li>
            <li>
              The <b className="text-slate-100">Undo</b> page puts back today's changes, or everything, with one click.
            </li>
            <li>Nothing is deleted that you'd miss: only temporary files and caches that Windows and apps make again.</li>
          </ul>
        </>
      ),
    },
    {
      icon: 'sparkles',
      title: "Let's speed up your PC",
      body: (
        <>
          <p>
            <b className="text-slate-100">Optimize my PC</b> turns on the safe settings that help games, cleans up junk, and keeps cleaning once a week by itself. It takes a minute or
            two. You can also do this later from Home.
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-[var(--card-2)] p-3 ring-1 ring-[var(--line)]">
            <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full', optimized?.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/15 text-sky-300')}>
              {optimized?.ok ? '✓' : <Icon name="bolt" className="h-4 w-4" />}
            </span>
            <span className={clsx('min-w-0 flex-1 text-sm', optimized ? (optimized.ok ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-300')}>
              {busy === 'optimize' ? 'Optimizing… this can take a minute or two.' : optimized ? optimizeSummary(optimized, state.live) : recommended?.estimate ? `Expected: ${recommended.estimate} (an estimate).` : 'Safe changes only.'}
            </span>
            {busy === 'optimize' ? (
              <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" aria-hidden />
            ) : (
              !optimized?.ok && (
                <Button primary disabled={!!busy} onClick={() => void run('optimize', () => window.api.simpleOptimize())}>
                  Optimize my PC
                </Button>
              )
            )}
          </div>
          {!state.isAdmin && state.live && <p className="text-amber-300">Some settings need administrator: start IcyTweaker as administrator to get all of them.</p>}
        </>
      ),
    },
  ];

  const advancedSteps: Step[] = [
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
          <p>This short guide takes about a minute. You can skip it and reopen it any time from Settings.</p>
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
                working: 'Creating the restore point… this can take a minute.',
                hint: !state.isAdmin && state.live ? 'Needs administrator: relaunch as admin first, or skip.' : '',
              },
              {
                key: 'preset',
                n: 2,
                title: `Apply ${recommended?.name ?? 'Safe Optimize'}`,
                text: 'Only tweaks with no downside. The recommended start.',
                action: () => run('preset', () => window.api.applyPreset(recommended!.id)),
                label: 'Apply',
                working: 'Applying tweaks… this can take a minute.',
                hint: '',
              },
              { key: 'clean', n: 3, title: 'Run a Health Check', text: 'Find out how much safe junk can go.', action: () => open('health'), label: 'Open', working: '', hint: '' },
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
                    <span className={clsx('block text-xs', busy === x.key ? 'text-sky-300' : r ? (r.ok ? 'text-emerald-300' : 'text-rose-300') : 'text-slate-400')}>
                      {busy === x.key ? x.working : r ? r.message : x.hint || x.text}
                    </span>
                  </span>
                  {busy === x.key ? (
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" aria-hidden />
                  ) : (
                    !r?.ok && (
                      <Button primary disabled={!!busy || (x.key === 'preset' && !recommended)} onClick={() => void x.action()}>
                        {x.label}
                      </Button>
                    )
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

  const steps = chosen === 'simple' ? simpleSteps : advancedSteps;
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div ref={dialog} className="page-in w-full max-w-xl space-y-4 rounded-2xl bg-[var(--panel)] p-6 shadow-2xl ring-1 ring-[var(--line)]">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={clsx('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-sky-400' : i < step ? 'w-3 bg-sky-400/50' : 'w-3 bg-white/15')} />
            ))}
          </div>
          <button onClick={close} disabled={!!busy} className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40">
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
          {/* Back from the first step returns to the mode choice. */}
          <Button disabled={!!busy} onClick={() => (step === 0 ? setChosen(null) : setStep(step - 1))}>
            Back
          </Button>
          <Button primary disabled={!!busy} onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The first thing a new user sees: Simple or Advanced, side by side, with what each one shows. */
function ModeChoice({ current, onChoose, onSkip }: { current: AppMode | null; onChoose: (m: AppMode) => void; onSkip?: () => void }) {
  const dialog = useModal(onSkip); // first run has no onSkip: Escape does nothing, a mode must be chosen
  const Option = ({ m, icon, title, tag, points }: { m: AppMode; icon: IconName; title: string; tag: string; points: string[] }) => (
    <button
      type="button"
      onClick={() => onChoose(m)}
      className={clsx(
        'group flex flex-col gap-3 rounded-2xl p-5 text-left ring-1 transition hover:-translate-y-0.5 hover:bg-sky-500/10 hover:ring-sky-400/60',
        current === m ? 'bg-sky-500/10 ring-sky-400/60' : 'bg-[var(--card)] ring-[var(--line)]',
      )}
    >
      <span className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-lg font-semibold text-slate-50">{title}</span>
          <span className="block text-xs text-sky-300">{tag}</span>
        </span>
      </span>
      <ul className="space-y-1.5 text-sm text-slate-300">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            {p}
          </li>
        ))}
      </ul>
      <span className="mt-auto pt-1 text-sm font-medium text-sky-300 group-hover:text-sky-200">{current === m ? 'Keep this mode ›' : `Choose ${title} ›`}</span>
    </button>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="mode-title">
      <div ref={dialog} className="page-in w-full max-w-3xl space-y-5 rounded-2xl bg-[var(--panel)] p-6 shadow-2xl ring-1 ring-[var(--line)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="mode-title" className="text-2xl font-semibold text-slate-50">
              Welcome to IcyTweaker
            </h2>
            <p className="text-sm text-slate-400">How would you like to use it? Both are safe, and you can switch any time in Settings.</p>
          </div>
          {onSkip && (
            <button onClick={onSkip} className="shrink-0 text-xs text-slate-400 hover:text-slate-200">
              Close
            </button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Option
            m="simple"
            icon="sparkles"
            title="Simple"
            tag="Recommended if you're not into PC settings"
            points={[
              'One "Optimize my PC" button does all the safe work for you',
              'Just four easy pages: Home, Clean up, Games and Undo',
              'Plain words, no technical settings',
              'A health check that says what needs attention, with a one-click fix',
              'Only safe changes; everything can be undone',
            ]}
          />
          <Option
            m="advanced"
            icon="sliders"
            title="Advanced"
            tag="For people who like to choose every setting"
            points={[
              'Every tweak with its own switch, plus presets',
              'Services, network, Windows features, BIOS and driver tools',
              'Game profiles, overlay, benchmarks and analyzers',
              'Debloater, startup apps and the full cleaner',
              'The same safety: backups, restore points and undo',
            ]}
          />
        </div>
      </div>
    </div>
  );
}
