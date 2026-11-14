import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { BoostOptions, BoostState, DisplayMode, FanPoint, SensorReading, FroststrapInfo, FrametimeResult, ToolStatus, GameFlag, GameStatus, GameValues, GameView, GameWinSettings, LibraryGame, SessionReport } from '../../shared/types';
import { Badge, Button, Loading, MUTED_BADGE, Toggle, type Ask } from '../ui';
import type { Act } from './General';
import deadlockArt from '../assets/games/deadlock.jpg';
import dbdArt from '../assets/games/dead-by-daylight.jpg';
import outlastArt from '../assets/games/outlast-trials.jpg';
import fortniteLogo from '../assets/games/fortnite.png';
import valorantLogo from '../assets/games/valorant.png';
import robloxLogo from '../assets/games/roblox.png';

/** Game artwork (see Docs/ASSETS.md for sources). cover = Steam header art; logo = a logo on a color tile. */
const ART: Record<string, { src: string; kind: 'cover' } | { src: string; kind: 'logo'; bg: string; invert?: boolean }> = {
  deadlock: { src: deadlockArt, kind: 'cover' },
  'dead-by-daylight': { src: dbdArt, kind: 'cover' },
  'outlast-trials': { src: outlastArt, kind: 'cover' },
  fortnite: { src: fortniteLogo, kind: 'logo', bg: 'from-[#1e3a8a] via-[#4338ca] to-[#7c3aed]', invert: true },
  valorant: { src: valorantLogo, kind: 'logo', bg: 'from-[#0f1923] to-[#2a0e14]' },
  roblox: { src: robloxLogo, kind: 'logo', bg: 'from-[#1f2937] to-[#3f4b5c]', invert: true },
};

/** Full-window launch card: the game's art, a spinner while it starts, a check once its process is running. */
function Launching({ id, name, icon, phase, onClose }: { id: string; name: string; icon?: string | null; phase: 'starting' | 'running'; onClose: () => void }) {
  const running = phase === 'running';
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm animate-[fadein_.2s_ease-out]" onClick={onClose}>
      <div className="w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-[var(--panel)] shadow-2xl ring-1 ring-[var(--line)] animate-[launch-pop_.35s_cubic-bezier(.2,.9,.3,1.2)]" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          {ART[id] ? <GameArt id={id} name={name} large /> : <div className="grid h-40 place-items-center bg-gradient-to-br from-sky-900/60 to-slate-900">{icon ? <img src={icon} alt="" className="h-16 w-16" /> : <span className="text-3xl font-bold text-slate-200">{name.slice(0, 2)}</span>}</div>}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--panel)] via-transparent to-transparent" />
          {!running && <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-white/10"><div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-sky-400" /></div>}
        </div>
        <div className="flex items-center gap-4 p-5">
          <div className="relative grid h-12 w-12 shrink-0 place-items-center">
            {running ? (
              <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/20 text-2xl text-emerald-300 ring-2 ring-emerald-400/60 animate-[check-pop_.4s_ease-out]">✓</span>
            ) : (
              <>
                <span className="absolute inset-0 rounded-full border-4 border-sky-500/20" />
                <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-sky-400" />
                <span className="text-lg text-sky-300">▶</span>
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold text-slate-50">{running ? `${name} is running` : `Starting ${name}…`}</div>
            <p className="text-sm text-slate-400">{running ? 'Good luck, have fun.' : 'Opening through its launcher. If it asks you to sign in or update, finish that there.'}</p>
          </div>
          <Button onClick={onClose}>{running ? 'Close' : 'Hide'}</Button>
        </div>
      </div>
    </div>
  );
}

/** Resolutions competitive players use. 4:3 / 16:10 on a 16:9 screen = "stretched" when the GPU scales to full screen. */
const RES_PRESETS: Array<{ w: number; h: number; tag: string }> = [
  { w: 1920, h: 1080, tag: '16:9' },
  { w: 1600, h: 900, tag: '16:9' },
  { w: 1728, h: 1080, tag: '16:10 stretched' },
  { w: 1680, h: 1050, tag: '16:10 stretched' },
  { w: 1440, h: 1080, tag: '4:3 stretched' },
  { w: 1280, h: 960, tag: '4:3 stretched' },
  { w: 1024, h: 768, tag: '4:3 stretched' },
  { w: 1280, h: 1024, tag: '5:4 stretched' },
];

function ResolutionPresets({ width, height, onPick, disabled }: { width?: number; height?: number; onPick: (w: number, h: number) => void; disabled: boolean }) {
  // The main display's real pixels (devicePixelRatio undoes Windows scaling).
  const native = { w: Math.round(window.screen.width * window.devicePixelRatio), h: Math.round(window.screen.height * window.devicePixelRatio), tag: 'your screen' };
  const list = [native, ...RES_PRESETS.filter((p) => p.w !== native.w || p.h !== native.h)];
  const stretched = width && height && width / height < native.w / native.h - 0.02; // narrower than the screen (wider = ultrawide)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resolution presets">
        {list.map((p) => {
          const on = p.w === width && p.h === height;
          return (
            <button
              key={`${p.w}x${p.h}`}
              disabled={disabled}
              onClick={() => onPick(p.w, p.h)}
              aria-pressed={on}
              className={clsx('rounded-md px-2 py-1 text-xs ring-1 transition', on ? 'bg-sky-500/20 text-sky-200 ring-sky-500/50' : 'bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10')}
            >
              {p.w}×{p.h} <span className="text-slate-500">{p.tag}</span>
            </button>
          );
        })}
      </div>
      {stretched && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--card-2)] px-3 py-2 ring-1 ring-[var(--line)]">
          <p className="min-w-0 flex-1 text-xs text-slate-400">
            Stretched: also turn on Fullscreen below, and in NVIDIA Control Panel → Adjust desktop size and position pick <b>Full-screen</b> with scaling on <b>GPU</b> (AMD: GPU Scaling on, Full panel). Otherwise you get black bars.
          </p>
          <Button disabled={disabled} onClick={() => void window.api.openShortcut('nvidia-control-panel').then((r) => !r.ok && alert(r.message))}>
            Open NVIDIA Control Panel
          </Button>
        </div>
      )}
    </div>
  );
}

/** Wide game artwork: list thumbnails (small) and the editor banner (large). */
function GameArt({ id, name, large }: { id: string; name: string; large?: boolean }) {
  const art = ART[id];
  const box = large ? 'h-32 w-full rounded-xl' : 'h-9 w-[76px] shrink-0 rounded-md';
  if (!art) return <span className={clsx(box, 'flex items-center justify-center border border-[var(--line)] bg-[var(--card-2)] text-xs text-slate-400')}>{name}</span>;
  if (art.kind === 'cover') return <img src={art.src} alt={large ? name : ''} className={clsx(box, 'border border-[var(--line)] object-cover')} />;
  return (
    <span className={clsx(box, 'flex items-center justify-center overflow-hidden border border-[var(--line)] bg-gradient-to-br', art.bg)}>
      <img src={art.src} alt={large ? name : ''} className={clsx('max-h-[70%] max-w-[80%] object-contain', art.invert && 'brightness-0 invert')} />
    </span>
  );
}

const FLAG_LABEL: Record<GameFlag, string> = {
  fullscreen: 'Exclusive Fullscreen',
  borderless: 'Borderless Windowed',
  vsyncOff: 'Disable V-Sync',
  dynResOff: 'Disable Dynamic Resolution',
  hdrOff: 'Disable HDR Output',
  showFps: 'Show FPS Counter',
  lowEffects: 'Low Effects Quality',
  lowMaterials: 'Low Material Quality',
  lowTextures: 'Low Texture Quality',
  lowDetail: 'Low Detail Quality',
  shadowsOff: 'Disable Shadows',
  lowAa: 'Low Anti-Aliasing Quality',
  aoOff: 'Disable Ambient Occlusion',
  bloomOff: 'Disable Bloom',
  motionBlurOff: 'Disable Motion Blur',
  noLetterbox: 'Fill the screen (no black bars, for stretched)',
  dofOff: 'Disable Depth of Field',
};

const STATUS: Record<GameStatus, [string, string]> = {
  'not-installed': ['Not Installed', MUTED_BADGE],
  'no-config': ['No settings yet', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
  'not-optimized': ['Not Optimized', 'bg-slate-500/15 text-slate-200 ring-slate-500/30'],
  optimized: ['Optimized', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
};

const ORDER: GameStatus[] = ['optimized', 'not-optimized', 'no-config', 'not-installed'];

const PIN_KEY = 'pinnedGames';
const loadPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
  } catch {
    return [];
  }
};

/** Game Boost: the launch watcher. Status refreshes every few seconds while the page is open. */
function GameBoost({ busy, act }: { busy: boolean; act: Act }) {
  const [b, setB] = useState<BoostState | null>(null);
  /** Which options are being edited: 'all' = the defaults, or one game's own. */
  const [scope, setScope] = useState('all');
  const [overlay, setOverlay] = useState<{ running: boolean; game: string | null }>({ running: false, game: null });
  const [plans, setPlans] = useState<Array<{ guid: string; name: string; active: boolean }>>([]);
  useEffect(() => void window.api.powerPlans().then(setPlans), []);
  const [modes, setModes] = useState<DisplayMode[]>([]);
  useEffect(() => void window.api.displayModes().then(setModes), []);
  useEffect(() => {
    const load = () => {
      if (document.hidden) return;
      void window.api.getBoost().then(setB);
      void window.api.overlayStatus().then(setOverlay);
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  if (!b) return null;
  const s = b.settings;
  const custom = scope !== 'all' && !!s.perGame[scope];
  const o: BoostOptions = scope !== 'all' && s.perGame[scope] ? s.perGame[scope] : s;
  const saveAll = async (next: BoostState['settings']) => setB(await window.api.setBoost(next));
  /** Edits the options in scope: the defaults, or this game's own (creating them from the defaults). */
  const edit = (patch: Partial<BoostOptions>) =>
    scope === 'all' ? saveAll({ ...s, ...patch }) : saveAll({ ...s, perGame: { ...s.perGame, [scope]: { ...o, ...patch } } });
  const setCustom = (on: boolean) => {
    const perGame = { ...s.perGame };
    if (on) perGame[scope] = { plan: s.plan, planGuid: s.planGuid, lowerApps: [...s.lowerApps], pauseUpdates: s.pauseUpdates, pauseOneDrive: s.pauseOneDrive, purgeStandby: s.purgeStandby, display: s.display ?? null, quietNotifications: !!s.quietNotifications, fanCurve: s.fanCurve ?? null };
    else delete perGame[scope];
    return saveAll({ ...s, perGame });
  };
  const editable = scope === 'all' || custom;

  return (
    <div className="space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">Game Boost</span>
            {b.active ? (
              <Badge className="bg-emerald-500/15 text-emerald-300 ring-emerald-500/30">Boosting {b.active.game}</Badge>
            ) : s.enabled ? (
              <Badge className="bg-sky-500/15 text-sky-300 ring-sky-500/30">Watching</Badge>
            ) : null}
          </div>
          <p className="text-sm text-slate-400">
            Turn this on and IcyTweaker watches for your games (it checks every 10 seconds). When one starts, it switches on the options below; when the game closes, everything goes back
            exactly as it was. It keeps working while IcyTweaker is closed to the tray.
          </p>
          {b.active && (
            <p className="text-xs text-emerald-300">
              {b.active.plan ? `Power plan: ${b.active.plan}. ` : ''}
              {b.active.lowered} background process(es) lowered.
            </p>
          )}
        </div>
        <Toggle on={s.enabled} label="Game Boost" disabled={busy} onChange={(v) => saveAll({ ...s, enabled: v })} />
      </div>

      <p className="text-xs text-slate-500">
        Pick "All games" to set the options every game uses, or pick one game and tick "Use its own settings" to give it different ones (for example a fan curve only for your most
        demanding game).
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Options for</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Options for" className="rounded-md bg-white/5 px-2 py-1 text-slate-100 ring-1 ring-white/10">
          <option value="all">All games (default)</option>
          {b.games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {s.perGame[g.id] ? ' (own settings)' : ''}
            </option>
          ))}
        </select>
        {scope !== 'all' && (
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={custom} disabled={busy} onChange={(e) => setCustom(e.target.checked)} />
            Use its own settings
          </label>
        )}
      </div>

      <div className={clsx('space-y-2 text-sm text-slate-300', !editable && 'opacity-50')}>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <BoostOption
            label="Power plan"
            text="Switches Windows to a high-performance power plan so the CPU doesn't slow down to save power. Your usual plan comes back after. Skipped on battery when the laptop profile is on."
          >
            <input type="checkbox" checked={o.plan} disabled={busy || !editable} onChange={(e) => edit({ plan: e.target.checked })} aria-label="Power plan" />
            <select
              value={o.planGuid ?? ''}
              disabled={busy || !editable || !o.plan}
              onChange={(e) => edit({ planGuid: e.target.value || null })}
              aria-label="Power plan during play"
              className="min-w-0 flex-1 rounded-md bg-white/5 px-2 py-0.5 text-sm text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
            >
              <option value="">Best performance plan (automatic)</option>
              {plans.map((p) => (
                <option key={p.guid} value={p.guid}>
                  {p.name}
                  {plans.filter((x) => x.name === p.name).length > 1 ? ` (${p.guid.slice(0, 8)})` : ''}
                  {p.active ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </BoostOption>
          <BoostOption label="Display" text="Switches your main screen to this resolution and refresh rate while you play, and back after. Only modes your screen supports are listed.">
            <select
              value={o.display ? `${o.display.width}x${o.display.height}@${o.display.hz}` : ''}
              disabled={busy || !editable}
              onChange={(e) => edit({ display: modes.find((m) => `${m.width}x${m.height}@${m.hz}` === e.target.value) ?? null })}
              aria-label="Display mode during play"
              className="min-w-0 flex-1 rounded-md bg-white/5 px-2 py-0.5 text-sm text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
            >
              <option value="">Leave as is</option>
              {modes.map((m) => (
                <option key={`${m.width}x${m.height}@${m.hz}`} value={`${m.width}x${m.height}@${m.hz}`}>
                  {m.width}×{m.height} at {m.hz} Hz
                </option>
              ))}
            </select>
          </BoostOption>
          <BoostCheck label="Pause Windows Update" text="Stops Windows Update from downloading or installing mid-game. It starts again when you close the game. Needs administrator." checked={o.pauseUpdates} disabled={busy || !editable} onChange={(v) => edit({ pauseUpdates: v })} />
          <BoostCheck label="Pause OneDrive" text="Closes OneDrive so it doesn't sync files while you play. It reopens when you close the game." checked={o.pauseOneDrive} disabled={busy || !editable} onChange={(v) => edit({ pauseOneDrive: v })} />
          <BoostCheck
            label="Free standby memory when low"
            text="Every 30 seconds: if free memory drops under 1 GB, clears Windows' standby memory cache so the game has room. Needs administrator."
            checked={o.purgeStandby}
            disabled={busy || !editable}
            onChange={(v) => edit({ purgeStandby: v })}
          />
          <BoostCheck label="Do Not Disturb" text="Hides notification pop-ups while you play. Your notification setting comes back when you close the game." checked={!!o.quietNotifications} disabled={busy || !editable} onChange={(v) => edit({ quietNotifications: v })} />
        </div>
        <div>
          <div className="text-slate-200">Lower these apps' priority</div>
          <p className="mb-1.5 text-xs text-slate-500">They keep running, but Windows gives your game the CPU first. Their priority goes back to normal when you close the game.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {b.apps.map((a) => (
              <label key={a.exe} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={o.lowerApps.includes(a.exe)}
                  disabled={busy || !editable}
                  onChange={(e) => edit({ lowerApps: e.target.checked ? [...o.lowerApps, a.exe] : o.lowerApps.filter((x) => x !== a.exe) })}
                />
                {a.name}
              </label>
            ))}
          </div>
        </div>
        <FanCurveEditor key={scope} curve={o.fanCurve ?? null} disabled={busy || !editable} act={act} onChange={(fanCurve) => edit({ fanCurve })} />
        {!editable && <p className="text-xs text-slate-500">This game uses the defaults. Tick "Use its own settings" to change them for it only.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="block text-slate-200">In-game overlay</span>
          <span className="block text-xs text-slate-500">
            A small box in the corner of your game showing FPS, 1% low FPS (how bad the worst stutters are), GPU load and temperatures. It only shows over borderless or windowed
            games (exclusive fullscreen draws over it) and needs administrator. Clicks pass through it.
          </span>
        </span>
        <span className="flex items-center gap-2">
          <CpuTempSetup busy={busy} act={act} />
          {overlay.running ? (
            <Button disabled={busy} onClick={() => window.api.stopOverlay().then(() => setOverlay({ running: false, game: null }))}>
              Hide overlay ({overlay.game})
            </Button>
          ) : (
            <OverlayStart busy={busy} act={act} />
          )}
        </span>
      </div>
    </div>
  );
}

/** Game Boost page: live temperatures and fans (with a fan test), then Game Boost and the overlay. */
export function BoostPage({ busy, act }: { busy: boolean; act: Act }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Game Boost & overlay</h2>
        <p className="text-sm text-slate-400">
          Things IcyTweaker does only while you play: a faster power plan, quieter background apps, a fan curve and an FPS overlay. Nothing here changes your PC permanently; it's all
          undone when the game closes.
        </p>
      </div>
      <SensorPanel busy={busy} act={act} />
      <GameBoost busy={busy} act={act} />
    </section>
  );
}

/**
 * Live CPU / GPU temperature and fan speeds (read every 2 s while this panel is open; the reader stops 10 s after you
 * leave), plus a fan test that needs no game.
 */
function SensorPanel({ busy, act }: { busy: boolean; act: Act }) {
  const [r, setR] = useState<SensorReading | null>(null);
  const [pct, setPct] = useState(70);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    const read = () => !document.hidden && void window.api.sensorsNow().then(setR, () => {});
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);
  const tone = (c: number | null) => (c === null ? 'text-slate-500' : c >= 85 ? 'text-rose-300' : c >= 75 ? 'text-amber-300' : 'text-emerald-300');
  const Temp = ({ label, c }: { label: string; c: number | null }) => (
    <div className="rounded-lg bg-white/[0.03] px-4 py-3 ring-1 ring-[var(--line)]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={clsx('text-2xl font-semibold tabular-nums', tone(c))}>{c === null ? '—' : `${c} °C`}</div>
    </div>
  );
  const test = async () => {
    setTesting(true);
    try {
      await act(() => window.api.testFans(pct));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div>
        <div className="font-medium text-slate-100">Temperatures and fans</div>
        <p className="text-sm text-slate-400">Live readings, updated every 2 seconds while this page is open. Green is fine, amber is warm, red is hot (85 °C or more).</p>
      </div>
      {!r ? (
        <Loading text="Reading sensors…" />
      ) : !r.ready ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
          Temperatures and fan control need a one-time setup (a sensor library and its driver). <CpuTempSetup busy={busy} act={act} />
        </div>
      ) : !r.admin ? (
        <p className="text-sm text-amber-300">Sensors can only be read when IcyTweaker runs as administrator.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Temp label="CPU" c={r.cpu} />
            <Temp label="Graphics card" c={r.gpu} />
          </div>
          {r.fans.length || r.power.length ? (
            <div className="grid gap-1.5 text-sm sm:grid-cols-2">
              {r.fans.map((f) => (
                <div key={`rpm-${f.name}`} className="flex justify-between rounded-md bg-white/[0.03] px-3 py-1.5 ring-1 ring-[var(--line)]">
                  <span className="text-slate-300">{f.name}</span>
                  <span className="tabular-nums text-slate-100">{f.value} RPM</span>
                </div>
              ))}
              {r.power.map((f) => (
                <div key={`pct-${f.name}`} className="flex justify-between rounded-md bg-white/[0.03] px-3 py-1.5 ring-1 ring-[var(--line)]">
                  <span className="text-slate-300">{f.name} power</span>
                  <span className="tabular-nums text-slate-100">{f.value} %</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No fan readings on this PC (common on laptops).</p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-slate-200">Test fan speed</span>
              <span className="block text-xs text-slate-500">
                Holds every fan IcyTweaker can control at this speed for 10 seconds, so you can hear and see (RPM above) what a curve setting does. Then the BIOS takes them back.
              </span>
            </span>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={pct}
              disabled={busy || testing}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label="Test fan speed"
              className="slider w-40"
            />
            <span className="w-12 text-right tabular-nums text-slate-200">{pct} %</span>
            <Button disabled={busy || testing} onClick={() => void test()}>
              {testing ? 'Testing…' : 'Test for 10 s'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Performance page: Game Boost session reports, temperature history, frametime captures, sensitivity converter. */
export function PerformancePage({ busy }: { busy: boolean }) {
  const [games, setGames] = useState<GameView[]>([]);
  useEffect(() => void window.api.listGames().then(setGames, () => {}), []);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Performance</h2>
        <p className="text-sm text-slate-400">
          How your games actually run: reports from Game Boost sessions (FPS before and after optimizing), temperatures over time, detailed frame-time captures and a sensitivity
          converter.
        </p>
      </div>
      <Sessions games={games} />
      <TempHistorySection />
      <Frametimes busy={busy} />
      <SensConverter />
    </section>
  );
}

/** One Game Boost option: its controls, then what it does in plain words. */
function BoostOption({ label, text, children }: { label: string; text: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-slate-200">{label}</span>
        {children}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{text}</p>
    </div>
  );
}

function BoostCheck({ label, text, checked, disabled, onChange }: { label: string; text: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-slate-200">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
    </label>
  );
}

/** CPU temperature in the overlay needs a one-time setup (hash-checked library + PawnIO driver). */
function CpuTempSetup({ busy, act }: { busy: boolean; act: Act }) {
  const [tools, setTools] = useState<ToolStatus | null>(null);
  useEffect(() => void window.api.toolStatus().then(setTools), []);
  if (!tools) return null;
  if (tools.lhm && tools.pawnio) return <span className="text-xs text-emerald-300">CPU temperature ready{tools.admin ? '' : ' (shows when run as administrator)'}</span>;
  return (
    <Button disabled={busy} onClick={() => act(() => window.api.setupCpuTemp()).then(() => window.api.toolStatus().then(setTools))}>
      Set up CPU temperature
    </Button>
  );
}

/** Same limits as electron/system/fans.ts (the main process checks them again). */
const FAN = { min: 30, panic: 85, tMin: 30, tMax: 95 };
const DEFAULT_CURVE: FanPoint[] = [
  { t: 40, pct: 35 },
  { t: 60, pct: 50 },
  { t: 75, pct: 75 },
  { t: 85, pct: 100 },
];

/**
 * Game Boost fan curve: CPU temperature -> fan speed for the motherboard's fans while the game runs. Drag the points
 * on the chart or type exact values. Saved when a drag ends (not on every move).
 */
function FanCurveEditor({ curve, disabled, act, onChange }: { curve: FanPoint[] | null; disabled: boolean; act: Act; onChange: (c: FanPoint[] | null) => void }) {
  const [pts, setPts] = useState<FanPoint[]>(curve ?? DEFAULT_CURVE);
  const [drag, setDrag] = useState<number | null>(null);
  const [fans, setFans] = useState<{ ready: boolean; admin: boolean; channels: string[] } | null>(null);
  // The panel reloads settings every 3 s (new objects): follow only real changes, and never mid-drag.
  const saved = JSON.stringify(curve);
  useEffect(() => {
    if (drag === null) setPts(curve ?? DEFAULT_CURVE);
  }, [saved]); // keyed on the saved value, not the object
  const on = !!curve;
  const W = 320;
  const H = 150;
  const P = 28; // room for the axis labels
  const x = (t: number) => P + ((t - FAN.tMin) / (FAN.tMax - FAN.tMin)) * (W - P - 8);
  const y = (pct: number) => 8 + ((100 - pct) / (100 - FAN.min)) * (H - P - 8);
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  // Same rules as validateCurve: rising temperatures, speeds within limits.
  const clean = (list: FanPoint[]) =>
    [...list]
      .map((p) => ({ t: Math.round(Math.min(FAN.tMax, Math.max(FAN.tMin, p.t))), pct: Math.round(Math.min(100, Math.max(FAN.min, p.pct))) }))
      .sort((a, b) => a.t - b.t)
      .filter((p, i, a) => i === 0 || p.t > a[i - 1].t);
  const save = (list: FanPoint[]) => {
    const c = clean(list);
    setPts(c);
    if (on && c.length >= 2) onChange(c);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag === null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const t = FAN.tMin + ((sx - P) / (W - P - 8)) * (FAN.tMax - FAN.tMin);
    const pct = 100 - ((sy - 8) / (H - P - 8)) * (100 - FAN.min);
    setPts((list) => list.map((p, i) => (i === drag ? { t: Math.round(Math.min(FAN.tMax, Math.max(FAN.tMin, t))), pct: Math.round(Math.min(100, Math.max(FAN.min, pct))) } : p)));
  };
  const addPoint = () => {
    // In the middle of the widest gap between two points.
    let best = 1;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].t - sorted[i - 1].t > sorted[best].t - sorted[best - 1].t) best = i;
    const [a, b] = [sorted[best - 1], sorted[best]];
    if (b.t - a.t >= 2) save([...sorted, { t: Math.round((a.t + b.t) / 2), pct: Math.round((a.pct + b.pct) / 2) }]);
  };

  return (
    <div className="space-y-2 rounded-lg bg-white/[0.03] p-3 ring-1 ring-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked ? clean(pts) : null)} />
          Fan curve during play
        </label>
        <Button
          disabled={disabled}
          onClick={() =>
            void window.api.fanChannels().then(setFans, () => setFans({ ready: false, admin: false, channels: [] }))
          }
        >
          Check fans
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        The motherboard's fans follow your CPU temperature while this game runs, and go back to the BIOS settings when it closes. They never drop below {FAN.min} % and run at 100 % from {FAN.panic} °C.
        Works on most desktop motherboards; most laptops don't allow it.
      </p>
      {fans &&
        (!fans.ready ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300">
            Needs the CPU temperature reader first. <CpuTempSetup busy={disabled} act={act} />
          </div>
        ) : !fans.admin ? (
          <p className="text-xs text-amber-300">Checking fans needs IcyTweaker to run as administrator.</p>
        ) : fans.channels.length ? (
          <p className="text-xs text-emerald-300">
            {fans.channels.length} fan(s) can be controlled: {fans.channels.join(', ')}.
          </p>
        ) : (
          <p className="text-xs text-amber-300">No fans on this PC can be controlled by IcyTweaker, so a curve would change nothing.</p>
        ))}
      <div className={clsx('flex flex-wrap items-start gap-4', !on && 'opacity-50')}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-[320px] touch-none select-none"
          role="img"
          aria-label={`Fan curve: ${sorted.map((p) => `${p.t} °C ${p.pct} %`).join(', ')}`}
          onPointerMove={move}
          onPointerUp={() => {
            if (drag !== null) save(pts);
            setDrag(null);
          }}
          onPointerLeave={() => {
            if (drag !== null) save(pts);
            setDrag(null);
          }}
        >
          {[40, 60, 80, 95].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={8} y2={H - P} className="stroke-white/10" />
              <text x={x(t)} y={H - P + 14} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {t}°
              </text>
            </g>
          ))}
          {[30, 50, 75, 100].map((pct) => (
            <g key={pct}>
              <line x1={P} x2={W - 8} y1={y(pct)} y2={y(pct)} className="stroke-white/10" />
              <text x={P - 4} y={y(pct) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">
                {pct}%
              </text>
            </g>
          ))}
          <rect x={x(FAN.panic)} y={8} width={x(FAN.tMax) - x(FAN.panic)} height={H - P - 8} className="fill-rose-500/10" />
          <polyline
            points={[`${x(FAN.tMin)},${y(sorted[0].pct)}`, ...sorted.map((p) => `${x(p.t)},${y(p.pct)}`), `${x(FAN.panic)},${y(sorted[sorted.length - 1].pct)}`].join(' ')}
            className="fill-none stroke-sky-400"
            strokeWidth={2}
          />
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={x(p.t)}
              cy={y(p.pct)}
              r={drag === i ? 7 : 5.5}
              className={clsx('fill-sky-300 stroke-[var(--card)]', !disabled && on && 'cursor-grab')}
              strokeWidth={2}
              onPointerDown={(e) => {
                if (disabled || !on) return;
                e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                setDrag(i);
              }}
            />
          ))}
        </svg>
        <div className="space-y-1 text-xs">
          {sorted.map((p, i) => (
            <div key={`${p.t}-${i}`} className="flex items-center gap-1.5">
              {/* Saved when you leave the box (or press Enter): half-typed values would be clamped. */}
              <input
                key={`t${p.t}`}
                type="number"
                min={FAN.tMin}
                max={FAN.tMax}
                defaultValue={p.t}
                disabled={disabled || !on}
                aria-label={`Point ${i + 1} temperature`}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => Number(e.target.value) !== p.t && save(sorted.map((q, j) => (j === i ? { ...q, t: Number(e.target.value) } : q)))}
                className="w-14 rounded bg-white/5 px-1.5 py-0.5 text-slate-100 ring-1 ring-white/10"
              />
              °C →
              <input
                key={`p${p.pct}`}
                type="number"
                min={FAN.min}
                max={100}
                defaultValue={p.pct}
                disabled={disabled || !on}
                aria-label={`Point ${i + 1} fan speed`}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => Number(e.target.value) !== p.pct && save(sorted.map((q, j) => (j === i ? { ...q, pct: Number(e.target.value) } : q)))}
                className="w-14 rounded bg-white/5 px-1.5 py-0.5 text-slate-100 ring-1 ring-white/10"
              />
              %
              <button
                type="button"
                disabled={disabled || !on || sorted.length <= 2}
                onClick={() => save(sorted.filter((_, j) => j !== i))}
                aria-label={`Remove point ${i + 1}`}
                className="px-1 text-slate-500 hover:text-rose-300 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" disabled={disabled || !on || sorted.length >= 8} onClick={addPoint} className="text-sky-300 hover:underline disabled:opacity-40">
            + Add point
          </button>
        </div>
      </div>
    </div>
  );
}

/** Starts the overlay for the first supported game that is running. */
function OverlayStart({ busy, act }: { busy: boolean; act: Act }) {
  return (
    <Button
      primary
      disabled={busy}
      onClick={() =>
        act(async () => {
          const running = await window.api.frametimeTargets();
          if (!running.length) return { ok: false, message: 'Start a supported game first, then show the overlay.' };
          return window.api.startOverlay(running[0].exe);
        })
      }
    >
      Show overlay
    </Button>
  );
}

/** Froststrap (Roblox launcher): open it and set the FPS cap flag it applies to Roblox. */
function Froststrap({ busy, act }: { busy: boolean; act: Act }) {
  const [info, setInfo] = useState<FroststrapInfo | null>(null);
  const [fps, setFps] = useState('');
  const load = () =>
    window.api.froststrap().then((i) => {
      setInfo(i);
      setFps(i.fpsCap ? String(i.fpsCap) : '');
    });
  useEffect(() => void load(), []);
  if (!info?.installed) return null;
  return (
    <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--card-2)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium text-slate-100">Froststrap</span> <span className="text-xs text-slate-400">launcher found · {info.flags} FastFlag(s) applied to Roblox</span>
        </div>
        <Button disabled={busy} onClick={() => act(() => window.api.openFroststrap())}>
          Open Froststrap
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          FPS cap flag (DFIntTaskSchedulerTargetFps)
          <input
            type="number"
            min={30}
            max={10000}
            value={fps}
            onChange={(e) => setFps(e.target.value)}
            placeholder="not set"
            className="w-32 rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10"
          />
        </label>
        <Button primary disabled={busy || !fps} onClick={() => act(() => window.api.setFroststrapFps(Number(fps))).then(load)}>
          Set
        </Button>
        {info.changed && (
          <Button disabled={busy} onClick={() => act(() => window.api.setFroststrapFps(null)).then(load)}>
            Reset
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">Froststrap applies it the next time it starts Roblox. Close Froststrap before changing it. The original value is backed up.</p>
    </div>
  );
}

/** Frametime capture (PresentMon) of a running game, with average, 1% and 0.1% lows and a frame-time chart. */
function Frametimes({ busy }: { busy: boolean }) {
  const [targets, setTargets] = useState<Array<{ name: string; exe: string }> | null>(null);
  const [exe, setExe] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [res, setRes] = useState<{ result?: FrametimeResult; previous?: FrametimeResult & { at: string }; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const scan = () =>
    window.api.frametimeTargets().then((t) => {
      setTargets(t);
      setExe((cur) => (t.some((x) => x.exe === cur) ? cur : (t[0]?.exe ?? '')));
    });
  useEffect(() => void scan(), []);
  const r = res?.result;
  const max = r ? Math.max(...r.points, 1) : 1;
  const line = r ? r.points.map((v, i) => `${(i / Math.max(r.points.length - 1, 1)) * 600},${100 - (v / max) * 95}`).join(' ') : '';
  return (
    <div className="space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div>
        <div className="font-medium text-slate-100">Frametime capture</div>
        <p className="text-sm text-slate-400">Records a running game's frame times with Intel PresentMon (downloaded once from its official releases). Play normally while it records.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={exe} onChange={(e) => setExe(e.target.value)} aria-label="Game to record" className="rounded-md bg-white/5 px-2 py-1 text-slate-100 ring-1 ring-white/10">
          {!targets?.length && <option value="">No supported game running</option>}
          {targets?.map((t) => (
            <option key={t.exe} value={t.exe}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Length" className="rounded-md bg-white/5 px-2 py-1 text-slate-100 ring-1 ring-white/10">
          {[10, 30, 60].map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
        <Button disabled={busy || running} onClick={scan}>
          Refresh
        </Button>
        <Button
          primary
          disabled={busy || running || !exe}
          onClick={async () => {
            setRunning(true);
            setRes(await window.api.captureFrametimes(exe, seconds));
            setRunning(false);
          }}
        >
          {running ? `Recording ${seconds}s…` : 'Start capture'}
        </Button>
      </div>
      {res?.error && <p className="text-sm text-rose-300">{res.error}</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ['Average', `${r.avgFps} FPS`],
                ['1% low', `${r.low1} FPS`],
                ['0.1% low', `${r.low01} FPS`],
                ['Avg frame time', `${r.avgMs} ms`],
                ['Worst frame', `${r.maxMs} ms`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-2">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="font-semibold text-slate-100">{v}</div>
              </div>
            ))}
          </div>
          <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="h-28 w-full rounded-lg border border-[var(--line)] bg-[var(--card-2)]" role="img" aria-label="Frame times over the capture">
            <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          </svg>
          <p className="text-xs text-slate-500">
            {r.frames} frames over {r.seconds}s. Spikes in the line are stutters; higher means a longer frame (top = {max} ms).
          </p>
          {res?.previous && <Compare now={r} before={res.previous} />}
        </>
      )}
    </div>
  );
}

/** The game's own icon (from its installed .exe), or its initials on a tile when it isn't installed. */
function GameIcon({ name, src, large }: { name: string; src?: string | null; large?: boolean }) {
  const size = large ? 'h-11 w-11' : 'h-9 w-9';
  if (src) return <img src={src} alt="" className={clsx(size, 'shrink-0 rounded-lg border border-[var(--line)] bg-[var(--card-2)] object-contain p-1')} />;
  const initials = name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span aria-hidden="true" className={clsx(size, 'flex shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-gradient-to-br from-sky-500/25 to-blue-700/25 text-xs font-semibold text-sky-100')}>
      {initials}
    </span>
  );
}

/** Before / after: this capture against the previous one of the same game. */
function Compare({ now, before }: { now: FrametimeResult; before: FrametimeResult & { at: string } }) {
  const row = (label: string, a: number, b: number, unit: string, higherIsBetter: boolean) => {
    const d = Math.round((a - b) * 10) / 10;
    const good = higherIsBetter ? d > 0 : d < 0;
    return (
      <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--card-2)] px-3 py-2">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm text-slate-300">
          {b} → <span className="font-semibold text-slate-100">{a}</span> {unit}
          <span className={clsx('ml-1.5 font-semibold', d === 0 ? 'text-slate-500' : good ? 'text-emerald-300' : 'text-rose-300')}>
            {d > 0 ? '+' : ''}
            {d}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-slate-400">Compared with your previous capture ({new Date(before.at).toLocaleString()}):</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {row('Average', now.avgFps, before.avgFps, 'FPS', true)}
        {row('1% low', now.low1, before.low1, 'FPS', true)}
        {row('0.1% low', now.low01, before.low01, 'FPS', true)}
        {row('Worst frame', now.maxMs, before.maxMs, 'ms', false)}
      </div>
      <p className="text-xs text-slate-500">Run the same scene both times for a fair comparison. Differences of a few percent are normal run-to-run noise.</p>
    </div>
  );
}

function Editor({ g, icon, busy, act, ask, reload, onPlay }: { g: GameView; icon?: string | null; busy: boolean; act: Act; ask: Ask; reload: () => Promise<void>; onPlay: () => void }) {
  const [v, setV] = useState<GameValues>(g.current);
  const [recommended, setRecommended] = useState(false);
  const editable = g.status === 'not-optimized' || g.status === 'optimized';
  const set = (patch: Partial<GameValues>) => {
    setV((x) => ({ ...x, ...patch }));
    setRecommended(false);
  };
  // Exclusive fullscreen and borderless are one display mode: picking one unticks the other.
  const RIVAL: Partial<Record<GameFlag, GameFlag>> = { fullscreen: 'borderless', borderless: 'fullscreen' };
  const toggleFlag = (f: GameFlag, on: boolean) => set({ flags: on ? [...v.flags.filter((x) => x !== RIVAL[f]), f] : v.flags.filter((x) => x !== f) });
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  async function apply() {
    const ok = await ask(
      `Apply ${g.name} profile?`,
      `Writes only the settings shown here to:\n${g.configPaths.join('\n')}\n\nEach original value is backed up first; Reset or Undo All puts them back.`,
      'Apply profile',
    );
    if (!ok) return;
    await act(() => window.api.applyGameProfile(g.id, v));
    await reload();
  }

  const select = (label: string, choices: string[], value: number | undefined, onChange: (n: number) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
      {label}
      <select
        value={value ?? ''}
        disabled={!editable}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 disabled:opacity-50"
      >
        {value === undefined && <option value="">Custom / unknown</option>}
        {choices.map((c, i) => (
          <option key={c} value={i} className="bg-slate-900">
            {c}
          </option>
        ))}
      </select>
    </label>
  );
  const input = (label: string, value: number | undefined, onChange: (n: number | undefined) => void) => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number"
        value={value ?? ''}
        disabled={!editable}
        onChange={(e) => onChange(num(e.target.value))}
        className="w-28 rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 disabled:opacity-50"
      />
    </label>
  );

  return (
    <div className="space-y-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <GameArt id={g.id} name={g.name} large />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <GameIcon name={g.name} src={icon} large />
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{g.name}</h3>
            <p className="text-xs text-slate-500">
              {g.publisher} · settings checked against {g.checkedVersion}
            </p>
          </div>
        </div>
        {g.running ? (
          <Badge className="bg-sky-500/15 text-sky-300 ring-sky-500/30">Running</Badge>
        ) : (
          g.status !== 'not-installed' && (
            <div className="flex gap-2">
            <Button primary disabled={busy} onClick={() => onPlay()}>
              ▶ Play
            </Button>
            </div>
          )
        )}
      </div>
      {g.note && <p className="text-xs text-amber-300">{g.note}</p>}
      {!!g.reverted?.length && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-500/30">
          {g.name} put back {g.reverted.length} of the settings IcyTweaker applied ({g.reverted.join(', ')}). Games often do this on launch or when a setting is changed
          in-game. Apply again to set them, or change them in the game.
        </p>
      )}
      {g.id === 'roblox' && <Froststrap busy={busy} act={act} />}
      {!editable ? (
        <p className="text-sm text-slate-400">
          {g.status === 'no-config' ? 'Installed, but it has no settings file yet. Start the game once, then Refresh.' : 'Not found on this PC.'}
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={recommended}
              disabled={busy}
              onChange={(e) => {
                if (e.target.checked) setV((x) => ({ ...x, ...g.recommended, flags: [...g.recommended.flags] }));
                else setV(g.current);
                setRecommended(e.target.checked);
              }}
            />
            Recommended settings <span className="text-xs text-slate-500">(competitive defaults; keeps your resolution and FPS cap)</span>
          </label>
          <div className="flex flex-wrap gap-4">
            {g.supports.resolution && (
              <>
                {input('Width', v.width, (n) => set({ width: n }))}
                {input('Height', v.height, (n) => set({ height: n }))}
              </>
            )}
            {g.supports.fps && input('Max FPS (0 = unlimited)', v.fps, (n) => set({ fps: n }))}
          </div>
          {g.supports.resolution && <ResolutionPresets width={v.width} height={v.height} onPick={(width, height) => set({ width, height })} disabled={busy} />}
          {g.supports.fps && (
            <div className="flex items-center gap-3">
              <input
                type="range"
                className="slider w-full max-w-sm"
                min={0}
                max={500}
                step={1}
                value={Math.min(v.fps ?? 0, 500)}
                disabled={!editable}
                onChange={(e) => set({ fps: Number(e.target.value) })}
                aria-label="Max FPS"
                style={{ '--fill': `${(Math.min(v.fps ?? 0, 500) / 500) * 100}%` } as React.CSSProperties}
              />
              <span className="w-24 text-xs text-slate-400">{!v.fps ? 'Unlimited' : `${v.fps} FPS`}</span>
            </div>
          )}
          <div className="space-y-2">
            {g.supports.aa && select('Anti-aliasing', g.supports.aa, v.aa, (n) => set({ aa: n }))}
            {g.supports.reflex && select('NVIDIA Reflex', g.supports.reflex, v.reflex, (n) => set({ reflex: n }))}
          </div>
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional options</legend>
            {g.supports.flags.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={v.flags.includes(f)} disabled={busy} onChange={(e) => toggleFlag(f, e.target.checked)} />
                {FLAG_LABEL[f]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button primary disabled={busy || g.running} onClick={apply}>
              Apply Profile
            </Button>
            <Button
              disabled={busy || g.running || g.status !== 'optimized'}
              onClick={async () => {
                await act(() => window.api.resetGameProfile(g.id));
                await reload();
              }}
            >
              Reset
            </Button>
            {g.running && <span className="text-xs text-slate-400">Close the game first: it rewrites its settings when it exits.</span>}
          </div>
          <p className="truncate text-xs text-slate-600" title={g.configPaths.join('\n')}>
            {g.configPaths.join(' · ')}
          </p>
        </>
      )}
      {g.status !== 'not-installed' && <WinSettings target={g.id} busy={busy} act={act} />}
    </div>
  );
}

/** Windows' own per-program settings for this game's exe: graphics preference, compatibility flags, CPU priority. */
function WinSettings({ target, busy, act }: { target: string; busy: boolean; act: Act }) {
  const [data, setData] = useState<{ exe: string; settings: GameWinSettings } | { error: string } | null>(null);
  const [v, setV] = useState<GameWinSettings | null>(null);
  const load = useCallback(async () => {
    const r = await window.api.getWinSettings(target);
    setData(r);
    setV('settings' in r ? r.settings : null);
  }, [target]);
  useEffect(() => void load(), [load]);
  if (!data) return null;
  if ('error' in data || !v) return null;
  const set = (patch: Partial<GameWinSettings>) => setV({ ...v, ...patch });
  const dirty = JSON.stringify(v) !== JSON.stringify(data.settings);
  const box = (key: 'fso' | 'dpi' | 'admin', label: string, title: string) => (
    <label className="flex items-center gap-2" title={title}>
      <input type="checkbox" checked={v[key]} disabled={busy} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <section className="space-y-3 rounded-lg bg-[var(--card-2)] p-4 ring-1 ring-[var(--line)]">
      <div>
        <h4 className="text-sm font-semibold text-slate-100">Windows settings for this game</h4>
        <p className="truncate text-xs text-slate-500" title={data.exe}>
          {data.exe}
        </p>
      </div>
      <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Graphics</span>
          <select value={v.gpu} disabled={busy} onChange={(e) => set({ gpu: Number(e.target.value) as GameWinSettings['gpu'] })} className="w-full rounded-md bg-white/5 px-2 py-1.5 text-slate-100 ring-1 ring-white/10">
            <option value={0} className="bg-slate-900">Let Windows decide</option>
            <option value={2} className="bg-slate-900">High performance GPU</option>
            <option value={1} className="bg-slate-900">Power saving GPU</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">CPU priority</span>
          <select value={v.priority} disabled={busy} onChange={(e) => set({ priority: e.target.value as GameWinSettings['priority'] })} className="w-full rounded-md bg-white/5 px-2 py-1.5 text-slate-100 ring-1 ring-white/10">
            <option value="default" className="bg-slate-900">Normal (Windows default)</option>
            <option value="above" className="bg-slate-900">Above normal</option>
            <option value="high" className="bg-slate-900">High</option>
          </select>
        </label>
      </div>
      <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
        {box('fso', 'Disable fullscreen optimizations', 'Properties > Compatibility. Can lower input delay in exclusive fullscreen; turn it back on if the game looks wrong.')}
        {box('dpi', 'High-DPI scaling by the game', 'Properties > Compatibility > Override high DPI scaling (Application). Fixes blurry or wrongly sized games on scaled displays.')}
        {box('admin', 'Run as administrator', 'Some launchers (and anti-cheats) refuse games that ask for administrator. Only use it if the game needs it.')}
      </div>
      <p className="text-xs text-slate-500">Graphics preference matters on PCs with two GPUs (most gaming laptops). Changes apply the next time the game starts; Undo all changes puts them back.</p>
      <div className="flex gap-2">
        <Button
          primary
          disabled={busy || !dirty}
          onClick={async () => {
            await act(() => window.api.setWinSettings(target, v));
            await load();
          }}
        >
          Save
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            await act(() => window.api.resetWinSettings(target));
            await load();
          }}
        >
          Put back
        </Button>
      </div>
    </section>
  );
}

const STORE: Record<LibraryGame['source'], string> = { steam: 'Steam', epic: 'Epic Games', riot: 'Riot Games', ubisoft: 'Ubisoft Connect', gog: 'GOG', xbox: 'Xbox app' };

/** A library game without a profile: play it, set its Windows settings. */
function LibraryPanel({ g, icon, busy, act, onPlay }: { g: LibraryGame; icon?: string | null; busy: boolean; act: Act; onPlay: () => void }) {
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => void window.api.libraryArt(g.id).then(setArt, () => {}), [g.id]);
  return (
    <div className="space-y-4 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      {art ? (
        <img src={art} alt="" className="aspect-[460/215] w-full rounded-lg object-cover ring-1 ring-[var(--line)]" />
      ) : (
        <div className="grid aspect-[460/215] w-full place-items-center rounded-lg bg-gradient-to-br from-sky-900/40 to-slate-900 ring-1 ring-[var(--line)]">
          {icon ? <img src={icon} alt="" className="h-16 w-16" /> : <span className="text-3xl font-bold text-slate-300">{g.name.slice(0, 2)}</span>}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <GameIcon name={g.name} src={icon} large />
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{g.name}</h3>
            <p className="text-xs text-slate-500">{STORE[g.source]} · no settings profile (Game Boost, Play and Windows settings work)</p>
          </div>
        </div>
        <Button primary disabled={busy} onClick={() => onPlay()}>
          ▶ Play
        </Button>
      </div>
      <WinSettings target={g.id} busy={busy} act={act} />
    </div>
  );
}

/** Finished Game Boost sessions. */
/**
 * Degrees turned per mouse count at sensitivity 1 (the widely used conversion values). Fortnite's is per 1 % of its
 * slider. Same value = same turn per mouse movement, so CS2 and Apex share sensitivities.
 */
const YAW: Array<{ id: string; name: string; yaw: number; unit?: string }> = [
  { id: 'cs2', name: 'Counter-Strike 2', yaw: 0.022 },
  { id: 'apex', name: 'Apex Legends', yaw: 0.022 },
  { id: 'deadlock', name: 'Deadlock', yaw: 0.022 },
  { id: 'valorant', name: 'VALORANT', yaw: 0.07 },
  { id: 'ow2', name: 'Overwatch 2', yaw: 0.0066 },
  { id: 'fortnite', name: 'Fortnite', yaw: 0.005555, unit: '%' },
];

function SensConverter() {
  const [from, setFrom] = useState('valorant');
  const [sens, setSens] = useState(0.4);
  const [dpi, setDpi] = useState(800);
  const src = YAW.find((y) => y.id === from)!;
  const ok = sens > 0 && dpi > 0;
  const cm360 = ok ? (2.54 * 360) / (dpi * sens * src.yaw) : null;
  const field = 'rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10';
  return (
    <div className="space-y-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div>
        <div className="font-medium text-slate-100">Sensitivity converter</div>
        <p className="text-sm text-slate-400">Same aim in every game: enter your sensitivity in one, read it for the others.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-xs text-slate-400">
        <label className="flex flex-col gap-1">
          Game
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
            {YAW.map((y) => (
              <option key={y.id} value={y.id} className="bg-slate-900">
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Sensitivity{src.unit ? ` (${src.unit})` : ''}
          <input type="number" step="0.01" min={0} value={sens} onChange={(e) => setSens(Number(e.target.value))} className={clsx(field, 'w-28')} />
        </label>
        <label className="flex flex-col gap-1">
          Mouse DPI
          <input type="number" step="50" min={0} value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className={clsx(field, 'w-28')} />
        </label>
        {cm360 && (
          <div className="rounded-lg bg-sky-500/10 px-3 py-1.5 text-sky-200 ring-1 ring-sky-500/30">
            <span className="text-lg font-semibold tabular-nums">{cm360.toFixed(1)}</span> cm / 360° <span className="text-slate-400">({(cm360 / 2.54).toFixed(1)} in)</span>
          </div>
        )}
      </div>
      {ok && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {YAW.filter((y) => y.id !== from).map((y) => {
            const v = (sens * src.yaw) / y.yaw;
            return (
              <li key={y.id} className="flex items-center justify-between rounded-lg bg-[var(--card-2)] px-3 py-2 ring-1 ring-[var(--line)]">
                <span className="text-sm text-slate-300">{y.name}</span>
                <span className="font-semibold tabular-nums text-slate-100">
                  {v < 10 ? v.toFixed(3) : v.toFixed(2)}
                  {y.unit ?? ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500">Assumes the same mouse DPI, default field of view and no in-game scope multipliers. Fortnite: set X and Y to the same value.</p>
    </div>
  );
}

/** Average FPS in Game Boost sessions before vs after IcyTweaker first optimized each game (needs the overlay in both). */
function BeforeAfter({ list, games }: { list: SessionReport[]; games: GameView[] }) {
  const rows = games.flatMap((g) => {
    if (!g.optimizedAt) return [];
    const mine = list.filter((s) => s.game === g.name && s.fpsAvg !== null);
    const avg = (xs: SessionReport[]) => (xs.length ? Math.round(xs.reduce((a, s) => a + s.fpsAvg!, 0) / xs.length) : null);
    const before = avg(mine.filter((s) => s.startedAt < g.optimizedAt!));
    const after = avg(mine.filter((s) => s.startedAt >= g.optimizedAt!));
    return before && after ? [{ name: g.name, before, after, pct: Math.round(((after - before) / before) * 100) }] : [];
  });
  if (!rows.length) return null;
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.name} className="flex items-center justify-between rounded-lg bg-[var(--card-2)] px-3 py-2 ring-1 ring-[var(--line)]">
          <span className="text-sm text-slate-300">{r.name}: before → after optimizing</span>
          <span className="tabular-nums text-slate-100">
            {r.before} → {r.after} FPS <span className={r.pct >= 0 ? 'text-emerald-300' : 'text-amber-300'}>({r.pct >= 0 ? '+' : ''}{r.pct}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Loads the session list for the temperature graph. */
function TempHistorySection() {
  const [list, setList] = useState<SessionReport[] | null>(null);
  useEffect(() => void window.api.sessions().then(setList), []);
  return list ? <TempHistory list={list} /> : null;
}

/** CPU and GPU temperature over one Game Boost session (needs the overlay on, which reads the sensors). */
function TempHistory({ list }: { list: SessionReport[] }) {
  const withTemps = list.filter((s) => s.temps && s.temps.length > 1);
  const [pick, setPick] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  if (!withTemps.length)
    return (
      <div className="rounded-xl bg-[var(--card)] p-4 text-sm text-slate-400 ring-1 ring-[var(--line)]">
        <div className="font-medium text-slate-100">Temperature history</div>
        Temperatures are recorded while the overlay runs during Game Boost (Settings: Overlay during Game Boost). Play a session with it on and the graph shows up here.
      </div>
    );
  const s = withTemps[Math.min(pick, withTemps.length - 1)];
  const pts = s.temps!;
  const W = 640;
  const H = 220;
  const pad = { l: 40, r: 56, t: 14, b: 28 };
  const values = pts.flatMap((p) => [p.cpu, p.gpu]).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10);
  const hi = Math.max(100, Math.ceil((Math.max(...values) + 5) / 10) * 10);
  const maxM = Math.max(1, pts[pts.length - 1].m);
  const x = (m: number) => pad.l + (m / maxM) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (k: 'cpu' | 'gpu') =>
    pts
      .filter((p) => p[k] !== null)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p[k]!).toFixed(1)}`)
      .join(' ');
  const last = (k: 'cpu' | 'gpu') => [...pts].reverse().find((p) => p[k] !== null);
  const ticks = Array.from({ length: Math.floor((hi - lo) / 20) + 1 }, (_, i) => lo + i * 20);
  const h = hover === null ? null : pts[hover];
  const SERIES = [
    { k: 'cpu' as const, label: 'CPU', color: 'var(--chart-cpu)', limit: 95 },
    { k: 'gpu' as const, label: 'GPU', color: 'var(--chart-gpu)', limit: 87 },
  ];
  return (
    <div className="space-y-2 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-slate-100">Temperature history</div>
          <p className="text-xs text-slate-500">Per minute. Dashed lines: where CPUs (95 °C) and GPUs (87 °C) typically start slowing themselves down.</p>
        </div>
        <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Session" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
          {withTemps.map((x, i) => (
            <option key={x.startedAt} value={i} className="bg-slate-900">
              {x.game} · {new Date(x.startedAt).toLocaleString()}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-300" aria-hidden>
        {SERIES.map((d) => (
          <span key={d.k} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: d.color }} />
            {d.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`CPU and GPU temperature during ${s.game}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--ink) / 0.07)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {t}°
            </text>
          </g>
        ))}
        {SERIES.map((d) =>
          d.limit > lo && d.limit < hi ? <line key={`l-${d.k}`} x1={pad.l} x2={W - pad.r} y1={y(d.limit)} y2={y(d.limit)} stroke={d.color} strokeOpacity={0.45} strokeDasharray="4 4" /> : null,
        )}
        <text x={pad.l} y={H - 8} className="fill-slate-500 text-[11px]">
          0 min
        </text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-slate-500 text-[11px]">
          {maxM} min
        </text>
        {SERIES.map((d) => {
          const end = last(d.k);
          return (
            <g key={d.k}>
              <path d={line(d.k)} fill="none" stroke={d.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {end && (
                <text x={x(end.m) + 6} y={y(end[d.k]!) + 4} className="fill-slate-200 text-[11px] font-medium">
                  {d.label} {end[d.k]}°
                </text>
              )}
            </g>
          );
        })}
        {h && (
          <g>
            <line x1={x(h.m)} x2={x(h.m)} y1={pad.t} y2={H - pad.b} stroke="rgb(var(--ink) / 0.3)" />
            {SERIES.map((d) => (h[d.k] !== null ? <circle key={d.k} cx={x(h.m)} cy={y(h[d.k]!)} r={4} fill={d.color} stroke="var(--card)" strokeWidth={2} /> : null))}
          </g>
        )}
        {/* Hit areas: one band per point, wider than the line. */}
        {pts.map((p, i) => {
          const half = (W - pad.l - pad.r) / Math.max(1, pts.length - 1) / 2;
          return <rect key={i} x={x(p.m) - half} y={pad.t} width={half * 2} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />;
        })}
      </svg>
      <p className="h-4 text-xs text-slate-300" aria-live="polite">
        {h ? `Minute ${h.m}: CPU ${h.cpu ?? '—'} °C, GPU ${h.gpu ?? '—'} °C` : 'Hover the graph to read a minute.'}
      </p>
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-1 w-full max-w-sm text-left">
          <thead className="text-slate-500">
            <tr>
              <th className="font-normal">Minute</th>
              <th className="font-normal">CPU °C</th>
              <th className="font-normal">GPU °C</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.m} className="text-slate-300">
                <td>{p.m}</td>
                <td>{p.cpu ?? '—'}</td>
                <td>{p.gpu ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** The apps that most often used CPU right after an FPS drop, across all sessions. */
function Culprits({ list }: { list: SessionReport[] }) {
  const count = new Map<string, number>();
  for (const x of list.flatMap((s) => s.stutters ?? [])) for (const p of x.top) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return null;
  return (
    <p className="mt-2 text-xs text-slate-400">
      Busiest right after FPS drops: {top.map(([n, c]) => `${n} (${c}×)`).join(', ')}. Hover a drop count for details. Closing or lowering these during play may help.
    </p>
  );
}

function Sessions({ games }: { games: GameView[] }) {
  const [list, setList] = useState<SessionReport[] | null>(null);
  useEffect(() => void window.api.sessions().then(setList), []);
  if (!list?.length)
    return (
      <div className="rounded-xl bg-[var(--card)] p-4 text-sm text-slate-400 ring-1 ring-[var(--line)]">
        <div className="font-medium text-slate-100">Session history</div>
        No Game Boost sessions yet. Turn on Game Boost (and the overlay for FPS), play, and each session shows up here.
      </div>
    );
  const v = (n: number | null, unit = '') => (n === null ? '—' : `${n}${unit}`);
  return (
    <details open className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--line)]">
      <summary className="cursor-pointer text-sm font-medium text-slate-200">Session history ({list.length})</summary>
      <p className="mt-1 text-xs text-slate-500">One row per Game Boost session. FPS and temperatures need the overlay to have been on during the game.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              {['Game', 'When', 'Length', 'Avg FPS', '1% low', 'CPU', 'CPU max °C', 'GPU max °C', 'FPS drops'].map((h) => (
                <th key={h} className="px-2 py-1 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.startedAt} className="border-t border-[var(--line)] text-slate-300" title={s.hot.join('\n') || undefined}>
                <td className="px-2 py-1 text-slate-100">{s.game}</td>
                <td className="px-2 py-1">{new Date(s.startedAt).toLocaleString()}</td>
                <td className="px-2 py-1">{s.minutes} min</td>
                <td className="px-2 py-1">{v(s.fpsAvg)}</td>
                <td className="px-2 py-1">{v(s.low1)}</td>
                <td className="px-2 py-1">{v(s.cpuAvg, '%')}</td>
                <td className={clsx('px-2 py-1', s.cpuTempMax !== null && s.cpuTempMax >= 95 && 'text-amber-300')}>{v(s.cpuTempMax)}</td>
                <td className={clsx('px-2 py-1', s.gpuTempMax !== null && s.gpuTempMax >= 87 && 'text-amber-300')}>{v(s.gpuTempMax)}</td>
                <td
                  className={clsx('px-2 py-1', s.stutters?.length && 'cursor-help text-amber-300')}
                  title={s.stutters?.map((x) => `${new Date(x.at).toLocaleTimeString()}: ${x.before} → ${x.fps} FPS. ${x.top.map((p) => `${p.name} ${p.cpu}%`).join(', ') || 'No background app stood out.'}`).join('\n')}
                >
                  {s.stutters ? s.stutters.length : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BeforeAfter list={list} games={games} />
      <Culprits list={list} />
      {list.some((s) => s.hot.length) && <p className="mt-2 text-xs text-amber-300/90">Amber = hot enough that the chip may have slowed itself down. Check cooling and dust.</p>}
    </details>
  );
}

export function Games({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [games, setGames] = useState<GameView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'name' | 'status'>('name');
  const [pins, setPins] = useState<string[]>(loadPins);
  const load = useCallback(async () => setGames(await window.api.listGames()), []);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  useEffect(() => void window.api.gameIcons().then(setIcons), []);
  useEffect(() => void load(), [load]);
  const [launching, setLaunching] = useState<{ id: string; name: string; at: number; profile: boolean; phase: 'starting' | 'running' } | null>(null);
  // Running games: re-check every 4 s while one runs or is starting, so a closed game unlocks its profile by itself.
  const anyRunning = !!games?.some((g) => g.running);
  useEffect(() => {
    if (!anyRunning && !launching) return;
    const t = setInterval(() => void (document.hidden ? undefined : load()), 4000);
    return () => clearInterval(t);
  }, [anyRunning, launching, load]);
  useEffect(() => {
    if (!launching || launching.phase !== 'starting') return;
    if (launching.profile && games?.find((g) => g.id === launching.id)?.running) setLaunching({ ...launching, phase: 'running' });
  }, [games, launching]);
  useEffect(() => {
    if (!launching) return;
    // Running: show it briefly. Library games aren't tracked, and a launcher may sit at a login: let go after a while.
    const ms = launching.phase === 'running' ? 2500 : launching.profile ? 90_000 : 8000;
    const t = setTimeout(() => setLaunching(null), ms);
    return () => clearTimeout(t);
  }, [launching]);
  async function startGame(id: string, name: string, profile: boolean) {
    const r = await (profile ? window.api.launchGame(id) : window.api.launchLibraryGame(id));
    if (r.ok) setLaunching({ id, name, at: Date.now(), profile, phase: 'starting' });
    else await act(async () => r);
  }
  const [library, setLibrary] = useState<LibraryGame[]>([]);
  const [libIcons, setLibIcons] = useState<Record<string, string | null>>({});
  const loadLibrary = useCallback(async (refresh = false) => {
    setLibrary(await window.api.library(refresh));
    void window.api.libraryIcons().then(setLibIcons, () => {});
  }, []);
  useEffect(() => void loadLibrary(), [loadLibrary]);

  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
    setPins(next);
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
    } catch {
      // pins just won't persist
    }
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (games ?? [])
      .filter((g) => !q || `${g.name} ${g.publisher}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(pins.includes(b.id)) - Number(pins.includes(a.id)) ||
          (sort === 'status' ? ORDER.indexOf(a.status) - ORDER.indexOf(b.status) : 0) ||
          a.name.localeCompare(b.name),
      );
  }, [games, filter, sort, pins]);
  const libShown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return library.filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [library, filter]);
  const libSelected = library.find((g) => g.id === selected);
  const current = libSelected ? undefined : (games?.find((g) => g.id === selected) ?? shown[0]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Game profiles</h2>
        <p className="text-sm text-slate-400">
          Edits each game's own settings file, only the keys shown. Anti-cheat files are never touched. The game must be closed.
        </p>
      </div>
      {launching && (
        <Launching
          id={launching.id}
          name={launching.name}
          icon={launching.profile ? icons[launching.id] : libIcons[launching.id]}
          phase={launching.phase}
          onClose={() => setLaunching(null)}
        />
      )}
      <div className="grid gap-4 md:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search games…"
              aria-label="Search games"
              className="min-w-0 flex-1 rounded-md bg-white/5 px-3 py-1 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
              <option value="name" className="bg-slate-900">A–Z</option>
              <option value="status" className="bg-slate-900">Status</option>
            </select>
          </div>
          <Button
            disabled={busy}
            onClick={() => {
              void load();
              void loadLibrary(true);
            }}
          >
            Refresh
          </Button>
          {!games ? (
            <p className="text-sm text-slate-400">Looking for games…</p>
          ) : (
            <ul className="space-y-1">
              {shown.map((g) => (
                <li key={g.id} className={clsx('flex items-center gap-1 rounded-md ring-1', current?.id === g.id ? 'bg-sky-500/10 ring-sky-500/40' : 'ring-transparent hover:bg-white/5')}>
                  <button onClick={() => setSelected(g.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left">
                    <GameArt id={g.id} name={g.name} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-100">{g.name}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Badge className={STATUS[g.status][1]}>{STATUS[g.status][0]}</Badge>
                        {g.running && <span className="text-sky-300">running</span>}
                      </div>
                    </div>
                  </button>
                  {g.status !== 'not-installed' && !g.running && (
                    <button
                      disabled={busy}
                      onClick={() => void startGame(g.id, g.name, true)}
                      aria-label={`Play ${g.name}`}
                      title={`Play ${g.name}`}
                      className="px-1.5 text-sm text-slate-500 hover:text-sky-300 disabled:opacity-40"
                    >
                      ▶
                    </button>
                  )}
                  <button
                    onClick={() => togglePin(g.id)}
                    aria-pressed={pins.includes(g.id)}
                    aria-label={`${pins.includes(g.id) ? 'Unpin' : 'Pin'} ${g.name}`}
                    title={pins.includes(g.id) ? 'Unpin' : 'Pin to top'}
                    className={clsx('px-2 text-lg', pins.includes(g.id) ? 'text-sky-300' : 'text-slate-600 hover:text-slate-300')}
                  >
                    {pins.includes(g.id) ? '★' : '☆'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {libShown.length > 0 && (
            <>
              <h3 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your library ({libShown.length})</h3>
              <ul className="space-y-1">
                {libShown.map((g) => (
                  <li key={g.id} className={clsx('flex items-center gap-1 rounded-md ring-1', selected === g.id ? 'bg-sky-500/10 ring-sky-500/40' : 'ring-transparent hover:bg-white/5')}>
                    <button onClick={() => setSelected(g.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-1.5 text-left">
                      <GameIcon name={g.name} src={libIcons[g.id]} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-100">{g.name}</div>
                        <div className="text-xs text-slate-500">{STORE[g.source]}</div>
                      </div>
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void startGame(g.id, g.name, false)}
                      aria-label={`Play ${g.name}`}
                      title={`Play ${g.name}`}
                      className="px-2 text-sm text-slate-500 hover:text-sky-300 disabled:opacity-40"
                    >
                      ▶
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {/* Sticky: the chosen game's settings stay in view however far down the list it was picked. */}
        <div className="min-w-0 md:sticky md:top-2 md:max-h-[calc(100vh-5rem)] md:self-start md:overflow-y-auto md:pr-1">
          {libSelected && <LibraryPanel key={libSelected.id} g={libSelected} icon={libIcons[libSelected.id]} busy={busy} act={act} onPlay={() => void startGame(libSelected.id, libSelected.name, false)} />}
          {current && (
            <Editor
              key={`${current.id}:${JSON.stringify(current.current)}`}
              g={current}
              icon={icons[current.id]}
              busy={busy}
              act={act}
              ask={ask}
              reload={load}
              onPlay={() => void startGame(current.id, current.name, true)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
