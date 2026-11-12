// App Optimizer: one card per app, each a tweak (page 'apps') so it gets the same backup, revert and tests.
// Cards that edit an app's own settings file only exist when that file does (the app is installed).
import type { TweakMeta } from '../../shared/types';
import { dword, type SettingRef } from '../system/adapter';
import { regTweak, tweak, type RegSetting, type Tweak } from '../tweaks/engine';
import type { ConfigFormat } from '../games/config';

const card = (m: Pick<TweakMeta, 'id' | 'name' | 'description'> & Partial<TweakMeta>): TweakMeta => ({
  category: 'performance',
  risk: 'safe',
  requiresAdmin: false,
  requiresReboot: false,
  builds: { min: 0 },
  page: 'apps',
  ...m,
});

const cfg = (file: string, format: ConfigFormat, name: string, section?: string): SettingRef => ({ kind: 'configKey', file, format, name, section });

// Browser policies (machine-wide; Chromium browsers show "managed by your organization" while set).
const policies = (key: string, values: Array<[string, number]>): RegSetting[] =>
  values.map(([name, v]) => ({ hive: 'HKLM', key, name, on: dword(v), off: null }));
const CHROMIUM = (key: string) =>
  policies(key, [
    ['HardwareAccelerationModeEnabled', 0],
    ['BackgroundModeEnabled', 0],
    ['HighEfficiencyModeEnabled', 1], // verify: Chrome may have replaced this Memory Saver policy in newer versions
  ]);
const POLICY_WARNING = 'Hardware acceleration off: video and some pages use more CPU. The browser shows "managed by your organization" while this is on.';
const HW_WARNING = 'Hardware acceleration off: video in the app uses more CPU.';

/** Settings files of installed apps; null = not installed (no card). */
export interface AppPaths {
  discord: string | null;
  /** Chromium "Local State" of Opera and Opera GX. */
  opera: string | null;
  operaGx: string | null;
  spotify: string | null;
  obs: string | null;
}
export const NO_APPS: AppPaths = { discord: null, opera: null, operaGx: null, spotify: null, obs: null };

// Opera has no documented policy support, so its Local State prefs are edited (keys standard to Chromium).
const operaCard = (id: string, name: string, file: string) =>
  tweak(card({ id, name, description: 'Hardware acceleration off, and Opera stops running in the background after you close it.', warning: `${HW_WARNING} Opera must be closed while this changes.`, needsClosed: ['opera.exe'] }), [
    { ref: cfg(file, 'json', 'hardware_acceleration_mode.enabled'), on: false, off: null },
    { ref: cfg(file, 'json', 'background_mode.enabled'), on: false, off: null },
  ]);

export function appTweaks(p: AppPaths): Tweak[] {
  const all: Array<Tweak | false | null | ''> = [
    regTweak(
      card({
        id: 'app-edge',
        name: 'Microsoft Edge',
        description: 'Stops Startup Boost and background extensions when Edge is closed, and turns off hardware acceleration.',
        requiresAdmin: true,
        warning: POLICY_WARNING,
      }),
      policies('SOFTWARE\\Policies\\Microsoft\\Edge', [
        ['StartupBoostEnabled', 0],
        ['BackgroundModeEnabled', 0],
        ['HardwareAccelerationModeEnabled', 0],
      ]),
    ),
    p.discord &&
      tweak(
        card({
          id: 'app-discord',
          name: 'Discord Optimization',
          description: "Turns off Discord's hardware acceleration so it stops using the GPU while you play.",
          warning: 'Discord must be closed (including the tray icon) while this changes.',
          needsClosed: ['discord.exe'],
        }),
        [{ ref: cfg(p.discord, 'json', 'enableHardwareAcceleration'), on: false, off: null }],
      ),
    regTweak(
      card({
        id: 'app-discord-priority',
        name: 'Discord CPU Priority',
        description: 'Runs Discord at Below Normal priority so games get the CPU first. Stays set across restarts.',
        requiresAdmin: true,
      }),
      [
        {
          hive: 'HKLM',
          key: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\Discord.exe\\PerfOptions',
          name: 'CpuPriorityClass',
          on: dword(5), // 5 = Below Normal
          off: null,
        },
      ],
    ),
    regTweak(
      card({ id: 'app-chrome', name: 'Google Chrome', description: 'Hardware acceleration and background mode off, Memory Saver on.', requiresAdmin: true, warning: POLICY_WARNING }),
      CHROMIUM('SOFTWARE\\Policies\\Google\\Chrome'),
    ),
    regTweak(
      card({ id: 'app-brave', name: 'Brave', description: 'Hardware acceleration and background mode off, Memory Saver on.', requiresAdmin: true, warning: POLICY_WARNING }),
      CHROMIUM('SOFTWARE\\Policies\\BraveSoftware\\Brave'),
    ),
    // Firefox reads enterprise policies from the registry (same names as policies.json).
    regTweak(
      card({
        id: 'app-firefox',
        name: 'Firefox',
        description: 'Hardware acceleration off and no background update task while Firefox is closed.',
        requiresAdmin: true,
        warning: 'Hardware acceleration off: video uses more CPU. Firefox shows "Your browser is being managed by your organization" while this is on.',
      }),
      policies('SOFTWARE\\Policies\\Mozilla\\Firefox', [
        ['HardwareAcceleration', 0],
        ['BackgroundAppUpdate', 0],
      ]),
    ),
    p.opera && operaCard('app-opera', 'Opera', p.opera),
    // verify: Opera GX limiter keys were not checked against a real GX profile, so the limiters are not set here.
    p.operaGx && operaCard('app-opera-gx', 'Opera GX', p.operaGx),
    p.spotify &&
      tweak(
        card({
          id: 'app-spotify',
          name: 'Spotify',
          description: 'Hardware acceleration off, and Spotify no longer starts with Windows.',
          warning: `${HW_WARNING} Spotify must be closed while this changes.`,
          needsClosed: ['spotify.exe'],
        }),
        [
          { ref: cfg(p.spotify, 'prefs', 'ui.hardware_acceleration'), on: 'false', off: null },
          { ref: cfg(p.spotify, 'prefs', 'app.autostart-mode'), on: '"off"', off: null },
        ],
      ),
    p.obs &&
      tweak(
        card({
          id: 'app-obs',
          name: 'OBS Studio',
          description: 'Browser sources (alerts, chat widgets) render on the CPU instead of competing with your game for the GPU.',
          warning: 'Heavy browser sources may use more CPU. OBS must be closed while this changes.',
          needsClosed: ['obs64.exe'],
        }),
        [{ ref: cfg(p.obs, 'ini', 'BrowserHWAccel', 'General'), on: 'false', off: null }],
      ),
  ];
  return all.filter((t): t is Tweak => !!t);
}
