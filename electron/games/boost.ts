// Game Boost: a watcher that starts a session when a known game runs and undoes it when the game exits.
//   - switches to a performance power plan (backed up through the safety layer, so Undo All also covers a crash)
//   - lowers named background apps to Below Normal priority (only ones at Normal; put back to Normal after)
//   - optionally pauses Windows Update (stops the service) and OneDrive, and starts them again after
// Each game can have its own options (perGame); on battery the power plan is left alone.
import type { BoostState } from '../../shared/types';
import { POWERSHELL_EXE, SC_EXE, runningProcesses, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';
import { purgeStandby } from '../system/memory';
import type { DisplayMode } from '../../shared/types';
import { setDisplayMode, validMode } from '../system/monitors';
import { CORE_PLAN } from '../tweaks/general';

export const BOOST_APPS = [
  { exe: 'discord.exe', name: 'Discord' },
  { exe: 'spotify.exe', name: 'Spotify' },
  { exe: 'chrome.exe', name: 'Chrome' },
  { exe: 'msedge.exe', name: 'Edge' },
  { exe: 'brave.exe', name: 'Brave' },
  { exe: 'firefox.exe', name: 'Firefox' },
  { exe: 'steamwebhelper.exe', name: 'Steam web helper' },
  { exe: 'epicgameslauncher.exe', name: 'Epic Games Launcher' },
  { exe: 'onedrive.exe', name: 'OneDrive' },
];

/** Performance plans, best first: the app's Core plan, Ultimate Performance, High performance. */
const PLANS = [
  { guid: CORE_PLAN, name: 'IcyTweaker Core' },
  { guid: 'e9a42b02-d5df-448d-aa00-03f14749eb61', name: 'Ultimate Performance' },
  { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'High performance' },
];

/** What a session does. The global settings apply unless a game has its own (perGame). */
export interface BoostOptions {
  plan: boolean;
  /** A specific power plan (GUID from powercfg /list); null = the best performance plan available. */
  planGuid: string | null;
  /** exe names from BOOST_APPS. */
  lowerApps: string[];
  /** Stop the Windows Update service during play and start it again after (needs administrator). */
  pauseUpdates: boolean;
  /** Close OneDrive during play and start it again after (it stops syncing meanwhile). */
  pauseOneDrive: boolean;
  /** During play, every 30 s: purge the standby memory list when free memory is low (needs administrator). */
  purgeStandby: boolean;
  /** Primary display mode during play, put back after (null = leave it). */
  display?: DisplayMode | null;
}
export interface BoostSettings extends BoostOptions {
  enabled: boolean;
  /** Game id -> its own options. */
  perGame: Record<string, BoostOptions>;
}
export const DEFAULT_BOOST: BoostSettings = {
  enabled: false,
  plan: true,
  planGuid: null,
  lowerApps: ['discord.exe', 'spotify.exe', 'chrome.exe', 'msedge.exe', 'steamwebhelper.exe'],
  pauseUpdates: false,
  pauseOneDrive: false,
  purgeStandby: false,
  perGame: {},
};

const ACTIVE: SettingRef = { kind: 'activeScheme' };
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** powercfg /list output -> plans. Names repeat (copies of Ultimate Performance), so the GUID is kept. */
export function parsePlans(out: string): Array<{ guid: string; name: string; active: boolean }> {
  return [...out.matchAll(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\((.*)\)(\s*\*)?/gi)].map((m) => ({ guid: m[1].toLowerCase(), name: m[2], active: !!m[3] }));
}
const psNames = (exes: string[]) => exes.map((e) => `'${e.replace(/\.exe$/i, '').replace(/'/g, '')}'`).join(',');
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const optionsFor = (s: BoostSettings, gameId: string): BoostOptions => s.perGame[gameId] ?? s;

export function createBoost(
  safety: Safety,
  games: Array<{ id: string; name: string; exe: string[] }>,
  initial: BoostSettings,
  onEvent?: (e: 'start' | 'end', game: string) => void,
  /** true while on battery: the power plan is left alone (Devices > laptop profile). */
  onBattery: () => boolean = () => false,
) {
  let settings = initial;
  let session: {
    game: string;
    since: string;
    prevScheme: string | null;
    plan: string | null;
    lowered: number[];
    updatesStopped: boolean;
    oneDrive: string | null;
    display: boolean;
  } | null = null;
  let busy: Promise<void> = Promise.resolve();
  let ticks = 0;
  let gameId: string | null = null;

  async function start(game: { id: string; name: string }) {
    const o = optionsFor(settings, game.id);
    let plan: (typeof PLANS)[number] | undefined;
    let prev: string | null = null;
    if (o.plan && !onBattery()) {
      // The game's chosen plan if it still exists, else the best performance plan available.
      const chosen = o.planGuid ? [{ guid: o.planGuid, name: 'chosen plan' }] : [];
      for (const p of [...chosen, ...PLANS]) if ((await safety.read({ kind: 'scheme', guid: p.guid, base: '', name: p.name })) !== null) { plan = p; break; }
      prev = (await safety.read(ACTIVE)) as string | null;
      if (plan && prev !== plan.guid) await safety.set(ACTIVE, plan.guid);
      else plan = undefined;
    }
    let lowered: number[] = [];
    if (o.lowerApps.length) {
      const script = `Get-Process -Name ${psNames(o.lowerApps)} -ErrorAction SilentlyContinue | Where-Object { $_.PriorityClass -eq 'Normal' } | ForEach-Object { $_.PriorityClass = 'BelowNormal'; $_.Id }`;
      const { stdout } = await safety.adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 30_000);
      lowered = stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
    }
    // Windows Update: only stopped if it is running now, so it is only started again if we stopped it.
    let updatesStopped = false;
    if (o.pauseUpdates) {
      const state = await safety.adapter.query(SC_EXE, ['query', 'wuauserv']).catch(() => '');
      if (/STATE\s*:\s*4\b/.test(state)) {
        await safety.adapter.exec(SC_EXE, ['stop', 'wuauserv'], 60_000).then(() => (updatesStopped = true), () => {});
      }
    }
    // OneDrive: its own /shutdown, then /background to bring it back.
    let oneDrive: string | null = null;
    if (o.pauseOneDrive) {
      const script = "$p = Get-Process OneDrive -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { $p.Path; Start-Process $p.Path '/shutdown' }";
      const { stdout } = await safety.adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 30_000).catch(() => ({ stdout: '' }));
      oneDrive = stdout.trim().split(/\r?\n/)[0] || (safety.adapter.live ? null : 'OneDrive.exe');
    }
    let display = false;
    if (o.display) await setDisplayMode(safety.adapter, o.display).then(() => (display = true), () => {});
    session = { game: game.name, since: new Date().toISOString(), prevScheme: plan ? prev : null, plan: plan?.name ?? null, lowered, updatesStopped, oneDrive, display };
    onEvent?.('start', game.name);
    const parts = [
      plan ? `plan ${plan.name}` : 'plan unchanged',
      `${lowered.length} app process(es) lowered`,
      updatesStopped ? 'Windows Update paused' : '',
      oneDrive ? 'OneDrive paused' : '',
      display ? `display ${o.display!.width}x${o.display!.height} ${o.display!.hz} Hz` : '',
    ];
    await safety.log('boost-start', game.name, true, `${parts.filter(Boolean).join('; ')}${safety.adapter.live ? '' : ' (dry-run)'}`);
  }

  async function end() {
    if (!session) return;
    const s = session;
    session = null;
    onEvent?.('end', s.game);
    const errors: string[] = [];
    // Writing the previous plan back drops the backup entry if it was the original.
    if (s.prevScheme) await safety.set(ACTIVE, s.prevScheme).catch((e: Error) => errors.push(e.message));
    if (s.lowered.length) {
      const script = `Get-Process -Id ${s.lowered.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'Normal' }`;
      await safety.adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 30_000).catch((e: Error) => errors.push(e.message));
    }
    if (s.updatesStopped) await safety.adapter.exec(SC_EXE, ['start', 'wuauserv'], 60_000).catch((e: Error) => errors.push(e.message));
    if (s.oneDrive) {
      await safety.adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', `Start-Process ${psQuote(s.oneDrive)} '/background'`], 30_000).catch((e: Error) => errors.push(e.message));
    }
    if (s.display) await setDisplayMode(safety.adapter, null).catch((e: Error) => errors.push(e.message));
    await safety.log('boost-end', s.game, errors.length === 0, errors.join(' | ') || undefined);
  }

  /** One watcher step. Serialized, so a slow tick never overlaps the next. */
  function tick() {
    busy = busy
      .then(async () => {
        const procs = await runningProcesses(safety.adapter);
        const game = settings.enabled ? games.find((g) => g.exe.some((e) => procs.has(e))) : undefined;
        if (session && (!game || game.name !== session.game)) await end();
        if (game && !session) await start(game);
        gameId = session ? (game?.id ?? gameId) : null;
        // Standby memory: checked every 3rd tick (30 s); the script itself decides whether memory is low enough.
        if (session && gameId && optionsFor(settings, gameId).purgeStandby && ++ticks % 3 === 0) {
          if (await purgeStandby(safety.adapter, true).catch(() => false)) await safety.log('standby-purge', session.game, true, safety.adapter.live ? undefined : 'dry-run');
        }
      })
      .catch(() => {});
    return busy;
  }

  return {
    tick,
    end: () => (busy = busy.then(end).catch(() => {})),
    get settings() {
      return settings;
    },
    set(next: BoostSettings) {
      settings = next;
      return tick();
    },
    state: (): BoostState => ({
      settings,
      active: session ? { game: session.game, since: session.since, plan: session.plan, lowered: session.lowered.length } : null,
      apps: BOOST_APPS,
      games: games.map((g) => ({ id: g.id, name: g.name })),
    }),
  };
}

/** Validates settings from the renderer or an imported file. null = invalid. Unknown games and apps are dropped. */
export function validateBoost(raw: unknown, gameIds: string[]): BoostSettings | null {
  const apps = BOOST_APPS.map((a) => a.exe);
  const opts = (x: unknown): BoostOptions | null => {
    const o = x as Partial<BoostOptions> | null;
    if (!o || typeof o.plan !== 'boolean' || !Array.isArray(o.lowerApps)) return null;
    return {
      plan: o.plan,
      planGuid: typeof o.planGuid === 'string' && GUID.test(o.planGuid) ? o.planGuid.toLowerCase() : null,
      lowerApps: [...new Set(o.lowerApps.filter((a): a is string => typeof a === 'string' && apps.includes(a)))],
      pauseUpdates: o.pauseUpdates === true,
      pauseOneDrive: o.pauseOneDrive === true,
      purgeStandby: o.purgeStandby === true,
      display: validMode(o.display),
    };
  };
  const r = raw as Partial<BoostSettings> | null;
  const base = opts(r);
  if (!r || !base || typeof r.enabled !== 'boolean') return null;
  const perGame: Record<string, BoostOptions> = {};
  for (const [id, v] of Object.entries(r.perGame ?? {})) {
    const o = opts(v);
    if (gameIds.includes(id) && o) perGame[id] = o;
  }
  return { ...base, enabled: r.enabled, perGame };
}
