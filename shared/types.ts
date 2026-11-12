// Types shared by the main process, the preload bridge and the renderer. Type-only: no runtime code.

export type Risk = 'safe' | 'balanced' | 'risky';
export type Category = 'performance' | 'system' | 'graphics' | 'security';
/** 'unavailable' = what the tweak changes doesn't exist on this PC (e.g. a missing scheduled task). */
export type TweakStatus = 'applied' | 'not_applied' | 'partial' | 'unknown' | 'unavailable';

export interface TweakMeta {
  id: string;
  name: string;
  category: Category;
  description: string;
  risk: Risk;
  requiresAdmin: boolean;
  /** Needs a restart (or sign-out) before Windows picks the change up. */
  requiresReboot: boolean;
  /** Supported Windows builds, inclusive. Windows 10 2004 = 19041, Windows 11 21H2 = 22000. */
  builds: { min: number; max?: number };
  /** Side effect the user should read before applying. Shown as a warning chip. */
  warning?: string;
  /** Adjustable tweaks: the values the user can pick from. The first is the default when toggled on. */
  options?: Array<{ value: number; label: string }>;
  /** Which page lists it. Default 'general'. */
  page?: 'general' | 'network' | 'services' | 'apps' | 'advanced' | 'devices';
  /** Services page: the group card it belongs to. */
  group?: string;
  /** Process names (lower case) that must not be running while it changes, e.g. an app that rewrites its settings on exit. */
  needsClosed?: string[];
  /** Shown instead of "Access is denied" when Windows protects the setting from other programs. */
  deniedHint?: string;
  /** Hardware it is meant for: laptop false = desktops only; ssd true = SSDs only. */
  hardware?: { laptop?: boolean; ssd?: boolean };
  /** Anti-cheats that may object, and how. */
  anticheat?: { names: string[]; note: string };
}

export interface TweakView extends TweakMeta {
  status: TweakStatus;
  supported: boolean;
  /** For adjustable tweaks: the current value, or null if absent. */
  currentOption?: number | null;
  /** Why it doesn't fit this PC (laptop, HDD), or undefined. Bulk applies skip it. */
  unfit?: string;
  /** Warning when an anti-cheat it may upset is installed here. */
  anticheatWarning?: string;
  /** When the app first changed it (it has a backup). */
  changedAt?: string;
  tags?: TweakTag[];
}

/** power: uses more power / runs warmer; beta: its exact setting is still marked "verify"; preference: taste, not speed (never in presets). */
export type TweakTag = 'power' | 'beta' | 'preference';

export interface FixMeta {
  id: string;
  name: string;
  description: string;
  risk: Risk;
  requiresAdmin: boolean;
  requiresReboot: boolean;
  /** Part of what it does can't be undone from the app's backup (only from a restore point). */
  permanent: boolean;
  warning?: string;
  /** Which page lists it. Default 'fixes'. */
  page?: 'fixes' | 'network';
}

export interface PresetMeta {
  id: string;
  name: string;
  description: string;
  /** 'apply' applies the listed tweaks; 'revert' reverts them. '*' = every tweak. */
  action: 'apply' | 'revert';
  tweakIds: string[];
  /**
   * Rough expected change, e.g. "+3–10% FPS". Not measured on the user's PC: a conservative range for these kinds of
   * changes, shown as an estimate. Frametime capture measures the real before/after.
   */
  estimate?: string;
  estimateNote?: string;
}

export interface Stats {
  /** Percent, 0-100. */
  cpu: number;
  ramUsed: number;
  ramTotal: number;
  /** GPU 3D engine percent, or null when the performance counter is unavailable. */
  gpu: number | null;
}

export interface AppItem {
  /** Opaque id; main looks the uninstall command up from its own list. */
  key: string;
  kind: 'desktop' | 'store';
  name: string;
  version: string | null;
  publisher: string | null;
  sizeBytes: number | null;
  installDate: string | null;
  /** Reason it can't be removed, or null. */
  protected: string | null;
  /** Plain-language note for vendor utilities and trialware. */
  vendorNote: string | null;
  /** On the curated safe-to-remove list. */
  suggested: boolean;
  /** Desktop app without a silent uninstaller: its own uninstall window will open. */
  interactive: boolean;
  /** Last time one of its programs ran (Prefetch / UserAssist), or null if unknown. */
  lastUsed: string | null;
  /** Suggested for removal: not opened in 6+ months. */
  unused: boolean;
}

export interface RestorePointView {
  sequence: number;
  description: string;
  created: string;
}

export interface LogEntry {
  ts: string;
  mode: 'live' | 'dry-run';
  action: string;
  target: string;
  ok: boolean;
  message?: string;
}

export interface BackupView {
  target: string;
  original: string;
  savedAt: string;
}

export type ServiceLevel = 'off' | 'minimum' | 'medium' | 'extreme';
export type ServiceStartType = 'boot' | 'system' | 'auto' | 'delayed-auto' | 'demand' | 'disabled';

export interface ServiceInfo {
  name: string;
  displayName: string;
  description: string;
  /** Running, Stopped, ... */
  state: string;
  startType: ServiceStartType;
  /** Services that need this one. */
  dependents: string[];
  /** Why it can't be disabled or stopped here, or null. */
  protected: string | null;
  /** Per-user instance (read-only here). */
  perUser: boolean;
}

export interface LevelPreview {
  level: ServiceLevel;
  xboxInUse: boolean;
  /** Services this level turns off (not already off). */
  disable: Array<{ name: string; displayName: string; breaks: string; running: boolean }>;
  /** Services above this level the app changed earlier and puts back. */
  restore: string[];
  /** Other services that need one being disabled and would stop working. */
  dependents: Array<{ service: string; dependent: string }>;
}

export interface DnsPreset {
  id: string;
  name: string;
  /** 'a,b' or 'dhcp'. */
  servers: string;
}

export interface NetAdapterView {
  guid: string;
  name: string;
  description: string;
  media: string;
  speed: string;
  /** Current IPv4 DNS: 'a,b', 'dhcp', or null if unknown. */
  dns: string | null;
  /** Matching preset id, or null for custom. */
  preset: string | null;
}

export interface HostsError {
  line: number;
  message: string;
}

export interface SystemCheckStep {
  id: 'chkdsk' | 'sfc' | 'dism';
  name: string;
  ok: boolean;
  summary: string;
}

export interface ShortcutView {
  id: string;
  name: string;
  description: string;
  requiresAdmin: boolean;
  restarts: boolean;
}

export interface HardwareInfo {
  maker: string;
  model: string;
  board: string;
  boardMaker: string;
  biosVersion: string | null;
  biosDate: string | null;
  cpu: string;
  cpuVendor: 'AMD' | 'Intel' | 'other';
  cores: number;
  threads: number;
  laptop: boolean;
  gpus: Array<{ name: string; driver: string; pnp: string; vendor: 'NVIDIA' | 'AMD' | 'Intel' | 'other'; driverDate?: string | null }>;
  nics: Array<{ name: string; pnp: string }>;
  memory: { totalBytes: number; modules: number; type: 'DDR4' | 'DDR5' | null; ratedMTs: number | null; runningMTs: number | null };
  virtualization: { firmware: boolean | null; hypervisor: boolean };
  secureBoot: boolean | null;
  /** null = not readable (needs administrator) or absent. */
  tpm: { enabled: boolean; version: string | null } | null;
  vbsRunning: boolean;
  hvciRunning: boolean;
  /** The Windows drive is an SSD (null = unknown, e.g. in a VM). */
  systemSsd: boolean | null;
  /** Dell / Lenovo / HP when the maker's WMI BIOS interface is present. */
  biosVendorTool: string | null;
}

export interface AuditItem {
  id: string;
  name: string;
  status: 'good' | 'check' | 'info';
  detail: string;
}

export interface BoostOptions {
  plan: boolean;
  /** A specific power plan GUID; null = best performance plan available. */
  planGuid: string | null;
  lowerApps: string[];
  pauseUpdates: boolean;
  pauseOneDrive: boolean;
  /** Free the standby memory list during play when free memory runs low (needs administrator). */
  purgeStandby: boolean;
  /** Primary display mode during play, put back after. null / absent = leave it. */
  display?: DisplayMode | null;
  /** Do Not Disturb during play (notification banners off, put back after). */
  quietNotifications?: boolean;
}
export interface DisplayMode {
  width: number;
  height: number;
  hz: number;
}

export interface BoostState {
  settings: BoostOptions & { enabled: boolean; perGame: Record<string, BoostOptions> };
  /** The running session, or null when no game is being boosted. */
  active: { game: string; since: string; plan: string | null; lowered: number } | null;
  apps: Array<{ exe: string; name: string }>;
  games: Array<{ id: string; name: string }>;
}

export type ProcessHint = 'system' | 'safe' | 'caution' | 'unknown';

export interface ProcessView {
  pid: number;
  name: string;
  /** Percent of the whole CPU. */
  cpu: number;
  /** Private working set, bytes. */
  memory: number;
  /** Disk + other I/O, bytes per second. */
  disk: number;
  hint: ProcessHint;
  note: string;
}

export interface LatencyCheck {
  /** Percent of CPU time; peak = worst one-second sample on one core. */
  dpc: { avg: number; peak: number; core: string };
  isr: { avg: number; peak: number; core: string };
  verdict: 'good' | 'check' | 'bad';
  advice: string;
}

export interface DriverBackupView {
  id: string;
  folder: string;
  /** Driver packages (.inf) in the backup. */
  packages: number;
  created: string;
}

/** Live numbers for the in-game overlay. null = unknown. */
/** An installed game found in a launcher library (Steam, Epic), with or without a profile. */
export interface LibraryGame {
  id: string;
  name: string;
  source: 'steam' | 'epic' | 'riot' | 'ubisoft' | 'gog' | 'xbox';
  /** Its main program (best guess for Steam: the largest .exe in its folder). */
  exe: string;
}

/** Per-game Windows settings, keyed by the game's exe. */
export interface GameWinSettings {
  /** Graphics preference: 0 = let Windows decide, 1 = power saving GPU, 2 = high performance GPU. */
  gpu: 0 | 1 | 2;
  /** Compatibility: disable fullscreen optimizations. */
  fso: boolean;
  /** Compatibility: high-DPI scaling done by the application. */
  dpi: boolean;
  /** Compatibility: run as administrator. */
  admin: boolean;
  /** CPU priority Windows starts it with. */
  priority: 'default' | 'above' | 'high';
}

/** A finished Game Boost session. FPS and temperatures only when the overlay ran during it. */
export interface SessionReport {
  game: string;
  startedAt: string;
  endedAt: string;
  minutes: number;
  fpsAvg: number | null;
  /** Typical (median) 1% low FPS. */
  low1: number | null;
  cpuAvg: number | null;
  cpuTempMax: number | null;
  gpuTempMax: number | null;
  gpuLoadAvg: number | null;
  /** Plain-language warnings, e.g. a temperature near the throttling limit. */
  hot: string[];
  /** FPS drops (overlay running): which background apps used the most CPU right after each one. */
  stutters?: Stutter[];
}
export interface Stutter {
  at: string;
  fps: number;
  /** Average FPS just before the drop. */
  before: number;
  top: Array<{ name: string; cpu: number }>;
}

export interface OverlayStats {
  game: string | null;
  fps: number | null;
  frametime: number | null;
  /** 1% low FPS over the last few seconds. */
  low1: number | null;
  gpuTemp: number | null;
  gpuLoad: number | null;
  cpu: number | null;
  cpuTemp: number | null;
  /** Internet round trip (TCP handshake to 1.1.1.1), ms. */
  ping?: number | null;
}

/** One driver from a latency trace. maxUs = its longest DPC/ISR (bucket upper bound, microseconds). */
export interface DriverLatency {
  module: string;
  kind: 'DPC' | 'ISR';
  count: number;
  maxUs: number;
}

export interface ToolStatus {
  /** Windows Performance Toolkit (xperf) installed: the latency check can name drivers. */
  wpt: boolean;
  /** CPU temperature: library downloaded and the PawnIO driver installed. */
  lhm: boolean;
  pawnio: boolean;
  admin: boolean;
}

export interface FroststrapInfo {
  installed: boolean;
  /** FPS cap FastFlag (DFIntTaskSchedulerTargetFps) in Froststrap's flags, or null when not set. */
  fpsCap: number | null;
  /** How many FastFlags Froststrap applies. */
  flags: number;
  /** IcyTweaker changed the FPS flag (Reset puts the original back). */
  changed: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  /** No release source set up in package.json (build.publish / updateRepo). */
  configured: boolean;
  /** The installed app can download and install it itself. */
  canInstall?: boolean;
  downloaded?: boolean;
  error?: string;
}

export interface DeviceInfo {
  detected: 'desktop' | 'laptop';
  /** What the app optimizes for (detected unless the user chose). */
  type: 'desktop' | 'laptop';
  onBattery: boolean;
  /** The laptop profile is switching plans with the power source. */
  laptopProfile: boolean;
}

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  hz: number;
  /** Highest refresh rate offered at the current resolution. */
  maxHz: number;
}

export interface BootInfo {
  lastBoot: string;
  lastBootMs: number | null;
  averageBootMs: number | null;
  /** Boot to desktop, and the part after it where startup apps load. */
  lastMainMs: number | null;
  lastPostMs: number | null;
  /** Apps Windows recorded as slowing startup, worst first. */
  slowApps: Array<{ name: string; degradationMs: number; file?: string }>;
  note?: string;
}

export interface DuplicateGroup {
  size: number;
  /** Bytes freed by keeping one copy. */
  wasted: number;
  files: Array<{ path: string; modified: string }>;
}

export interface OldFile {
  path: string;
  size: number;
  lastUsed: string;
}

export interface PrivacyTraceView {
  id: string;
  name: string;
  description: string;
  count: number;
}

export interface PrivacySnapshot {
  id: string;
  files: number;
}

export interface AppSettings {
  /** Closing the window keeps IcyTweaker in the system tray. */
  tray: boolean;
  /** Notifications (Game Boost, scheduled cleaning). */
  notify: boolean;
  /** Start in the tray when you sign in. */
  startWithWindows: boolean;
  /** Run Health Check weekly when the PC is idle (while IcyTweaker runs). */
  weeklyClean: boolean;
  lastCleanAt: string | null;
  /** Devices page: optimize as a desktop or laptop ('auto' = detected). */
  deviceType: 'auto' | 'desktop' | 'laptop';
  /** Laptop profile: Balanced plan on battery, back to your plan when plugged in; Game Boost leaves the plan alone on battery. */
  laptopProfile: boolean;
  /** Show the in-game overlay automatically while Game Boost runs a session. */
  overlayWithBoost: boolean;
  /** Global hotkeys: Ctrl+Shift+O overlay, Ctrl+Shift+B Game Boost. */
  hotkeys: boolean;
  /** Check, download and install updates (on quit) by itself. Installed app with a release repository only. */
  autoUpdate: boolean;
  theme: 'dark' | 'light';
  accent: Accent;
}

export type Accent = 'blue' | 'cyan' | 'violet' | 'emerald' | 'indigo';

export interface ConfigSummary {
  file: string;
  exportedAt: string;
  tweaks: Array<{ id: string; name: string; risk: Risk; option?: number }>;
  skipped: number;
  boost: boolean;
}

export interface DriverInfo {
  vendor: 'NVIDIA' | 'AMD' | 'Intel' | 'other' | null;
  gpu: string | null;
  /** NVIDIA style (621.14) for NVIDIA, the Windows driver version otherwise. */
  installed: string | null;
  latest: { version: string; url: string; name: string; released: string; size: string } | null;
  error?: string;
}

export interface DriverJobView {
  step: 'downloading' | 'cleaning' | 'installing' | 'done' | 'failed';
  gpu: string;
  version: string;
  installer: string;
  startedAt: string;
  message: string;
}

export interface FrametimeResult {
  process: string;
  seconds: number;
  frames: number;
  avgFps: number;
  /** 1% and 0.1% low FPS. */
  low1: number;
  low01: number;
  avgMs: number;
  maxMs: number;
  /** Frame times for the chart, at most 400 (worst per bucket). */
  points: number[];
}

export interface StartupItemView {
  /** Opaque id; main only changes items from its last listing. */
  id: string;
  name: string;
  command: string;
  location: string;
  enabled: boolean;
  requiresAdmin: boolean;
  /** registry: a Run value; folder: a Startup-folder shortcut; task: a scheduled task with a sign-in trigger. */
  kind: 'registry' | 'folder' | 'task';
}

export interface RuntimeView {
  /** winget package id. */
  id: string;
  name: string;
  group: string;
}

export interface RuntimeResult {
  id: string;
  ok: boolean;
  summary: string;
}

/** Milliseconds; null when every attempt failed. loss = percent. */
export interface LatencyResult {
  host: string;
  name: string;
  min: number | null;
  avg: number | null;
  jitter: number | null;
  loss: number;
}

export interface DnsBenchResult {
  /** DNS preset id. */
  id: string;
  name: string;
  ip: string;
  median: number | null;
  failed: number;
}

/** Game profile checkboxes. A game lists only the ones its config file has. */
export type GameFlag =
  | 'fullscreen'
  | 'vsyncOff'
  | 'dynResOff'
  | 'hdrOff'
  | 'showFps'
  | 'lowEffects'
  | 'lowMaterials'
  | 'lowTextures'
  | 'lowDetail'
  | 'shadowsOff'
  | 'lowAa'
  | 'aoOff'
  | 'bloomOff'
  | 'motionBlurOff'
  | 'noLetterbox'
  | 'borderless'
  | 'dofOff';

/** What a profile sets. Fields left out are not touched. aa / reflex = index into the game's choices. */
export interface GameValues {
  width?: number;
  height?: number;
  fps?: number;
  aa?: number;
  reflex?: number;
  flags: GameFlag[];
}

/** not-installed; no-config = installed but the game hasn't written its settings file yet. */
export type GameStatus = 'not-installed' | 'no-config' | 'not-optimized' | 'optimized';

export interface GameView {
  id: string;
  name: string;
  publisher: string;
  status: GameStatus;
  /** The game is running right now (launch detection). Profiles can't be applied while it runs. */
  running: boolean;
  /** Game version the setting names were checked against. */
  checkedVersion: string;
  note?: string;
  configPaths: string[];
  supports: { resolution: boolean; fps: boolean; aa: string[] | null; reflex: string[] | null; flags: GameFlag[] };
  /** Read from the config file; empty when there is none. */
  current: GameValues;
  recommended: GameValues;
  /** When IcyTweaker first changed this game's settings; null = not optimized. */
  optimizedAt?: string | null;
}

export interface AppState {
  live: boolean;
  isAdmin: boolean;
  build: number;
  dataDir: string;
  tweaks: TweakView[];
  fixes: FixMeta[];
  /** Names of tweaks changed this session that need a restart. */
  rebootPending: string[];
  /** Number of values the app has changed and can undo. */
  backupCount: number;
  presets: PresetMeta[];
  /** First-run walkthrough finished or skipped. */
  onboarded: boolean;
}

export interface ActionReport {
  ok: boolean;
  message: string;
}

/** Progress of a long task. For 'analyze', done = files scanned and total = 0 (unknown). */
export interface Progress {
  task: 'uninstall' | 'scan' | 'clean' | 'analyze' | 'system-check' | 'runtimes' | 'net-test' | 'driver' | 'frametime' | 'find' | 'update' | 'restore-point' | 'restart';
  done: number;
  total: number;
  current: string;
  bytes?: number;
}

/** Cleaner risk: safe regenerates, caution loses something you may notice, risky loses data. */
export type CleanRisk = 'safe' | 'caution' | 'risky';

export interface CleanTargetView {
  id: string;
  group: 'system' | 'browser' | 'app';
  /** Browser targets: "Brave: Work" (browser and profile). */
  subgroup?: string;
  name: string;
  description: string;
  risk: CleanRisk;
  requiresAdmin: boolean;
  defaultSelected: boolean;
  /** The owning app must be closed (cookies, history, passwords). */
  needsClosed: boolean;
  /** The owning app is running right now. */
  running: boolean;
}

export interface ScanResult {
  id: string;
  bytes: number;
  files: number;
  inaccessible: number;
  error?: string;
}

export interface CleanResult {
  id: string;
  freed: number;
  files: number;
  /** Files in use or without permission, left in place. */
  locked: number;
  skipped?: string;
}

export interface DriveInfo {
  name: string;
  media: string;
  bus: string;
  health: string;
  status: string;
  size: number;
  /** Percent of rated SSD endurance used. null = not reported (or not admin). */
  wear: number | null;
  temperature: number | null;
  powerOnHours: number | null;
  readErrors: number | null;
  writeErrors: number | null;
}

export interface DirEntry {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
}

/** Focus Mode: what it stops (service names) and closes (exe names) while on. */
export interface FocusSettings {
  services: string[];
  apps: string[];
  /** The user's own programs to close (exe names). */
  custom: string[];
  /** Never closed, whatever the lists say. */
  exceptions: string[];
  /** Reopen the closed apps when Focus Mode turns off. */
  reopen: boolean;
}
/** While Focus Mode is on: what it actually stopped and closed. */
export interface FocusState {
  since: string;
  services: string[];
  apps: Array<{ name: string; path: string }>;
}
export interface FocusInfo {
  settings: FocusSettings;
  state: FocusState | null;
  services: Array<{ name: string; label: string; note: string }>;
  apps: Array<{ exe: string; label: string }>;
}

/** One item in the Recycle Bin. */
export interface RecycleItem {
  name: string;
  /** Folder it was deleted from. */
  from: string;
  /** When it was deleted (ISO), if Windows recorded it. */
  deleted: string | null;
  /** Bytes (a folder's total). */
  size: number;
  folder: boolean;
}

/** The last result of each scanner, with when it ran (`at`, ISO). */
export interface LastScans {
  analyze?: { at: string; root: string; view: AnalyzeView };
  duplicates?: { at: string; root: string; groups: DuplicateGroup[] };
  oldfiles?: { at: string; root: string; days: number; files: OldFile[] };
  cleaner?: Record<string, { at: string; result: ScanResult }>;
}

export interface AnalyzeView {
  root: string;
  path: string;
  size: number;
  /** Subfolders and files of `path`, biggest first. */
  entries: DirEntry[];
  /** Biggest files anywhere under the root. */
  topFiles: DirEntry[];
  inaccessible: number;
  scanned: boolean;
}

/** The API the preload exposes as `window.api`. Channel name = method name. */
export interface OptimizerApi {
  getState(): Promise<AppState>;
  /** Risky tweaks need confirmed: true. option = value for adjustable tweaks. */
  setTweak(id: string, on: boolean, opts?: { confirmed?: boolean; option?: number }): Promise<ActionReport>;
  /** Optional category = only that tab. Risky tweaks are skipped. */
  applyAll(category?: Category): Promise<ActionReport>;
  revertAll(category?: Category): Promise<ActionReport>;
  undoAll(): Promise<ActionReport>;
  relaunchAsAdmin(): Promise<ActionReport>;
  applyPreset(id: string): Promise<ActionReport>;
  /** name: optional label shown in Windows System Restore ("IcyTweaker: <name>"). */
  createRestorePoint(name?: string): Promise<ActionReport>;
  /** Asks for confirmation in a native dialog, then restarts Windows. */
  restart(): Promise<ActionReport>;
  completeOnboarding(): Promise<void>;
  getStats(): Promise<Stats>;
  /** Risky fixes need confirmed: true. */
  runFix(id: string, confirmed?: boolean): Promise<ActionReport>;
  listApps(): Promise<{ apps: AppItem[]; error?: string }>;
  /** App key (from the last listApps) -> its icon as a PNG data URL, or null. */
  appIcons(): Promise<Record<string, string | null>>;
  uninstallApps(keys: string[]): Promise<ActionReport>;
  listRestorePoints(): Promise<{ points: RestorePointView[]; error?: string }>;
  /** Opens the Windows System Restore wizard, where the user picks a point and confirms. */
  openSystemRestore(): Promise<ActionReport>;
  getHistory(): Promise<{ log: LogEntry[]; changes: BackupView[] }>;
  /** Save dialog, then copies the action log there. */
  exportLog(): Promise<ActionReport>;
  listCleanTargets(): Promise<CleanTargetView[]>;
  /** Read-only: sizes what each target would free. */
  scanCleanTargets(ids: string[]): Promise<ScanResult[]>;
  /** Risky targets need confirmed: true. */
  cleanTargets(ids: string[], confirmed?: boolean): Promise<{ report: ActionReport; results: CleanResult[] }>;
  /** Drives and your user folder, to analyze. */
  analyzeRoots(): Promise<string[]>;
  analyze(root: string): Promise<AnalyzeView | { error: string }>;
  /** Drill into a folder of the last analysis. */
  analyzeOpen(path: string): Promise<AnalyzeView | { error: string }>;
  cancelAnalyze(): Promise<void>;
  /** Show a file of the last analysis in File Explorer. */
  revealPath(path: string): Promise<void>;
  /** Move a file of the last analysis to the Recycle Bin. */
  trashPath(path: string): Promise<ActionReport>;
  driveHealth(): Promise<{ drives: DriveInfo[]; error?: string }>;
  servicesLevel(): Promise<{ level: ServiceLevel; custom: boolean; xboxInUse: boolean }>;
  previewServiceLevel(level: ServiceLevel): Promise<LevelPreview>;
  /** Medium and Extreme need confirmed: true (Extreme: the user typed EXTREME). */
  setServiceLevel(level: ServiceLevel, confirmed?: boolean): Promise<ActionReport>;
  listServices(): Promise<{ services: ServiceInfo[]; error?: string }>;
  setServiceStartType(name: string, type: ServiceStartType): Promise<ActionReport>;
  controlService(name: string, action: 'start' | 'stop'): Promise<ActionReport>;
  networkInfo(): Promise<{ adapters: NetAdapterView[]; presets: DnsPreset[]; error?: string }>;
  setDns(guid: string, presetId: string): Promise<ActionReport>;
  getHosts(): Promise<{ content: string | null }>;
  saveHosts(content: string): Promise<{ report: ActionReport; errors: HostsError[] }>;
  runSystemCheck(): Promise<{ report: ActionReport; steps: SystemCheckStep[] }>;
  shortcuts(): Promise<ShortcutView[]>;
  openShortcut(id: string): Promise<ActionReport>;
  listGames(): Promise<GameView[]>;
  /** Game id -> icon (PNG data URL) read from the installed game's own .exe; null when not installed. */
  gameIcons(): Promise<Record<string, string | null>>;
  /** Backs up, patches only the profile's keys, verifies. Refused while the game runs or if a key is missing. */
  applyGameProfile(id: string, values: GameValues): Promise<ActionReport>;
  /** Puts back every key the app changed for this game. */
  resetGameProfile(id: string): Promise<ActionReport>;
  /** Starts the game through Steam, Epic, the Riot Client, or its own .exe. */
  launchGame(id: string): Promise<ActionReport>;
  /** Every installed Steam / Epic game (cached; refresh: true scans again). */
  library(refresh?: boolean): Promise<LibraryGame[]>;
  /** Game id -> icon from its exe, for library games. */
  libraryIcons(): Promise<Record<string, string | null>>;
  launchLibraryGame(id: string): Promise<ActionReport>;
  /** Per-game Windows settings. target = a profile id or a library game id. */
  getWinSettings(target: string): Promise<{ exe: string; settings: GameWinSettings } | { error: string }>;
  setWinSettings(target: string, settings: GameWinSettings): Promise<ActionReport>;
  resetWinSettings(target: string): Promise<ActionReport>;
  /** Finished Game Boost sessions, newest first. */
  sessions(): Promise<SessionReport[]>;
  /** Free and standby memory in MB (needs administrator). */
  memoryStatus(): Promise<{ freeMb: number; standbyMb: number } | { error: string }>;
  purgeStandby(): Promise<ActionReport>;
  /** The Windows build changed since the last start: from -> to. null = no change seen. */
  windowsUpdateInfo(): Promise<{ from: string; to: string } | null>;
  /** Read-only hardware detection and BIOS audit. Cached after the first call; refresh: true re-reads. */
  hardware(refresh?: boolean): Promise<{ hw: HardwareInfo | null; audit: AuditItem[]; guide: { brand: string; steps: string[] }; error?: string }>;
  /** Installed and latest GPU driver (asks NVIDIA's lookup service), plus any driver job in progress. */
  driverInfo(): Promise<{ info: DriverInfo; job: DriverJobView | null }>;
  /** Needs confirmed: true (the user typed REINSTALL). Restore point first; ends in a restart. */
  beginDriverJob(confirmed?: boolean): Promise<{ report: ActionReport; job: DriverJobView | null }>;
  /** After the restart: install the downloaded driver. */
  resumeDriverJob(): Promise<{ report: ActionReport; job: DriverJobView | null }>;
  clearDriverJob(): Promise<void>;
  /** Status only (no network). */
  driverJob(): Promise<DriverJobView | null>;
  /** Known games running now, for frametime capture. */
  frametimeTargets(): Promise<Array<{ name: string; exe: string }>>;
  /** previous = the last capture of the same game, for a before/after comparison. */
  captureFrametimes(exe: string, seconds: number): Promise<{ result?: FrametimeResult; previous?: FrametimeResult & { at: string }; error?: string }>;
  listProcesses(): Promise<{ processes: ProcessView[]; error?: string }>;
  /** Ends a process from the last listing (never Windows' own). */
  endProcess(pid: number): Promise<ActionReport>;
  latencyCheck(seconds: number): Promise<{ result?: LatencyCheck; error?: string }>;
  /** Kernel trace (xperf): which drivers spent longest in DPCs/ISRs. Needs administrator and the toolkit. */
  traceDrivers(seconds: number): Promise<{ drivers?: DriverLatency[]; error?: string }>;
  toolStatus(): Promise<ToolStatus>;
  /** Installs the Windows Performance Toolkit (winget, Windows ADK feature only). */
  installWpt(): Promise<ActionReport>;
  /** Downloads the CPU temperature library (hash-checked) and installs PawnIO if missing. */
  setupCpuTemp(): Promise<ActionReport>;
  backupDrivers(): Promise<ActionReport>;
  driverBackups(): Promise<DriverBackupView[]>;
  restoreDriverBackup(id: string): Promise<ActionReport>;
  openDriverBackup(id: string): Promise<void>;
  /** In-game overlay for a running game (PresentMon + nvidia-smi). */
  startOverlay(exe: string): Promise<ActionReport>;
  stopOverlay(): Promise<void>;
  overlayStatus(): Promise<{ running: boolean; game: string | null }>;
  froststrap(): Promise<FroststrapInfo>;
  /** null = remove the app's FPS flag change (puts the original back). */
  setFroststrapFps(fps: number | null): Promise<ActionReport>;
  openFroststrap(): Promise<ActionReport>;
  checkUpdates(): Promise<UpdateInfo>;
  openUpdatePage(): Promise<void>;
  downloadUpdate(): Promise<ActionReport>;
  /** Closes IcyTweaker and installs the downloaded update. */
  installUpdate(): Promise<void>;
  /** Puts back every setting the app first changed at or after `savedAt` (newest first), behind a restore point. */
  undoSince(savedAt: string): Promise<ActionReport>;
  device(): Promise<DeviceInfo>;
  /** Event, not a call: overlay numbers (the overlay window listens). */
  onOverlay(cb: (s: OverlayStats) => void): () => void;
  /** Tweaks the app applied that Windows has since undone (live mode). */
  drifted(): Promise<Array<{ id: string; name: string; risk: Risk }>>;
  /** Risky ones need confirmed: true. */
  reapply(ids: string[], confirmed?: boolean): Promise<ActionReport>;
  /** Save dialog; writes the applied tweaks and Game Boost settings. */
  exportConfig(): Promise<ActionReport>;
  /** Copies the same export as a share code (text) to the clipboard. */
  copyShareCode(): Promise<ActionReport>;
  /** Open dialog (or the clipboard's share code); reads and checks a settings file without applying it. */
  readConfig(fromClipboard?: boolean): Promise<{ summary?: ConfigSummary; error?: string }>;
  /** Applies the file from the last readConfig (Risky ones need confirmed: true). */
  applyConfig(confirmed?: boolean): Promise<ActionReport>;
  bootInfo(): Promise<{ info?: BootInfo; error?: string }>;
  monitors(): Promise<MonitorInfo[]>;
  /** Home checkups: shader cache total and GPU driver dates. */
  checkups(): Promise<{ chipset: { vendor: 'AMD' | 'Intel'; driverDate: string } | null; shaderBytes: number; shaderIds: string[]; gpus: Array<{ name: string; vendor: string; driverDate: string | null }> }>;
  /** Official AMD / Intel driver page in the browser. */
  openVendorPage(kind: 'amd' | 'intel'): Promise<ActionReport>;
  /** The primary display's modes (Game Boost display option). */
  displayModes(): Promise<DisplayMode[]>;
  getSettings(): Promise<AppSettings>;
  setSettings(s: Omit<AppSettings, 'lastCleanAt'>): Promise<AppSettings>;
  /** Folders the finders may scan (drives and your user folder). */
  findRoots(): Promise<string[]>;
  /** A Steam library game's header art (data URL) from Steam's local cache; null = none. */
  libraryArt(id: string): Promise<string | null>;
  focusInfo(): Promise<FocusInfo>;
  setFocusSettings(s: FocusSettings): Promise<FocusInfo>;
  /** Turn Focus Mode on or off. */
  setFocus(on: boolean): Promise<ActionReport>;
  /** Everything in the Recycle Bin, newest deleted first. */
  recycleItems(): Promise<{ items: RecycleItem[]; error?: string }>;
  /** Last results of the Disk Analyzer, finders and cleaner scans. */
  lastScans(): Promise<LastScans>;
  findDuplicates(root: string): Promise<{ groups: DuplicateGroup[]; error?: string }>;
  findOldFiles(root: string, days: number): Promise<{ files: OldFile[]; error?: string }>;
  cancelFind(): Promise<void>;
  /** Moves files from the last duplicate / old-files scan to the Recycle Bin. */
  trashFound(paths: string[]): Promise<ActionReport>;
  privacyTraces(): Promise<PrivacyTraceView[]>;
  clearPrivacy(ids: string[]): Promise<ActionReport>;
  privacySnapshots(): Promise<PrivacySnapshot[]>;
  restorePrivacy(id: string): Promise<ActionReport>;
  deletePrivacySnapshot(id: string): Promise<ActionReport>;
  /** Custom title bar buttons. */
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  /** Power plans on this PC (powercfg /list), for Game Boost's plan choice. */
  powerPlans(): Promise<Array<{ guid: string; name: string; active: boolean }>>;
  getBoost(): Promise<BoostState>;
  setBoost(settings: BoostState['settings']): Promise<BoostState>;
  listStartup(): Promise<{ items: StartupItemView[]; error?: string }>;
  setStartupItem(id: string, enabled: boolean): Promise<ActionReport>;
  /** Many at once (restore point first). */
  setStartupItems(ids: string[], enabled: boolean): Promise<ActionReport>;
  /** Delete one entry: registry values are backed up (Undo All), folder shortcuts go to the Recycle Bin, tasks can't be deleted. */
  removeStartupItem(id: string): Promise<ActionReport>;
  runtimes(): Promise<RuntimeView[]>;
  /** Installs through winget (downloads from Microsoft). Behind a restore point. */
  installRuntimes(ids: string[]): Promise<{ report: ActionReport; results: RuntimeResult[] }>;
  /** Network: TCP handshake times to the default targets, or to one host the user typed. */
  latencyTest(host?: string): Promise<{ results: LatencyResult[]; error?: string }>;
  /** Network: resolves popular gaming domains through each DNS preset, fastest first. */
  dnsBenchmark(): Promise<{ results: DnsBenchResult[]; error?: string }>;
  /** Event, not a call: progress of uninstall, scan, clean and analyze. Returns an unsubscribe function. */
  onProgress(cb: (p: Progress) => void): () => void;
}

export type InvokeApi = Omit<OptimizerApi, 'onProgress' | 'onOverlay'>;
