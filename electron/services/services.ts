// Services: level selector (Off / Minimum / Medium / Extreme) and the full service manager.
// Every start type change goes through safety.set (backed up); start/stop goes through adapter.exec.
import type { LevelPreview, ServiceInfo, ServiceLevel } from '../../shared/types';
import { POWERSHELL_EXE, SC_EXE, type StartType, type SystemAdapter } from '../system/adapter';
import type { Safety } from '../system/safety';
import { catalogServices, type CatalogService } from './catalog';

export const LEVELS: ServiceLevel[] = ['off', 'minimum', 'medium', 'extreme'];
const rank = (l: ServiceLevel) => LEVELS.indexOf(l);

/** Rank at which a catalog service is disabled, or null for "sub-group switch only". */
export const levelRank = (x: CatalogService, xboxInUse: boolean) => (x.level === null ? null : x.xbox && xboxInUse ? rank('medium') : rank(x.level));

/** Never disabled, set to Manual, or stopped from the service manager: Windows or networking stops working. */
export const CRITICAL = new Set(
  [
    'RpcSs', 'RpcEptMapper', 'DcomLaunch', 'LSM', 'SamSs', 'EventLog', 'PlugPlay', 'Power', 'ProfSvc', 'BrokerInfrastructure',
    'CoreMessagingRegistrar', 'Dhcp', 'Dnscache', 'nsi', 'NlaSvc', 'netprofm', 'mpssvc', 'BFE', 'WinDefend', 'SecurityHealthService',
    'wscsvc', 'gpsvc', 'Winmgmt', 'CryptSvc', 'StateRepository', 'SystemEventsBroker', 'TimeBrokerSvc', 'UserManager', 'Schedule',
    'AudioEndpointBuilder', 'Audiosrv', 'LanmanWorkstation', 'TrustedInstaller', 'msiserver', 'AppXSvc', 'ClipSVC', 'Appinfo', 'KeyIso',
    'VaultSvc', 'WlanSvc', 'Wcmsvc', 'EventSystem', 'SENS', 'ShellHWDetection', 'Themes', 'FontCache', 'camsvc', 'TokenBroker',
  ].map((n) => n.toLowerCase()),
);

/** Per-user service instances (Name_1a2b3) are created from a template at sign-in; change the template instead. */
export const isPerUser = (name: string) => /_[0-9a-f]{4,6}$/i.test(name);

const MODES: Record<string, StartType> = { auto: 'auto', manual: 'demand', disabled: 'disabled', boot: 'boot', system: 'system' };

const LIST_SCRIPT =
  "$deps=@{}; Get-Service -ErrorAction SilentlyContinue | ForEach-Object { $deps[$_.Name] = @($_.DependentServices | ForEach-Object Name) }; " +
  '@(Get-CimInstance Win32_Service | ForEach-Object { [pscustomobject]@{ n=$_.Name; d=$_.DisplayName; s=$_.Description; st=$_.State; m=$_.StartMode; dl=$_.DelayedAutoStart; dep=$deps[$_.Name] } }) | ConvertTo-Json -Compress -Depth 3';

interface Raw {
  n: string;
  d: string;
  s: string | null;
  st: string;
  m: string;
  dl: boolean;
  dep: Array<string | null> | string | null;
}

export function parseServices(json: string): ServiceInfo[] {
  const raw: Raw[] = JSON.parse(json || '[]');
  return (Array.isArray(raw) ? raw : [raw]).map((r) => {
    const mode = MODES[r.m?.toLowerCase()] ?? 'demand';
    return {
      name: r.n,
      displayName: r.d,
      description: r.s ?? '',
      state: r.st,
      startType: mode === 'auto' && r.dl ? 'delayed-auto' : mode,
      // Windows reports some dependents without a name (null); skip those.
      dependents: (r.dep == null ? [] : Array.isArray(r.dep) ? r.dep : [r.dep]).filter((d): d is string => typeof d === 'string'),
      protected: CRITICAL.has(r.n.toLowerCase()) ? 'Windows needs this service.' : null,
      perUser: isPerUser(r.n),
    };
  });
}

export function createServices(adapter: SystemAdapter, safety: Safety) {
  let xbox: Promise<boolean> | null = null;
  const ref = (name: string) => ({ kind: 'service' as const, name });

  async function list(): Promise<ServiceInfo[]> {
    const services = parseServices(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', LIST_SCRIPT], 60_000));
    // The query sees the real system; show dry-run (and just-made) changes for services the app touched.
    const changed = new Set(safety.changedRefs().filter((r) => r.kind === 'service').map((r) => (r as { name: string }).name.toLowerCase()));
    await Promise.all(
      services.filter((x) => changed.has(x.name.toLowerCase())).map(async (x) => (x.startType = ((await safety.read(ref(x.name))) as StartType | null) ?? x.startType)),
    );
    return services;
  }

  const xboxInUse = () =>
    (xbox ??= adapter
      .query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', "@(Get-AppxPackage -Name 'Microsoft.GamingApp').Count"])
      .then((o) => Number(o.trim()) > 0, () => false));

  /** Catalog services that exist here, with their current start type. */
  async function present() {
    const cur = await Promise.all(catalogServices.map((x) => safety.read(ref(x.name))));
    return catalogServices.flatMap((x, i) => (cur[i] === null ? [] : [{ x, start: cur[i] as StartType }]));
  }

  return {
    list,
    xboxInUse,

    /** The highest level whose services are all disabled; custom = more is disabled than that level covers. */
    async currentLevel(): Promise<{ level: ServiceLevel; custom: boolean }> {
      const [p, xb] = [await present(), await xboxInUse()];
      const ranked = p.flatMap(({ x, start }) => {
        const r = levelRank(x, xb);
        return r === null ? [] : [{ r, off: start === 'disabled' }];
      });
      let level = 0;
      for (let l = 1; l <= 3; l++) if (ranked.filter((e) => e.r <= l).every((e) => e.off)) level = l;
      return { level: LEVELS[level], custom: ranked.some((e) => e.r > level && e.off) };
    },

    async preview(level: ServiceLevel): Promise<LevelPreview> {
      const [p, xb, all] = [await present(), await xboxInUse(), await list().catch(() => [])];
      const info = new Map(all.map((s) => [s.name.toLowerCase(), s]));
      const L = rank(level);
      const inLevel = (x: CatalogService) => {
        const r = levelRank(x, xb);
        return r !== null && r <= L;
      };
      const disable = p.filter(({ x, start }) => inLevel(x) && start !== 'disabled');
      const disabling = new Set(p.filter(({ x }) => inLevel(x)).map(({ x }) => x.name.toLowerCase()));
      const changed = new Set(safety.changedRefs().filter((r) => r.kind === 'service').map((r) => (r as { name: string }).name.toLowerCase()));
      return {
        level,
        xboxInUse: xb,
        disable: disable.map(({ x }) => ({
          name: x.name,
          displayName: info.get(x.name.toLowerCase())?.displayName ?? x.name,
          breaks: x.breaks,
          running: info.get(x.name.toLowerCase())?.state === 'Running',
        })),
        restore: p.filter(({ x }) => !inLevel(x) && levelRank(x, xb) !== null && changed.has(x.name.toLowerCase())).map(({ x }) => x.name),
        dependents: disable.flatMap(({ x }) =>
          (info.get(x.name.toLowerCase())?.dependents ?? [])
            .filter((d) => !disabling.has(d.toLowerCase()) && info.get(d.toLowerCase())?.startType !== 'disabled')
            .map((d) => ({ service: x.name, dependent: info.get(d.toLowerCase())?.displayName ?? d })),
        ),
      };
    },

    /** Disable everything at or below `level`; put back what the app changed above it. Call behind a restore point. */
    async apply(level: ServiceLevel): Promise<string[]> {
      const [p, xb] = [await present(), await xboxInUse()];
      const errors: string[] = [];
      for (const { x } of p) {
        const r = levelRank(x, xb);
        if (r === null) continue; // sub-group switch only
        try {
          if (r <= rank(level)) await safety.set(ref(x.name), 'disabled');
          else await safety.restore(ref(x.name));
        } catch (err) {
          errors.push(`${x.name}: ${(err as Error).message}`);
        }
      }
      return errors;
    },

    async setStartType(name: string, type: StartType) {
      await safety.set(ref(name), type);
    },

    async control(name: string, action: 'start' | 'stop') {
      await adapter.exec(SC_EXE, [action, name], 60_000);
    },
  };
}
