import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { ActionReport, AppState, DriverJobView, Progress, Risk } from '../shared/types';
import { Settings } from './pages/Settings';
import { Devices } from './pages/Devices';
import { Startup } from './pages/Startup';
import { Focus } from './pages/Focus';
import { OldDrivers } from './pages/OldDrivers';
import { WinFeatures } from './pages/WinFeatures';
import { Duplicates, OldFiles, Privacy } from './pages/Finder';
import { Onboarding } from './Onboarding';
import { Debloater } from './pages/Debloater';
import { Fixes } from './pages/Fixes';
import { General, appliedCount, tweakHandlers } from './pages/General';
import { Home } from './pages/Home';
import { Presets } from './pages/Presets';
import { SystemRestore } from './pages/SystemRestore';
import { CleanerPage, HealthCheck, RecycleBin } from './pages/Cleaner';
import { Analyzer } from './pages/Analyzer';
import { DriveHealth } from './pages/DriveHealth';
import { Services } from './pages/Services';
import { Network } from './pages/Network';
import { Resources } from './pages/Resources';
import { Games } from './pages/Games';
import { AppOptimizer } from './pages/AppOptimizer';
import { Advanced, Bios } from './pages/Advanced';
import { Icon, Logo, type IconName } from './icons';
import { Banner, Button, ConfirmDialog, Loading, TweakRow, type Ask } from './ui';
import { applyTheme } from './theme';

const PAGES = ['home', 'general', 'debloater', 'fixes', 'presets', 'restore', 'services', 'network', 'resources', 'games', 'appopt', 'advanced', 'bios', 'health', 'smart', 'browsers', 'apps', 'analyzer', 'drives', 'duplicates', 'oldfiles', 'privacy', 'recycle', 'settings', 'devices', 'startup', 'focus', 'olddrivers', 'features'] as const;
type Page = (typeof PAGES)[number];
type Confirm = { title: string; body: string; confirmLabel: string; typeToConfirm?: string; resolve: (ok: boolean) => void };
/** Tweaks the Re-Enable Defender fix reverses. */
const DEFENDER_TWEAKS = ['disable-defender', 'rt-scan-trim', 'security-quiet'];
type NavItem ={ id: Page; label: string; icon: IconName; count?: string };

/** Window title bar: breadcrumb on the left, window buttons on the right. The bar itself drags the window. */
function TitleBar({ crumb }: { crumb: string }) {
  const btn = 'no-drag flex h-8 w-10 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-slate-100';
  return (
    <div className="drag flex h-12 shrink-0 items-center justify-between pl-5 pr-2">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Icon name="grid" className="h-4 w-4 text-slate-500" />
        <Icon name="chevron" className="h-3.5 w-3.5 text-slate-600" />
        <span className="text-slate-300">{crumb}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className={btn} aria-label="Minimize" onClick={() => window.api.windowControl('minimize')}>
          <Icon name="minimize" className="h-4 w-4" />
        </button>
        <button className={btn} aria-label="Maximize" onClick={() => window.api.windowControl('maximize')}>
          <Icon name="maximize" className="h-3.5 w-3.5" />
        </button>
        <button className={clsx(btn, 'hover:!bg-rose-600 hover:!text-white')} aria-label="Close" onClick={() => window.api.windowControl('close')}>
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Full-window status while Windows makes a restore point or is about to restart (both can take a while). */
function Activity() {
  const [task, setTask] = useState<'restore-point' | 'restart' | null>(null);
  const [bulk, setBulk] = useState<Progress | null>(null); // presets, Apply All, Undo All: a restore point can show on top
  const [left, setLeft] = useState(5);
  useEffect(
    () =>
      window.api.onProgress((p) => {
        if (p.task === 'bulk') return setBulk(p.current ? p : null);
        if (p.task !== 'restore-point' && p.task !== 'restart') return;
        setTask(p.current ? p.task : null);
        if (p.task === 'restart') setLeft(5);
      }),
    [],
  );
  useEffect(() => {
    if (task !== 'restart') return;
    // shutdown /t 5. If the window is still here well after that (dry-run, or the restart was stopped), let go.
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    const done = setTimeout(() => setTask(null), 9000);
    return () => {
      clearInterval(t);
      clearTimeout(done);
    };
  }, [task]);
  if (!task && bulk)
    return (
      <div role="alertdialog" aria-live="polite" aria-label={`Applying ${bulk.label ?? ''}`} className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm animate-[fadein_.2s_ease-out]">
        <div className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-[var(--panel)] p-6 text-center shadow-2xl ring-1 ring-[var(--line)]">
          <div className="relative mx-auto mb-4 h-16 w-16">
            <div className="absolute inset-0 rounded-full border-4 border-sky-500/20" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-sky-400" />
            {bulk.total > 0 && <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-sky-300">{Math.round((bulk.done / bulk.total) * 100)}%</div>}
          </div>
          <div className="text-lg font-semibold text-slate-100">{bulk.label}…</div>
          <p className="mt-1 truncate text-sm text-slate-400">{bulk.total > 0 ? `${bulk.done + 1} of ${bulk.total}: ${bulk.current}` : bulk.current}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            {bulk.total > 0 ? (
              <div className="h-full rounded-full bg-sky-400 transition-[width] duration-300" style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
            ) : (
              <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-sky-400" />
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">Every change is backed up. Please keep IcyTweaker open.</p>
        </div>
      </div>
    );
  if (!task) return null;
  const rp = task === 'restore-point';
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={rp ? 'Creating a restore point' : 'Restarting Windows'} className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm animate-[fadein_.2s_ease-out]">
      <div className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-[var(--panel)] p-6 text-center shadow-2xl ring-1 ring-[var(--line)]">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-sky-500/20" />
          {/* Always moves (no motion-safe): it's a progress signal, and many gaming PCs turn Windows animations off. */}
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-sky-400" />
          <div className="absolute inset-0 grid place-items-center text-xl font-semibold text-sky-300">{rp ? '' : Math.max(left, 0)}</div>
        </div>
        <div className="text-lg font-semibold text-slate-100">{rp ? 'Creating a restore point…' : left > 0 ? `Restarting in ${left}…` : 'Restarting…'}</div>
        <p className="mt-1 text-sm text-slate-400">
          {rp ? 'Windows is saving a snapshot of your system settings. This usually takes under a minute; please keep IcyTweaker open.' : 'Save your work now. Windows will close your apps and restart.'}
        </p>
        {rp && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-sky-400" />
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<(ActionReport & { undo?: () => Promise<ActionReport> }) | null>(null);
  const [page, setPage] = useState<Page>(() => {
    try {
      const saved = localStorage.getItem('lastPage');
      return PAGES.find((p) => p === saved) ?? 'home';
    } catch {
      return 'home';
    }
  });
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [driverJob, setDriverJob] = useState<DriverJobView | null>(null);
  const [drifted, setDrifted] = useState<Array<{ id: string; name: string; risk: Risk }>>([]);
  // Sidebar sections the user folded (remembered between runs).
  const [foldedSections, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('foldedSections') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggleSection = (title: string) =>
    setFolded((f) => {
      const next = f.includes(title) ? f.filter((x) => x !== title) : [...f, title];
      try {
        localStorage.setItem('foldedSections', JSON.stringify(next));
      } catch {
        // just not remembered
      }
      return next;
    });
  // The beginner guide, reopened from Home or Settings (openGuide in Onboarding.tsx).
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const show = () => setGuide(true);
    window.addEventListener('icy:guide', show);
    return () => window.removeEventListener('icy:guide', show);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setState(await window.api.getState()), []);
  useEffect(() => void refresh().catch((e) => setReport({ ok: false, message: String(e) })), [refresh]);
  // Notifications go away by themselves: 4 s, errors 8 s (more to read). Each new one restarts the timer.
  useEffect(() => {
    if (!report) return;
    const t = setTimeout(() => setReport(null), report.ok ? 4000 : 8000);
    return () => clearTimeout(t);
  }, [report]);
  // Launch-time re-check: tweaks the app applied that Windows has since undone.
  useEffect(() => void window.api.drifted().then(setDrifted), []);
  const [winUpdate, setWinUpdate] = useState<{ from: string; to: string } | null>(null);
  // A downloaded IcyTweaker update: banner with Restart now (installing on quit never reopens the app).
  const [appUpdate, setAppUpdate] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    void window.api.updateReady().then(setAppUpdate);
    return window.api.onProgress((p) => p.task === 'update' && !p.current && p.total > 0 && void window.api.updateReady().then(setAppUpdate));
  }, []);
  useEffect(() => void window.api.windowsUpdateInfo().then(setWinUpdate), []);
  useEffect(() => void window.api.getSettings().then(applyTheme), []);
  // Remember the page between runs.
  useEffect(() => {
    try {
      localStorage.setItem('lastPage', page);
    } catch {
      // not remembered this time
    }
  }, [page]);
  // Ctrl+K: search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCollapsed(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A driver reinstall waiting after its restart: take the user straight to it.
  useEffect(() => {
    void window.api.driverJob().then((j) => {
      setDriverJob(j);
      if (j?.step === 'cleaning') setPage('resources');
    });
  }, []);

  // A new question cancels any open one, so no caller is left waiting forever.
  const ask: Ask = (title, body, confirmLabel = 'Confirm', typeToConfirm) =>
    new Promise((resolve) =>
      setConfirm((prev) => {
        prev?.resolve(false);
        return { title, body, confirmLabel, typeToConfirm, resolve };
      }),
    );

  async function act(fn: () => Promise<ActionReport>, undo?: () => Promise<ActionReport>) {
    setBusy(true);
    try {
      const r = await fn();
      setReport({ ...r, undo: r.ok ? undo : undefined });
    } catch (e) {
      setReport({ ok: false, message: String(e) });
    } finally {
      await refresh().catch(() => {});
      setBusy(false);
    }
  }

  if (!state) return <div className="drag flex h-screen items-center justify-center"><Loading text="Reading system state…" /></div>;

  const q = query.trim().toLowerCase();
  const results = q ? state.tweaks.filter((t) => `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)) : [];
  const adminNeeded = state.tweaks.filter((t) => t.requiresAdmin).length;
  // Security trade-offs that are on (performance-only Risky tweaks such as MSI mode don't lower protection).
  const riskyActive = state.tweaks.filter((t) => t.risk === 'risky' && t.category === 'security' && (t.status === 'applied' || t.status === 'partial'));

  const sections: Array<{ title: string; items: NavItem[] }> = [
    {
      title: 'General',
      items: [
        { id: 'home', label: 'Home', icon: 'home' },
        { id: 'restore', label: 'System Restore', icon: 'restore' },
        { id: 'resources', label: 'Resources', icon: 'grid' },
        { id: 'fixes', label: 'Fixes', icon: 'wrench' },
        { id: 'presets', label: 'Presets', icon: 'layers' },
        { id: 'startup', label: 'Startup Apps', icon: 'list' },
        { id: 'settings', label: 'Settings', icon: 'sliders' },
      ],
    },
    {
      title: 'Tweaks',
      items: [
        { id: 'general', label: 'General', icon: 'sliders', count: appliedCount(state.tweaks) },
        { id: 'debloater', label: 'Debloating', icon: 'trash' },
        { id: 'network', label: 'Networking', icon: 'network' },
        { id: 'services', label: 'Services', icon: 'services' },
        { id: 'games', label: 'Game Profiles', icon: 'gamepad' },
        { id: 'focus', label: 'Focus Mode', icon: 'bolt' },
        { id: 'appopt', label: 'App Optimizer', icon: 'app' },
        { id: 'devices', label: 'Devices', icon: 'laptop' },
        { id: 'features', label: 'Windows Features', icon: 'grid' },
        { id: 'advanced', label: 'Advanced', icon: 'chip' },
        { id: 'bios', label: 'BIOS', icon: 'board' },
      ],
    },
    {
      title: 'Cleaner',
      items: [
        { id: 'health', label: 'Health Check', icon: 'pulse' },
        { id: 'smart', label: 'Smart Cleaner', icon: 'sparkles' },
        { id: 'browsers', label: 'Browsers', icon: 'globe' },
        { id: 'apps', label: 'App Caches', icon: 'box' },
        { id: 'analyzer', label: 'Disk Analyzer', icon: 'pie' },
        { id: 'drives', label: 'Drive Health', icon: 'drive' },
        { id: 'duplicates', label: 'Duplicate Finder', icon: 'layers' },
        { id: 'oldfiles', label: 'Old Files', icon: 'restore' },
        { id: 'privacy', label: 'Privacy Traces', icon: 'globe' },
        { id: 'recycle', label: 'Recycle Bin', icon: 'trash' },
        { id: 'olddrivers', label: 'Old Drivers', icon: 'chip' },
      ],
    },
  ];
  const current = sections.flatMap((s) => s.items).find((i) => i.id === page) ?? sections[0].items[0];
  const pageProps = { state, busy, act, ask };
  const go = (id: Page) => {
    setPage(id);
    setQuery('');
  };

  return (
    <div className="flex h-screen text-slate-200">
      <Activity />
      {busy && (
        <div role="progressbar" aria-label="Working" className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-sky-500/15">
          <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-sky-400" />
        </div>
      )}
      <aside className={clsx('sidebar-glow flex shrink-0 flex-col overflow-hidden transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-64')}>
        <div className="drag flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-8 w-8 shrink-0" />
            {!collapsed && (
              <span className="truncate text-[15px] font-semibold tracking-tight text-slate-50">
                Icy<span className="font-normal text-slate-400">Tweaker</span>
              </span>
            )}
          </div>
          {!collapsed && (
            <button className="no-drag rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200" aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}>
              <Icon name="panel" className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed ? (
          <button className="mx-auto mb-2 rounded-md p-2 text-slate-500 hover:bg-white/10 hover:text-slate-200" aria-label="Expand sidebar" onClick={() => setCollapsed(false)}>
            <Icon name="panel" className="h-4 w-4" />
          </button>
        ) : (
          <label className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white/[0.03] px-3 py-1.5 focus-within:border-sky-500/50">
            <Icon name="search" className="h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              ref={searchRef}
              placeholder="Search tweaks…  Ctrl+K"
              aria-label="Search all tweaks"
              className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </label>
        )}

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {sections.map((s) => {
            // A folded section still shows the page you're on, so you never lose your place.
            const folded = !collapsed && foldedSections.includes(s.title);
            return (
            <div key={s.title} className="pt-3">
              {!collapsed && (
                <button
                  onClick={() => toggleSection(s.title)}
                  aria-expanded={!folded}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 pb-1.5 text-left text-xs font-medium text-slate-500 hover:text-slate-300"
                >
                  <Icon name="chevron" className={clsx('h-3 w-3 transition-transform', folded ? 'rotate-0' : 'rotate-90')} />
                  <span className="flex-1">{s.title}</span>
                  {folded && <span className="text-[11px] text-slate-600">{s.items.length}</span>}
                </button>
              )}
              <div>
                {s.items.map((n) => {
                  const active = !q && page === n.id;
                  // Folding slides each item's height to zero and fades it (grid rows 1fr -> 0fr animate smoothly).
                  // Always animated, like the spinners: short, and many users have Windows animations off.
                  const hidden = folded && !active;
                  return (
                    <div
                      key={n.id}
                      className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
                      style={{ gridTemplateRows: hidden ? '0fr' : '1fr', opacity: hidden ? 0 : 1 }}
                      aria-hidden={hidden || undefined}
                      inert={hidden || undefined}
                    >
                    <div className="min-h-0 overflow-hidden">
                    <button
                      onClick={() => go(n.id)}
                      title={collapsed ? n.label : undefined}
                      aria-label={n.label}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'mb-0.5 flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm transition',
                        collapsed ? 'justify-center px-0' : 'px-2.5',
                        active ? 'nav-active text-slate-50' : 'text-slate-300 hover:bg-white/[0.04] hover:text-slate-100',
                      )}
                    >
                      <Icon name={n.icon} className={clsx('h-[18px] w-[18px] shrink-0', active ? 'text-sky-300' : 'text-slate-400')} />
                      {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                      {!collapsed && n.count && <span className="rounded-md border border-[var(--line)] bg-white/[0.04] px-1.5 text-xs text-slate-400">{n.count}</span>}
                    </button>
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </nav>

      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar crumb={q ? 'Search' : current.label} />
        <main className="flex-1 overflow-y-auto rounded-tl-2xl border-l border-t border-[var(--line)] bg-[var(--panel)]">
          <div className="mx-auto max-w-5xl space-y-4 p-6">
            {!state.live && <Banner tone="info">Dry-run mode: changes are simulated in memory and nothing is written to Windows.</Banner>}
            {appUpdate && (
              <Banner tone="info">
                <span>IcyTweaker {appUpdate} is ready. Restart to install it; the app reopens by itself.</span>
                <Button
                  primary
                  disabled={installing}
                  onClick={() => {
                    setInstalling(true);
                    void window.api.installUpdate();
                  }}
                >
                  {installing ? 'Restarting…' : 'Restart now'}
                </Button>
              </Banner>
            )}
            {winUpdate && drifted.length === 0 && (
              <Banner tone="info">
                <span>
                  Windows updated (build {winUpdate.from} to {winUpdate.to}). All the tweaks you applied are still in place.
                </span>
                <Button onClick={() => setWinUpdate(null)}>Dismiss</Button>
              </Banner>
            )}
            {drifted.length > 0 && (
              <Banner tone="warn">
                <span>
                  {winUpdate ? `Windows updated (build ${winUpdate.from} to ${winUpdate.to}) and put back` : 'Windows undid'} {drifted.length} tweak(s) you applied
                  {winUpdate ? '' : ' (usually after an update)'}: {drifted.map((d) => d.name).join(', ')}.
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button disabled={busy} onClick={() => setDrifted([])}>
                    Dismiss
                  </Button>
                  <Button
                    primary
                    disabled={busy}
                    onClick={async () => {
                      const risky = drifted.filter((d) => d.risk === 'risky');
                      if (risky.length && !(await ask('Re-apply Risky tweaks too?', `These are Risky and were on before:\n${risky.map((r) => `• ${r.name}`).join('\n')}`, 'Re-apply all'))) return;
                      await act(() => window.api.reapply(drifted.map((d) => d.id), risky.length > 0));
                      setDrifted(await window.api.drifted());
                    }}
                  >
                    Re-apply
                  </Button>
                </span>
              </Banner>
            )}
            {driverJob?.step === 'cleaning' && page !== 'resources' && (
              <Banner tone="info">
                <span>A driver reinstall is waiting to finish after the restart.</span>
                <Button primary onClick={() => go('resources')}>
                  Continue
                </Button>
              </Banner>
            )}
            {riskyActive.length > 0 && (
              <Banner tone="danger">
                <span>Protection is reduced: {riskyActive.map((t) => t.name).join(', ')}.</span>
                {riskyActive.some((t) => DEFENDER_TWEAKS.includes(t.id)) && (
                  <Button disabled={busy} onClick={() => go('fixes')}>
                    Re-Enable Defender
                  </Button>
                )}
              </Banner>
            )}
            {!state.isAdmin && (
              <Banner tone="warn">
                <span>Not running as administrator. {adminNeeded} tweak(s), most fixes and restore points need admin rights.</span>
                <Button primary disabled={busy} onClick={() => act(() => window.api.relaunchAsAdmin())}>
                  Relaunch as admin
                </Button>
              </Banner>
            )}
            {state.rebootPending.length > 0 && (
              <Banner tone="reboot">
                <span>Restart (or sign out) to finish: {state.rebootPending.join(', ')}.</span>
                <Button disabled={busy} onClick={() => act(() => window.api.restart())}>
                  Restart now
                </Button>
              </Banner>
            )}

            {/* Keyed by page: each page fades in as you switch to it. */}
            <div key={q ? 'search' : page} className="page-in">
            {q ? (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-slate-100">
                  Search: “{query.trim()}” <span className="text-sm font-normal text-slate-500">{results.length} result(s)</span>
                </h2>
                <ul className="space-y-2">
                  {results.map((t) => (
                    <TweakRow key={t.id} t={t} busy={busy} {...tweakHandlers(t, act, ask)} />
                  ))}
                </ul>
              </section>
            ) : page === 'home' ? (
              <Home state={state} go={go} />
            ) : page === 'general' ? (
              <General {...pageProps} />
            ) : page === 'debloater' ? (
              <Debloater {...pageProps} />
            ) : page === 'fixes' ? (
              <Fixes {...pageProps} />
            ) : page === 'services' ? (
              <Services {...pageProps} />
            ) : page === 'network' ? (
              <Network {...pageProps} />
            ) : page === 'resources' ? (
              <Resources {...pageProps} onDriverJob={setDriverJob} />
            ) : page === 'advanced' ? (
              <Advanced {...pageProps} />
            ) : page === 'bios' ? (
              <Bios busy={busy} act={act} />
            ) : page === 'games' ? (
              <Games busy={busy} act={act} ask={ask} />
            ) : page === 'appopt' ? (
              <AppOptimizer {...pageProps} />
            ) : page === 'health' ? (
              <HealthCheck {...pageProps} />
            ) : page === 'smart' ? (
              <CleanerPage key="system" group="system" {...pageProps} />
            ) : page === 'browsers' ? (
              <CleanerPage key="browser" group="browser" {...pageProps} />
            ) : page === 'apps' ? (
              <CleanerPage key="app" group="app" {...pageProps} />
            ) : page === 'analyzer' ? (
              <Analyzer {...pageProps} />
            ) : page === 'drives' ? (
              <DriveHealth {...pageProps} />
            ) : page === 'devices' ? (
              <Devices {...pageProps} />
            ) : page === 'features' ? (
              <WinFeatures {...pageProps} />
            ) : page === 'olddrivers' ? (
              <OldDrivers busy={busy} act={act} ask={ask} />
            ) : page === 'focus' ? (
              <Focus busy={busy} act={act} />
            ) : page === 'startup' ? (
              <Startup busy={busy} act={act} ask={ask} />
            ) : page === 'settings' ? (
              <Settings state={state} busy={busy} act={act} ask={ask} />
            ) : page === 'duplicates' ? (
              <Duplicates busy={busy} act={act} ask={ask} />
            ) : page === 'oldfiles' ? (
              <OldFiles busy={busy} act={act} ask={ask} />
            ) : page === 'privacy' ? (
              <Privacy busy={busy} act={act} ask={ask} />
            ) : page === 'recycle' ? (
              <RecycleBin busy={busy} act={act} ask={ask} />
            ) : page === 'presets' ? (
              <Presets {...pageProps} />
            ) : (
              <SystemRestore {...pageProps} />
            )}
            </div>

          </div>
        </main>
      </div>

      {report && (
        <div className="fixed bottom-5 right-5 z-10 flex max-w-md items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--card-2)] px-4 py-3 shadow-2xl">
          <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', report.ok ? 'bg-emerald-400' : 'bg-rose-400')} />
          <p role="status" className={clsx('text-sm', report.ok ? 'text-slate-200' : 'text-rose-200')}>
            {report.message}
          </p>
          {report.undo && (
            <button
              className="shrink-0 rounded-md px-2 text-sm font-medium text-sky-300 hover:bg-white/10 disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                const undo = report.undo!;
                void act(undo);
              }}
            >
              Undo
            </button>
          )}
          <button className="text-slate-500 hover:text-slate-200" aria-label="Dismiss" onClick={() => setReport(null)}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          key={confirm.title + confirm.body} // fresh state (typed text) per question
          {...confirm}
          onClose={(ok) => {
            confirm.resolve(ok);
            setConfirm(null);
          }}
        />
      )}
      {(!state.onboarded || guide) && (
        <Onboarding
          state={state}
          go={(p) => go(p)}
          onDone={async () => {
            setGuide(false);
            if (!state.onboarded) await window.api.completeOnboarding();
            await refresh();
          }}
        />
      )}
    </div>
  );
}
