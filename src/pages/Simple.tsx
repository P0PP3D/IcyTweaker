// Simple mode: four plain pages (Home, Clean up, Games, Undo) built on the same safe features as Advanced mode.
// No timers here: the pages ask once when opened, so nothing polls in the background.
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppSettings, AppState, BoostState, CleanTargetView, FocusInfo, SimpleOptimizeResult } from '../../shared/types';
import { Icon, type IconName } from '../icons';
import { Button, Loading, Toggle, formatBytes, type Ask } from '../ui';
import { optimizeSummary } from '../Onboarding';
import type { Act } from './General';

export type SimplePage = 'home' | 'cleanup' | 'play' | 'undo' | 'settings';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Late night session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

type Light = 'green' | 'yellow' | 'red';
const LIGHT: Record<Light, string> = { green: 'bg-emerald-400', yellow: 'bg-amber-400', red: 'bg-rose-500' };
const LIGHT_LABEL: Record<Light, string> = { green: 'Good', yellow: 'Worth a look', red: 'Needs attention' };

/** One traffic-light line: a plain sentence and, when something can be done, one button. */
function Check({ light, title, text, action }: { light: Light | null; title: string; text: string; action?: { label: string; run: () => void } }) {
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      {light ? (
        <span className={clsx('h-3.5 w-3.5 shrink-0 rounded-full', LIGHT[light])} role="img" aria-label={LIGHT_LABEL[light]} title={LIGHT_LABEL[light]} />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-100">{title}</div>
        <div className="text-sm text-slate-400">{text}</div>
      </div>
      {action && <Button onClick={action.run}>{action.label}</Button>}
    </li>
  );
}

const months = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / (30.44 * 86_400_000)));

export function SimpleHome({ state, act, go }: { state: AppState; act: Act; go: (p: SimplePage) => void }) {
  const [result, setResult] = useState<SimpleOptimizeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [drive, setDrive] = useState<{ free: number; total: number } | null | undefined>(undefined);
  const [gpu, setGpu] = useState<{ vendor: string; date: string | null } | null | undefined>(undefined);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void window.api.systemDrive().then(setDrive, () => setDrive(null));
    void window.api.getSettings().then(setSettings);
    void window.api.checkups().then(
      (c) => {
        // The graphics card that matters for games: a dedicated one over Intel's built-in graphics.
        // NVIDIA first: on laptops with an AMD CPU, the Radeon built-in graphics would otherwise win.
        const has = (re: RegExp) => c.gpus.find((x) => re.test(`${x.vendor} ${x.name}`));
        const g = has(/nvidia/i) ?? has(/amd|advanced micro|radeon/i) ?? c.gpus[0];
        setGpu(g ? { vendor: /nvidia/i.test(`${g.vendor} ${g.name}`) ? 'NVIDIA' : /amd|advanced micro|radeon/i.test(`${g.vendor} ${g.name}`) ? 'AMD' : 'Intel', date: g.driverDate } : null);
      },
      () => setGpu(null),
    );
  }, []);

  const preset = state.presets.find((p) => p.id === 'safe-optimize');
  const ids = new Set(preset?.tweakIds ?? []);
  // Same skips as the preset's bulk apply: tweaks it won't touch must not keep this row yellow forever.
  const off = state.tweaks.filter((t) => ids.has(t.id) && t.risk !== 'risky' && t.supported && !t.unfit && (t.status === 'not_applied' || t.status === 'partial')).length;

  const optimize = async () => {
    if (running) return; // the health-check row's Optimize button stays clickable
    setRunning(true);
    await act(async () => {
      const r = await window.api.simpleOptimize();
      setResult(r);
      return { ok: r.ok, message: optimizeSummary(r, state.live) };
    });
    setRunning(false);
    void window.api.systemDrive().then(setDrive, () => {});
    void window.api.getSettings().then(setSettings);
  };

  const freePct = drive ? (100 * drive.free) / drive.total : null;
  const driverAge = gpu?.date ? months(gpu.date) : null;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-50">{greeting()}</h2>
        <p className="text-sm text-slate-400">Here's how your PC is doing, and one button to make it faster.</p>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-gradient-to-br from-sky-500/15 to-transparent p-6 ring-1 ring-sky-500/30">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/40">
          <Icon name="bolt" className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-semibold text-slate-50">Optimize my PC</div>
          <p className="text-sm text-slate-300" aria-live="polite">
            {result
              ? optimizeSummary(result, state.live)
              : 'Turns on the safe settings that help games, cleans up junk, and keeps cleaning every week. Takes a minute or two. Everything can be undone.'}
          </p>
          {!result && preset?.estimate && <p className="mt-1 text-xs text-slate-400">Expected: {preset.estimate} (an estimate, not measured on your PC).</p>}
        </div>
        <Button primary disabled={running} onClick={() => void optimize()}>
          {running ? 'Optimizing…' : result?.ok ? 'Run again' : 'Optimize my PC'}
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-300">Health check</h3>
        <ul className="divide-y divide-[var(--line)] rounded-2xl bg-[var(--card)] ring-1 ring-[var(--line)]">
          <Check
            light={off === 0 ? 'green' : 'yellow'}
            title={off === 0 ? 'All safe improvements are on' : `${off} safe improvement${off === 1 ? '' : 's'} could be turned on`}
            text={off === 0 ? 'Your Windows settings are set up for gaming.' : 'Optimize my PC turns them on. They have no downside.'}
            action={off === 0 ? undefined : { label: 'Optimize', run: () => void optimize() }}
          />
          <Check
            light={drive === undefined ? null : freePct === null ? 'yellow' : freePct < 8 ? 'red' : freePct < 15 ? 'yellow' : 'green'}
            title={drive === undefined ? 'Checking free space…' : drive ? `${formatBytes(drive.free)} free on your Windows drive` : "Couldn't read your drive's free space"}
            text={
              freePct === null
                ? 'Windows needs free space to update and run smoothly.'
                : freePct < 8
                  ? 'Almost full: Windows and games slow down without free space.'
                  : freePct < 15
                    ? 'Getting full. Cleaning up can free some space.'
                    : `${Math.round(freePct)}% of the drive is free. Plenty of room.`
            }
            action={freePct !== null && freePct < 15 ? { label: 'Free up space', run: () => go('cleanup') } : undefined}
          />
          <Check
            light={gpu === undefined ? null : driverAge === null ? 'yellow' : driverAge >= 12 ? 'red' : driverAge >= 6 ? 'yellow' : 'green'}
            title={gpu === undefined ? 'Checking your graphics driver…' : driverAge === null ? 'Graphics driver age unknown' : `Graphics driver updated ${driverAge === 0 ? 'this month' : `${driverAge} month${driverAge === 1 ? '' : 's'} ago`}`}
            text={
              driverAge !== null && driverAge >= 6
                ? 'Newer drivers often make games run better and fix crashes.'
                : 'The graphics driver is what lets games use your graphics card.'
            }
            action={gpu ? { label: driverAge !== null && driverAge < 6 ? 'Check for updates' : 'Update', run: () => void act(() => window.api.openGpuApp(gpu.vendor)) } : undefined}
          />
          {state.rebootPending.length > 0 && (
            <Check
              light="yellow"
              title="Restart to finish"
              text={`${state.rebootPending.length} change${state.rebootPending.length === 1 ? '' : 's'} take effect after a restart.`}
              action={{ label: 'Restart', run: () => void act(() => window.api.restart()) }}
            />
          )}
          <Check
            light={settings === null ? null : settings.weeklyClean ? 'green' : 'yellow'}
            title={settings?.weeklyClean ? 'Cleans itself every week' : 'Weekly cleanup is off'}
            text={settings?.weeklyClean ? 'Junk files are removed once a week while your PC is idle.' : 'Turn it on and junk files are cleaned once a week, by themselves.'}
            action={
              settings && !settings.weeklyClean
                ? { label: 'Turn on', run: () => void window.api.setSettings({ ...settings, weeklyClean: true }).then(setSettings) }
                : undefined
            }
          />
        </ul>
      </div>
      <p className="text-xs text-slate-500">Want to choose every setting yourself? Switch to Advanced mode in Settings.</p>
    </section>
  );
}

/** Safe junk (the Health Check's safe items) and the Recycle Bin, each with one button. */
export function SimpleClean({ state, act, ask }: { state: AppState; act: Act; ask: Ask }) {
  const [targets, setTargets] = useState<CleanTargetView[] | null>(null);
  const [junk, setJunk] = useState<number | null>(null);
  const [bin, setBin] = useState<number | null>(null);
  const [working, setWorking] = useState<'junk' | 'bin' | null>(null);
  const scan = useCallback(async () => {
    const all = await window.api.listCleanTargets();
    const safe = all.filter((t) => t.risk === 'safe' && t.defaultSelected && (!t.requiresAdmin || state.isAdmin || !state.live));
    setTargets(safe);
    setJunk(null);
    setBin(null);
    const [j, b] = await Promise.all([window.api.scanCleanTargets(safe.map((t) => t.id)), window.api.scanCleanTargets(['recycle-bin'])]);
    setJunk(j.reduce((a, r) => a + r.bytes, 0));
    setBin(b[0]?.bytes ?? 0);
  }, [state.isAdmin, state.live]);
  useEffect(() => void scan(), [scan]);

  const run = async (kind: 'junk' | 'bin') => {
    if (kind === 'bin' && !(await ask('Empty the Recycle Bin?', "Files in the Recycle Bin are deleted for good and can't be brought back.", 'Empty it'))) return;
    setWorking(kind);
    await act(async () => (await window.api.cleanTargets(kind === 'junk' ? (targets ?? []).map((t) => t.id) : ['recycle-bin'])).report);
    setWorking(null);
    await scan();
  };

  const Card = ({ icon, title, text, bytes, kind, label }: { icon: IconName; title: string; text: string; bytes: number | null; kind: 'junk' | 'bin'; label: string }) => (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-[var(--card)] p-5 ring-1 ring-[var(--line)]">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold text-slate-50">{title}</div>
        <p className="text-sm text-slate-400">{text}</p>
        {bytes === null ? <Loading text="Measuring…" className="mt-1" /> : <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{formatBytes(bytes)}</p>}
      </div>
      <Button primary={kind === 'junk'} danger={kind === 'bin'} disabled={working !== null || !bytes} onClick={() => void run(kind)}>
        {working === kind ? (kind === 'junk' ? 'Cleaning…' : 'Emptying…') : bytes === 0 ? 'Nothing to clean' : label}
      </Button>
    </div>
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Clean up</h2>
        <p className="text-sm text-slate-400">Free up space without losing anything you'd miss.</p>
      </div>
      <Card
        icon="sparkles"
        title="Junk files"
        text="Temporary files, old caches and crash reports. Windows and your apps make them again when they need them."
        bytes={junk}
        kind="junk"
        label="Clean up"
      />
      <Card icon="trash" title="Recycle Bin" text="Files you deleted are kept here until it's emptied." bytes={bin} kind="bin" label="Empty Recycle Bin" />
    </section>
  );
}

/** Game Boost and Focus Mode as two plain switches. */
export function SimplePlay({ act }: { act: Act }) {
  const [boost, setBoost] = useState<BoostState | null>(null);
  const [focus, setFocus] = useState<FocusInfo | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    void window.api.getBoost().then(setBoost);
    void window.api.focusInfo().then(setFocus);
  }, []);

  const Row = ({ icon, title, text, on, onChange, disabled, extra }: { icon: IconName; title: string; text: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; extra?: string }) => (
    <label className="flex items-center gap-5 rounded-2xl bg-[var(--card)] p-5 ring-1 ring-[var(--line)]">
      <span className={clsx('grid h-14 w-14 shrink-0 place-items-center rounded-2xl ring-1', on ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' : 'bg-sky-500/10 text-sky-300 ring-sky-500/30')}>
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-slate-50">{title}</span>
        <span className="block text-sm text-slate-400">{text}</span>
        {extra && <span className="mt-1 block text-sm text-emerald-300">{extra}</span>}
      </span>
      <Toggle on={on} label={title} disabled={disabled} onChange={onChange} />
    </label>
  );

  if (!boost || !focus) return <Loading text="Loading…" />;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Games</h2>
        <p className="text-sm text-slate-400">Two switches that help while you play. Turn them off and everything goes back.</p>
      </div>
      <Row
        icon="gamepad"
        title="Game Boost"
        text="When you start a game, IcyTweaker gives it priority and uses your fastest power setting. When you close the game, everything goes back."
        on={boost.settings.enabled}
        extra={boost.active ? `Boosting ${boost.active.game} right now.` : undefined}
        onChange={(v) => void window.api.setBoost({ ...boost.settings, enabled: v }).then(setBoost)}
      />
      <Row
        icon="bolt"
        title="Focus Mode"
        text="Pauses Windows background work (updates, indexing) and closes apps like OneDrive while you play. Turn it off and they all come back."
        on={!!focus.state}
        disabled={switching}
        extra={switching ? (focus.state ? 'Turning off…' : 'Turning on…') : undefined}
        onChange={(v) => {
          setSwitching(true);
          void act(() => window.api.setFocus(v))
            .then(() => window.api.focusInfo().then(setFocus))
            .finally(() => setSwitching(false));
        }}
      />
      <Row
        icon="sparkles"
        title="Focus Mode during games only"
        text="Focus Mode turns on by itself when Game Boost sees a game start, and off when it closes."
        on={!!focus.settings.withBoost}
        onChange={(v) => void window.api.setFocusSettings({ ...focus.settings, withBoost: v }).then(setFocus)}
      />
    </section>
  );
}

/** One-click ways back: today's changes, everything, or Windows' own restore point. */
export function SimpleUndo({ state, act, ask }: { state: AppState; act: Act; ask: Ask }) {
  const today = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };
  const Option = ({ icon, title, text, label, danger, run }: { icon: IconName; title: string; text: string; label: string; danger?: boolean; run: () => void }) => (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-[var(--card)] p-5 ring-1 ring-[var(--line)]">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold text-slate-50">{title}</div>
        <p className="text-sm text-slate-400">{text}</p>
      </div>
      <Button danger={danger} disabled={state.backupCount === 0 && label !== 'Open'} onClick={run}>
        {label}
      </Button>
    </div>
  );
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Undo</h2>
        <p className="text-sm text-slate-400">
          Something doesn't feel right? Put things back. {state.backupCount === 0 ? "IcyTweaker hasn't changed anything yet." : `IcyTweaker has changed ${state.backupCount} setting(s) so far.`}
        </p>
      </div>
      <Option
        icon="undo"
        title="Undo today's changes"
        text="Puts back every setting IcyTweaker changed today. Older changes stay."
        label="Undo today"
        run={() =>
          void ask("Undo today's changes?", 'Every setting IcyTweaker changed today goes back to how it was. A restore point is made first.', 'Undo today').then(
            (ok) => void (ok && act(() => window.api.undoSince(today()))),
          )
        }
      />
      <Option
        icon="restore"
        title="Undo everything"
        text="Puts back every setting IcyTweaker ever changed, as if it had never been used."
        label="Undo everything"
        danger
        run={() =>
          void ask('Undo everything?', 'Every setting IcyTweaker ever changed goes back to how it was. A restore point is made first.', 'Undo everything').then(
            (ok) => void (ok && act(() => window.api.undoAll())),
          )
        }
      />
      <Option
        icon="shield"
        title="Roll Windows back"
        text="Opens Windows' own System Restore, to go back to a restore point. It works even without IcyTweaker."
        label="Open"
        run={() => void act(() => window.api.openSystemRestore())}
      />
    </section>
  );
}
