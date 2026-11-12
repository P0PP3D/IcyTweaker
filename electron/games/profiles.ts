// Game profiles as data. Each lists the game's own settings files and, per option, the exact keys and
// values to write. A profile only ever changes keys already in the file: if the game renamed one in a
// patch, applying refuses and names the missing key (see games.ts), so a stale profile fails loudly.
// Never list anti-cheat files here, only the game's own settings files.
//
// Paths: %VAR% = environment variable, {steam} = Steam folder, * = any one folder (the newest file wins).
import type { GameFlag, GameValues } from '../../shared/types';
import type { ConfigFormat } from './config';

export interface Key {
  file: string;
  section?: string;
  name: string;
}
export type Write = [Key, string];
export interface Choice {
  label: string;
  set: Write[];
}

export interface GameProfile {
  id: string;
  name: string;
  publisher: string;
  /** Game version (or date) the keys below were read from. */
  checkedVersion: string;
  note?: string;
  /** Process names, lower case (launch detection). */
  exe: string[];
  install: { steam?: number; riot?: string };
  /**
   * Where the game's .exe usually is, for its icon (read from the user's own install, never bundled).
   * Tokens: %VAR%, * (any folder, newest wins), {steamapp:ID} (its Steam install folder), {epic:AppName}, {riot:name}.
   */
  icon: string[];
  /** Read the icon with Windows' own extractor: Electron's getFileIcon returns the generic program icon for some
   * exes (Roblox's, checked 2026-11). */
  shellIcon?: boolean;
  files: Record<string, { path: string; format: ConfigFormat }>;
  /** Every key gets the same value (e.g. current and last-confirmed resolution). */
  resolution?: { w: Key[]; h: Key[] };
  /** float: Unreal writes 240.000000. 0 = unlimited, written as `unlimited` when the game uses another value for it. */
  fps?: { key: Key; float: boolean; unlimited?: string };
  aa?: Choice[];
  reflex?: Choice[];
  flags: Partial<Record<GameFlag, Write[]>>;
  /** Competitive defaults for the "Recommended" switch. Resolution and FPS stay as the user has them. */
  recommended: Omit<GameValues, 'width' | 'height' | 'fps'>;
}

// Unreal Engine GameUserSettings.ini. Fullscreen mode: 0 fullscreen, 1 windowed fullscreen, 2 windowed.
const SG = 'ScalabilityGroups';
const ue = (section: string, fullscreenKeys: string[]) => {
  const k = (name: string, s = section): Key => ({ file: 'gus', section: s, name });
  const sg = (name: string, v: string): Write => [k(name, SG), v];
  return {
    k,
    resolution: { w: [k('ResolutionSizeX'), k('LastUserConfirmedResolutionSizeX')], h: [k('ResolutionSizeY'), k('LastUserConfirmedResolutionSizeY')] },
    fps: { key: k('FrameRateLimit'), float: true },
    flags: {
      fullscreen: fullscreenKeys.map((n): Write => [k(n), '0']),
      borderless: fullscreenKeys.map((n): Write => [k(n), '1']), // 1 = windowed fullscreen (borderless)
      vsyncOff: [[k('bUseVSync'), 'False']],
      dynResOff: [[k('bUseDynamicResolution'), 'False']],
      hdrOff: [[k('bUseHDRDisplayOutput'), 'False']],
      lowEffects: [sg('sg.EffectsQuality', '0')],
      lowMaterials: [sg('sg.ShadingQuality', '0')],
      lowTextures: [sg('sg.TextureQuality', '0')],
      lowDetail: [sg('sg.FoliageQuality', '0')],
      shadowsOff: [sg('sg.ShadowQuality', '0')],
      lowAa: [sg('sg.AntiAliasingQuality', '0')],
    } satisfies Partial<Record<GameFlag, Write[]>>,
  };
};

const fn = ue('/Script/FortniteGame.FortGameUserSettings', ['PreferredFullscreenMode', 'LastConfirmedFullscreenMode']); // Fortnite has no FullscreenMode line
const val = ue('/Script/ShooterGame.ShooterGameUserSettings', ['FullscreenMode', 'PreferredFullscreenMode', 'LastConfirmedFullscreenMode']);
const tot = ue('/Script/OPP.RBGameUserSettings', ['FullscreenMode', 'PreferredFullscreenMode', 'LastConfirmedFullscreenMode']);
const { lowAa: _totHasNoAaGroup, ...totFlags } = tot.flags; // its AntiAliasingQuality is outside ScalabilityGroups
// Dead by Daylight's file only lists values that differ from the defaults (";METADATA=(Diff=true)"): no resolution,
// vsync or fullscreen lines to patch, so only the quality groups.
const dbd = ue('/Script/DeadByDaylight.DBDGameUserSettings', []);
const { lowEffects, lowMaterials, lowTextures, lowDetail, shadowsOff, lowAa } = dbd.flags;

const rbx = (name: string): Key => ({ file: 'settings', name });
const dl = (name: string): Key => ({ file: 'video', name: `setting.${name}` });

export const gameProfiles: GameProfile[] = [
  {
    id: 'fortnite',
    name: 'Fortnite',
    publisher: 'Epic Games',
    checkedVersion: 'GameUserSettings.ini as of 2026-11',
    exe: ['fortniteclient-win64-shipping.exe'],
    install: {},
    icon: ['{epic:Fortnite}\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe', '%ProgramFiles%\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe'],
    files: { gus: { path: '%LOCALAPPDATA%\\FortniteGame\\Saved\\Config\\WindowsClient\\GameUserSettings.ini', format: 'ini' } },
    resolution: fn.resolution,
    fps: fn.fps,
    // verify: LatencyTweak2 0/1/2 = Reflex Off / On / On + Boost (read from a real file set to On + Boost; the mapping is not documented).
    reflex: ['Off', 'On', 'On + Boost'].map((label, i) => ({ label, set: [[fn.k('LatencyTweak2'), String(i)]] })),
    flags: { ...fn.flags, showFps: [[fn.k('bShowFPS'), 'True']] },
    recommended: { reflex: 1, flags: ['fullscreen', 'vsyncOff', 'dynResOff', 'hdrOff', 'showFps', 'lowEffects', 'shadowsOff', 'lowDetail'] },
  },
  {
    id: 'valorant',
    name: 'VALORANT',
    publisher: 'Riot Games',
    checkedVersion: 'GameUserSettings.ini as of 2026-11',
    // verify: Valorant also stores graphics settings in your Riot account and may put them back on next launch.
    exe: ['valorant-win64-shipping.exe'],
    install: { riot: 'valorant.live' },
    icon: ['{riot:valorant}\\VALORANT.exe', 'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe'],
    files: { gus: { path: '%LOCALAPPDATA%\\VALORANT\\Saved\\Config\\*\\WindowsClient\\GameUserSettings.ini', format: 'ini' } },
    resolution: val.resolution,
    // Letterbox keys read from the dev PC's real file (2026-11): True = 4:3 shows with black bars.
    flags: { ...val.flags, noLetterbox: [[val.k('bShouldLetterbox'), 'False'], [val.k('bLastConfirmedShouldLetterbox'), 'False']] },
    recommended: { flags: ['fullscreen', 'vsyncOff', 'dynResOff', 'hdrOff', 'lowEffects', 'shadowsOff', 'lowDetail'] },
  },
  {
    // Keys read from the dev PC's real files (video.txt "Version" 20, 2026-11). The FPS cap lives in the per-user
    // machine_convars.vcfg (same "key" "value" layout), not in video.txt.
    id: 'deadlock',
    name: 'Deadlock',
    publisher: 'Valve',
    checkedVersion: 'video.txt version 20, machine_convars.vcfg as of 2026-11',
    note: 'Deadlock rewrites these files when it closes, so apply with the game shut. Shadows are left alone in the recommended set: they help you see enemies.',
    exe: ['deadlock.exe'],
    install: { steam: 1422450 },
    icon: ['{steamapp:1422450}\\game\\bin\\win64\\deadlock.exe'],
    files: {
      video: { path: '{steamapp:1422450}\\game\\citadel\\cfg\\video.txt', format: 'kv' },
      convars: { path: '{steam}\\userdata\\*\\1422450\\local\\cfg\\machine_convars.vcfg', format: 'kv' },
    },
    resolution: { w: [dl('defaultres')], h: [dl('defaultresheight')] },
    fps: { key: { file: 'convars', name: 'fps_max' }, float: false }, // Source 2: 0 = no cap
    // verify: r_low_latency 0/1/2 = Off / On / On + Boost (Source 2 convention; the file holds 1 = On).
    reflex: ['Off', 'On', 'On + Boost'].map((label, i) => ({ label, set: [[dl('r_low_latency'), String(i)]] })),
    flags: {
      // verify: exclusive fullscreen is fullscreen 1 + nowindowborder 0 (the file holds borderless: 0 / 1).
      fullscreen: [[dl('fullscreen'), '1'], [dl('nowindowborder'), '0']],
      // Read from the dev PC's real video.txt, which is set to borderless: fullscreen 0 + nowindowborder 1.
      borderless: [[dl('fullscreen'), '0'], [dl('nowindowborder'), '1']],
      vsyncOff: [[dl('mat_vsync'), '0']],
      aoOff: [[dl('r_citadel_ssao_quality'), '0'], [dl('r_citadel_distancefield_ao_quality'), '0']],
      bloomOff: [[dl('r_effects_bloom'), 'false'], [dl('r_post_bloom'), 'false']],
      motionBlurOff: [[dl('r_citadel_motion_blur'), '0']],
      dofOff: [[dl('r_depth_of_field'), 'false']],
      // verify: the 0 = lowest mapping of these quality levels (the file holds 1-4).
      lowEffects: [[dl('cpu_level'), '0'], [dl('r_particle_depth_feathering'), 'false'], [dl('r_arealights'), 'false']],
      lowMaterials: [[dl('shaderquality'), '0']],
      lowTextures: [[dl('gpu_mem_level'), '0']],
      lowDetail: [[dl('gpu_level'), '0'], [dl('r_citadel_fog_quality'), '0']],
      shadowsOff: [[dl('r_citadel_shadow_quality'), '0']],
    },
    recommended: { reflex: 1, flags: ['vsyncOff', 'aoOff', 'bloomOff', 'motionBlurOff', 'dofOff', 'lowEffects'] },
  },
  {
    // Keys read from the dev PC's real file (2026-11).
    id: 'outlast-trials',
    name: 'The Outlast Trials',
    publisher: 'Red Barrels',
    checkedVersion: 'GameUserSettings.ini Version=7 as of 2026-11',
    // verify: whether a QualityPreset other than custom puts the groups back on launch.
    note: 'If the game puts the quality settings back, pick the Custom preset in its menu once.',
    exe: ['totclient-win64-shipping.exe'],
    install: { steam: 1304930 },
    icon: ['{steamapp:1304930}\\OPP\\Binaries\\Win64\\TOTClient-Win64-Shipping.exe'],
    files: { gus: { path: '%LOCALAPPDATA%\\OPP\\Saved\\Config\\WindowsClient\\GameUserSettings.ini', format: 'ini' } },
    resolution: tot.resolution,
    fps: tot.fps,
    flags: { ...totFlags, motionBlurOff: [[tot.k('bMotionBlurEnabled'), 'False']], bloomOff: [[tot.k('bBloomEnabled'), 'False']] },
    recommended: { flags: ['vsyncOff', 'dynResOff', 'motionBlurOff', 'lowEffects'] },
  },
  {
    // Keys read from the dev PC's real file (2026-11).
    id: 'dead-by-daylight',
    name: 'Dead by Daylight',
    publisher: 'Behaviour Interactive',
    checkedVersion: 'GameUserSettings.ini (Diff=true) as of 2026-11',
    // verify: whether ScalabilityLevel (the preset) overrides the groups on launch.
    note: 'Only quality settings: the file has no resolution, V-Sync or fullscreen lines. The FPS cap (30 / 60 / 120) is set in the game.',
    exe: ['deadbydaylight-win64-shipping.exe'],
    install: { steam: 381210 },
    icon: ['{steamapp:381210}\\DeadByDaylight\\Binaries\\Win64\\DeadByDaylight-Win64-Shipping.exe'],
    files: { gus: { path: '%LOCALAPPDATA%\\DeadByDaylight\\Saved\\Config\\WindowsClient\\GameUserSettings.ini', format: 'ini' } },
    flags: { lowEffects, lowMaterials, lowTextures, lowDetail, shadowsOff, lowAa },
    recommended: { flags: ['lowEffects', 'lowDetail'] },
  },
  {
    // Roblox's own user settings file. Hyperion (its anti-cheat) files are never touched.
    id: 'roblox',
    name: 'Roblox',
    publisher: 'Roblox Corporation',
    checkedVersion: 'GlobalBasicSettings_13.xml as of 2026-11',
    note: 'Roblox picks its own resolution from the window. Low graphics quality is the manual quality slider at 1.',
    exe: ['robloxplayerbeta.exe'],
    install: {},
    icon: ['%LOCALAPPDATA%\\Roblox\\Versions\\*\\RobloxPlayerBeta.exe'],
    shellIcon: true,
    files: { settings: { path: '%LOCALAPPDATA%\\Roblox\\GlobalBasicSettings_13.xml', format: 'xml' } },
    fps: { key: rbx('FramerateCap'), float: false, unlimited: '9999' }, // verify: 9999 = no cap (the value read with the cap off)
    flags: {
      fullscreen: [[rbx('Fullscreen'), 'true']],
      lowDetail: [[rbx('SavedQualityLevel'), '1'], [rbx('GraphicsQualityLevel'), '1']],
    },
    recommended: { flags: ['fullscreen'] },
  },
];
