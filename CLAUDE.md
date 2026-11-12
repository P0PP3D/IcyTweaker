# IcyTweaker (formerly IcyCleaner): rules for every session

Windows 10/11 optimizer for gamers (tweaker + cleaner). Stack is locked: Electron, React, TypeScript, Vite, Tailwind.
Full spec: `docs/SPEC.md`. Work one phase of its "Build order" at a time.

## Hard rules

1. **Every tweak needs a working revert** and an **apply → detect applied → revert → detect original restored** test
   in `electron/tweaks.test.ts` (fake registry via `memoryAdapter()`), including the case where the value was absent before.
2. **Restore point before every bulk change** (Apply All, Revert All, Undo All, presets, anything touching many items).
   If the restore point fails, change nothing.
3. **Dry-run is the default in development.** `npm run dev` / `electron .` is live only with `OPTIMIZER_LIVE=1`.
   Installed (packaged) builds are live by default (user decision); `OPTIMIZER_LIVE=0` forces them to dry-run.
   Never set OPTIMIZER_LIVE=1 yourself, never run a real registry write, service change, powercfg or PowerShell
   write on this machine, and **never start `release/win-unpacked/IcyTweaker.exe` here without OPTIMIZER_LIVE=0**.
   Tests and dev use dry-run or the fake adapter. Stop and ask before enabling live mode.
4. **Every system write goes through `SystemAdapter`** (`electron/system/adapter.ts`), and every tweak writes through the
   safety layer (`ctx.set` / `ctx.restore`), which backs up the original value (or "absent") before the first change.
5. **Never write outside the project folder and the app data folder** (`%APPDATA%\IcyCleaner`). Test temp files go in
   `./.test-tmp/` (gitignored).
6. **Never run, install or build anything inside `./reference`.** It is untrusted third-party code (MIT), read-only, for
   patterns only. Don't copy it verbatim; if you adapt any, add a NOTICE file with its MIT copyright notice. Never
   modify or delete the Krypt zip files.
7. **Do not add features outside the current phase.**
8. Registry paths: exact values only. If unsure, mark `verify` in a code comment and in the report; don't guess.
9. Allowed dependencies: electron, react, react-dom, vite, tailwindcss, typescript, vitest, electron-builder, clsx, plus
   their required plugins and type packages. Ask before adding anything else, before deleting any file, and before
   changing the stack. No telemetry, accounts or network calls, except the user-approved ones: the latency test and
   DNS benchmark (only when the user presses the button), runtime installs through winget, the NVIDIA driver lookup
   and download, DDU through winget, PresentMon from GitHub, the GitHub update check, and the overlay's ping
   (TCP 1.1.1.1:443 every 2 s, only while the overlay is on) (all approved by the user).

## Commands

- `npm run dev`: dev app (dry-run). `npm test`, `npm run typecheck`, `npm run build`: all must pass.

## Layout

- `electron/system/adapter.ts`: all system access. A `SettingRef` is one piece of state (registry value,
  scheduled task, service start type, power setting, power plan, active plan, hibernation, TRIM), read and written
  only here. Dry-run = in-memory overlay on real reads; `exec` (writes) is recorded, `query` (read-only) runs.
  New kinds go here, plus `refId`, and `creatable` if a missing one can't be created.
- `electron/system/safety.ts`: backup.json, restore, undo all, restore point, restart, `actions.jsonl` log.
  Dry-run starts each session with a fresh backup (`resume: false`); live resumes from disk.
- `electron/tweaks/engine.ts`: `tweak()` (any setting kinds), `regTweak`, `regDwordTweak`, fixes runner, the
  runner used by IPC. Risky tweaks/fixes need `confirmed: true`; bulk applies skip Risky.
- `electron/tweaks/fixes.ts`: fixes. Setting changes go in `changes` (backed up). Anything in `script` can't be
  undone from the backup, so the fix must be `permanent: true` (a test enforces it).
- `electron/cleaner/`: `cleaner.ts` clean targets as data (folders to empty, optional file filter, or a
  PowerShell script), `walk.ts` the only filesystem walk (never follows or yields symlinks/junctions),
  `analyzer.ts` Disk Analyzer. Files are deleted only via `adapter.removeFile` (one file, never a link), only
  if this module's own walk found them under the target's root; `unsafeRoot` refuses drive roots and broad
  folders without a single-file filter. Analyzer deletes go to the Recycle Bin (`adapter.trash`).
  Cleaner tests use real files in `./.test-tmp/cleaner` only.
- `electron/services/`: `catalog.ts` service groups (each sub-group is a tweak, `page: 'services'`), each service
  with its Windows default, level and what breaks; `services.ts` levels (preview, apply behind a restore point)
  and the service manager (`CRITICAL` services are never disabled or stopped; per-user instances are read-only).
- `electron/network/network.ts`: network tweaks (`page: 'network'`), DNS presets (setting kind `dns`, backed up),
  reset tools (fixes with `page: 'network'`), hosts check (`validateHosts`; the hosts file is setting kind `hosts`).
  No network calls.
- `electron/resources/resources.ts`: system check (chkdsk scan, SFC, DISM via `adapter.exec`) and shortcuts.
- `electron/games/`: `config.ts` patches one key in ini / kv / cfg / json files (line formats never add keys);
  `profiles.ts` game profiles as data (files, exact keys per option, `checkedVersion`); `games.ts` install and
  config discovery, launch detection (running exe), apply (refuses if the game runs or any key is missing, backs up
  each key as setting kind `configKey` with `owner`, verifies by reading back) and reset. Tests use fixture files
  in `./.test-tmp/games` read via `liveRead`; writes stay in the fake adapter.
- Game artwork IS bundled now (owner's decision, overrides the spec): `src/assets/games/`, sources in
  `Docs/ASSETS.md`. Small exe icons are still read at runtime: `findGameExe` locates the installed exe from the
  profile's `icon` patterns ({steamapp:ID}, {epic:AppName}, {riot:name}, %VAR%, *) and main reads its icon with
  `app.getFileIcon`; not installed = initials tile.
- `electron/apps/apps.ts`: App Optimizer cards (tweaks, `page: 'apps'`). `needsClosed` makes the engine refuse
  while that process runs. File-based cards exist only when the app's settings file does (`AppPaths`).
- `electron/apps/startup.ts`: startup manager. Lists Run keys and startup folders (read-only); on/off only via the
  StartupApproved REG_BINARY flag (low bit of byte 0 = off), backed up. Run entries are never deleted.
- `electron/resources/runtimes.ts`: runtime installer through winget (IDs checked with `winget show`). Dry-run
  records the commands. winget is an app execution alias: check it with `lstat`, not `existsSync`.
- `electron/network/tests.ts`: latency test and DNS benchmark, the app's only network calls (user-started).
  Tests use fake probes; never call the network from tests.
- `electron/advanced/`: `hardware.ts` read-only hardware query, BIOS audit and per-brand BIOS guide (never writes
  firmware); `advanced.ts` Advanced page tweaks (`page: 'advanced'`; MSI mode only for PCI devices whose driver
  has the MessageSignaledInterruptProperties key). Power reads use `powercfg /qh` (shows hidden settings).
- `electron/games/boost.ts`: Game Boost watcher (5 s tick in main while enabled). Power plan via `activeScheme`
  through the safety layer; background app priorities via PowerShell, put back on game exit and before quit.
- `electron/system/uninstall.ts` + `build/installer.nsh`: the uninstaller runs the app with `--restore-defender`,
  which restores only Defender values in the live backup.
- Installer: `npm run dist` (electron-builder, NSIS, per-machine) -> `release/`. Never run the installer on the
  dev PC (it installs to Program Files). The installed app is LIVE (see rule 3).
- `electron/resources/driver.ts`: NVIDIA driver reinstall job (lookup via NVIDIA's service with an exact product
  match, signed download, DDU via winget, RunOnce, resume after restart; state in `driver-job.json`).
  `electron/resources/frametime.ts`: PresentMon (Intel-signed, from GitHub releases) capture and stats.
  `electron/system/download.ts`: the only downloader (host allow-list) and Authenticode check. Never run an
  unsigned or wrongly signed download. Tests never touch the network.
- UI: frameless window, custom title bar (`TitleBar` in `App.tsx`, `windowControl` IPC). Colors are CSS variables in
  `src/index.css` (`--panel`, `--card`, `--line`, `--accent` blue). Icons are our own in `src/icons.tsx`;
  `FeatureCard`, `Tabs`, `CheckList` in `src/ui.tsx`. Accent is blue; rose only for danger.
- Engine extras: `drifted()` / `reapply()` (launch re-check: tweaks the app applied that Windows undid; skips
  adjustable tweaks and the active power plan), `applyList()` (imports), `unfit` from `TweakMeta.hardware`
  (bulk applies skip it), `anticheatWarning` from `TweakMeta.anticheat` + installed anti-cheat services,
  `changedAt` from the backup (`safety.savedAt`).
- `electron/system/`: `configfile.ts` export/import format; `boot.ts` boot timing (admin-only event log);
  `monitors.ts` refresh check (C# via Add-Type, read-only). Setting kind `regKey` = a registry key's existence.
- `electron/cleaner/finder.ts` duplicates (size, 64 KB hash, full hash) and old files; deletes only via
  `trashFound` (paths from the last scan, Recycle Bin). `privacy.ts` traces: registry values cleared through the
  safety layer (backed up); Recent items copied to `privacy-backups/` before removal, restored via
  `adapter.restoreFile` (never overwrites).
- Main: single instance, tray (`public/icon.png` -> `dist/icon.png`), close-to-tray (setting), notifications,
  weekly Health Check timer (idle 10 min), Start with Windows (`HKCU\...\Run\IcyCleaner` = `--tray`).
  App settings live in `settings.json` (`app`, `boost`, `onboarded`), shared by both modes.
- UI kit: `Toggle` (CSS `.toggle`), every checkbox is styled globally in `index.css`, `.slider` for ranges,
  `TweakCard` (General grid, `.tweak-card` glow). General page = card grid; other pages use `TweakRow`.
- Resource use (measured): the GPU reader (PowerShell) only runs while Home asks for stats (stops after 10 s);
  closing to the tray destroys the window (renderer freed); Game Boost polls every 10 s. Keep it that way.
- Single tweak changes make no restore point (owner's decision); "Restart now" offers one first (main `restart`). Bulk changes still need one (rule 2).
- More modules: `system/processes.ts` (Win32_Process; the perf-formatted WMI classes and the "Processor"
  counter set are missing on some PCs, use "Processor Information"), `system/latency.ts` (DPC/ISR counters),
  `system/drivers.ts` (pnputil export/restore; the driver job backs up first), `system/usage.ts` (Prefetch as
  admin, else UserAssist: Debloater "unused 6+ months"), `system/updates.ts` (GitHub release check, package.json
  `updateRepo`, empty = not set up), `games/overlay.ts` + `src/Overlay.tsx` (overlay window loads `#overlay`,
  click-through; `mainWindow()` in main excludes it), `apps/froststrap.ts` (FPS FastFlag in Froststrap's
  `ClientSettings\ClientAppSettings.json`, backed up, refuses while Froststrap runs).
- Game Boost: `perGame` options, `pauseUpdates` (stops wuauserv only if running), `pauseOneDrive`; skips the
  plan switch on battery when the laptop profile is on. Devices page: `deviceType` overrides laptop detection
  (engine `hardware` object is mutated in place).
- Game Boost `planGuid`: a specific plan per game (powercfg /list via `parsePlans`), else the best available.
- Driver naming: `latency.ts` `traceDrivers` (xperf kernel trace, `parseDpcIsr`); toolkit installed via winget
  (`Microsoft.WindowsADK`, WPT feature only). CPU temperature: `system/sensors.ts`, LibreHardwareMonitor 0.9.6
  pinned by SHA-256 (not code-signed) in `%APPDATA%\IcyCleaner\tools`, PawnIO driver via winget; reader runs only
  with the overlay.
- Auto-update: `electron-updater` (a real dependency, external in vite.electron.config.mts, packed by
  electron-builder). Active only in installed builds with package.json `updateRepo` = "owner/name";
  `scripts/dist.mjs` adds the GitHub publish config so release/latest.yml is produced (upload it with the
  installer + .blockmap). Settings "Automatic updates" (default on): checks 30 s after start and every 6 h, downloads in the background, installs on quit. Off = Settings buttons only.
- Installed builds always run as administrator (`build.win.requestedExecutionLevel: requireAdministrator`, a UAC
  prompt at each start). Windows won't start such an app from Run/RunOnce, so "Start with Windows" and the driver
  job's resume use elevated sign-in scheduled tasks (`system/tasks.ts`, `\IcyCleaner\Start`, `\IcyCleaner\DriverJob`).
  Launching `release/win-unpacked/IcyTweaker.exe` on the dev PC now raises a UAC prompt: don't.
- `safety.undoSince(ts)`: restores settings first changed at/after ts (System Restore > Change history).
- Never write TS/regex through shell heredocs: backslashes get eaten. Use the Write/Edit tools.
- Revert without a backup never writes "absent" to a kind that can't be absent (power, task, service): no-op.
- General Apply All / Revert All only touch `page: 'general'` tweaks. Restore Defaults is `'*'`: every page.
- `electron/system/debloat.ts`: app listing (read-only query), protected/vendor/suggested rules, uninstall. Main
  only uninstalls keys from its own last listing, never commands from the renderer.
- `electron/tweaks/general.ts`: tweak data. `electron/tweaks/presets.ts`: presets (lists of tweak ids; Restore Defaults
  must list every tweak, a test enforces it).
- `electron/system/stats.ts`: read-only CPU/RAM (`os`) and GPU (Get-Counter) for the home rings.
- `shared/types.ts`: IPC types. `src/`: React renderer (`App.tsx` shell + sidebar + search, `pages/`, `Onboarding.tsx`, `ui.tsx`).
- `%APPDATA%\IcyCleaner\settings.json`: first-run (onboarding) flag.
- App data: `%APPDATA%\IcyCleaner\dry-run\` and `...\live\` (separate backups and logs per mode).
- Live reads are batched (`adapter.ts`): registry keys asked for in one tick are read by one PowerShell, tasks by
  one `schtasks /Query /XML`, identical read commands share a result for 1.5 s, at most 6 read processes at once.
  `clearReadCache()` runs around every live write and exec. Never go back to one process per value (30 s refreshes).
  The engine's before/after check reads only restart-required tweaks.
- `games/library.ts`: every installed Steam (appmanifest) / Epic (.item) game; `mainExe` guesses the exe (Shipping >
  root folder > largest, skipping tools/editors/servers). Library games without a profile join Game Boost's list,
  get Play and per-game Windows settings. `games/winsettings.ts`: per-exe GPU preference (DirectX
  UserGpuPreferences), compatibility flags (AppCompatFlags Layers; flags we don't manage are kept), CPU priority
  (IFEO PerfOptions CpuPriorityClass), all through the safety layer. `games/session.ts`: Game Boost session
  reports (`sessions.json` in the data dir), fed by the overlay and the boost timer.
- `system/memory.ts`: standby list read/purge (C# via Add-Type, -EncodedCommand; purge is an exec, so dry-run only
  records it). Boost option `purgeStandby`. Setting kind `netAdv` = a network adapter advanced property
  (Get/Set-NetAdapterAdvancedProperty, not creatable); `nicTweaks` per physical adapter.
- Theme: `src/theme.ts` sets `data-theme` / `data-accent` on <html>; index.css remaps Tailwind's palette variables
  (generated from node_modules/tailwindcss/theme.css). Use `var(--ink)` / palette vars, never hard-coded colours.
- Share code (`configfile.ts` `toShareCode`/`fromShareCode`): the export JSON deflated + base64url behind `ICY1.`,
  via the clipboard. Tray: overlay, standby purge, Clean now (`safeClean`, same targets as the weekly check).
- Boost `display` option: primary display mode via `monitors.ts` `setDisplayMode` (ChangeDisplaySettingsEx flags 0 =
  not saved; Reset = registry mode), set at session start, reset at end. Only modes the display lists.
- Stutter log: `session.ts` `isDrop` (FPS < 60 % of the last 30 readings) -> main `recordStutter` (two
  Win32_Process samples 2 s apart, at most once a minute) -> `SessionReport.stutters`.
- Game profiles (owner's pick, 2026-11-12): Fortnite, VALORANT, Deadlock, The Outlast Trials, Dead by Daylight, Roblox.
  Apex, CS2, Marvel Rivals and Minecraft were removed (config format `colon` stays, unused). `shellIcon`: icon via
  System.Drawing ExtractAssociatedIcon (Electron gives Roblox's exe the generic icon). Dead by Daylight's ini is
  Diff=true: quality groups only. Repo: github.com/P0PP3D/IcyTweaker.
- Cleaner safety: `finder.ts` `keptOut` (games, Program Files, AppData, Windows folders on any drive) is skipped by
  Duplicate Finder / Old Files; `cleaner.ts` `isTempDir` (user-temp only cleans a folder named Temp/Tmp).
- Restore point / restart status: `safety.hooks.activity` -> progress task 'restore-point' / 'restart' -> App `Activity`.
  Game launches from the elevated app: a .lnk in the data dir (`launch\<id>.lnk`) opened by explorer.exe, so the game
  starts unelevated like a double-click (an elevated Riot Client only shows itself). Games page polls every 4 s while a
  game runs or is starting (profile unlocks when it closes) and shows the `Launching` card. Spinners/progress always
  animate (no motion-safe): many users have Windows animations off (prefers-reduced-motion).
- Renamed IcyCleaner -> IcyTweaker (productName, UI). Kept on purpose: data folder `%APPDATA%\IcyCleaner` (main pins
  userData to it), appId `app.icycleaner.desktop`, task names `\IcyCleaner\Start|DriverJob`, config kind
  `icycleaner-config`, theme localStorage key. Start task is re-pointed when the exe path changes (`settings.startCmd`).
  Installed exe is now `IcyTweaker.exe` (release/win-unpacked/IcyTweaker.exe: same UAC rule).
- Home `Checkups` (main `checkups`: shader cache total from the Cleaner's own targets, GPU `driverDate` from the
  hardware query). Games page tabs: Profiles / Game Boost & overlay / Performance (sessions + `BeforeAfter` from
  `GameView.optimizedAt`, frametimes, `SensConverter` yaw table). Editor "Competitive setup" = recommended values +
  per-game Boost. Startup items show event-101 slowdowns (`BootInfo.slowApps[].file`). `library.ts` `ALWAYS_ON_TOOL`
  keeps always-running Steam software (docks, wallpapers, scalers) out of the library and Game Boost.
- Last scans: main `last-scans.json` (data dir) keeps the Disk Analyzer overview (not its tree: folders of a saved
  result can't be opened until a new scan), duplicates, old files and cleaner sizes; `foundPaths` (trashable files) is
  rebuilt from it. Pages show `ScanAge` (ui.tsx `ago`). Library games: Steam header art from Steam's local
  `appcache\librarycache` (main `libraryArt`). NVIDIA Control Panel opens via shortcut `nvidia-control-panel`
  (`NVCP_SCRIPT` in fixes.ts, shared with the fix).
- Recycle Bin page lists items via Shell.Application NameSpace(10) (main `recycleItems`, read-only). Preset icons:
  `ICON` map in Presets.tsx.
- Hardware detection (~9 s) is cached in `hardware.json` (userData) and refreshed in the background. Start-up reads
  must run in parallel (sequential awaits defeat the batched reads).
