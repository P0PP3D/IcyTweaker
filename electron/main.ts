import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, globalShortcut, Notification, powerMonitor, screen, shell, Tray } from 'electron';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createAnalyzer } from './cleaner/analyzer';
import { createCleaner, driveHealth, type Env } from './cleaner/cleaner';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Accent, LastScans, ProcessView, AppSettings, CleanResult, DriverJobView, FrametimeResult, GameValues, InvokeApi, NetAdapterView, Progress, ServiceInfo, ServiceLevel, ServiceStartType } from '../shared/types';
import { POWERSHELL_EXE, SHUTDOWN_EXE, createSystemAdapter, isLiveEnv, liveAdapter, REG_EXE, runningProcesses, sz, type SettingRef } from './system/adapter';
import { createProcessSampler, queryProcesses } from './system/processes';
import { WPT_INSTALL_ARGS, XPERF, latencyCheck, traceDrivers } from './system/latency';
import { PAWNIO_INSTALL_ARGS, ensureLhm, pawnioInstalled } from './system/sensors';
import { backupDrivers, listDriverBackups, restoreDrivers } from './system/drivers';
import { checkUpdates } from './system/updates';
import { START_TASK, setLogonTask } from './system/tasks';
import { autoUpdater } from 'electron-updater';
import { createOverlayFeed } from './games/overlay';
import { createFroststrap } from './apps/froststrap';
import { buildConfig, fromShareCode, parseConfig, toShareCode, type ConfigFile } from './system/configfile';
import { bootInfo } from './system/boot';
import { displayModes, monitors } from './system/monitors';
import { findDuplicates, findOldFiles, keptOut } from './cleaner/finder';
import { TRACES as PRIVACY_TRACES, createPrivacy } from './cleaner/privacy';
import { restoreDefender } from './system/uninstall';
import { createDriverJob, driverInfo } from './resources/driver';
import { captureFrametimes, ensurePresentMon } from './resources/frametime';
import { BIOS_GUIDES, GENERIC_GUIDE, auditBios, detectHardware } from './advanced/hardware';
import { advancedTweaks, type MsiDevice } from './advanced/advanced';
import { DEFAULT_BOOST, createBoost, parsePlans, validateBoost, type BoostSettings } from './games/boost';
import { createDebloater } from './system/debloat';
import { fixes } from './tweaks/fixes';
import { serviceTweaks } from './services/catalog';
import { LEVELS, createServices } from './services/services';
import { DNS_PRESETS, activeInterfaces, listAdapters, physicalNics, networkFixes, networkTweaks, validateHosts } from './network/network';
import { SHORTCUTS, runSystemCheck } from './resources/resources';
import { isAdmin, relaunchAsAdmin } from './system/admin';
import { createSafety } from './system/safety';
import { createEngine } from './tweaks/engine';
import { generalTweaks } from './tweaks/general';
import { presets } from './tweaks/presets';
import { createStatsSampler } from './system/stats';
import { appTweaks } from './apps/apps';
import { gameProfiles } from './games/profiles';
import { createGames, findGameExe, launchTarget, validateValues } from './games/games';
import { scanLibrary, type LibraryEntry } from './games/library';
import { applyWinSettings, readWinSettings, resetWinSettings, validateWinSettings } from './games/winsettings';
import { cpuMeter, createSessionRecorder } from './games/session';
import { memoryLists, purgeStandby } from './system/memory';

const ACCENTS: Accent[] = ['blue', 'cyan', 'violet', 'emerald', 'indigo'];
import { createStartup, startupSources } from './apps/startup';
import { RUNTIMES, installRuntimes, wingetPath } from './resources/runtimes';
import { LATENCY_TARGETS, dnsBenchmark, latencyTest, tcpProbe, validHost } from './network/tests';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

// The app was renamed IcyCleaner -> IcyTweaker. Its data folder keeps the old name: the backups Undo needs, the
// settings and the logs are there. (An explicit --user-data-dir, as in tests, still wins.)
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'IcyCleaner'));
const live = isLiveEnv(process.env, app.isPackaged); // installed builds are live; `npm run dev` is dry-run
const devUrl = process.env.VITE_DEV_SERVER_URL;

/** The overlay window, when shown. Everything else talks to the main window. */
let overlayWin: BrowserWindow | null = null;
const mainWindow = () => BrowserWindow.getAllWindows().find((w) => w !== overlayWin && !w.isDestroyed());

/** Set once settings load: closing the window keeps the app in the tray. */
let keepInTray = () => false;
let appQuitting = false;
app.on('before-quit', () => (appQuitting = true));
const showWindow = () => {
  const win = mainWindow();
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

function createWindow(show = true) {
  // Opens at 1440 x 940, or 90% of the screen's work area when that is smaller.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    show,
    width: Math.min(1440, Math.round(area.width * 0.9)),
    height: Math.min(940, Math.round(area.height * 0.9)),
    center: true,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#07090d',
    autoHideMenuBar: true,
    frame: false, // custom title bar in the renderer (TitleBar in App.tsx)
    title: `IcyTweaker${live ? ' (LIVE)' : ' (dry-run)'}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => {
    if (!keepInTray()) overlayWin?.destroy();
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  if (process.argv.includes('--restore-defender')) {
    // Uninstaller hook: no window. Only acts on a live backup, so only on changes the app made for real.
    await restoreDefender(liveAdapter(), path.join(app.getPath('userData'), 'live')).catch(() => 0);
    app.exit(0);
    return;
  }
  // One instance: starting it again (Start menu, RunOnce after a driver restart) shows the running one.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);
  app.setAppUserModelId('app.icycleaner.desktop'); // notifications
  try {
    const adapter = createSystemAdapter(process.env, app.isPackaged);
    // Live and dry-run keep separate backups and logs, so a dry-run backup can never be "undone" for real.
    const safety = await createSafety(adapter, path.join(app.getPath('userData'), live ? 'live' : 'dry-run'), { resume: live });
    const sysRootForHw = process.env.SystemRoot ?? 'C:\\Windows';
    // Hardware detection takes ~9 s (CIM queries). The last result starts the app; a fresh one replaces it in the
    // background. Only the first start ever waits for it. Read-only data, shared by both modes.
    const hwFile = path.join(app.getPath('userData'), 'hardware.json');
    const hwDetect = () =>
      detectHardware(adapter, sysRootForHw).then(
        async (h) => (await writeFile(hwFile, JSON.stringify(h)).catch(() => {}), h),
        () => null,
      );
    const hwSaved = await readFile(hwFile, 'utf8').then((t) => JSON.parse(t) as Awaited<ReturnType<typeof detectHardware>>, () => null);
    const [admin, interfaces, nics, hwFirst] = await Promise.all([isAdmin(), activeInterfaces(adapter), physicalNics(adapter), hwSaved ?? hwDetect()]);
    if (hwSaved) void hwDetect().then((h) => h && (hwCache = h));
    // Hardware (read-only), for the Advanced page and BIOS audit. MSI tweaks only for PCI devices whose driver has the key.
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
    let hwCache = hwFirst;
    const pci = [...(hwCache?.hw.gpus ?? []), ...(hwCache?.hw.nics ?? [])].filter((d) => /^PCI\\/i.test(d.pnp));
    const hasMsiKey = await Promise.all(
      pci.map((d) => adapter.query(REG_EXE, ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${d.pnp}\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties`]).then(() => true, () => false)),
    );
    const msiDevices: MsiDevice[] = pci.filter((_, i) => hasMsiKey[i]).map((d) => ({ name: d.name, pnp: d.pnp }));
    const roaming = process.env.APPDATA!;
    const ifExists = (...p: string[]) => (existsSync(path.join(...p)) ? path.join(...p) : null);
    // verify: Opera keeps its Local State in Roaming (neither Opera is installed on the dev PC).
    const appPaths = {
      discord: ifExists(roaming, 'discord', 'settings.json'),
      opera: ifExists(roaming, 'Opera Software', 'Opera Stable', 'Local State'),
      operaGx: ifExists(roaming, 'Opera Software', 'Opera GX Stable', 'Local State'),
      spotify: ifExists(roaming, 'Spotify', 'prefs'),
      obs: ifExists(roaming, 'obs-studio', 'global.ini'),
    };
    // What the engine optimizes for; Devices can override laptop vs desktop (set once settings load).
    const engineHw = { laptop: hwCache?.hw.laptop ?? null, ssd: hwCache?.hw.systemSsd ?? null };
    // Installed anti-cheats (their services), for warnings on tweaks they may object to.
    // All at once: reads asked for together share one batched registry read.
    const AC = [
      ['Vanguard', ['vgc', 'vgk']],
      ['Easy Anti-Cheat', ['EasyAntiCheat', 'EasyAntiCheat_EOS']],
      ['BattlEye', ['BEService']],
      ['FACEIT', ['FACEIT', 'FACEITService']],
    ] as const;
    const found = await Promise.all(AC.map(([, svcs]) => Promise.all(svcs.map((s) => adapter.read({ kind: 'service', name: s }).catch(() => null)))));
    const antiCheats: string[] = AC.filter((_, i) => found[i].some((v) => v !== null)).map(([name]) => name);
    const { withRestorePoint, serial, ...engine } = createEngine({
      tweaks: [...generalTweaks, ...serviceTweaks, ...networkTweaks(interfaces, nics), ...appTweaks(appPaths), ...advancedTweaks(msiDevices)],
      presets,
      fixes: [...fixes, ...networkFixes],
      safety,
      live,
      isAdmin: admin,
      build: Number(os.release().split('.')[2]) || 0,
      hardware: engineHw,
      antiCheats,
    });
    const debloater = createDebloater(adapter);
    const services = createServices(adapter, safety);
    let serviceList = new Map<string, ServiceInfo>(); // from the last listServices(); only these can be changed
    let adapterList: NetAdapterView[] = []; // from the last networkInfo(); only these get DNS changes
    const removedFile = path.join(safety.dataDir, 'removed-apps.jsonl');
    const progress = (p: Progress) => mainWindow()?.webContents.send('progress', p);
    safety.hooks.activity = (task, active) => progress({ task, done: 0, total: 0, current: active ? task : '' });

    // Cleaner environment. Recycle Bin folders are per user SID; Steam may be installed anywhere.
    const env = process.env;
    const sid = /S-1-5-[\d-]+/.exec(await adapter.query(path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']).catch(() => ''))?.[0];
    const drives = [...'CDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => `${l}:\\`).filter((d) => existsSync(d));
    const steamReg = await adapter.read({ kind: 'reg', hive: 'HKCU', key: 'Software\\Valve\\Steam', name: 'SteamPath' }).catch(() => null);
    const cleanerEnv: Env = {
      LOCALAPPDATA: env.LOCALAPPDATA!,
      APPDATA: env.APPDATA!,
      TEMP: env.TEMP!,
      SystemRoot: env.SystemRoot ?? 'C:\\Windows',
      ProgramData: env.ProgramData ?? 'C:\\ProgramData',
      ProgramFilesX86: env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      USERPROFILE: env.USERPROFILE!,
      recycleBins: sid ? drives.map((d) => path.join(d, '$Recycle.Bin', sid)) : [],
      steamPath: path.normalize(typeof steamReg === 'object' && steamReg?.type === 'REG_SZ' ? steamReg.data : path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam')),
    };
    const cleaner = createCleaner(adapter, cleanerEnv);
    const gameEnv = { vars: env, steamPath: cleanerEnv.steamPath, programData: cleanerEnv.ProgramData };
    const games = createGames(gameProfiles, safety, gameEnv);
    const iconCache = new Map<string, string | null>();
    const appIconCache = new Map<string, string | null>(); // icon file -> data URL (Debloater)
    const startup = createStartup(safety, startupSources({ APPDATA: env.APPDATA!, ProgramData: cleanerEnv.ProgramData }));
    let startupIds = new Map<string, boolean>(); // id -> requiresAdmin, from the last listStartup()
    let netTestRunning = false;
    let pendingConfig: ConfigFile | null = null; // from the last readConfig()
    // Last scans (Disk Analyzer overview, duplicates, old files, cleaner sizes), kept so each page shows its last
    // result and when it ran instead of an empty screen. Per mode, in the data dir.
    const lastScansFile = path.join(safety.dataDir, 'last-scans.json');
    let lastScans: LastScans = await readFile(lastScansFile, 'utf8').then((t) => JSON.parse(t) as LastScans, () => ({}));
    let foundPaths = new Set<string>(); // files in the last duplicate / old-files results; only these can be trashed
    const refreshFound = () =>
      (foundPaths = new Set([...(lastScans.duplicates?.groups ?? []).flatMap((g) => g.files.map((f) => f.path)), ...(lastScans.oldfiles?.files ?? []).map((f) => f.path)].map((p) => path.resolve(p).toLowerCase())));
    refreshFound();
    const saveLast = (patch: Partial<LastScans>) => {
      lastScans = { ...lastScans, ...patch };
      void writeFile(lastScansFile, JSON.stringify(lastScans)).catch(() => {});
    };
    let findCancelled = false;
    const privacy = createPrivacy(safety, { appData: env.APPDATA!, snapshotDir: path.join(safety.dataDir, 'privacy-backups') });
    const captureHistory = path.join(app.getPath('userData'), 'captures', 'history.json');
    // Driver job: resumes after the restart via RunOnce (`--resume-driver-job` just opens the app on Resources).
    const driverJob = createDriverJob({
      adapter,
      dataDir: safety.dataDir,
      resumeCommand: app.isPackaged ? `"${process.execPath}" --resume-driver-job` : `"${process.execPath}" "${app.getAppPath()}" --resume-driver-job`,
      winget: wingetPath(env.LOCALAPPDATA!),
      // verify: DDU's install folder from its winget (NSIS) installer.
      dduExe: path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Display Driver Uninstaller', 'Display Driver Uninstaller.exe'),
      log: safety.log,
      progress: (done, total, current) => progress({ task: 'driver', done, total, current }),
      backup: () => backupDrivers(adapter, path.join(safety.dataDir, 'driver-backups')),
    });
    const analyzer = createAnalyzer();
    const analyzeRoots = [...drives, env.USERPROFILE!];
    // Never offered for deletion from the analyzer, even inside an analyzed folder.
    const protectedPaths = [cleanerEnv.SystemRoot, env.ProgramFiles, cleanerEnv.ProgramFilesX86, cleanerEnv.ProgramData]
      .filter((p): p is string => !!p)
      .map((p) => path.resolve(p).toLowerCase() + path.sep);
    const isProtected = (p: string) =>
      protectedPaths.some((x) => path.resolve(p).toLowerCase().startsWith(x)) || /^[a-z]:\\(pagefile|hiberfil|swapfile)\.sys$/i.test(path.resolve(p));
    const stats = createStatsSampler();
    app.on('will-quit', () => stats.stop());

    // First-run flag, shared by both modes.
    const settingsFile = path.join(app.getPath('userData'), 'settings.json');
    const saved = await readFile(settingsFile, 'utf8').then((s) => JSON.parse(s) as Record<string, unknown>, () => ({}) as Record<string, unknown>);
    const savedApp = (saved.app ?? {}) as Partial<AppSettings>;
    let settings = {
      onboarded: saved.onboarded === true,
      windowsBuild: (typeof saved.windowsBuild === 'string' ? saved.windowsBuild : null) as string | null,
      /** The command the Start with Windows task was last pointed at. */
      startCmd: (typeof saved.startCmd === 'string' ? saved.startCmd : null) as string | null,
      boost: { ...DEFAULT_BOOST, ...(saved.boost as Partial<BoostSettings> | undefined) },
      app: { tray: true, notify: true, startWithWindows: false, weeklyClean: false, lastCleanAt: null, deviceType: 'auto', laptopProfile: false, overlayWithBoost: false, hotkeys: false, autoUpdate: true, theme: 'dark', accent: 'blue', ...savedApp } as AppSettings,
    };
    const saveSettings = () => writeFile(settingsFile, JSON.stringify(settings, null, 2));

    // Windows build at the last start (build.UBR, e.g. 26200.7171). A change means an update installed since: the
    // launch re-check then says so next to the tweaks it put back.
    const ntKey = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';
    const [cb, ubr] = await Promise.all(['CurrentBuild', 'UBR'].map((name) => safety.read({ kind: 'reg', hive: 'HKLM', key: ntKey, name }).catch(() => null)));
    const buildNow = cb && ubr && typeof cb === 'object' && typeof ubr === 'object' ? `${cb.data}.${ubr.data}` : null;
    const buildBefore = settings.windowsBuild;
    const windowsUpdate = buildNow && buildBefore && buildNow !== buildBefore ? { from: buildBefore, to: buildNow } : null;
    if (buildNow && buildNow !== buildBefore) {
      settings = { ...settings, windowsBuild: buildNow };
      await saveSettings().catch(() => {});
    }
    // Start with Windows: the sign-in task holds the program's path, which changed with the rename (IcyCleaner.exe ->
    // IcyTweaker.exe) and can change with the install folder. Re-point it once when the path differs.
    if (app.isPackaged && live && admin && settings.app.startWithWindows) {
      const startCmd = `"${process.execPath}" --tray`;
      if (settings.startCmd !== startCmd)
        void setLogonTask(adapter, START_TASK, startCmd).then(() => {
          settings = { ...settings, startCmd };
          return saveSettings();
        }, () => {});
    }
    keepInTray = () => settings.app.tray;
    const detectedType = (): 'desktop' | 'laptop' => (hwCache?.hw.laptop ? 'laptop' : 'desktop');
    const deviceType = () => (settings.app.deviceType === 'auto' ? detectedType() : settings.app.deviceType);
    engineHw.laptop = deviceType() === 'laptop';
    const notify = (title: string, body: string) => {
      if (settings.app.notify && Notification.isSupported()) new Notification({ title, body, icon: trayIconPath }).show();
    };

    // Game Boost watcher: checks running processes every 10 s while enabled or during a session.
    // Session reports: started and ended with each Game Boost session, fed by the overlay and the boost timer.
    const sessions = createSessionRecorder(path.join(safety.dataDir, 'sessions.json'));
    const cpuLoad = cpuMeter();
    const boostGames = gameProfiles.map((g) => ({ id: g.id, name: g.name, exe: [...g.exe] }));
    const boost = createBoost(safety, boostGames, settings.boost, (e, game) => {
      if (settings.app.overlayWithBoost) void (e === 'start' ? startOverlayFor(game) : stopOverlay());
      if (e === 'start') {
        sessions.start(game);
        notify(`Game Boost on: ${game}`, 'Power plan and background apps adjusted.');
      } else {
        void sessions.end().then((r) => {
          const fps = r?.fpsAvg ? ` Average ${r.fpsAvg} FPS${r.low1 ? `, 1% low ${r.low1}` : ''}.` : '';
          notify('Game Boost ended', `${game} closed after ${r?.minutes ?? 0} min.${fps}${r?.hot.length ? ` ${r.hot.join('. ')}.` : ''}`);
        }, () => {});
      }
      updateTray();
    }, () => settings.app.laptopProfile && powerMonitor.isOnBatteryPower());

    // System tray: open, Game Boost switch, quit.
    const trayIconPath = path.join(__dirname, '..', 'dist', 'icon.png');
    const tray = new Tray(nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip(`IcyTweaker${live ? '' : ' (dry-run)'}`);
    tray.on('click', showWindow);
    function updateTray() {
      const active = boost.state().active;
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open IcyTweaker', click: showWindow },
          { type: 'separator' },
          {
            label: active ? `Game Boost (boosting ${active.game})` : 'Game Boost',
            type: 'checkbox',
            checked: boost.settings.enabled,
            click: async (item) => {
              settings = { ...settings, boost: { ...settings.boost, enabled: item.checked } };
              await saveSettings();
              await boost.set(settings.boost);
              updateTray();
            },
          },
          { label: 'Show / hide overlay', click: () => void toggleOverlay().catch(() => {}) },
          {
            label: 'Free standby memory',
            enabled: admin || !live,
            click: () =>
              void purgeStandby(adapter).then(
                () => notify('Standby memory', live ? 'Standby memory freed.' : 'Would free standby memory (dry-run).'),
                (e: Error) => notify('Standby memory', e.message),
              ),
          },
          { label: 'Clean now (safe items)', click: () => void safeClean('Clean done').catch((e: Error) => notify('Clean', e.message)) },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ]),
      );
    }
    updateTray();

    // Weekly Health Check: while IcyTweaker runs, when 7 days have passed and the PC has been idle 10 minutes.
    async function weeklyClean() {
      if (!settings.app.weeklyClean) return;
      const last = settings.app.lastCleanAt ? Date.parse(settings.app.lastCleanAt) : 0;
      if (Date.now() - last < 7 * 86_400_000 || powerMonitor.getSystemIdleTime() < 600) return;
      await safeClean('Weekly Health Check done');
    }
    /** The Health Check's safe, default-selected targets (weekly timer and the tray's Clean now). */
    async function safeClean(title: string) {
      settings = { ...settings, app: { ...settings.app, lastCleanAt: new Date().toISOString() } };
      await saveSettings();
      const targets = (await cleaner.list()).filter((t) => t.risk === 'safe' && t.defaultSelected && (!t.requiresAdmin || admin || !live));
      const procs = await runningProcesses(adapter);
      let freed = 0;
      for (const t of targets) {
        const r = await cleaner.clean(cleaner.get(t.id)!, procs).catch(() => null);
        freed += r?.freed ?? 0;
      }
      await safety.log('scheduled-clean', `${targets.length} target(s)`, true, `${freed} bytes${live ? '' : ' (dry-run)'}`);
      notify(title, `${live ? 'Freed' : 'Would free'} ${(freed / 1024 ** 2).toFixed(0)} MB.`);
    }
    setInterval(() => void weeklyClean().catch(() => {}), 15 * 60_000);
    const boostTimer = setInterval(() => {
      if (boost.state().active && !overlayFeed.running()) sessions.sample({ cpu: cpuLoad() }); // the overlay sends its own
      if (boost.settings.enabled || boost.state().active) void boost.tick();
    }, 10_000); // a game is picked up within 10 s; each check starts tasklist, so not more often
    let quitting = false;
    app.on('before-quit', (e) => {
      if (quitting || !boost.state().active) return;
      e.preventDefault(); // end the session (power plan, priorities) before exiting
      quitting = true;
      clearInterval(boostTimer);
      void boost.end().finally(() => app.quit());
    });

    // Laptop profile: Balanced on battery, back to the previous plan on AC (through the safety layer: Undo All covers it).
    const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
    let planBeforeBattery: string | null = null;
    async function applyPowerSource() {
      const active: SettingRef = { kind: 'activeScheme' };
      const wanted = settings.app.laptopProfile && deviceType() === 'laptop' && powerMonitor.isOnBatteryPower();
      if (wanted === (planBeforeBattery !== null)) return; // nothing to switch: don't queue behind other changes
      await serial(async () => {
        if (wanted && planBeforeBattery === null) {
          const cur = await safety.read(active);
          if (typeof cur === 'string' && cur !== BALANCED) {
            planBeforeBattery = cur;
            await safety.set(active, BALANCED);
            notify('On battery', 'Switched to the Balanced power plan.');
          }
        } else if (!wanted && planBeforeBattery) {
          await safety.set(active, planBeforeBattery);
          planBeforeBattery = null;
        }
        return { ok: true, message: '' };
      });
    }
    powerMonitor.on('on-battery', () => void applyPowerSource().catch(() => {}));
    powerMonitor.on('on-ac', () => void applyPowerSource().catch(() => {}));
    void applyPowerSource().catch(() => {});

    // In-game overlay: a small click-through window over the game, fed by the overlay module.
    const toolsDir = path.join(app.getPath('userData'), 'tools');
    const overlayFeed = createOverlayFeed({
      systemRoot: sysRoot,
      send: (raw) => {
        const st = { ...raw, ping };
        overlayWin?.webContents.send('overlay', st);
        const before = sessions.sample(st);
        if (before !== null && st.fps != null && Date.now() - lastStutter > 60_000) {
          lastStutter = Date.now();
          void recordStutter(st.fps, before).catch(() => {});
        }
      },
    });
    // Stutter log: on an FPS drop (at most once a minute), the background apps with the most CPU over the next 2 s.
    let lastStutter = 0;
    async function recordStutter(fps: number, before: number) {
      const at = new Date().toISOString();
      const rate = createProcessSampler();
      rate(await queryProcesses(adapter));
      await new Promise((r) => setTimeout(r, 2000));
      const game = new Set(boostGames.flatMap((g) => g.exe.map((e) => e.replace(/\.exe$/, ''))));
      const top = rate(await queryProcesses(adapter))
        .filter((p) => p.cpu >= 1 && !game.has(p.name.toLowerCase()) && p.name.toLowerCase() !== 'system idle process')
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 3)
        .map((p) => ({ name: p.name, cpu: p.cpu }));
      sessions.stutter({ at, fps: Math.round(fps), before, top });
    }
    // Overlay ping: one TCP handshake to Cloudflare (1.1.1.1:443, the nearest of its servers) every 2 s while the
    // overlay is on. Shows connection spikes; it is not the game server's own ping (games don't expose it).
    let ping: number | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    async function startOverlay(exe: string, name: string) {
      if (!admin) throw new Error('The overlay needs administrator (Windows event tracing). Relaunch as admin first.');
      pingTimer ??= setInterval(() => void tcpProbe('1.1.1.1', 443, 1500).then((ms) => (ping = ms === null ? null : Math.round(ms))), 2000);
      const lhmDir = path.join(toolsDir, 'lhm-0.9.6');
      overlayFeed.start(await ensurePresentMon(adapter, toolsDir), exe, name, existsSync(path.join(lhmDir, 'LibreHardwareMonitorLib.dll')) ? lhmDir : null);
      if (!overlayWin) {
        const area = screen.getPrimaryDisplay().workArea;
        const w = new BrowserWindow({
          x: area.x + 16,
          y: area.y + 16,
          width: 230,
          height: 162,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          focusable: false,
          resizable: false,
          hasShadow: false,
          show: false,
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        w.setIgnoreMouseEvents(true);
        w.setAlwaysOnTop(true, 'screen-saver');
        w.once('ready-to-show', () => w.showInactive());
        w.on('closed', () => (overlayWin = null));
        if (devUrl) void w.loadURL(`${devUrl}#overlay`);
        else void w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'overlay' });
        overlayWin = w;
      }
      await safety.log('overlay', name, true);
    }
    async function startOverlayFor(gameName: string) {
      const g = boostGames.find((x) => x.name === gameName);
      const procs = await runningProcesses(adapter);
      const exe = g?.exe.find((e) => procs.has(e));
      if (g && exe) await startOverlay(exe, g.name).catch(() => {});
    }
    async function stopOverlay() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      ping = null;
      overlayFeed.stop();
      overlayWin?.close();
      overlayWin = null;
    }

    // Game library: every installed Steam / Epic game. Scanned in the background at start and on demand.
    let libraryGames: LibraryEntry[] = [];
    const exeName = (p: string) => path.win32.basename(p).toLowerCase();
    // Games with a profile already have their own entry (and Boost watches their exe).
    const profiled = (g: LibraryEntry) => gameProfiles.some((p) => p.exe.includes(exeName(g.exe)) || (p.install.steam !== undefined && g.id === `steam-${p.install.steam}`));
    async function refreshLibrary() {
      libraryGames = await scanLibrary(gameEnv).catch(() => libraryGames);
      // Game Boost also watches library games that have no profile.
      const covered = new Set(boostGames.flatMap((g) => g.exe));
      for (const g of libraryGames) {
        if (profiled(g) || covered.has(exeName(g.exe))) continue;
        boostGames.push({ id: g.id, name: g.name, exe: [exeName(g.exe)] });
        covered.add(exeName(g.exe));
      }
      return libraryGames;
    }
    void refreshLibrary();
    /** The exe behind a profile id or a library game id. */
    async function exeFor(target: unknown): Promise<string | null> {
      const p = gameProfiles.find((g) => g.id === target);
      if (p) return findGameExe(p, gameEnv).catch(() => null);
      return libraryGames.find((g) => g.id === target)?.exe ?? null;
    }

    // Global hotkeys (Settings): overlay on/off for the running game, Game Boost on/off.
    async function toggleOverlay() {
      if (overlayFeed.running()) return void stopOverlay();
      const procs = await runningProcesses(adapter);
      const g = boostGames.find((x) => x.exe.some((e) => procs.has(e)));
      if (!g) return notify('Overlay', 'Start a game first, then press Ctrl+Shift+O.');
      await startOverlay(g.exe.find((e) => procs.has(e))!, g.name).catch((e: Error) => notify('Overlay', e.message));
    }
    async function toggleBoost() {
      settings = { ...settings, boost: { ...settings.boost, enabled: !settings.boost.enabled } };
      await saveSettings();
      void boost.set(settings.boost);
      updateTray();
      notify('Game Boost', settings.boost.enabled ? 'Game Boost is on.' : 'Game Boost is off.');
    }
    function registerHotkeys() {
      globalShortcut.unregisterAll();
      if (!settings.app.hotkeys) return;
      globalShortcut.register('CommandOrControl+Shift+O', () => void toggleOverlay().catch(() => {}));
      globalShortcut.register('CommandOrControl+Shift+B', () => void toggleBoost().catch(() => {}));
    }
    registerHotkeys();
    app.on('will-quit', () => globalShortcut.unregisterAll());

    let processList = new Map<number, ProcessView>(); // from the last listProcesses(); only these can be ended
    const sampleProcesses = createProcessSampler();
    const driverBackupRoot = path.join(safety.dataDir, 'driver-backups');
    const froststrap = createFroststrap(safety, env.LOCALAPPDATA!);
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { version: string; updateRepo?: string };
    let updateUrl: string | null = null;
    // Auto-update (installed builds with a release repository): GitHub releases through electron-updater.
    // With Settings > Automatic updates on (default), it checks 30 s after start and every 6 h, downloads in the
    // background and installs when IcyTweaker quits (or at "Restart and install"). Off = only the Settings buttons.
    // The installer is not code-signed yet, so updates are trusted through HTTPS from the project's own GitHub
    // releases; once signed, set build.win.publisherName so electron-updater also checks the update's signature.
    const [repoOwner, repoName] = (pkg.updateRepo ?? '').split('/');
    const canAutoUpdate = app.isPackaged && !!repoOwner && !!repoName;
    let updateDownloaded = false;
    const applyAutoUpdate = () => {
      autoUpdater.autoDownload = settings.app.autoUpdate;
      autoUpdater.autoInstallOnAppQuit = settings.app.autoUpdate;
    };
    if (canAutoUpdate) {
      autoUpdater.setFeedURL({ provider: 'github', owner: repoOwner, repo: repoName });
      applyAutoUpdate();
      autoUpdater.on('download-progress', (p) => progress({ task: 'update', done: p.transferred, total: p.total, current: 'IcyTweaker update' }));
      autoUpdater.on('update-downloaded', (info) => {
        if (!updateDownloaded) notify(`IcyTweaker ${info.version} downloaded`, 'It installs when you quit IcyTweaker, or restart now from Settings > Updates.');
        updateDownloaded = true;
        progress({ task: 'update', done: 1, total: 1, current: '' });
      });
      const autoCheck = () => {
        if (settings.app.autoUpdate && !updateDownloaded) void autoUpdater.checkForUpdates().catch(() => {});
      };
      setTimeout(autoCheck, 30_000);
      setInterval(autoCheck, 6 * 3_600_000);
    }

    const api: InvokeApi = {
      // ---- Process view
      async listProcesses() {
        try {
          const list = sampleProcesses(await queryProcesses(adapter));
          processList = new Map(list.map((p) => [p.pid, p]));
          return { processes: list };
        } catch (err) {
          return { processes: [], error: `Could not read processes: ${(err as Error).message}` };
        }
      },

      async endProcess(pid: unknown) {
        const p = typeof pid === 'number' ? processList.get(pid) : undefined;
        if (!p) return { ok: false, message: 'Invalid request.' };
        const ours = [process.pid, ...BrowserWindow.getAllWindows().map((w) => w.webContents.getOSProcessId())];
        if (p.hint === 'system' || ours.includes(p.pid)) return { ok: false, message: `${p.name} is part of Windows or IcyTweaker and is not ended here.` };
        try {
          await adapter.exec(path.join(sysRoot, 'System32', 'taskkill.exe'), ['/PID', String(p.pid), '/T', '/F'], 30_000);
          await safety.log('end-process', `${p.name} (${p.pid})`, true, live ? undefined : 'dry-run: not ended');
          return { ok: true, message: `${p.name} ${live ? 'ended' : 'would be ended (dry-run)'}.` };
        } catch (err) {
          await safety.log('end-process', p.name, false, (err as Error).message);
          return { ok: false, message: `${p.name}: ${(err as Error).message}` };
        }
      },

      // ---- Latency check (read-only)
      async latencyCheck(seconds: unknown) {
        const s = Number.isInteger(seconds) && (seconds as number) >= 5 && (seconds as number) <= 120 ? (seconds as number) : 20;
        try {
          const result = await latencyCheck(adapter, s);
          await safety.log('latency-check', `${s} s`, true, `${result.verdict}: DPC peak ${result.dpc.peak}%, ISR peak ${result.isr.peak}%`);
          return { result };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },

      async traceDrivers(seconds: unknown) {
        const s = Number.isInteger(seconds) && (seconds as number) >= 5 && (seconds as number) <= 60 ? (seconds as number) : 15;
        if (!admin) return { error: 'Naming the driver needs a kernel trace, which needs administrator. Relaunch as admin first.' };
        if (!existsSync(XPERF)) return { error: 'The Windows Performance Toolkit is not installed. Install it first (one-time, from Microsoft).' };
        try {
          const drivers = await traceDrivers(adapter, XPERF, s, path.join(safety.dataDir, 'traces'));
          await safety.log('driver-trace', `${s} s`, true, drivers.slice(0, 3).map((d) => `${d.module} ${d.maxUs} us`).join(', '));
          return { drivers };
        } catch (err) {
          await safety.log('driver-trace', `${s} s`, false, (err as Error).message);
          return { error: (err as Error).message };
        }
      },

      toolStatus: async () => ({
        wpt: existsSync(XPERF),
        lhm: existsSync(path.join(toolsDir, 'lhm-0.9.6', 'LibreHardwareMonitorLib.dll')),
        pawnio: await pawnioInstalled(adapter),
        admin,
      }),

      async installWpt() {
        if (existsSync(XPERF)) return { ok: true, message: 'The Windows Performance Toolkit is already installed.' };
        if (live && !admin) return { ok: false, message: 'Installing the toolkit needs administrator.' };
        const winget = wingetPath(env.LOCALAPPDATA!);
        if (!lstatSync(winget, { throwIfNoEntry: false })) return { ok: false, message: 'winget (App Installer) is not installed.' };
        try {
          progress({ task: 'runtimes', done: 0, total: 1, current: 'Windows Performance Toolkit' });
          await adapter.exec(winget, WPT_INSTALL_ARGS, 30 * 60_000);
          await safety.log('install-wpt', 'Microsoft.WindowsADK (Performance Toolkit)', true, live ? undefined : 'dry-run: not installed');
          return { ok: true, message: live ? 'Windows Performance Toolkit installed.' : 'Toolkit install skipped (dry-run).' };
        } catch (err) {
          await safety.log('install-wpt', 'Microsoft.WindowsADK', false, (err as Error).message);
          return { ok: false, message: `Toolkit install failed: ${(err as Error).message}` };
        } finally {
          progress({ task: 'runtimes', done: 1, total: 1, current: '' });
        }
      },

      async setupCpuTemp() {
        try {
          await ensureLhm(adapter, toolsDir); // our app data folder only; hash-checked
          if (!(await pawnioInstalled(adapter))) {
            if (live && !admin) return { ok: false, message: 'Library ready. Installing the PawnIO driver needs administrator.' };
            const winget = wingetPath(env.LOCALAPPDATA!);
            await adapter.exec(winget, PAWNIO_INSTALL_ARGS, 10 * 60_000);
            await safety.log('install-pawnio', 'namazso.PawnIO', true, live ? undefined : 'dry-run: not installed');
          }
          await safety.log('setup-cpu-temp', 'LibreHardwareMonitor 0.9.6', true);
          return { ok: true, message: `CPU temperature is set up${admin ? '' : '; it shows when IcyTweaker runs as administrator'}.` };
        } catch (err) {
          return { ok: false, message: (err as Error).message };
        }
      },

      // ---- Driver backup
      async backupDrivers() {
        if (live && !admin) return { ok: false, message: 'Exporting drivers needs administrator.' };
        try {
          const r = await backupDrivers(adapter, driverBackupRoot);
          await safety.log('driver-backup', r.folder, true, live ? undefined : 'dry-run');
          return { ok: true, message: r.message };
        } catch (err) {
          await safety.log('driver-backup', driverBackupRoot, false, (err as Error).message);
          return { ok: false, message: (err as Error).message };
        }
      },

      driverBackups: () => listDriverBackups(driverBackupRoot),

      async restoreDriverBackup(id: unknown) {
        const b = (await listDriverBackups(driverBackupRoot)).find((x) => x.id === id);
        if (!b) return { ok: false, message: 'Invalid request.' };
        if (live && !admin) return { ok: false, message: 'Reinstalling drivers needs administrator.' };
        return withRestorePoint('Restore driver backup', async () => {
          try {
            const message = await restoreDrivers(adapter, b.folder);
            await safety.log('driver-restore', b.folder, true, message);
            return { ok: true, message };
          } catch (err) {
            await safety.log('driver-restore', b.folder, false, (err as Error).message);
            return { ok: false, message: (err as Error).message };
          }
        });
      },

      async openDriverBackup(id: unknown) {
        const b = (await listDriverBackups(driverBackupRoot)).find((x) => x.id === id);
        if (b) await shell.openPath(b.folder);
      },

      // ---- In-game overlay
      async startOverlay(exe: unknown) {
        const g = gameProfiles.find((x) => typeof exe === 'string' && x.exe.includes(exe));
        if (!g) return { ok: false, message: 'Invalid request.' };
        try {
          await startOverlay(exe as string, g.name);
          return { ok: true, message: `Overlay on for ${g.name}. It shows over borderless or windowed games.` };
        } catch (err) {
          return { ok: false, message: (err as Error).message };
        }
      },

      stopOverlay: () => stopOverlay(),
      overlayStatus: async () => ({ running: overlayFeed.running(), game: overlayFeed.game() }),

      // ---- Froststrap
      froststrap: () => froststrap.info(),

      async setFroststrapFps(fps: unknown) {
        if (fps !== null && !(Number.isInteger(fps) && (fps as number) >= 30 && (fps as number) <= 10_000)) return { ok: false, message: 'FPS cap must be 30 to 10000.' };
        return serial(async () => {
          try {
            const changed = await froststrap.setFps(fps as number | null);
            await safety.log('froststrap-fps', String(fps ?? 'reset'), true, live ? undefined : 'dry-run');
            return {
              ok: true,
              message: fps === null ? (changed ? 'Froststrap FPS flag put back.' : 'Nothing to put back.') : `Froststrap will start Roblox with an FPS cap of ${fps}${live ? '' : ' (dry-run: nothing written)'}.`,
            };
          } catch (err) {
            return { ok: false, message: (err as Error).message };
          }
        });
      },

      async openFroststrap() {
        if (!froststrap.installed()) return { ok: false, message: 'Froststrap is not installed.' };
        const err = await shell.openPath(froststrap.exe);
        return err ? { ok: false, message: err } : { ok: true, message: 'Froststrap opened.' };
      },

      // ---- Updates
      async checkUpdates() {
        const r = await checkUpdates(pkg.version, pkg.updateRepo);
        updateUrl = r.url;
        if (canAutoUpdate && r.newer) {
          // electron-updater needs the release's latest.yml; without it the page link still works.
          const found = await autoUpdater.checkForUpdates().catch(() => null);
          return { ...r, canInstall: !!found?.isUpdateAvailable, downloaded: updateDownloaded };
        }
        return { ...r, canInstall: false, downloaded: updateDownloaded };
      },

      async downloadUpdate() {
        if (!canAutoUpdate) return { ok: false, message: 'Automatic updates work in the installed app with a release repository set.' };
        try {
          await autoUpdater.downloadUpdate();
          await safety.log('update-download', 'IcyTweaker', true);
          return { ok: true, message: 'Update downloaded. Restart to install it.' };
        } catch (err) {
          await safety.log('update-download', 'IcyTweaker', false, (err as Error).message);
          return { ok: false, message: `Update download failed: ${(err as Error).message}` };
        }
      },

      async installUpdate() {
        if (!canAutoUpdate || !updateDownloaded) return;
        await safety.log('update-install', 'IcyTweaker', true);
        await boost.end(); // power plan and priorities back before the app closes
        appQuitting = true;
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
      },

      async openUpdatePage() {
        if (updateUrl) await shell.openExternal(updateUrl);
      },

      // ---- History
      async undoSince(since: unknown) {
        if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) return { ok: false, message: 'Invalid request.' };
        return withRestorePoint('Undo to a point in history', async () => {
          const { count, errors } = await safety.undoSince(since);
          await safety.log('undo-since', since, errors.length === 0, `${count} setting(s)${errors.length ? `; ${errors.join(' | ')}` : ''}`);
          return errors.length ? { ok: false, message: `Put back ${count - errors.length}/${count}. ${errors.join(' | ')}` } : { ok: true, message: `Put back ${count} setting(s)${live ? '' : ' (dry-run)'}.` };
        });
      },

      // ---- Devices
      device: async () => ({ detected: detectedType(), type: deviceType(), onBattery: powerMonitor.isOnBatteryPower(), laptopProfile: settings.app.laptopProfile }),

      ...engine,

      async listApps() {
        try {
          return { apps: await debloater.list() };
        } catch (err) {
          return { apps: [], error: `Could not list apps: ${(err as Error).message}` };
        }
      },

      // Icons for the last app list: the app's own .exe / .ico (Windows' icon), or a Store app's logo. Cached per file.
      async appIcons() {
        const files = await debloater.iconFiles();
        const load = async (file: string) => {
          const img = /\.png$/i.test(file) ? nativeImage.createFromPath(file) : await app.getFileIcon(file, { size: 'normal' }).catch(() => null);
          appIconCache.set(file, img && !img.isEmpty() ? img.resize({ width: 32, height: 32, quality: 'best' }).toDataURL() : null);
        };
        await Promise.all([...new Set([...files.values()])].filter((f): f is string => !!f && !appIconCache.has(f)).map(load));
        return Object.fromEntries([...files].map(([key, file]) => [key, file ? appIconCache.get(file)! : null]));
      },

      async uninstallApps(keys: unknown) {
        const picked = Array.isArray(keys) ? keys.map((k) => debloater.lookup(k)) : [];
        if (picked.length === 0 || picked.some((e) => !e)) return { ok: false, message: 'Invalid request: unknown or protected app.' };
        return withRestorePoint('Uninstall apps', async () => {
          const failures: string[] = [];
          for (const [i, e] of picked.entries()) {
            const { name, kind, version } = e!.item;
            progress({ task: 'uninstall', done: i, total: picked.length, current: name });
            try {
              await debloater.uninstall(e!);
              await safety.log('uninstall', name, true, live ? undefined : 'dry-run: not removed');
              // Saved so removed Store apps can be found and reinstalled later.
              await appendFile(removedFile, JSON.stringify({ ts: new Date().toISOString(), mode: live ? 'live' : 'dry-run', kind, name, version, key: e!.item.key }) + '\n');
            } catch (err) {
              await safety.log('uninstall', name, false, (err as Error).message);
              failures.push(`${name}: ${(err as Error).message}`);
            }
          }
          progress({ task: 'uninstall', done: picked.length, total: picked.length, current: '' });
          const done = picked.length - failures.length;
          const dry = live ? '' : ' (dry-run: nothing was removed)';
          return failures.length
            ? { ok: false, message: `Uninstalled ${done}/${picked.length}${dry}. Failed: ${failures.join(' | ')}` }
            : { ok: true, message: `Uninstalled ${done} app(s)${dry}.` };
        });
      },

      async listRestorePoints() {
        const script =
          "Get-ComputerRestorePoint | Select-Object SequenceNumber, Description, @{n='Created';e={$_.ConvertToDateTime($_.CreationTime).ToString('o')}} | ConvertTo-Json -Compress";
        try {
          const out = (await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 60_000)).trim();
          const raw = out ? JSON.parse(out) : [];
          const list: Array<{ SequenceNumber: number; Description: string; Created: string }> = Array.isArray(raw) ? raw : [raw];
          return { points: list.map((p) => ({ sequence: p.SequenceNumber, description: p.Description, created: p.Created })).reverse() };
        } catch (err) {
          return { points: [], error: `Could not list restore points (needs administrator): ${(err as Error).message}` };
        }
      },

      async openSystemRestore() {
        await safety.log('open-system-restore', 'rstrui.exe', true, live ? undefined : 'dry-run: not opened');
        if (!live) return { ok: true, message: 'System Restore wizard not opened (dry-run).' };
        // The wizard is where the user picks a point and confirms; nothing changes until they do.
        spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rstrui.exe'), [], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, message: 'System Restore opened. Pick a restore point there and confirm.' };
      },

      getHistory: async () => ({ log: await safety.readLog(), changes: safety.changes() }),

      listCleanTargets: () => cleaner.list(),

      async scanCleanTargets(ids: unknown) {
        const list = Array.isArray(ids) ? ids.map((id) => cleaner.get(id)) : [];
        if (list.some((x) => !x)) return [];
        const results = [];
        for (const [i, x] of list.entries()) {
          progress({ task: 'scan', done: i, total: list.length, current: x!.subgroup ? `${x!.subgroup} ${x!.name}` : x!.name });
          results.push(await cleaner.scan(x!));
        }
        progress({ task: 'scan', done: list.length, total: list.length, current: '' });
        const at = new Date().toISOString();
        saveLast({ cleaner: { ...lastScans.cleaner, ...Object.fromEntries(results.map((r) => [r.id, { at, result: r }])) } });
        return results;
      },

      async cleanTargets(ids: unknown, confirmed?: unknown) {
        const list = Array.isArray(ids) ? ids.map((id) => cleaner.get(id)) : [];
        if (list.length === 0 || list.some((x) => !x)) return { report: { ok: false, message: 'Invalid request.' }, results: [] };
        if (list.some((x) => x!.risk === 'risky') && confirmed !== true)
          return { report: { ok: false, message: 'Deleting saved passwords is Risky and needs confirmation.' }, results: [] };
        const procs = await runningProcesses(adapter);
        const results: CleanResult[] = [];
        for (const [i, x] of list.entries()) {
          const label = x!.subgroup ? `${x!.subgroup} ${x!.name}` : x!.name;
          progress({ task: 'clean', done: i, total: list.length, current: label });
          let r: CleanResult;
          if (live && x!.requiresAdmin && !admin) r = { id: x!.id, freed: 0, files: 0, locked: 0, skipped: 'Needs administrator.' };
          else {
            try {
              r = await cleaner.clean(x!, procs);
            } catch (err) {
              r = { id: x!.id, freed: 0, files: 0, locked: 0, skipped: (err as Error).message };
            }
          }
          results.push(r);
          await safety.log('clean', x!.id, !r.skipped, r.skipped ?? `${r.files} file(s), ${r.freed} bytes${r.locked ? `, ${r.locked} in use` : ''}${live ? '' : ' (dry-run: nothing deleted)'}`);
        }
        progress({ task: 'clean', done: list.length, total: list.length, current: '' });
        // Saved scan sizes of cleaned targets: what was left behind (files in use), as of now.
        const at = new Date().toISOString();
        saveLast({
          cleaner: {
            ...lastScans.cleaner,
            ...Object.fromEntries(results.filter((r) => !r.skipped && live).map((r) => [r.id, { at, result: { id: r.id, bytes: Math.max(0, (lastScans.cleaner?.[r.id]?.result.bytes ?? 0) - r.freed), files: r.locked, inaccessible: 0 } }])),
          },
        });
        const freed = results.reduce((a, r) => a + r.freed, 0);
        const skipped = results.filter((r) => r.skipped).length;
        const locked = results.reduce((a, r) => a + r.locked, 0);
        const mb = (freed / 1024 ** 2).toFixed(1);
        return {
          report: {
            ok: skipped === 0,
            message: `${live ? 'Freed' : 'Would free'} ${mb} MB${live ? '' : ' (dry-run: nothing deleted)'}.${locked ? ` ${locked} file(s) in use were left.` : ''}${skipped ? ` ${skipped} item(s) skipped.` : ''}`,
          },
          results,
        };
      },

      analyzeRoots: async () => analyzeRoots,

      async analyze(root: unknown) {
        if (typeof root !== 'string' || !analyzeRoots.includes(root)) return { error: 'Invalid request.' };
        try {
          const view = await analyzer.analyze(root, (done, bytes, current) => progress({ task: 'analyze', done, total: 0, current, bytes }), adapter.isRemoved);
          saveLast({ analyze: { at: new Date().toISOString(), root, view } });
          return view;
        } catch (err) {
          return { error: (err as Error).message };
        }
      },

      async analyzeOpen(p: unknown) {
        if (typeof p !== 'string' || !analyzer.inside(p)) return { error: 'Invalid request.' };
        return analyzer.open(p, adapter.isRemoved).catch((err: Error) => ({ error: err.message }));
      },

      cancelAnalyze: async () => void analyzer.cancel(),

      async revealPath(p: unknown) {
        if (typeof p === 'string' && analyzer.inside(p)) shell.showItemInFolder(p);
      },

      async trashPath(p: unknown) {
        if (typeof p !== 'string' || !analyzer.inside(p)) return { ok: false, message: 'Invalid request.' };
        if (isProtected(p)) return { ok: false, message: 'Files in Windows, Program Files and ProgramData, and system files, are not deleted here.' };
        try {
          await adapter.trash(p);
          await safety.log('trash', p, true, live ? undefined : 'dry-run: not moved');
          return { ok: true, message: `${path.basename(p)} ${live ? 'moved to the Recycle Bin' : 'would be moved to the Recycle Bin (dry-run)'}.` };
        } catch (err) {
          await safety.log('trash', p, false, (err as Error).message);
          return { ok: false, message: `Could not delete ${path.basename(p)}: ${(err as Error).message}` };
        }
      },

      async driveHealth() {
        try {
          return { drives: await driveHealth(adapter) };
        } catch (err) {
          return { drives: [], error: `Could not read drives: ${(err as Error).message}` };
        }
      },

      // ---- Services
      servicesLevel: async () => ({ ...(await services.currentLevel()), xboxInUse: await services.xboxInUse() }),

      async previewServiceLevel(level: unknown) {
        if (!LEVELS.includes(level as ServiceLevel)) throw new Error('Invalid request.');
        return services.preview(level as ServiceLevel);
      },

      async setServiceLevel(level: unknown, confirmed?: unknown) {
        if (!LEVELS.includes(level as ServiceLevel)) return { ok: false, message: 'Invalid request.' };
        const l = level as ServiceLevel;
        if ((l === 'medium' || l === 'extreme') && confirmed !== true) return { ok: false, message: `${l} needs confirmation.` };
        if (live && !admin) return { ok: false, message: 'Changing services needs administrator. Relaunch as admin first.' };
        const label = `Services level: ${l[0].toUpperCase()}${l.slice(1)}`;
        return withRestorePoint(label, async () => {
          const errors = await services.apply(l);
          await safety.log('services-level', l, errors.length === 0, errors.join(' | ') || (live ? undefined : 'dry-run: nothing written'));
          return errors.length
            ? { ok: false, message: `${label}: ${errors.length} service(s) could not be changed. ${errors.join(' | ')}` }
            : { ok: true, message: `${label} applied${live ? '' : ' (dry-run: nothing written to Windows)'}.` };
        });
      },

      async listServices() {
        try {
          const list = await services.list();
          serviceList = new Map(list.map((s) => [s.name.toLowerCase(), s]));
          return { services: list };
        } catch (err) {
          return { services: [], error: `Could not list services: ${(err as Error).message}` };
        }
      },

      async setServiceStartType(name: unknown, type: unknown) {
        const s = typeof name === 'string' ? serviceList.get(name.toLowerCase()) : undefined;
        const types: ServiceStartType[] = ['auto', 'delayed-auto', 'demand', 'disabled'];
        if (!s || !types.includes(type as ServiceStartType)) return { ok: false, message: 'Invalid request.' };
        if (s.perUser) return { ok: false, message: `${s.displayName} is a per-user service; it can't be changed here.` };
        if (s.protected && (type === 'disabled' || type === 'demand')) return { ok: false, message: `${s.displayName}: ${s.protected}` };
        if (live && !admin) return { ok: false, message: 'Changing services needs administrator.' };
        return serial(async () => {
          try {
            await services.setStartType(s.name, type as ServiceStartType);
            await safety.log('service-start-type', s.name, true, `${type}${live ? '' : ' (dry-run)'}`);
            s.startType = type as ServiceStartType;
            return { ok: true, message: `${s.displayName} set to ${type}${live ? '' : ' (dry-run: nothing written to Windows)'}.` };
          } catch (err) {
            await safety.log('service-start-type', s.name, false, (err as Error).message);
            return { ok: false, message: `${s.displayName}: ${(err as Error).message}` };
          }
        });
      },

      async controlService(name: unknown, action: unknown) {
        const s = typeof name === 'string' ? serviceList.get(name.toLowerCase()) : undefined;
        if (!s || (action !== 'start' && action !== 'stop')) return { ok: false, message: 'Invalid request.' };
        if (action === 'stop' && s.protected) return { ok: false, message: `${s.displayName}: ${s.protected}` };
        try {
          await services.control(s.name, action);
          await safety.log(`service-${action}`, s.name, true, live ? undefined : 'dry-run: not run');
          return { ok: true, message: `${s.displayName} ${action === 'start' ? 'started' : 'stopped'}${live ? '' : ' (dry-run: nothing run)'}.` };
        } catch (err) {
          await safety.log(`service-${action}`, s.name, false, (err as Error).message);
          return { ok: false, message: `${s.displayName}: ${(err as Error).message}` };
        }
      },

      // ---- Networking
      async networkInfo() {
        try {
          adapterList = await listAdapters(adapter, safety);
          return { adapters: adapterList, presets: DNS_PRESETS };
        } catch (err) {
          return { adapters: [], presets: DNS_PRESETS, error: `Could not read network adapters: ${(err as Error).message}` };
        }
      },

      async setDns(guid: unknown, presetId: unknown) {
        const preset = DNS_PRESETS.find((p) => p.id === presetId);
        const a = adapterList.find((x) => x.guid === guid);
        if (!preset || !a) return { ok: false, message: 'Invalid request.' };
        if (live && !admin) return { ok: false, message: 'Changing DNS needs administrator.' };
        return serial(async () => {
          try {
            await safety.set({ kind: 'dns', guid: a.guid }, preset.servers);
            await safety.log('dns', a.name, true, `${preset.name}${live ? '' : ' (dry-run)'}`);
            return { ok: true, message: `${a.name} now uses ${preset.name} DNS${live ? '' : ' (dry-run: nothing written to Windows)'}.` };
          } catch (err) {
            await safety.log('dns', a.name, false, (err as Error).message);
            return { ok: false, message: `DNS: ${(err as Error).message}` };
          }
        });
      },

      getHosts: async () => ({ content: (await safety.read({ kind: 'hosts' })) as string | null }),

      async saveHosts(content: unknown) {
        if (typeof content !== 'string' || content.length > 4 * 1024 * 1024) return { report: { ok: false, message: 'Invalid request.' }, errors: [] };
        const errors = validateHosts(content);
        if (errors.length) return { report: { ok: false, message: `Not saved: ${errors.length} line(s) have errors.` }, errors };
        if (live && !admin) return { report: { ok: false, message: 'Saving the hosts file needs administrator.' }, errors: [] };
        const report = await serial(async () => {
          try {
            await safety.set({ kind: 'hosts' }, content); // the original is backed up before the first save
            await safety.log('hosts', 'hosts file', true, live ? undefined : 'dry-run: not written');
            return { ok: true, message: `Hosts file saved${live ? '' : ' (dry-run: nothing written)'}. The original is in the backup; Undo All restores it.` };
          } catch (err) {
            await safety.log('hosts', 'hosts file', false, (err as Error).message);
            return { ok: false, message: `Hosts file: ${(err as Error).message}` };
          }
        });
        return { report, errors: [] };
      },

      // ---- Resources
      async runSystemCheck() {
        if (live && !admin) return { report: { ok: false, message: 'The system check needs administrator.' }, steps: [] };
        const steps = await runSystemCheck(adapter, (i, step, line) => progress({ task: 'system-check', done: i, total: 3, current: line ? `${step.name}: ${line}` : step.name }));
        progress({ task: 'system-check', done: 3, total: 3, current: '' });
        for (const s of steps) await safety.log('system-check', s.id, s.ok, s.summary);
        const ok = steps.every((s) => s.ok);
        return { report: { ok, message: live ? (ok ? 'System check finished.' : 'System check found problems; see each step.') : 'System check not run (dry-run).' }, steps };
      },

      shortcuts: async () => SHORTCUTS.map(({ open, ...view }) => view),

      async openShortcut(id: unknown) {
        const s = SHORTCUTS.find((x) => x.id === id);
        if (!s) return { ok: false, message: 'Invalid request.' };
        if ('firmware' in s.open) {
          const { response } = await dialog.showMessageBox({
            type: 'question',
            title: 'Restart to BIOS / UEFI',
            message: live ? 'Restart into firmware settings now?' : 'Restart into firmware settings now? (dry-run: nothing will restart)',
            detail: 'Save your work first. The PC restarts 5 seconds after you confirm.',
            buttons: ['Restart', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
          });
          if (response !== 0) return { ok: false, message: 'Cancelled.' };
          try {
            await adapter.exec(SHUTDOWN_EXE, ['/r', '/fw', '/t', '5']);
            await safety.log('restart-firmware', 'windows', true, live ? undefined : 'dry-run: not restarted');
            return { ok: true, message: live ? 'Restarting to firmware settings in 5 seconds…' : 'Restart skipped (dry-run).' };
          } catch (err) {
            await safety.log('restart-firmware', 'windows', false, (err as Error).message);
            return { ok: false, message: `Could not restart to firmware: ${(err as Error).message}` };
          }
        }
        // Opening a Windows tool changes nothing by itself.
        if ('url' in s.open) await shell.openExternal(s.open.url);
        else if (s.open.args) spawn(s.open.exe, s.open.args, { detached: true, stdio: 'ignore' }).unref();
        else {
          const err = await shell.openPath(s.open.exe);
          if (err) return { ok: false, message: `${s.name}: ${err}` };
        }
        return { ok: true, message: `${s.name} opened.` };
      },

      // ---- Advanced / BIOS audit (read-only)
      async hardware(refresh?: unknown) {
        if (refresh === true || !hwCache) hwCache = await detectHardware(adapter, sysRoot).catch(() => null);
        if (!hwCache) return { hw: null, audit: [], guide: { brand: 'Any board', steps: GENERIC_GUIDE }, error: 'Could not read hardware information.' };
        const g = BIOS_GUIDES.find((x) => x.brand.test(hwCache!.hw.boardMaker) || x.brand.test(hwCache!.hw.maker));
        return { hw: hwCache.hw, audit: auditBios(hwCache.hw, hwCache.rebar), guide: g ? { brand: g.name, steps: [...g.steps, ...GENERIC_GUIDE.slice(-1)] } : { brand: 'Any board', steps: GENERIC_GUIDE } };
      },

      // ---- Driver reinstall (NVIDIA) and frametime capture: the approved downloads
      async driverInfo() {
        return { info: await driverInfo(hwCache?.hw ?? null), job: await driverJob.status() };
      },

      async beginDriverJob(confirmed?: unknown) {
        if (confirmed !== true) return { report: { ok: false, message: 'Driver reinstall needs confirmation.' }, job: null };
        if (live && !admin) return { report: { ok: false, message: 'Driver reinstall needs administrator. Relaunch as admin first.' }, job: null };
        const current = await driverJob.status();
        if (current && current.step !== 'done' && current.step !== 'failed') return { report: { ok: false, message: 'A driver job is already in progress.' }, job: current };
        const info = await driverInfo(hwCache?.hw ?? null);
        if (!info.latest || !info.gpu) return { report: { ok: false, message: info.error ?? 'No driver to install.' }, job: null };
        let job: DriverJobView | null = null;
        const report = await withRestorePoint('Driver reinstall', async () => {
          job = await driverJob.begin(info.latest!, info.gpu!);
          return job.step === 'failed' ? { ok: false, message: job.message } : { ok: true, message: job.message };
        });
        return { report, job };
      },

      async resumeDriverJob() {
        if (live && !admin) return { report: { ok: false, message: 'Installing the driver needs administrator. Relaunch as admin first.' }, job: await driverJob.status() };
        const job = await serial(async () => {
          const j = await driverJob.resume();
          return { ok: j?.step === 'done', message: j?.message ?? 'No driver job.' };
        });
        return { report: job, job: await driverJob.status() };
      },

      clearDriverJob: () => driverJob.clear(),
      driverJob: () => driverJob.status(),

      async frametimeTargets() {
        const procs = await runningProcesses(adapter);
        return boostGames.flatMap((g) => g.exe.filter((e) => procs.has(e)).map((exe) => ({ name: g.name, exe })));
      },

      async captureFrametimes(exe: unknown, seconds: unknown) {
        if (typeof exe !== 'string' || !boostGames.some((g) => g.exe.includes(exe))) return { error: 'Invalid request.' };
        if (!Number.isInteger(seconds) || (seconds as number) < 5 || (seconds as number) > 120) return { error: 'Capture length must be 5 to 120 seconds.' };
        if (!admin) return { error: 'Frametime capture needs administrator (Windows event tracing). Relaunch as admin first.' };
        try {
          progress({ task: 'frametime', done: 0, total: seconds as number, current: 'Getting PresentMon…' });
          const pm = await ensurePresentMon(adapter, path.join(app.getPath('userData'), 'tools'));
          progress({ task: 'frametime', done: 0, total: seconds as number, current: `Recording ${exe}…` });
          const csv = path.join(app.getPath('userData'), 'captures', `${exe}-${Date.now()}.csv`);
          await mkdir(path.dirname(csv), { recursive: true });
          const result = await captureFrametimes(adapter, pm, exe, seconds as number, csv);
          await safety.log('frametime-capture', exe, true, `${result.avgFps} FPS avg, ${result.low1} 1% low`);
          // Before / after: keep the last capture per game and hand back the previous one.
          const history = await readFile(captureHistory, 'utf8').then((s) => JSON.parse(s) as Record<string, FrametimeResult & { at: string }>, () => ({}) as Record<string, FrametimeResult & { at: string }>);
          const previous = history[exe];
          history[exe] = { ...result, points: [], at: new Date().toISOString() };
          await writeFile(captureHistory, JSON.stringify(history, null, 2));
          return { result, previous };
        } catch (err) {
          await safety.log('frametime-capture', exe, false, (err as Error).message);
          return { error: (err as Error).message };
        } finally {
          progress({ task: 'frametime', done: 0, total: 0, current: '' });
        }
      },

      async windowControl(action: unknown) {
        const win = mainWindow();
        if (!win) return;
        if (action === 'minimize') win.minimize();
        else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
        else if (action === 'close') win.close();
      },

      // ---- Game Boost
      powerPlans: async () => parsePlans(await adapter.query(path.join(sysRoot, 'System32', 'powercfg.exe'), ['/list']).catch(() => '')),

      getBoost: async () => boost.state(),

      async setBoost(next: unknown) {
        const n = validateBoost(next, boostGames.map((g) => g.id));
        if (!n) return boost.state();
        settings = { ...settings, boost: n };
        await saveSettings();
        void boost.set(settings.boost); // starting or ending a session can take seconds: don't hold up the page
        await safety.log('boost-settings', n.enabled ? 'on' : 'off', true);
        return boost.state();
      },

      // ---- Settings, export / import
      getSettings: async () => settings.app,

      async setSettings(next: unknown) {
        const n = next as Partial<AppSettings> | null;
        const bools = ['tray', 'notify', 'startWithWindows', 'weeklyClean', 'laptopProfile', 'overlayWithBoost'];
        if (!n || bools.some((k) => typeof (n as Record<string, unknown>)[k] !== 'boolean') || !['auto', 'desktop', 'laptop'].includes(n.deviceType as string)) return settings.app;
        if (n.startWithWindows !== settings.app.startWithWindows) {
          // An elevated sign-in task: Windows won't start an always-administrator app from the Run key. An app
          // setting, so not part of Undo All. Also removes the Run entry earlier versions used.
          if (live && !admin) return settings.app; // creating an elevated task needs administrator
          const cmd = app.isPackaged ? `"${process.execPath}" --tray` : `"${process.execPath}" "${app.getAppPath()}" --tray`;
          await setLogonTask(adapter, START_TASK, n.startWithWindows ? cmd : null);
          await adapter.write({ kind: 'reg', hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', name: 'IcyCleaner' }, null);
        }
        settings = {
          ...settings,
          app: {
            ...settings.app,
            tray: n.tray!,
            notify: n.notify!,
            startWithWindows: n.startWithWindows!,
            weeklyClean: n.weeklyClean!,
            deviceType: n.deviceType!,
            laptopProfile: n.laptopProfile!,
            overlayWithBoost: n.overlayWithBoost!,
            // Newer settings: kept as they were when an older page leaves them out.
            hotkeys: typeof n.hotkeys === 'boolean' ? n.hotkeys : settings.app.hotkeys,
            autoUpdate: typeof n.autoUpdate === 'boolean' ? n.autoUpdate : settings.app.autoUpdate,
            theme: n.theme === 'light' || n.theme === 'dark' ? n.theme : settings.app.theme,
            accent: ACCENTS.includes(n.accent as Accent) ? n.accent! : settings.app.accent,
          },
        };
        engineHw.laptop = deviceType() === 'laptop';
        await saveSettings();
        registerHotkeys();
        if (canAutoUpdate) applyAutoUpdate();
        await applyPowerSource().catch(() => {});
        await safety.log('settings', 'app', true, JSON.stringify(settings.app));
        return settings.app;
      },

      async exportConfig() {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export IcyTweaker settings',
          defaultPath: path.join(app.getPath('documents'), `icytweaker-settings-${new Date().toISOString().slice(0, 10)}.json`),
          filters: [{ name: 'IcyTweaker settings', extensions: ['json'] }],
        });
        if (canceled || !filePath) return { ok: false, message: 'Export cancelled.' };
        const cfg = buildConfig((await engine.getState()).tweaks, Number(os.release().split('.')[2]) || 0, settings.boost);
        await writeFile(filePath, JSON.stringify(cfg, null, 2));
        return { ok: true, message: `Exported ${cfg.tweaks.length} applied tweak(s) to ${filePath}.` };
      },

      async copyShareCode() {
        const cfg = buildConfig((await engine.getState()).tweaks, Number(os.release().split('.')[2]) || 0, settings.boost);
        await clipboard.writeText(toShareCode(cfg));
        return { ok: true, message: `Share code for ${cfg.tweaks.length} applied tweak(s) copied. Paste it to a friend; they use "Import from clipboard".` };
      },

      async readConfig(fromClipboard?: unknown) {
        let file = 'a share code';
        let text: string;
        try {
          if (fromClipboard === true) text = fromShareCode(await clipboard.readText());
          else {
            const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Import IcyTweaker settings', properties: ['openFile'], filters: [{ name: 'IcyTweaker settings', extensions: ['json'] }] });
            if (canceled || !filePaths[0]) return { error: 'Import cancelled.' };
            file = filePaths[0];
            text = await readFile(file, 'utf8');
          }
          const known = (await engine.getState()).tweaks;
          const { config, skipped } = parseConfig(text, known);
          pendingConfig = config;
          return {
            summary: {
              file,
              exportedAt: config.exportedAt,
              tweaks: config.tweaks.map((t) => ({ ...t, name: known.find((k) => k.id === t.id)!.name, risk: known.find((k) => k.id === t.id)!.risk })),
              skipped,
              boost: !!config.boost,
            },
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },

      async applyConfig(confirmed?: unknown) {
        if (!pendingConfig) return { ok: false, message: 'Pick a settings file first.' };
        const cfg = pendingConfig;
        const report = await engine.applyList(cfg.tweaks, 'Import settings', confirmed === true);
        const importedBoost = cfg.boost ? validateBoost({ ...DEFAULT_BOOST, ...cfg.boost }, gameProfiles.map((g) => g.id)) : null;
        if (report.ok && importedBoost) {
          settings = { ...settings, boost: importedBoost };
          await saveSettings();
          await boost.set(settings.boost);
          updateTray();
        }
        if (report.ok) pendingConfig = null;
        return report;
      },

      // ---- Boot analysis and monitors (read-only)
      async bootInfo() {
        try {
          return { info: await bootInfo(adapter, admin) };
        } catch (err) {
          return { error: `Could not read boot times: ${(err as Error).message}` };
        }
      },

      monitors: () => monitors(adapter).catch(() => []),
      displayModes: () => displayModes(adapter).catch(() => []),

      // Home checkups (read-only): total shader cache size (Cleaner's own targets) and each GPU driver's date.
      async checkups() {
        const ids = ['nvidia-shaders', 'amd-shaders', 'intel-shaders', 'directx-shader-cache', 'steam-shaders'];
        const scans = await Promise.all(ids.map((id) => cleaner.get(id)).filter((x) => !!x).map((x) => cleaner.scan(x!)));
        return {
          shaderBytes: scans.reduce((a, s) => a + s.bytes, 0),
          shaderIds: scans.filter((s) => s.bytes > 0).map((s) => s.id),
          gpus: (hwCache?.hw.gpus ?? []).filter((g) => g.vendor !== 'other').map((g) => ({ name: g.name, vendor: g.vendor, driverDate: g.driverDate ?? null })),
        };
      },

      // ---- Duplicate Finder and Old Files (read-only scans; deletes go to the Recycle Bin)
      findRoots: async () => analyzeRoots,
      lastScans: async () => lastScans,

      async findDuplicates(root: unknown) {
        if (typeof root !== 'string' || !analyzeRoots.includes(root)) return { groups: [], error: 'Invalid request.' };
        findCancelled = false;
        try {
          const groups = await findDuplicates(root, {
            skip: (p) => isProtected(p) || keptOut(p) || !!adapter.isRemoved?.(p),
            cancelled: () => findCancelled,
            onProgress: (done, current) => progress({ task: 'find', done, total: 0, current }),
          });
          saveLast({ duplicates: { at: new Date().toISOString(), root, groups } });
          refreshFound();
          return { groups };
        } catch (err) {
          return { groups: [], error: (err as Error).message };
        } finally {
          progress({ task: 'find', done: 0, total: 0, current: '' });
        }
      },

      async findOldFiles(root: unknown, days: unknown) {
        if (typeof root !== 'string' || !analyzeRoots.includes(root) || !Number.isInteger(days) || (days as number) < 30) return { files: [], error: 'Invalid request.' };
        findCancelled = false;
        try {
          const files = await findOldFiles(root, { days: days as number, skip: (p) => isProtected(p) || keptOut(p) || !!adapter.isRemoved?.(p), cancelled: () => findCancelled });
          saveLast({ oldfiles: { at: new Date().toISOString(), root, days: days as number, files } });
          refreshFound();
          return { files };
        } catch (err) {
          return { files: [], error: (err as Error).message };
        }
      },

      cancelFind: async () => void (findCancelled = true),

      async trashFound(paths: unknown) {
        const list = Array.isArray(paths) ? paths : [];
        if (list.length === 0 || list.some((p) => typeof p !== 'string' || !foundPaths.has(path.resolve(p).toLowerCase()) || isProtected(p) || keptOut(p))) return { ok: false, message: 'Invalid request.' };
        const failed: string[] = [];
        for (const p of list as string[]) {
          try {
            await adapter.trash(p);
            await safety.log('trash', p, true, live ? undefined : 'dry-run: not moved');
          } catch (err) {
            failed.push(`${path.basename(p)}: ${(err as Error).message}`);
            await safety.log('trash', p, false, (err as Error).message);
          }
        }
        const done = list.length - failed.length;
        return failed.length
          ? { ok: false, message: `${done} moved to the Recycle Bin. Failed: ${failed.join(' | ')}` }
          : { ok: true, message: `${done} file(s) ${live ? 'moved to the Recycle Bin' : 'would be moved to the Recycle Bin (dry-run)'}.` };
      },

      // ---- Privacy traces
      privacyTraces: () => privacy.list(),

      async clearPrivacy(ids: unknown) {
        const list = Array.isArray(ids) ? ids.filter((x): x is string => PRIVACY_TRACES.some((t) => t.id === x)) : [];
        if (list.length === 0) return { ok: false, message: 'Invalid request.' };
        return serial(async () => {
          try {
            const n = await privacy.clear(list);
            await safety.log('privacy-clear', list.join(', '), true, `${n} entr(ies)${live ? '' : ' (dry-run)'}`);
            return { ok: true, message: `Cleared ${n} entr(ies)${live ? '' : ' (dry-run: nothing deleted)'}. Undo All (registry lists) and Privacy backups (recent items) bring them back.` };
          } catch (err) {
            return { ok: false, message: `Privacy traces: ${(err as Error).message}` };
          }
        });
      },

      privacySnapshots: () => privacy.snapshots(),

      async restorePrivacy(id: unknown) {
        if (typeof id !== 'string' || !(await privacy.snapshots()).some((s) => s.id === id)) return { ok: false, message: 'Invalid request.' };
        const n = await privacy.restore(id);
        await safety.log('privacy-restore', id, true, `${n} file(s)${live ? '' : ' (dry-run)'}`);
        return { ok: true, message: `Restored ${n} recent item(s)${live ? '' : ' (dry-run: nothing copied)'}.` };
      },

      async deletePrivacySnapshot(id: unknown) {
        if (typeof id !== 'string' || !(await privacy.snapshots()).some((s) => s.id === id)) return { ok: false, message: 'Invalid request.' };
        await privacy.deleteSnapshot(id);
        return { ok: true, message: 'Privacy backup deleted.' };
      },

      // ---- Startup manager
      async listStartup() {
        try {
          const items = await startup.list();
          startupIds = new Map(items.map((i) => [i.id, i.requiresAdmin]));
          return { items };
        } catch (err) {
          return { items: [], error: `Could not read startup items: ${(err as Error).message}` };
        }
      },

      async setStartupItem(id: unknown, enabled: unknown) {
        if (typeof id !== 'string' || !startupIds.has(id) || typeof enabled !== 'boolean') return { ok: false, message: 'Invalid request.' };
        if (live && startupIds.get(id) && !admin) return { ok: false, message: 'This item is set for all users; changing it needs administrator.' };
        const name = id.split('|').slice(1).join('|');
        return serial(async () => {
          try {
            await startup.setEnabled(id, enabled);
            await safety.log('startup-item', name, true, `${enabled ? 'enabled' : 'disabled'}${live ? '' : ' (dry-run)'}`);
            return { ok: true, message: `${name} ${enabled ? 'will start' : 'no longer starts'} with Windows${live ? '' : ' (dry-run: nothing written)'}.` };
          } catch (err) {
            await safety.log('startup-item', name, false, (err as Error).message);
            return { ok: false, message: `${name}: ${(err as Error).message}` };
          }
        });
      },

      // ---- Runtime installer (winget downloads from Microsoft)
      runtimes: async () => RUNTIMES,

      async installRuntimes(ids: unknown) {
        const list = Array.isArray(ids) ? [...new Set(ids)] : [];
        if (list.length === 0 || list.some((id) => !RUNTIMES.some((r) => r.id === id))) return { report: { ok: false, message: 'Invalid request.' }, results: [] };
        const winget = wingetPath(env.LOCALAPPDATA!);
        // winget is an app execution alias (a reparse point stat can't follow), so lstat, not existsSync.
        if (!lstatSync(winget, { throwIfNoEntry: false })) return { report: { ok: false, message: 'winget (App Installer) is not installed. Get "App Installer" from the Microsoft Store first.' }, results: [] };
        let results: Awaited<ReturnType<typeof installRuntimes>> = [];
        const report = await withRestorePoint('Install runtimes', async () => {
          results = await installRuntimes(adapter, winget, list as string[], (i, name) => progress({ task: 'runtimes', done: i, total: list.length, current: name }));
          progress({ task: 'runtimes', done: list.length, total: list.length, current: '' });
          for (const r of results) await safety.log('runtime', r.id, r.ok, r.summary);
          const failed = results.filter((r) => !r.ok).length;
          if (!live) return { ok: true, message: `${list.length} runtime(s) not installed (dry-run: nothing downloaded).` };
          return failed ? { ok: false, message: `${failed} of ${list.length} runtime(s) failed; see each one.` } : { ok: true, message: `${list.length} runtime(s) installed or already up to date.` };
        });
        return { report, results };
      },

      // ---- Network tests (the app's only network calls; user-started)
      async latencyTest(host: unknown) {
        if (host !== undefined && (typeof host !== 'string' || !validHost(host.trim()))) return { results: [], error: 'Enter a host name or IPv4 address.' };
        if (netTestRunning) return { results: [], error: 'A network test is already running.' };
        netTestRunning = true;
        try {
          const targets = host ? [{ host: (host as string).trim(), name: (host as string).trim() }] : LATENCY_TARGETS;
          const results = await latencyTest(targets);
          await safety.log('latency-test', targets.map((t) => t.host).join(', '), true);
          return { results };
        } catch (err) {
          return { results: [], error: (err as Error).message };
        } finally {
          netTestRunning = false;
        }
      },

      async dnsBenchmark() {
        if (netTestRunning) return { results: [], error: 'A network test is already running.' };
        netTestRunning = true;
        try {
          const servers = DNS_PRESETS.filter((p) => p.servers !== 'dhcp').map((p) => ({ id: p.id, name: p.name, ip: p.servers.split(',')[0] }));
          const results = await dnsBenchmark(servers);
          await safety.log('dns-benchmark', servers.map((s) => s.ip).join(', '), true, results[0] ? `fastest: ${results[0].name}` : undefined);
          return { results };
        } catch (err) {
          return { results: [], error: (err as Error).message };
        } finally {
          netTestRunning = false;
        }
      },

      // ---- Games
      listGames: () => games.list(),

      // Icons come from each installed game's own .exe (never bundled: publisher logos are theirs). Cached per run.
      async gameIcons() {
        const out: Record<string, string | null> = {};
        for (const g of gameProfiles) {
          if (!iconCache.has(g.id)) {
            const exe = await findGameExe(g, gameEnv).catch(() => null);
            if (exe && g.shellIcon) {
              // Windows' own extractor (read-only query); Electron returns the generic icon for these exes.
              const q = `'${exe.replace(/'/g, "''")}'`;
              const script = `Add-Type -AssemblyName System.Drawing; $m = New-Object IO.MemoryStream; [System.Drawing.Icon]::ExtractAssociatedIcon(${q}).ToBitmap().Save($m, [System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())`;
              const b64 = (await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], 30_000).catch(() => '')).trim();
              iconCache.set(g.id, /^[A-Za-z0-9+/=]{100,}$/.test(b64) ? `data:image/png;base64,${b64}` : null);
            } else {
              const img = exe ? await app.getFileIcon(exe, { size: 'large' }).catch(() => null) : null;
              iconCache.set(g.id, img && !img.isEmpty() ? img.toDataURL() : null);
            }
          }
          out[g.id] = iconCache.get(g.id)!;
        }
        return out;
      },

      // Starting a game changes no settings, so it works the same in dry-run. Only targets built by launchTarget are opened.
      async launchGame(id: unknown) {
        const p = gameProfiles.find((g) => g.id === id);
        if (!p) return { ok: false, message: 'Invalid request.' };
        if ((await games.list()).find((g) => g.id === p.id)?.running) return { ok: false, message: `${p.name} is already running.` };
        const t = await launchTarget(p, gameEnv).catch(() => null);
        if (!t) return { ok: false, message: `${p.name} isn't installed.` };
        try {
          if ('url' in t) await shell.openExternal(t.url);
          else if (admin) {
            // The installed app runs as administrator, and a launcher started from it would be too. An elevated Riot
            // Client can't hand the launch to the one already running (different integrity level), so only the client
            // window shows. Instead: a shortcut (same target and arguments as Riot's own Start menu one) opened by
            // Explorer, which starts it in the normal, unelevated desktop session, exactly like a double-click.
            const lnk = path.join(safety.dataDir, 'launch', `${p.id}.lnk`);
            await mkdir(path.dirname(lnk), { recursive: true });
            const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
            const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)}); $s.TargetPath = ${q(t.exe)}; $s.Arguments = ${q(t.args.join(' '))}; $s.WorkingDirectory = ${q(path.dirname(t.exe))}; $s.Save()`;
            await new Promise<void>((resolve, reject) =>
              spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true })
                .on('error', reject)
                .on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Could not prepare the game shortcut.')))),
            );
            spawn(path.join(sysRoot, 'explorer.exe'), [lnk], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
          } else spawn(t.exe, t.args, { detached: true, stdio: 'ignore', cwd: path.dirname(t.exe) }).on('error', () => {}).unref();
          await safety.log('game-launch', p.id, true, 'url' in t ? t.url : t.exe);
          return { ok: true, message: `Starting ${p.name}…` };
        } catch (err) {
          return { ok: false, message: `${p.name}: ${(err as Error).message}` };
        }
      },

      async library(refresh?: unknown) {
        const list = refresh === true || !libraryGames.length ? await refreshLibrary() : libraryGames;
        return list.filter((g) => !profiled(g)).map(({ launch: _l, ...g }) => g);
      },

      async libraryIcons() {
        const out: Record<string, string | null> = {};
        await Promise.all(
          libraryGames.map(async (g) => {
            if (!iconCache.has(g.id)) {
              const img = await app.getFileIcon(g.exe, { size: 'large' }).catch(() => null);
              iconCache.set(g.id, img && !img.isEmpty() ? img.toDataURL() : null);
            }
            out[g.id] = iconCache.get(g.id)!;
          }),
        );
        return out;
      },

      /** A Steam library game's wide header art, from Steam's own local cache (no download). null = none. */
      async libraryArt(id: unknown) {
        const appid = /^steam-(\d+)$/.exec(String(id))?.[1];
        if (!appid || !libraryGames.some((g) => g.id === id)) return null;
        const dir = path.join(cleanerEnv.steamPath, 'appcache', 'librarycache', appid);
        const pick = async (d: string, depth: number): Promise<string | null> => {
          const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
          const hit = entries.find((e) => e.isFile() && /^(library_)?header\.jpg$/i.test(e.name));
          if (hit) return path.join(d, hit.name);
          if (depth === 0) return null;
          for (const e of entries) if (e.isDirectory()) {
            const found = await pick(path.join(d, e.name), depth - 1);
            if (found) return found;
          }
          return null;
        };
        const file = await pick(dir, 1);
        return file ? `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}` : null;
      },

      async launchLibraryGame(id: unknown) {
        const g = libraryGames.find((x) => x.id === id);
        if (!g) return { ok: false, message: 'Invalid request.' };
        if ((await runningProcesses(adapter)).has(exeName(g.exe))) return { ok: false, message: `${g.name} is already running.` };
        await shell.openExternal('url' in g.launch ? g.launch.url : g.exe); // launch URLs are built by scanLibrary only
        await safety.log('game-launch', g.id, true, 'url' in g.launch ? g.launch.url : g.exe);
        return { ok: true, message: `Starting ${g.name}…` };
      },

      async getWinSettings(target: unknown) {
        const exe = await exeFor(target);
        if (!exe) return { error: 'Game not installed.' };
        return { exe, settings: await readWinSettings(safety, exe) };
      },

      async setWinSettings(target: unknown, next: unknown) {
        const want = validateWinSettings(next);
        const exe = await exeFor(target);
        if (!want || !exe) return { ok: false, message: 'Invalid request.' };
        if (live && !admin) return { ok: false, message: 'Needs administrator (CPU priority is a machine-wide setting).' };
        return serial(async () => {
          try {
            const changed = await applyWinSettings(safety, exe, want);
            await safety.log('game-windows-settings', exe, true, changed.join(', ') || 'no change');
            return { ok: true, message: changed.length ? `Saved: ${changed.join(', ')}. Takes effect the next time the game starts.` : 'Nothing to change.' };
          } catch (err) {
            await safety.log('game-windows-settings', exe, false, (err as Error).message);
            return { ok: false, message: (err as Error).message };
          }
        });
      },

      async resetWinSettings(target: unknown) {
        const exe = await exeFor(target);
        if (!exe) return { ok: false, message: 'Invalid request.' };
        return serial(async () => {
          await resetWinSettings(safety, exe);
          await safety.log('game-windows-settings-reset', exe, true);
          return { ok: true, message: 'Windows settings for this game put back.' };
        });
      },

      sessions: () => sessions.history(),

      async memoryStatus() {
        try {
          return await memoryLists(adapter);
        } catch (err) {
          return { error: (err as Error).message };
        }
      },

      async purgeStandby() {
        if (live && !admin) return { ok: false, message: 'Needs administrator: relaunch IcyTweaker as admin.' };
        try {
          await purgeStandby(adapter);
          await safety.log('standby-purge', 'manual', true, live ? undefined : 'dry-run');
          return { ok: true, message: live ? 'Standby memory freed.' : 'Standby memory purge skipped (dry-run).' };
        } catch (err) {
          return { ok: false, message: /Needs administrator/.test((err as Error).message) ? 'Needs administrator.' : 'Could not free standby memory.' };
        }
      },

      windowsUpdateInfo: async () => windowsUpdate,

      async applyGameProfile(id: unknown, values: unknown) {
        const p = gameProfiles.find((g) => g.id === id);
        const invalid = p ? validateValues(p, values) : 'Invalid request.';
        if (!p || invalid) return { ok: false, message: invalid ?? 'Invalid request.' };
        return serial(async () => {
          try {
            const r = await games.apply(p, values as GameValues);
            await safety.log('game-profile', p.id, r.ok, r.message);
            return r;
          } catch (err) {
            await safety.log('game-profile', p.id, false, (err as Error).message);
            return { ok: false, message: `${p.name}: ${(err as Error).message}` };
          }
        });
      },

      async resetGameProfile(id: unknown) {
        const p = gameProfiles.find((g) => g.id === id);
        if (!p) return { ok: false, message: 'Invalid request.' };
        return serial(async () => {
          try {
            const r = await games.reset(p);
            await safety.log('game-profile-reset', p.id, r.ok, r.message);
            return r;
          } catch (err) {
            await safety.log('game-profile-reset', p.id, false, (err as Error).message);
            return { ok: false, message: `${p.name}: ${(err as Error).message}` };
          }
        });
      },

      async exportLog() {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export action log',
          defaultPath: path.join(app.getPath('documents'), `icytweaker-log-${new Date().toISOString().slice(0, 10)}.jsonl`),
          filters: [{ name: 'JSON lines', extensions: ['jsonl'] }],
        });
        if (canceled || !filePath) return { ok: false, message: 'Export cancelled.' };
        await copyFile(safety.logFile, filePath).catch(async () => writeFile(filePath, ''));
        return { ok: true, message: `Log exported to ${filePath}.` };
      },

      getState: async () => ({ ...(await engine.getState()), onboarded: settings.onboarded }),
      getStats: async () => stats.get(),
      async completeOnboarding() {
        settings = { ...settings, onboarded: true };
        await writeFile(settingsFile, JSON.stringify(settings, null, 2));
      },
      async restart() {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'Restart Windows',
          message: live ? 'Restart Windows now?' : 'Restart Windows now? (dry-run: nothing will actually restart)',
          detail:
            'Save your work first. Windows restarts 5 seconds after you confirm.\n\n' +
            'Create a restore point first? It saves Windows as it is now, so you can return to this point if anything goes wrong after the restart. ' +
            'Changes made by IcyTweaker can always be undone from its own backup (Undo all changes).',
          buttons: ['Create restore point, then restart', 'Restart without one', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
        });
        if (response === 2) return { ok: false, message: 'Restart cancelled.' };
        if (response === 0) {
          const rp = await engine.createRestorePoint('Before restart');
          if (!rp.ok) return { ok: false, message: `${rp.message} Windows was not restarted.` };
        }
        try {
          await safety.restart();
          return { ok: true, message: live ? 'Restarting in 5 seconds…' : 'Restart skipped (dry-run).' };
        } catch (err) {
          return { ok: false, message: `Restart failed: ${(err as Error).message}` };
        }
      },
      async relaunchAsAdmin() {
        app.releaseSingleInstanceLock(); // the elevated copy must be able to take it
        try {
          await relaunchAsAdmin(live, devUrl);
        } catch (err) {
          app.requestSingleInstanceLock();
          return { ok: false, message: `Relaunch cancelled or failed: ${(err as Error).message}` };
        }
        setImmediate(() => app.exit(3)); // 3 tells scripts/dev.mjs to keep the dev server up
        return { ok: true, message: 'Relaunching as administrator…' };
      },
    };
    for (const [channel, fn] of Object.entries(api)) {
      ipcMain.handle(channel, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));
    }
    createWindow(!process.argv.includes('--tray')); // --tray: started at sign-in, stay in the tray
  } catch (err) {
    dialog.showErrorBox('IcyTweaker could not start', String(err));
    app.exit(1);
  }
});

// In tray mode, closing the window frees it completely (renderer and its memory); the tray reopens a fresh one.
app.on('window-all-closed', () => {
  if (appQuitting || !keepInTray()) app.quit();
});
