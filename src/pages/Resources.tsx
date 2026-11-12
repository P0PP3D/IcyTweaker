import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppState, BenchResult, DriverBackupView, DriverInfo, DriverJobView, DriverLatency, LatencyCheck, ToolStatus, Progress, RuntimeResult, RuntimeView, ShortcutView, SystemCheckStep } from '../../shared/types';
import { Icon } from '../icons';
import { Badge, Button, CheckList, FeatureCard, MUTED_BADGE, Tabs, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

function DriverReinstall({ busy, act, ask, onJob }: { busy: boolean; act: Act; ask: Ask; onJob: (j: DriverJobView | null) => void }) {
  const [info, setInfo] = useState<DriverInfo | null>(null);
  const [job, setJob] = useState<DriverJobView | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const load = () =>
    window.api.driverInfo().then((r) => {
      setInfo(r.info);
      setJob(r.job);
      onJob(r.job);
    });
  useEffect(() => {
    void load();
    return window.api.onProgress((p) => p.task === 'driver' && setProgress(p.current ? p : null));
  }, []);

  async function begin() {
    const ok = await ask(
      'Reinstall the graphics driver?',
      `1. Downloads NVIDIA driver ${info!.latest!.version} (${info!.latest!.size}) from NVIDIA and checks its signature.\n2. Installs Display Driver Uninstaller (DDU) if needed.\n3. DDU removes the current driver completely and restarts the PC. The screen may flicker and run at low resolution until the new driver is in.\n4. After you sign in, IcyTweaker opens: press Continue to install the new driver.\n\nA restore point is created first. Save your work: the PC restarts.`,
      'Begin',
      'REINSTALL',
    );
    if (!ok) return;
    await act(async () => {
      const r = await window.api.beginDriverJob(true);
      setJob(r.job);
      onJob(r.job);
      return r.report;
    });
    setProgress(null);
  }

  async function resume() {
    await act(async () => {
      const r = await window.api.resumeDriverJob();
      setJob(r.job);
      onJob(r.job);
      return r.report;
    });
  }

  const upToDate = !!info?.latest && info.installed === info.latest.version;
  const waiting = job?.step === 'cleaning';
  return (
    <FeatureCard
      icon="bolt"
      title="Automated Driver Reinstall"
      subtitle="Clean graphics driver installation"
      tag="Elite"
      footer={
        waiting ? (
          <>
            <Button disabled={busy} onClick={() => window.api.clearDriverJob().then(load)}>
              Cancel job
            </Button>
            <Button primary disabled={busy} onClick={resume}>
              <Icon name="play" className="h-4 w-4" />
              Continue: install {job!.version}
            </Button>
          </>
        ) : (
          <>
            {(job?.step === 'done' || job?.step === 'failed') && (
              <Button disabled={busy} onClick={() => window.api.clearDriverJob().then(load)}>
                Dismiss
              </Button>
            )}
            <Button primary disabled={busy || !info?.latest || !!progress} onClick={begin}>
              <Icon name="play" className="h-4 w-4" />
              {progress ? 'Working…' : 'Begin Automation'}
            </Button>
          </>
        )
      }
    >
      <p>Reinstalls your graphics driver with the latest official NVIDIA driver. Display Driver Uninstaller removes the old one completely first, so nothing old is left behind.</p>
      <CheckList items={['Clean driver installation', 'Latest official NVIDIA driver, signature checked', 'Survives the restart in the middle']} />
      <div className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card-2)] px-4 py-2.5">
        <span className="font-semibold text-slate-100">{info?.vendor ?? '…'}</span>
        <span className="text-slate-400">
          Installed <span className="font-semibold text-slate-100">{info?.installed ?? '—'}</span>
        </span>
        <span className="text-slate-400">
          Available <span className={clsx('font-semibold', upToDate ? 'text-emerald-300' : 'text-slate-100')}>{info ? (info.latest?.version ?? '—') : 'checking…'}</span>
          {upToDate && <span className="text-emerald-300"> (up to date)</span>}
        </span>
      </div>
      {info?.error && <p className="text-amber-300">{info.error}</p>}
      {progress && (
        <p className="text-sky-300">
          {progress.current}
          {progress.total > 0 && ` · ${formatBytes(progress.done)} of ${formatBytes(progress.total)}`}
        </p>
      )}
      {job && <p className={clsx(job.step === 'failed' ? 'text-rose-300' : 'text-sky-200')}>{job.message}</p>}
    </FeatureCard>
  );
}

function Latency({ busy }: { busy: boolean }) {
  const [res, setRes] = useState<{ result?: LatencyCheck; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const r = res?.result;
  const tone = { good: 'text-emerald-300', check: 'text-amber-300', bad: 'text-rose-300' } as const;
  return (
    <FeatureCard
      icon="wave"
      title="Latency check"
      subtitle="Are drivers causing stutter or audio crackle?"
      footer={
        <Button
          primary
          disabled={busy || running}
          onClick={async () => {
            setRunning(true);
            setRes(await window.api.latencyCheck(20));
            setRunning(false);
          }}
        >
          <Icon name="play" className="h-4 w-4" />
          {running ? 'Measuring 20 s…' : 'Run check (20 s)'}
        </Button>
      }
    >
      <p>Measures how much CPU time drivers spend handling interrupts (DPC and ISR). Run it while the problem happens, for example during a game or while audio plays.</p>
      {res?.error && <p className="text-rose-300">{res.error}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['DPC average', `${r.dpc.avg}%`],
                ['DPC peak', `${r.dpc.peak}% (core ${r.dpc.core})`],
                ['ISR average', `${r.isr.avg}%`],
                ['ISR peak', `${r.isr.peak}% (core ${r.isr.core})`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-2">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="font-semibold text-slate-100">{v}</div>
              </div>
            ))}
          </div>
          <p className={tone[r.verdict]}>{r.advice}</p>
        </>
      )}
      <DriverTrace busy={busy} />
    </FeatureCard>
  );
}

/** Names the driver: a short kernel trace with Microsoft's Windows Performance Toolkit. */
function DriverTrace({ busy }: { busy: boolean }) {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [res, setRes] = useState<{ drivers?: DriverLatency[]; error?: string } | null>(null);
  const [state, setState] = useState<'idle' | 'installing' | 'tracing'>('idle');
  const [note, setNote] = useState<string>();
  const load = () => window.api.toolStatus().then(setTools);
  useEffect(() => void load(), []);
  if (!tools) return null;
  return (
    <div className="space-y-2 border-t border-[var(--line)] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-slate-100">Find the driver</div>
          <div className="text-xs text-slate-400">Records 15 seconds of driver activity with Microsoft's Windows Performance Toolkit and lists the slowest drivers. Needs administrator.</div>
        </div>
        {tools.wpt ? (
          <Button
            disabled={busy || state !== 'idle'}
            onClick={async () => {
              setState('tracing');
              setRes(await window.api.traceDrivers(15));
              setState('idle');
            }}
          >
            {state === 'tracing' ? 'Tracing 15 s…' : 'Find the driver'}
          </Button>
        ) : (
          <Button
            disabled={busy || state !== 'idle'}
            onClick={async () => {
              setState('installing');
              const r = await window.api.installWpt();
              setNote(r.message);
              setState('idle');
              await load();
            }}
          >
            {state === 'installing' ? 'Installing…' : 'Install the toolkit (one-time)'}
          </Button>
        )}
      </div>
      {note && <p className="text-xs text-slate-400">{note}</p>}
      {res?.error && <p className="text-rose-300">{res.error}</p>}
      {res?.drivers && (
        <ul className="space-y-1">
          {res.drivers.length === 0 && <li className="text-slate-400">No driver activity was recorded.</li>}
          {res.drivers.slice(0, 8).map((d, i) => (
            <li key={`${d.kind}${d.module}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-1.5">
              <span className={clsx('font-mono', i === 0 && d.maxUs >= 1000 ? 'text-rose-300' : 'text-slate-100')}>{d.module}</span>
              <span className="text-xs text-slate-400">
                {d.kind} · longest up to {d.maxUs >= 1000 ? `${(d.maxUs / 1000).toFixed(1)} ms` : `${d.maxUs} µs`} · {d.count.toLocaleString()} calls
              </span>
            </li>
          ))}
        </ul>
      )}
      {res?.drivers?.[0] && res.drivers[0].maxUs >= 1000 && (
        <p className="text-xs text-amber-300">Over 1 ms at a time is long enough to cause stutter or crackle. Update or reinstall the driver that owns {res.drivers[0].module}.</p>
      )}
    </div>
  );
}

function DriverBackups({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [list, setList] = useState<DriverBackupView[]>([]);
  const load = () => window.api.driverBackups().then(setList);
  useEffect(() => void load(), []);
  return (
    <FeatureCard
      icon="download"
      title="Driver backup"
      subtitle="Every third-party driver, exported with Windows' own pnputil"
      footer={
        <Button primary disabled={busy} onClick={() => act(() => window.api.backupDrivers()).then(load)}>
          Back up drivers now
        </Button>
      }
    >
      <p>Saves a copy of every installed third-party driver (graphics, network, audio, chipset) so you can put one back if an update goes wrong. The driver reinstall does this automatically first.</p>
      {list.length === 0 ? (
        <p className="text-slate-500">No backups yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-2">
              <span className="flex-1 text-slate-200">
                {new Date(b.created).toLocaleString()} <span className="text-slate-500">· {b.packages} driver package(s)</span>
              </span>
              <Button disabled={busy} onClick={() => window.api.openDriverBackup(b.id)}>
                Open folder
              </Button>
              <Button
                disabled={busy || b.packages === 0}
                onClick={async () => {
                  if (!(await ask('Reinstall these drivers?', `Reinstalls all ${b.packages} driver package(s) from this backup. A restore point is created first; a restart may be needed.`, 'Reinstall'))) return;
                  await act(() => window.api.restoreDriverBackup(b.id));
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </FeatureCard>
  );
}

function Runtimes({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [list, setList] = useState<RuntimeView[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, RuntimeResult>>(new Map());
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    void window.api.runtimes().then((l) => {
      setList(l);
      setPicked(new Set(l.map((r) => r.id)));
    });
    return window.api.onProgress((p) => p.task === 'runtimes' && setProgress(p.current ? p : null));
  }, []);
  const toggle = (id: string, on: boolean) => setPicked((s) => (on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id))));

  async function install() {
    const ok = await ask(
      `Install ${picked.size} runtime(s)?`,
      'Uses winget (Windows Package Manager) to download the official installers from Microsoft and install them one at a time. Anything already installed is skipped. A restore point is created first. Installed runtimes stay installed: remove them in Settings > Apps if you need to.',
      'Install',
    );
    if (!ok) return;
    await act(async () => {
      const r = await window.api.installRuntimes([...picked]);
      setResults(new Map(r.results.map((x) => [x.id, x])));
      return r.report;
    });
    setProgress(null);
  }

  const groups = [...new Set(list.map((r) => r.group))];
  return (
    <FeatureCard
      icon="download"
      title="Runtime & DirectX Installer"
      subtitle="Everything games and apps need to start"
      footer={
        <Button primary disabled={busy || picked.size === 0} onClick={install}>
          <Icon name="play" className="h-4 w-4" />
          {progress ? `Installing ${progress.done + 1}/${progress.total}…` : `Install selected (${picked.size})`}
        </Button>
      }
    >
      <p>Downloads and installs Visual C++, DirectX and the .NET Desktop Runtime from Microsoft. Fixes "missing DLL" errors such as MSVCP140, VCRUNTIME140 and d3dx9_43.</p>
      {progress && <p className="text-sky-300">{progress.current}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map((g) => (
          <fieldset key={g} className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-slate-500">{g}</legend>
            {list
              .filter((r) => r.group === g)
              .map((r) => {
                const res = results.get(r.id);
                return (
                  <label key={r.id} className="flex items-start gap-2 text-slate-300">
                    <input type="checkbox" className="mt-1 accent-sky-500" checked={picked.has(r.id)} disabled={busy} onChange={(e) => toggle(r.id, e.target.checked)} />
                    <span>
                      {r.name}
                      {res && <span className={clsx('block text-xs', res.ok ? 'text-emerald-300' : 'text-rose-300')}>{res.summary}</span>}
                    </span>
                  </label>
                );
              })}
          </fieldset>
        ))}
      </div>
    </FeatureCard>
  );
}

const STEP_NAMES = ['Check disk (C:)', 'System File Checker', 'Windows image repair (DISM)'];

function SystemCheck({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [steps, setSteps] = useState<SystemCheckStep[] | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => window.api.onProgress((p) => p.task === 'system-check' && setProgress(p)), []);

  async function check() {
    const ok = await ask(
      'Run the system check?',
      'Runs, in order: a disk scan of C:, System File Checker, and DISM image repair. Damaged system files are repaired. It usually takes 15–45 minutes; you can keep using the PC. DISM downloads repair files through Windows Update if it needs them.',
      'Run check',
    );
    if (!ok) return;
    setRunning(true);
    setSteps(null);
    await act(async () => {
      const r = await window.api.runSystemCheck();
      setSteps(r.steps);
      return r.report;
    });
    setRunning(false);
    setProgress(null);
  }

  return (
    <FeatureCard
      icon="pulse"
      title="System Corruption Check"
      subtitle="chkdsk, SFC and DISM, in order"
      footer={
        <Button primary disabled={busy || running} onClick={check}>
          <Icon name="play" className="h-4 w-4" />
          {running ? 'Running…' : 'Run check'}
        </Button>
      }
    >
      <p>Finds and repairs damaged Windows system files, with a plain summary of each step.</p>
      {!state.isAdmin && <p className="text-amber-300">Needs administrator.</p>}
      <ol className="space-y-2">
        {STEP_NAMES.map((name, i) => {
          const result = steps?.[i];
          const active = running && progress && progress.done === i;
          return (
            <li key={name} className="flex items-start gap-3">
              <span
                className={clsx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', result ? (result.ok ? 'bg-emerald-400' : 'bg-rose-400') : active ? 'animate-pulse bg-sky-400' : 'bg-white/15')}
              />
              <div className="min-w-0">
                <div className="text-slate-200">{name}</div>
                <div className={clsx('truncate text-xs', result && !result.ok ? 'text-rose-300' : 'text-slate-400')}>
                  {result ? result.summary : active ? progress?.current.replace(`${name}: `, '') || 'Starting…' : ''}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </FeatureCard>
  );
}

function Shortcuts({ busy, act }: { busy: boolean; act: Act }) {
  const [shortcuts, setShortcuts] = useState<ShortcutView[]>([]);
  useEffect(() => void window.api.shortcuts().then(setShortcuts), []);
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shortcuts.map((s) => (
        <li key={s.id} className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100">{s.name}</span>
            {s.requiresAdmin && <Badge className="bg-violet-500/15 text-violet-300 ring-violet-500/30">admin</Badge>}
            {s.restarts && <Badge className={MUTED_BADGE}>restarts</Badge>}
          </div>
          <p className="text-sm text-slate-400">{s.description}</p>
          <div className="mt-auto pt-1">
            <Button disabled={busy} onClick={() => act(() => window.api.openShortcut(s.id))}>
              {s.restarts ? 'Restart to BIOS' : 'Open'}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Standby memory: what Windows keeps cached; can be freed by hand (Game Boost can do it during play). */
/** Quick benchmark: run before and after tweaks; each row compares with the run before it. */
function Benchmark({ busy }: { busy: boolean }) {
  const [history, setHistory] = useState<BenchResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => void window.api.benchmarks().then(setHistory), []);
  useEffect(() => window.api.onProgress((p) => p.task === 'benchmark' && setStep(p.current)), []);
  const run = async () => {
    setRunning(true);
    setError(undefined);
    const r = await window.api.runBenchmark();
    setHistory(r.history);
    setError(r.error);
    setRunning(false);
  };
  const [now, before] = history ?? [];
  const METRICS: Array<{ k: keyof Omit<BenchResult, 'at'>; label: string; unit: string }> = [
    { k: 'cpuSingle', label: 'CPU, one core', unit: 'MB/s' },
    { k: 'cpuMulti', label: 'CPU, all cores', unit: 'MB/s' },
    { k: 'memory', label: 'Memory', unit: 'GB/s' },
    { k: 'diskWrite', label: 'Disk write', unit: 'MB/s' },
    { k: 'diskRead', label: 'Disk read', unit: 'MB/s' },
  ];
  return (
    <FeatureCard
      icon="bolt"
      title="Quick benchmark"
      subtitle="About 10 seconds. Run it before and after tweaks to compare"
      footer={
        <Button primary disabled={busy || running} onClick={() => void run()}>
          {running ? `Running: ${step || 'starting'}…` : now ? 'Run again' : 'Run benchmark'}
        </Button>
      }
    >
      {error && <p className="text-rose-300">{error}</p>}
      {!now ? (
        <p>Measures CPU speed (one core and all cores), memory speed and disk speed, all on this PC. Close games and big downloads first for steady numbers.</p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {METRICS.map((m) => {
              const pct = before && before[m.k] ? Math.round(((now[m.k] - before[m.k]) / before[m.k]) * 100) : null;
              return (
                <li key={m.k} className="rounded-lg bg-[var(--card-2)] px-3 py-2 ring-1 ring-[var(--line)]">
                  <div className="text-xs text-slate-400">{m.label}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold tabular-nums text-slate-50">{now[m.k].toLocaleString()}</span>
                    <span className="text-xs text-slate-500">{m.unit}</span>
                    {pct !== null && (
                      <span className={clsx('ml-auto text-xs font-medium tabular-nums', Math.abs(pct) < 3 ? 'text-slate-400' : pct > 0 ? 'text-emerald-300' : 'text-amber-300')}>
                        {pct > 0 ? '+' : ''}
                        {pct}%
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-500">
            Last run {new Date(now.at).toLocaleString()}
            {before ? `, compared with ${new Date(before.at).toLocaleString()}. Changes under 3% are normal run-to-run noise.` : '. Run it again after changing something to compare.'}
          </p>
        </>
      )}
    </FeatureCard>
  );
}

function StandbyMemory({ busy, act }: { busy: boolean; act: Act }) {
  const [m, setM] = useState<{ freeMb: number; standbyMb: number } | { error: string } | null>(null);
  const load = () => window.api.memoryStatus().then(setM);
  useEffect(() => void load(), []);
  const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
  return (
    <FeatureCard
      icon="chip"
      title="Standby memory"
      subtitle="Recently used files Windows keeps in RAM"
      footer={
        <>
          <Button
            primary
            disabled={busy || (m !== null && 'error' in m)}
            onClick={async () => {
              await act(() => window.api.purgeStandby());
              await load();
            }}
          >
            Free standby memory
          </Button>
          <Button disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
        </>
      }
    >
      {!m ? (
        <p className="text-sm text-slate-400">Reading…</p>
      ) : 'error' in m ? (
        <p className="text-sm text-amber-300">{m.error}</p>
      ) : (
        <div className="flex gap-8 text-sm">
          <div>
            <div className="text-2xl font-semibold tabular-nums text-slate-50">{gb(m.freeMb)}</div>
            <div className="text-xs text-slate-500">free</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums text-slate-50">{gb(m.standbyMb)}</div>
            <div className="text-xs text-slate-500">standby (cached)</div>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Windows gives standby memory back when a program needs it, so a full standby list is normal. Some games still stutter when free memory runs out; freeing it can help. Files load from disk again afterwards. Game Boost can do this automatically during play.
      </p>
    </FeatureCard>
  );
}

export function Resources({ state, busy, act, ask, onDriverJob }: { state: AppState; busy: boolean; act: Act; ask: Ask; onDriverJob: (j: DriverJobView | null) => void }) {
  const [tab, setTab] = useState<'automation' | 'diagnostics' | 'check' | 'shortcuts'>('automation');
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Resources</h2>
        <p className="text-sm text-slate-400">Drivers, runtimes, Windows repair, and quick ways into Windows tools.</p>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'automation', label: 'Automation', icon: 'sliders' },
          { id: 'diagnostics', label: 'Diagnostics', icon: 'wave' },
          { id: 'check', label: 'System check', icon: 'pulse' },
          { id: 'shortcuts', label: 'Shortcuts', icon: 'wave' },
        ]}
      />
      {tab === 'automation' ? (
        <div className="space-y-4">
          <DriverReinstall busy={busy} act={act} ask={ask} onJob={onDriverJob} />
          <Runtimes busy={busy} act={act} ask={ask} />
        </div>
      ) : tab === 'diagnostics' ? (
        <div className="space-y-4">
          <Benchmark busy={busy} />
          <Latency busy={busy} />
          <StandbyMemory busy={busy} act={act} />
          <DriverBackups busy={busy} act={act} ask={ask} />
        </div>
      ) : tab === 'check' ? (
        <SystemCheck state={state} busy={busy} act={act} ask={ask} />
      ) : (
        <Shortcuts busy={busy} act={act} />
      )}
    </section>
  );
}
