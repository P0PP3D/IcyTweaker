// General tweaks: the "General tweaks" table of docs/SPEC.md, in the same order.
// `off` is the Windows default, used on revert only when the app has no backup of that setting
// (normally revert restores the exact original from backup.json). null = delete / leave absent.
//
// Not here: NVIDIA Profile (needs NVAPI or a third-party tool, and the driver profile could not be backed up and reverted).
import type { TweakMeta } from '../../shared/types';
import { binary, dword, sz, type RegValue, type SettingRef, type Value } from '../system/adapter';
import { regDwordTweak, regTweak, tweak, type Setting, type Tweak } from './engine';

/** Windows 10 2004. The app targets Windows 10 22H2 and Windows 11. */
const WIN10_2004 = 19041;

const CDM = 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
const ACCESSIBILITY = 'Control Panel\\Accessibility';
const POLICIES = 'SOFTWARE\\Policies\\Microsoft';
const WU = `${POLICIES}\\Windows\\WindowsUpdate`;
const MMCSS = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';

/** Balanced always exists, so the app's own plan is copied from it. */
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
/** Fixed GUID for the app's own plan, so it can be found and deleted on revert. */
export const CORE_PLAN = '3f8e2c1a-7b4d-4e6f-9a2b-1c5d8e0f7a31';
const USB_SUB = '2a737441-1930-4402-8d77-b2bebba308a3';
const USB_SELECTIVE_SUSPEND = '48e6b7a6-50f5-4782-a5d4-53bb8f07e226';
/** SKF_HOTKEYACTIVE / TKF_HOTKEYACTIVE / FKF_HOTKEYACTIVE: the "press Shift 5 times" shortcut. */
const HOTKEY = 0x4;

const task = (path: string): Setting => ({ ref: { kind: 'task', path: `\\Microsoft\\Windows\\${path}` }, on: 'disabled', off: 'enabled' });
const power = (scheme: string, sub: string, setting: string, ac: boolean, on: number, off: number | null): Setting => ({
  ref: { kind: 'power', scheme, sub, setting, ac },
  on,
  off,
});

/** Defaults shared by every tweak below. */
const meta = (m: Pick<TweakMeta, 'id' | 'name' | 'category' | 'description'> & Partial<TweakMeta>): TweakMeta => ({
  risk: 'safe',
  requiresAdmin: true,
  requiresReboot: false,
  builds: { min: WIN10_2004 },
  ...m,
});

export const generalTweaks: Tweak[] = [
  tweak(
    meta({
      id: 'core-power-plan',
      name: 'Core Power Plan',
      category: 'performance',
      description:
        'Creates and activates an "IcyTweaker Core" power plan, copied from Balanced. When plugged in, the CPU stays at full speed, drives never spin down and PCIe link power saving is off. Battery settings are unchanged.',
    }),
    [
      { ref: { kind: 'scheme', guid: CORE_PLAN, base: BALANCED, name: 'IcyTweaker Core' }, on: true, off: null },
      power(CORE_PLAN, 'SUB_PROCESSOR', 'PROCTHROTTLEMIN', true, 100, null),
      power(CORE_PLAN, 'SUB_PROCESSOR', 'PROCTHROTTLEMAX', true, 100, null),
      power(CORE_PLAN, 'SUB_DISK', 'DISKIDLE', true, 0, null),
      power(CORE_PLAN, 'SUB_PCIEXPRESS', 'ASPM', true, 0, null),
      // Last, so revert switches back to the previous plan before the Core plan is deleted.
      { ref: { kind: 'activeScheme' }, on: CORE_PLAN, off: BALANCED },
    ],
  ),

  regDwordTweak(
    meta({
      id: 'process-count-reduction',
      name: 'Process Count Reduction',
      category: 'performance',
      description: 'Groups Windows services into fewer svchost processes, so Task Manager shows far fewer of them.',
      risk: 'balanced',
      requiresReboot: true,
      warning: 'If one grouped service crashes, it takes the others in its group down with it until they restart.',
    }),
    // Threshold above any installed RAM = services always grouped. Windows default 0x380000 (3.5 GB).
    { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control', name: 'SvcHostSplitThresholdInKB', enabled: 0xffffffff, defaultValue: 0x380000 },
  ),

  regDwordTweak(
    meta({
      id: 'win32-priority',
      name: 'Win32 Priority',
      category: 'performance',
      description: 'How strongly Windows favours the window in front (your game) when handing out CPU time.',
      risk: 'balanced',
      options: [
        { value: 0x26, label: 'Short, variable, high foreground boost (0x26)' },
        { value: 0x28, label: 'Short, fixed (0x28)' },
        { value: 0x16, label: 'Long, variable, high foreground boost (0x16)' },
        { value: 0x18, label: 'Long, fixed (0x18)' },
      ],
    }),
    // Windows default 2. Bits: interval (long/short), fixed/variable quantum, foreground boost.
    { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\PriorityControl', name: 'Win32PrioritySeparation', enabled: 0x26, defaultValue: 2 },
  ),

  regTweak(
    meta({
      id: 'cloud-sync-off',
      name: 'Cloud Sync Off',
      category: 'system',
      description: 'Stops Windows syncing your settings (theme, passwords, language, other preferences) to your other devices.',
    }),
    // "Do not sync" policy: DisableSettingSync 2 = disabled; UserOverride 1 = users cannot turn it back on.
    // verify: that Windows 11 24H2+ (Settings > Accounts > Windows backup) still honours this policy.
    [
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\SettingSync`, name: 'DisableSettingSync', on: dword(2), off: null },
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\SettingSync`, name: 'DisableSettingSyncUserOverride', on: dword(1), off: null },
    ],
  ),

  regDwordTweak(
    meta({
      id: 'do-solo-mode',
      name: 'DO Solo Mode',
      category: 'performance',
      description:
        'Windows Update and Store downloads come straight from Microsoft. Your PC stops downloading from, and uploading to, other PCs.',
    }),
    // Delivery Optimization policy. 0 = HTTP only, no peering.
    { hive: 'HKLM', key: `${POLICIES}\\Windows\\DeliveryOptimization`, name: 'DODownloadMode', enabled: 0, defaultValue: null },
  ),

  regDwordTweak(
    meta({
      id: 'experimentation-lock',
      name: 'Experimentation Lock',
      category: 'system',
      description: 'Stops Microsoft silently trying out new features and setting changes on your PC.',
    }),
    // verify: spec marks this (verify). MDM policy store value; not present by default on build 26200.
    { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\System', name: 'AllowExperimentation', enabled: 0, defaultValue: null },
  ),

  tweak(
    meta({
      id: 'feedback-tasks-off',
      name: 'Feedback Tasks Off',
      category: 'system',
      description: 'Disables the scheduled tasks behind Windows "How likely are you to recommend…" feedback prompts.',
    }),
    [task('Feedback\\Siuf\\DmClient'), task('Feedback\\Siuf\\DmClientOnScenarioDownload')],
  ),

  tweak(
    meta({
      id: 'hibernation-wipe',
      name: 'Hibernation Wipe',
      hardware: { laptop: false },
      category: 'performance',
      description: 'Turns hibernation off, which deletes hiberfil.sys and frees disk space about the size of your RAM.',
      risk: 'balanced',
      warning: 'This also turns off Fast Startup, so cold boots can take a few seconds longer, and laptops lose the Hibernate option.',
    }),
    [{ ref: { kind: 'hibernate' }, on: false, off: true }],
  ),

  regDwordTweak(
    meta({
      id: 'media-player-tracking-off',
      name: 'Media Player Tracking Off',
      category: 'system',
      description: 'Stops Windows Media Player recording usage information about what you play.',
      requiresAdmin: false,
    }),
    // verify: spec marks this (verify). The value exists on build 26200.
    { hive: 'HKCU', key: 'Software\\Microsoft\\MediaPlayer\\Preferences', name: 'UsageTracking', enabled: 0, defaultValue: null },
  ),

  regTweak(
    meta({
      id: 'nudge-blocker',
      name: 'Nudge Blocker',
      category: 'system',
      description:
        'Stops tips, "finish setting up your device" screens, suggested content in Settings and Start, and lock screen promos.',
      requiresAdmin: false,
    }),
    [
      ...[
        'SubscribedContent-338388Enabled', // Start suggestions
        'SubscribedContent-338389Enabled', // tips and tricks
        'SubscribedContent-353694Enabled', // suggested content in Settings
        'SubscribedContent-353696Enabled', // suggested content in Settings
        'SubscribedContent-310093Enabled', // welcome experience after updates
        'SystemPaneSuggestionsEnabled',
        'SoftLandingEnabled',
        'RotatingLockScreenOverlayEnabled', // lock screen fun facts and tips
      ].map((name) => ({ hive: 'HKCU' as const, key: CDM, name, on: dword(0), off: dword(1) })),
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\UserProfileEngagement', name: 'ScoobeSystemSettingEnabled', on: dword(0), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'raw-aim-curve',
      name: 'Raw Aim Curve',
      category: 'performance',
      description:
        'Turns off "Enhance pointer precision" (mouse acceleration), so the pointer moves exactly as far as your mouse does. Takes effect after you sign out.',
      requiresAdmin: false,
      requiresReboot: true,
    }),
    // With acceleration off Windows ignores SmoothMouseXCurve/YCurve, so the curves are left alone.
    [
      { hive: 'HKCU', key: 'Control Panel\\Mouse', name: 'MouseSpeed', on: sz('0'), off: sz('1') },
      { hive: 'HKCU', key: 'Control Panel\\Mouse', name: 'MouseThreshold1', on: sz('0'), off: sz('6') },
      { hive: 'HKCU', key: 'Control Panel\\Mouse', name: 'MouseThreshold2', on: sz('0'), off: sz('10') },
    ],
  ),

  regTweak(
    meta({
      id: 'rt-scan-trim',
      name: 'RT Scan Trim',
      category: 'security',
      description: 'Microsoft Defender stops sending file samples to Microsoft, and the Malicious Software Removal Tool stops reporting infections.',
      risk: 'risky',
      warning:
        'Lowers protection: Microsoft can no longer analyse new threats found on your PC. Tamper Protection may block or undo this. Re-Enable Defender on the Fixes page reverses it.',
    }),
    [
      { hive: 'HKLM', key: `${POLICIES}\\Windows Defender\\Spynet`, name: 'SubmitSamplesConsent', on: dword(2), off: null }, // 2 = never send
      { hive: 'HKLM', key: `${POLICIES}\\MRT`, name: 'DontReportInfectionInformation', on: dword(1), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'search-box-local',
      name: 'Search Box Local',
      category: 'system',
      description:
        'Start menu search shows only results from your PC, with no Bing web results. Also hides recent searches in the File Explorer search box. Takes effect after you sign out.',
      // HKCU\Software\Policies is read-only for standard users, so writing it needs elevation.
      requiresReboot: true,
    }),
    [
      { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Windows\\Explorer', name: 'DisableSearchBoxSuggestions', on: dword(1), off: null },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', name: 'BingSearchEnabled', on: dword(0), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'search-cloud-off',
      name: 'Search Cloud Off',
      category: 'system',
      description: 'Windows Search stops searching your Microsoft account and work or school account content in the cloud.',
      requiresAdmin: false,
    }),
    [
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', name: 'IsAADCloudSearchEnabled', on: dword(0), off: dword(1) },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', name: 'IsMSACloudSearchEnabled', on: dword(0), off: dword(1) },
    ],
  ),

  regTweak(
    meta({
      id: 'security-quiet',
      name: 'Security Quiet',
      category: 'security',
      description: 'Hides Windows Security notifications, including Defender and firewall toasts.',
      risk: 'risky',
      warning: 'This hides real alerts too: you will not be told when a threat is found or protection is off. Re-Enable Defender on the Fixes page reverses it.',
    }),
    [
      { hive: 'HKLM', key: `${POLICIES}\\Windows Defender Security Center\\Notifications`, name: 'DisableNotifications', on: dword(1), off: null },
      { hive: 'HKLM', key: `${POLICIES}\\Windows Defender Security Center\\Notifications`, name: 'DisableEnhancedNotifications', on: dword(1), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'silent-app-installs-off',
      name: 'Silent App Installs Off',
      category: 'system',
      description: 'Stops Windows quietly installing suggested apps and preinstalled or OEM promo apps for your account.',
      requiresAdmin: false,
    }),
    ['SilentInstalledAppsEnabled', 'PreInstalledAppsEnabled', 'OEMPreInstalledAppsEnabled'].map((name) => ({
      hive: 'HKCU' as const,
      key: CDM,
      name,
      on: dword(0),
      off: dword(1),
    })),
  ),

  tweak(
    meta({
      id: 'sqm-tasks-off',
      name: 'SQM Tasks Off',
      category: 'system',
      description: 'Disables the Customer Experience Improvement Program tasks that collect and upload usage data.',
    }),
    [task('Customer Experience Improvement Program\\Consolidator'), task('Customer Experience Improvement Program\\UsbCeip')],
  ),

  tweak(
    meta({
      id: 'stickykeys-guard',
      name: 'StickyKeys Guard',
      category: 'performance',
      description:
        'Stops the StickyKeys, ToggleKeys and FilterKeys pop-ups that appear when you press Shift five times or hold it mid-game. Takes effect after you sign out.',
      requiresAdmin: false,
      requiresReboot: true, // read at sign-in; sign-out is enough
    }),
    // Flags are REG_SZ bitmasks. Windows defaults 510/62/126. Only the hotkey bit (0x4) is ours: it counts
    // as applied when that bit is clear, and apply clears just that bit, keeping any other flags the user set.
    [
      { key: 'StickyKeys', on: '506', off: '510' },
      { key: 'ToggleKeys', on: '58', off: '62' },
      { key: 'Keyboard Response', on: '122', off: '126' },
    ].map(({ key, on, off }): Setting => {
      const flags = (v: Value | null) => ((v as RegValue | null)?.type === 'REG_SZ' ? Number((v as RegValue).data) : NaN);
      return {
        ref: { kind: 'reg', hive: 'HKCU', key: `${ACCESSIBILITY}\\${key}`, name: 'Flags' },
        on: sz(on),
        off: sz(off),
        matches: (v) => Number.isInteger(flags(v)) && (flags(v) & HOTKEY) === 0,
        toOn: (v) => (Number.isInteger(flags(v)) ? sz(String(flags(v) & ~HOTKEY)) : sz(on)),
      };
    }),
  ),

  regTweak(
    meta({
      id: 'telemetry-zero',
      name: 'Telemetry Zero',
      category: 'system',
      description: 'Sets diagnostic data to the lowest level your edition allows and stops feedback prompts.',
      warning: 'Windows Home and Pro treat 0 ("Security") as 1 ("Required"); only Enterprise and Education go lower.',
    }),
    [
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\DataCollection`, name: 'AllowTelemetry', on: dword(0), off: null },
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\DataCollection`, name: 'DoNotShowFeedbackNotifications', on: dword(1), off: null },
    ],
  ),

  tweak(
    meta({
      id: 'trim-force-on',
      name: 'TRIM Force-On',
      hardware: { ssd: true },
      category: 'performance',
      description: 'Makes sure Windows sends TRIM to SSDs, which keeps their write speed up over time. On by default on most PCs.',
    }),
    // Read from FileSystem\DisableDeleteNotification (what fsutil's NTFS setting stores), written with fsutil.
    [{ ref: { kind: 'trim' }, on: 0, off: null }],
  ),

  tweak(
    meta({
      id: 'troubleshooter-scans-off',
      name: 'Troubleshooter Scans Off',
      category: 'system',
      description: 'Stops Windows running recommended troubleshooters and scheduled diagnosis scans in the background.',
    }),
    [
      task('Diagnosis\\Scheduled'),
      task('Diagnosis\\RecommendedTroubleshootingScanner'),
      // verify: 1 = "Don't run any" recommended troubleshooters. Absent by default on build 26200.
      { ref: { kind: 'reg', hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\WindowsMitigation', name: 'UserPreference' }, on: dword(1), off: null },
    ],
  ),

  tweak(
    meta({
      id: 'usage-insights-off',
      name: 'Usage Insights Off',
      category: 'system',
      description: 'Disables the background tasks that report feature usage data to Microsoft.',
    }),
    // verify: the spec's "Usage and Quality Insights" task has no exact match on build 26200; these are the closest.
    [task('Flighting\\FeatureConfig\\UsageDataReporting'), task('Flighting\\FeatureConfig\\UsageDataFlushing')],
  ),

  tweak(
    meta({
      id: 'usb-power-guard',
      name: 'USB Power Guard',
      category: 'performance',
      description: 'Stops Windows suspending idle USB ports, a common cause of mouse stutter and audio dropouts. Applies to your current power plan.',
    }),
    // ponytail: "current" plan is resolved when read/written; if the user switches plan between apply and
    // revert, revert writes the new plan. Device-level power flags (spec) are not touched yet.
    [power('current', USB_SUB, USB_SELECTIVE_SUSPEND, true, 0, 1), power('current', USB_SUB, USB_SELECTIVE_SUSPEND, false, 0, 1)],
  ),

  regTweak(
    meta({
      id: 'voice-activation-off',
      name: 'Voice Activation Off',
      category: 'system',
      description: 'Stops apps (such as voice assistants) listening for a wake word, including on the lock screen.',
    }),
    // AppPrivacy policy: 2 = force deny.
    [
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\AppPrivacy`, name: 'LetAppsActivateWithVoice', on: dword(2), off: null },
      { hive: 'HKLM', key: `${POLICIES}\\Windows\\AppPrivacy`, name: 'LetAppsActivateWithVoiceAboveLock', on: dword(2), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'windows-update-improvements',
      name: 'Windows Update Improvements',
      category: 'system',
      description:
        'Delays feature updates by 90 days, sets active hours to 10:00–02:00 so updates do not restart your PC then, and never restarts automatically while you are signed in. Security updates are not delayed.',
      risk: 'balanced',
      warning: 'Windows Home ignores the feature update delay. Updates still install; this only controls when.',
    }),
    [
      { hive: 'HKLM', key: WU, name: 'DeferFeatureUpdates', on: dword(1), off: null },
      { hive: 'HKLM', key: WU, name: 'DeferFeatureUpdatesPeriodInDays', on: dword(90), off: null },
      { hive: 'HKLM', key: WU, name: 'SetActiveHours', on: dword(1), off: null },
      { hive: 'HKLM', key: WU, name: 'ActiveHoursStart', on: dword(10), off: null },
      { hive: 'HKLM', key: WU, name: 'ActiveHoursEnd', on: dword(2), off: null },
      { hive: 'HKLM', key: `${WU}\\AU`, name: 'NoAutoRebootWithLoggedOnUsers', on: dword(1), off: null },
    ],
  ),

  tweak(
    meta({
      id: 'winsat-benchmark-off',
      name: 'WinSAT Benchmark Off',
      category: 'performance',
      description: 'Stops the Windows System Assessment Tool benchmarking your PC in the background during maintenance.',
    }),
    [task('Maintenance\\WinSAT')],
  ),

  // ---- Krypt Tweaker carry-overs (spec: "Also carry over from Krypt Tweaker").
  // Network throttling and TCP ack/NoDelay already live on the Networking page.

  regTweak(
    meta({
      id: 'game-mode-on',
      name: 'Game Mode On',
      category: 'performance',
      description: 'Lets Windows prioritize the game you are playing and hold back Windows Update installs and notifications during play.',
      requiresAdmin: false,
    }),
    [
      { hive: 'HKCU', key: 'Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', on: dword(1), off: null },
      { hive: 'HKCU', key: 'Software\\Microsoft\\GameBar', name: 'AllowAutoGameMode', on: dword(1), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'game-dvr-off',
      name: 'Game DVR and Game Bar Off',
      category: 'performance',
      description: 'Stops background game recording and the Xbox button opening Game Bar.',
      requiresAdmin: false,
      warning: 'Win+Alt+R recording and background clip capture stop working.',
    }),
    [
      { hive: 'HKCU', key: 'System\\GameConfigStore', name: 'GameDVR_Enabled', on: dword(0), off: dword(1) },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', on: dword(0), off: null },
      { hive: 'HKCU', key: 'Software\\Microsoft\\GameBar', name: 'UseNexusForGameBarEnabled', on: dword(0), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'fullscreen-optimizations-off',
      name: 'Fullscreen Optimizations Off',
      category: 'graphics',
      description: 'Makes exclusive-fullscreen games run in true exclusive fullscreen instead of the optimized borderless mode.',
      requiresAdmin: false,
      risk: 'balanced',
      warning: 'Some games Alt+Tab slower, and Auto HDR and overlays may stop working in them.',
    }),
    // verify: GameDVR_FSEBehavior is absent on build 26200 until set; the other three read 0 there.
    [
      { hive: 'HKCU', key: 'System\\GameConfigStore', name: 'GameDVR_FSEBehaviorMode', on: dword(2), off: dword(0) },
      { hive: 'HKCU', key: 'System\\GameConfigStore', name: 'GameDVR_HonorUserFSEBehaviorMode', on: dword(1), off: dword(0) },
      { hive: 'HKCU', key: 'System\\GameConfigStore', name: 'GameDVR_FSEBehavior', on: dword(2), off: null },
      { hive: 'HKCU', key: 'System\\GameConfigStore', name: 'GameDVR_DXGIHonorFSEWindowsCompatible', on: dword(1), off: dword(0) },
    ],
  ),

  regDwordTweak(
    meta({
      id: 'hags-on',
      name: 'Hardware-Accelerated GPU Scheduling',
      category: 'graphics',
      description: 'Lets the graphics card schedule its own memory. Can lower latency on recent GPUs and drivers.',
      risk: 'balanced',
      requiresReboot: true,
      warning: 'Needs a supported GPU and driver; on some PCs it causes stutter. Turn it off again if games get worse.',
    }),
    { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode', enabled: 2, defaultValue: null },
  ),

  regTweak(
    meta({
      id: 'mmcss-games',
      name: 'Games Task Priority',
      category: 'performance',
      description: 'Raises the priority the Multimedia Class Scheduler gives games: CPU priority 6, High scheduling and High I/O.',
      risk: 'balanced',
    }),
    [
      { hive: 'HKLM', key: `${MMCSS}\\Tasks\\Games`, name: 'Priority', on: dword(6), off: dword(2) },
      { hive: 'HKLM', key: `${MMCSS}\\Tasks\\Games`, name: 'Scheduling Category', on: sz('High'), off: sz('Medium') },
      { hive: 'HKLM', key: `${MMCSS}\\Tasks\\Games`, name: 'SFIO Priority', on: sz('High'), off: sz('Normal') },
    ],
  ),

  regDwordTweak(
    meta({ id: 'system-responsiveness', name: 'System Responsiveness', category: 'performance', description: 'Reserves 10% of CPU time for background work during games and audio, instead of 20%.' }),
    { hive: 'HKLM', key: MMCSS, name: 'SystemResponsiveness', enabled: 10, defaultValue: 20 },
  ),

  regDwordTweak(
    meta({ id: 'transparency-off', name: 'Transparency Off', category: 'graphics', description: 'Turns off see-through effects on the taskbar, Start and windows.', requiresAdmin: false }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', enabled: 0, defaultValue: 1 },
  ),

  regTweak(
    meta({
      id: 'animations-off',
      name: 'Window & Taskbar Animations Off',
      category: 'graphics',
      description: 'Turns off only the minimize/maximize and taskbar animations. "Visual Effects for Performance" turns off the rest (fades, menu and app animations).',
      requiresAdmin: false,
      requiresReboot: true,
    }),
    [
      { hive: 'HKCU', key: 'Control Panel\\Desktop\\WindowMetrics', name: 'MinAnimate', on: sz('0'), off: sz('1') },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'TaskbarAnimations', on: dword(0), off: dword(1) },
    ],
  ),

  regTweak(
    meta({
      id: 'visual-effects-performance',
      name: 'Visual Effects for Performance',
      category: 'graphics',
      description: 'Sets "Adjust for best performance" in Performance Options: no fades, shadows or smooth scrolling.',
      requiresAdmin: false,
      requiresReboot: true,
      warning: 'Windows looks plainer: no window shadows, fades or animated thumbnails.',
    }),
    [
      // verify: 9012038010000000 is the commonly used "best performance" mask; 9E1E078012000000 is the default read on build 26200.
      { hive: 'HKCU', key: 'Control Panel\\Desktop', name: 'UserPreferencesMask', on: binary('9012038010000000'), off: binary('9E1E078012000000') },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', name: 'VisualFXSetting', on: dword(2), off: null },
    ],
  ),

  regTweak(
    meta({ id: 'activity-history-off', name: 'Activity History Off', category: 'security', description: 'Stops Windows recording the apps, files and sites you use and sending that history to Microsoft.' }),
    ['EnableActivityFeed', 'PublishUserActivities', 'UploadUserActivities'].map((name) => ({ hive: 'HKLM' as const, key: `${POLICIES}\\Windows\\System`, name, on: dword(0), off: null })),
  ),

  regDwordTweak(
    meta({ id: 'advertising-id-off', name: 'Advertising ID Off', category: 'security', description: 'Stops apps using your advertising ID for personalized ads.', requiresAdmin: false }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled', enabled: 0, defaultValue: 1 },
  ),

  regTweak(
    meta({
      id: 'copilot-off',
      name: 'Copilot Off',
      category: 'system',
      description: 'Turns off the built-in Windows Copilot and hides its taskbar button.',
      requiresAdmin: false,
      warning: 'On Windows 11 24H2 and later Copilot is a separate app this policy does not cover; remove it in the Debloater.',
    }),
    [
      { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Windows\\WindowsCopilot', name: 'TurnOffWindowsCopilot', on: dword(1), off: null },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'ShowCopilotButton', on: dword(0), off: null },
    ],
  ),

  regTweak(
    meta({ id: 'edge-sidebar-shopping-off', name: 'Edge Sidebar and Shopping Off', category: 'system', description: 'Turns off the Edge sidebar and its shopping assistant pop-ups (browser policies).' }),
    [
      { hive: 'HKLM', key: `${POLICIES}\\Edge`, name: 'HubsSidebarEnabled', on: dword(0), off: null },
      { hive: 'HKLM', key: `${POLICIES}\\Edge`, name: 'EdgeShoppingAssistantEnabled', on: dword(0), off: null },
    ],
  ),

  regTweak(
    meta({
      id: 'office-telemetry-off',
      name: 'Office Telemetry Off',
      category: 'security',
      description: 'Stops Microsoft Office sending diagnostic data (policy level "Neither") and turns off its telemetry agent.',
      requiresAdmin: false,
    }),
    [
      { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Office\\Common\\ClientTelemetry', name: 'SendTelemetry', on: dword(3), off: null },
      { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Office\\16.0\\Common\\ClientTelemetry', name: 'DisableTelemetry', on: dword(1), off: null },
    ],
  ),

  // ---- Windows 11 interface (spec, Additions).

  tweak(
    meta({
      id: 'classic-context-menu',
      name: 'Classic Right-Click Menu',
      category: 'system',
      description: 'Brings back the full right-click menu in File Explorer, without "Show more options".',
      requiresAdmin: false,
      requiresReboot: true,
      builds: { min: 22000 },
    }),
    // The well-known per-user override: an empty InprocServer32 key under this CLSID. Revert deletes the key.
    [{ ref: { kind: 'regKey', hive: 'HKCU', key: 'Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32' }, on: true, off: null }],
  ),

  regDwordTweak(
    meta({ id: 'taskbar-left', name: 'Taskbar Icons on the Left', category: 'system', description: 'Moves the Start button and taskbar icons to the left, as on Windows 10.', requiresAdmin: false, builds: { min: 22000 } }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'TaskbarAl', enabled: 0, defaultValue: 1 },
  ),

  regDwordTweak(
    meta({
      id: 'widgets-off',
      name: 'Widgets Off',
      category: 'system',
      description: 'Turns off the Widgets board and its news feed (policy).',
      builds: { min: 22000 },
      // Newer Windows 11 builds protect this setting (User Choice Protection driver); IcyTweaker doesn't work around it.
      deniedHint:
        'Windows protects this setting from other programs on your version, so IcyTweaker can\'t change it. Turn Widgets off yourself: Settings > Personalization > Taskbar > Widgets. To remove Widgets entirely, uninstall "Windows Web Experience Pack" on the Debloating page.',
    }),
    { hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Dsh', name: 'AllowNewsAndInterests', enabled: 0, defaultValue: null },
  ),

  regTweak(
    meta({ id: 'recall-off', name: 'Recall Off', category: 'security', description: 'Stops Windows Recall saving snapshots of your screen (Copilot+ PCs), and blocks turning it on.', builds: { min: 26100 } }),
    [
      { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Windows\\WindowsAI', name: 'DisableAIDataAnalysis', on: dword(1), off: null },
      // verify: AllowRecallEnablement (24H2 policy "Allow Recall to be enabled"), 0 = blocked.
      { hive: 'HKLM', key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', name: 'AllowRecallEnablement', on: dword(0), off: null },
    ],
  ),

  regDwordTweak(
    meta({ id: 'snap-layouts-off', name: 'Snap Layouts Pop-up Off', category: 'system', description: 'Stops the snap layout grid appearing when you hover the maximize button. Win+Z and dragging still snap.', requiresAdmin: false, builds: { min: 22000 } }),
    // verify: EnableSnapAssistFlyout is the Settings > Multitasking switch for this pop-up.
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'EnableSnapAssistFlyout', enabled: 0, defaultValue: null },
  ),

  regDwordTweak(
    meta({
      id: 'frequent-restore-points',
      name: 'Allow Frequent Restore Points',
      category: 'system',
      description: 'Windows normally makes at most one restore point per 24 hours, so IcyTweaker\'s automatic ones can be skipped. This lets every major change get its own.',
    }),
    { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore', name: 'SystemRestorePointCreationFrequency', enabled: 0, defaultValue: null },
  ),

  // ---- Devices page: input.
  // Mouse acceleration: see Raw Aim Curve above (the Devices page shows it too).
  regTweak(
    meta({
      id: 'keyboard-repeat-fast',
      name: 'Fast Key Repeat',
      category: 'performance',
      description: 'Shortest delay before a held key starts repeating. (The repeat rate is already at its fastest by default.)',
      requiresAdmin: false,
      requiresReboot: true,
      page: 'devices',
    }),
    [
      { hive: 'HKCU', key: 'Control Panel\\Keyboard', name: 'KeyboardDelay', on: sz('0'), off: sz('1') },
    ],
  ),

  // ---- From the Phase 3 open questions.

  regDwordTweak(
    meta({
      id: 'block-unsigned-drivers',
      name: 'Block Unsigned Drivers',
      category: 'security',
      description: 'Windows refuses to install driver packages that are not signed. The closest real switch to "WHQL only": signed, not necessarily WHQL-certified.',
      risk: 'balanced',
      requiresAdmin: false,
      warning: 'Some older or niche hardware (and modded controller drivers) ship unsigned and will not install while this is on.',
    }),
    // verify: "Code signing for device drivers" policy, 0 ignore / 1 warn / 2 block. 64-bit Windows already enforces kernel signing.
    { hive: 'HKCU', key: 'Software\\Policies\\Microsoft\\Windows NT\\Driver Signing', name: 'BehaviorOnFailedVerify', enabled: 2, defaultValue: null },
  ),

  regTweak(
    meta({ id: 'proximity-deny', name: 'Proximity Deny', category: 'security', description: 'Stops apps talking to nearby unpaired devices (Settings > Privacy > Other devices).', requiresAdmin: false }),
    // verify: there is no "proximity" entry in ConsentStore on build 26200; bluetoothSync is "communicate with unpaired devices".
    [{ hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\bluetoothSync', name: 'Value', on: sz('Deny'), off: sz('Allow') }],
  ),

  // ---- Services page: the separate Disable Defender switch (spec "Risks and legal": guardrails required).
  regTweak(
    meta({
      id: 'disable-defender',
      name: 'Disable Defender Real-Time Protection',
      category: 'security',
      description: 'Turns off Microsoft Defender real-time, behavior and download scanning by policy.',
      risk: 'risky',
      requiresReboot: true,
      page: 'services',
      group: 'Microsoft Defender',
      warning:
        'Your PC is unprotected against malware while this is on. Windows ignores it while Tamper Protection is on (Windows Security > Virus & threat protection settings). Re-Enable Defender on the Fixes page turns it back on.',
    }),
    ['DisableRealtimeMonitoring', 'DisableBehaviorMonitoring', 'DisableOnAccessProtection', 'DisableScanOnRealtimeEnable', 'DisableIOAVProtection'].map((name) => ({
      hive: 'HKLM' as const,
      key: `${POLICIES}\\Windows Defender\\Real-Time Protection`,
      name,
      on: dword(1),
      off: null,
    })),
  ),

  // ---- Added 2026-11-12 (values read on the dev PC, build 26200; absent ones noted)
  tweak(
    meta({
      id: 'windowed-game-optimizations',
      name: 'Optimizations for Windowed Games',
      category: 'graphics',
      description: 'Settings > Display > Graphics: borderless and windowed games present like fullscreen ones (lower latency, Auto HDR and VRR work).',
      requiresAdmin: false,
      builds: { min: 22000 },
    }),
    [dxFlag('SwapEffectUpgradeEnable')],
  ),
  tweak(
    meta({
      id: 'auto-hdr-on',
      name: 'Auto HDR',
      category: 'graphics',
      description: 'Settings > Display > Graphics: adds HDR to DirectX 11/12 games that only have SDR. Needs an HDR display with HDR turned on.',
      risk: 'balanced', // changes how games look: not in Safe Optimize
      requiresAdmin: false,
      builds: { min: 22000 },
    }),
    [dxFlag('AutoHDREnable')],
  ),
  regDwordTweak(
    meta({ id: 'power-throttling-off', name: 'Power Throttling Off', category: 'performance', description: 'Stops Windows slowing down programs it thinks run in the background (game launchers, Discord, OBS).', requiresReboot: true }),
    // Absent on the dev PC (Windows default: throttling on).
    { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', name: 'PowerThrottlingOff', enabled: 1, defaultValue: null },
  ),
  regDwordTweak(
    meta({
      id: 'fast-startup-off',
      name: 'Fast Startup Off',
      category: 'system',
      description: 'Shut down really shuts down: no half-hibernated kernel, so drivers and network start fresh. Startup from off takes a few seconds longer.',
    }),
    { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', name: 'HiberbootEnabled', enabled: 0, defaultValue: 1 },
  ),
  regDwordTweak(
    meta({ id: 'startup-delay-off', name: 'No Startup Delay', category: 'system', description: 'Starts your startup apps right after sign-in instead of waiting about 10 seconds.', requiresAdmin: false }),
    // The Serialize key is absent by default (the delay applies).
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', name: 'StartupDelayInMSec', enabled: 0, defaultValue: null },
  ),
  regDwordTweak(
    meta({
      id: 'background-apps-off',
      name: 'Background Apps Off',
      category: 'performance',
      description: 'Store apps stop running in the background (Settings > Apps). Their notifications and live updates arrive only while they are open.',
      risk: 'balanced', // can delay notifications from Store apps (Phone Link, Teams): not in Safe Optimize
      requiresAdmin: false,
    }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', name: 'GlobalUserDisabled', enabled: 1, defaultValue: 0 },
  ),
  regTweak(
    meta({ id: 'menu-delay-off', name: 'Instant Menus', category: 'system', description: 'Menus open right away instead of after a 400 ms hover delay. Takes effect after signing out.', requiresAdmin: false, requiresReboot: true }),
    [{ hive: 'HKCU', key: 'Control Panel\\Desktop', name: 'MenuShowDelay', on: sz('0'), off: sz('400') }],
  ),
  regDwordTweak(
    meta({
      id: 'fault-tolerant-heap-off',
      name: 'Fault Tolerant Heap Off',
      category: 'performance',
      description: 'Stops Windows quietly applying slower memory "fixes" to a program after it crashes a few times (it can stay on a game for good).',
      requiresReboot: true,
    }),
    { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\FTH', name: 'Enabled', enabled: 0, defaultValue: 1 },
  ),
  // ---- Explorer and quality-of-life (values read on the dev PC, build 26200, 2026-11-12)
  regDwordTweak(
    meta({ id: 'show-file-extensions', name: 'Show File Extensions', category: 'system', description: 'File Explorer shows ".exe", ".zip" and so on, so a "photo.jpg.exe" can\'t pass as a picture.', requiresAdmin: false }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'HideFileExt', enabled: 0, defaultValue: 1 },
  ),
  regDwordTweak(
    meta({ id: 'show-hidden-files', name: 'Show Hidden Files', category: 'system', description: 'File Explorer shows hidden files and folders (like AppData). Windows system files stay hidden.', requiresAdmin: false }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', name: 'Hidden', enabled: 1, defaultValue: 2 },
  ),
  regDwordTweak(
    meta({
      id: 'taskbar-end-task',
      name: 'End Task on the Taskbar',
      category: 'system',
      description: 'Right-click a taskbar app to force-close it, without opening Task Manager (Windows 11 23H2 and later).',
      requiresAdmin: false,
      builds: { min: 22631 },
    }),
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\\TaskbarDeveloperSettings', name: 'TaskbarEndTask', enabled: 1, defaultValue: null },
  ),
  regDwordTweak(
    meta({ id: 'classic-alt-tab', name: 'Classic Alt+Tab', category: 'system', description: 'The old, instant Alt+Tab grid of icons instead of large window previews. Takes effect after signing out.', requiresAdmin: false, requiresReboot: true }),
    // Absent on the dev PC (Windows default: previews).
    { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer', name: 'AltTabSettings', enabled: 1, defaultValue: null },
  ),
  regTweak(
    meta({ id: 'dark-mode', name: 'Dark Mode', category: 'system', description: 'Dark Windows and apps (Settings > Personalization > Colors).', requiresAdmin: false }),
    [
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'AppsUseLightTheme', on: dword(0), off: dword(1) },
      { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'SystemUsesLightTheme', on: dword(0), off: dword(1) },
    ],
  ),
  regDwordTweak(
    meta({ id: 'error-reporting-off', name: 'Windows Error Reporting Off', category: 'security', description: 'No crash reports collected or sent to Microsoft in the background.' }),
    // Policy value; absent on the dev PC.
    { hive: 'HKLM', key: `${POLICIES}\\Windows\\Windows Error Reporting`, name: 'Disabled', enabled: 1, defaultValue: null },
  ),
];

/**
 * One "name=1;" part of DirectXUserGlobalSettings (Settings > Display > Graphics). Several tweaks share this value, so
 * revert removes only this part (toOff) rather than restoring the whole backed-up value.
 */
function dxFlag(name: string): Setting {
  const ref: SettingRef = { kind: 'reg', hive: 'HKCU', key: 'Software\\Microsoft\\DirectX\\UserGpuPreferences', name: 'DirectXUserGlobalSettings' };
  const text = (v: Value | null) => ((v as RegValue | null)?.type === 'REG_SZ' ? (v as { data: string }).data : '');
  const parts = (v: Value | null) => text(v).split(';').map((p) => p.trim()).filter(Boolean);
  const others = (v: Value | null) => parts(v).filter((p) => p.split('=')[0] !== name);
  return {
    ref,
    on: sz(`${name}=1;`),
    off: sz(''),
    matches: (cur) => parts(cur).includes(`${name}=1`),
    toOn: (cur) => sz(`${[...others(cur), `${name}=1`].join(';')};`),
    toOff: (cur) => (others(cur).length ? sz(`${others(cur).join(';')};`) : null),
  };
}

export const settingRefs = (t: Tweak): SettingRef[] => t.settings.map((s) => s.ref);
