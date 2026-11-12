# IcyCleaner beta test checklist (Phase 9)

Run the whole list once per test machine. Tick each box; for anything that fails, note the machine, the step, and the
exact message, and attach `%APPDATA%\IcyCleaner\live\actions.jsonl` (or use **System Restore > Export log**).

## Test machines

| # | Windows | Form | GPU | Anti-cheat installed |
| --- | --- | --- | --- | --- |
| A | Windows 10 22H2 (19045) | Desktop | NVIDIA | Vanguard (Valorant) |
| B | Windows 11 current release | Desktop | AMD | Easy Anti-Cheat (Fortnite or Apex) |
| C | Windows 11 current release | Laptop (on battery and plugged in) | NVIDIA or Intel | none |
| D | Windows 11 previous release | Desktop | NVIDIA | Vanguard and Easy Anti-Cheat |

Use VMs with snapshots where you can (A, B), plus at least one real laptop (C): power, battery and GPU features
behave differently in a VM. NVIDIA driver reinstall, MSI mode and Resizable BAR need real hardware.

## 0. Before you start (every machine)

- [ ] Take a VM snapshot, or on real hardware create a restore point and back up anything important.
- [ ] Write down: Windows build (`winver`), GPU and driver version, active power plan (`powercfg /getactivescheme`).
- [ ] Install with `IcyCleaner-Setup-<version>.exe`. SmartScreen warns because the build is unsigned: More info > Run anyway.
- [ ] Installer lets you pick a folder, creates desktop and Start menu shortcuts.
- [ ] Start IcyCleaner. Sidebar footer says **Live mode** (red dot). No "Dry-run" banner.
- [ ] Not admin: yellow banner offers **Relaunch as admin**. Click it, accept UAC; the app comes back with no banner.
- [ ] Onboarding appears on first start only; finishing it doesn't bring it back after a restart of the app.
- [ ] Title bar: minimize, maximize/restore and close work; dragging the bar moves the window; the edges resize it.

## 1. Safety basics (do these first)

- [ ] **System Restore**: Create restore point. It appears in the list (Windows allows one per 24 h; a second one
      the same day shows a note, not an error).
- [ ] Apply any one General tweak, then **Undo all changes** in the sidebar. The tweak shows Not applied again and
      the counter returns to 0.
- [ ] Close and reopen the app: the change count is kept (live backups survive restarts).

## 2. Home

- [ ] CPU, GPU and RAM rings move and match Task Manager within a few percent.
- [ ] GPU ring shows a value (or "n/a" in a VM without GPU counters, not an error).
- [ ] "General tweaks x/y applied" matches the number next to General in the sidebar.

## 3. General tweaks

- [ ] **Apply All**: restore point made first; Risky tweaks are skipped; summary says how many were done.
- [ ] Restart Windows when the reboot banner asks. After restart every applied tweak still shows Applied.
- [ ] **Revert All**: everything returns to Not applied; restart; still reverted.
- [ ] Each category tab (Performance, System, Graphics, Security) lists only its tweaks.
- [ ] Turn on one Risky tweak (e.g. RT Scan Trim): a confirmation appears first; the red banner appears; **Re-Enable
      Defender** clears it.
- [ ] Win32 Priority: pick each Adjust value; Restore Windows default puts back the original.
- [ ] Machine A (Windows 10): tweaks marked "unsupported build" can't be switched; Global Timer Resolution is
      unsupported (Windows 11 only).
- [ ] Spot-check three tweaks in regedit against the values the app shows (e.g. Advertising ID Off ->
      `HKCU\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo\Enabled = 0`).

## 4. Presets

- [ ] Apply the Competitive preset, then **Restore Defaults**: every page's tweaks (General, Services, Networking,
      App Optimizer, Advanced) go back.

## 5. Debloater

- [ ] App list loads (desktop and Store apps); protected apps (Store, drivers, Windows Security) can't be selected.
- [ ] Uninstall one harmless suggested app (e.g. a game demo). Restore point first; the app is gone from Start.
- [ ] An app without a silent uninstaller opens its own uninstall window.

## 6. Fixes

- [ ] Run Flush DNS, Print spooler reset and Search and icon cache rebuild; each reports done.
- [ ] Valorant HVCI fix on machine A or D: Memory Integrity turns on after restart (Windows Security > Device security).
- [ ] **Undo everything** card works the same as the sidebar button.

## 7. Services

- [ ] Level **Minimum**: preview lists the services and what breaks; apply; restart; Windows works normally.
- [ ] Xbox app installed: Xbox services are not in the Minimum list.
- [ ] Level **Medium**: printing and Bluetooth stop (expected); level **Off** brings them back.
- [ ] Level **Extreme** needs EXTREME typed; afterwards Windows Update and search are off; **Off** restores them.
- [ ] Service manager: search, filter, change Fax to Disabled and back. RPC services can't be disabled.
- [ ] **Disable Defender Real-Time Protection** (Microsoft Defender group):
  - [ ] With Tamper Protection ON (default): after restart Defender real-time protection is still on (Windows
        ignores the policy). Expected; the warning says so.
  - [ ] With Tamper Protection OFF: after restart real-time protection shows off and is greyed "managed by
        your administrator". Red banner shows. Re-Enable Defender turns it back on after restart.
- [ ] **Anti-cheat**: with Defender off and on, Valorant (A, D) and an Easy Anti-Cheat game (B, D) still start.

## 8. Networking

- [ ] TCP tweaks apply and revert (`netsh int tcp show global` matches).
- [ ] DNS presets: pick Cloudflare, check `ipconfig /all` shows 1.1.1.1; pick Automatic, DHCP DNS returns.
- [ ] Latency test returns numbers for the three defaults and for a host you type; a bad host is rejected.
- [ ] DNS benchmark ranks the presets; **Use fastest** switches the adapter.
- [ ] Hosts editor: a bad line is refused with its line number; a valid save works; Undo All restores the original.
- [ ] Winsock reset and Network full reset: internet works after the restart.
- [ ] Non-English Windows (if available): TCP rows show "Not on this PC" rather than wrong values.

## 9. Resources

- [ ] **Automated Driver Reinstall** (real NVIDIA hardware only, machine A or D):
  - [ ] Card shows Installed and Available versions that match NVIDIA's website for your card.
  - [ ] Begin needs REINSTALL typed; progress shows the download; the PC restarts after DDU runs.
  - [ ] After sign-in IcyCleaner opens on Resources; **Continue** installs the driver silently; restart.
  - [ ] Driver version afterwards = Available version; games and the NVIDIA Control Panel work.
  - [ ] Cancel case: start a job, then Cancel job before the restart; no RunOnce entry left
        (`HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce`).
- [ ] AMD machine (B): the card shows the installed version and says automatic reinstall is NVIDIA only.
- [ ] **Runtimes**: install all on a fresh VM; each line reports Installed or Already installed; a game that
      complained about MSVCP140 / d3dx9 now starts.
- [ ] **System check** (as admin): runs chkdsk scan, SFC, DISM in order with live output and plain summaries.
- [ ] Shortcuts open the right Windows tools; **Restart to BIOS** asks first and reboots into firmware setup.

## 10. Advanced

- [ ] Hardware summary matches the machine (CPU, GPU and driver, RAM speed, laptop flag on C).
- [ ] Core Parking Off, Minimum Processor State 100%, Aggressive CPU Boost: check with
      `powercfg /qh SCHEME_CURRENT SUB_PROCESSOR` after applying; revert restores the earlier values.
- [ ] CPU Idle States Off needs APPLY typed; CPU shows 100% in Task Manager idle; revert fixes it.
- [ ] MSI Mode rows appear only for the GPU and network card; turning one off and back on survives a restart
      with a working screen and network.
- [ ] CPU Security Mitigations Off: after restart, Windows reports mitigations disabled (e.g. with
      `Get-SpeculationControlSettings` if installed); revert and restart restores them.
- [ ] Memory Integrity Off: Windows Security shows Memory Integrity off after restart; Valorant behaviour noted.

## 11. BIOS

- [ ] Audit items match what the BIOS shows (memory profile, Resizable BAR, Secure Boot, TPM as admin,
      virtualization). Test one machine with XMP/EXPO off: it is flagged "Check".
- [ ] The guide shows the right board brand (ASUS / MSI / Gigabyte / ASRock) or the generic guide.
- [ ] Dell, Lenovo or HP machine (if available): "maker interface is present" line appears.

## 12. Game profiles

For each installed game (Fortnite, Valorant, Apex, CS2, Marvel Rivals, Roblox):

- [ ] Status is right (Not Installed / No settings yet / Not Optimized).
- [ ] The editor shows the in-game values (resolution, FPS cap, Reflex, checkboxes).
- [ ] Apply the Recommended profile with the game closed; start the game: the settings changed; nothing else did.
- [ ] Reset puts the original values back (check in game).
- [ ] With the game running, Apply and Reset are refused ("Close the game first").
- [ ] After a game update, Apply still works or names the missing setting (never writes a guessed one).
- [ ] Anti-cheat games (Valorant, Fortnite, Apex) start normally after a profile is applied.
- [ ] Pins keep pinned games at the top after restarting the app.
- [ ] **Game Boost**: turn on, start a listed game: the badge says Boosting; `powercfg /getactivescheme` shows the
      performance plan; Discord/Chrome show Below normal in Task Manager > Details. Close the game: plan and
      priorities return. Quit IcyCleaner during a session: plan returns too.
- [ ] **Frametime capture** (as admin, game running): first use downloads PresentMon; a 30 s capture shows
      average, 1% and 0.1% lows close to what an overlay (e.g. the NVIDIA overlay) reports.

## 13. App Optimizer

- [ ] Each card applies and reverts; browser cards show "managed by your organization" while on and stop after revert.
- [ ] Discord / Spotify / OBS / Opera cards refuse while the app is running, and work when it's closed;
      the app starts normally after.
- [ ] Discord CPU Priority: Discord.exe shows Below normal in Task Manager after its next start.
- [ ] **Startup items**: the list matches Task Manager > Startup apps; turning one off shows "Disabled" in Task
      Manager and it doesn't start at next sign-in; Undo All turns it back on.

## 14. Cleaner

- [ ] Health Check scans and cleans; space freed roughly matches the scan.
- [ ] Smart Cleaner: safe, caution and risky tags shown; risky targets need confirmation.
- [ ] Browsers: a running browser's cookie/history targets are refused; cache cleans while it runs.
- [ ] App caches: Discord, Steam shader caches clean; the apps still start.
- [ ] Disk Analyzer: treemap of C:, drill down, reveal and delete (goes to the Recycle Bin); Windows folders refused.
- [ ] Drive Health: each disk listed; SSD wear and temperature shown as admin.

## 15. Uninstall

- [ ] Turn on Disable Defender (Tamper Protection off), then uninstall from Settings > Apps. After uninstall, the
      Defender policy values are gone (`HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection`)
      and real-time protection is back after restart.
- [ ] Other tweaks stay as they were (uninstalling does not undo them; use Undo All before uninstalling to revert).
- [ ] `%APPDATA%\IcyCleaner` remains (backups and logs are kept on purpose).
- [ ] Reinstall: the app finds the old backup; Undo All still works.

## 16. Added after the first draft

- [ ] **Re-check at launch**: apply a tweak, change its value back in regedit, restart IcyCleaner: the yellow
      banner names it; Re-apply fixes it; Dismiss hides it until next start.
- [ ] **Anti-cheat warnings**: with Valorant installed, Memory Integrity Off shows the anti-cheat chip and the
      confirmation mentions Vanguard. Without Vanguard/FACEIT installed, no chip.
- [ ] **Hardware-aware tweaks** (laptop C): CPU power tweaks and Hibernation Wipe show "not for this PC" and
      Apply All skips them. On an HDD system, TRIM Force-On shows it.
- [ ] **Export / import** (Settings): export on machine A, import on B; the list shown matches; Risky entries
      need IMPORT typed; afterwards the same tweaks are applied; a file from another app is refused.
- [ ] **Boot time** (App Optimizer > Startup items, as admin): last and average boot times match Event Viewer
      (Diagnostics-Performance, event 100); without admin a clear note is shown.
- [ ] **Monitor check** (Home): set a 144 Hz monitor to 60 Hz; Home flags it; "Set 144 Hz" opens Advanced
      display settings.
- [ ] **Before / after**: two captures of the same game show the comparison with +/- values.
- [ ] **Tray**: closing the window leaves the tray icon; tray menu opens the window, toggles Game Boost, quits.
      Turn the tray setting off: closing quits.
- [ ] **Notifications**: Game Boost start and end show a Windows notification (and none when turned off).
- [ ] **Start with Windows**: on, sign out and in: IcyCleaner is in the tray, no window. Off: it no longer starts.
- [ ] **Weekly Health Check**: turn on; leave the PC idle 10+ minutes with IcyCleaner in the tray (set the
      clock or `lastCleanAt` in settings.json back 8 days to test); a notification reports what was freed.
- [ ] **Duplicate Finder**: copy a large file twice into Downloads; scan your user folder; the set appears with
      the oldest kept; moving the copies sends them to the Recycle Bin. Picking every copy is blocked.
- [ ] **Old Files**: large old files appear; moving them uses the Recycle Bin.
- [ ] **Privacy Traces**: counts match (Win+R history, Explorer searches); Clear empties them; Undo All brings the
      registry lists back; Restore on a privacy backup brings Recent items back.
- [ ] **Windows 11 interface**: Classic Right-Click Menu (after Explorer restart or sign-out), Taskbar Icons on
      the Left, Widgets Off, Recall Off (Copilot+ PC), Snap Layouts Pop-up Off: each applies and reverts.
- [ ] **Small touches**: Ctrl+K focuses search; the result message has Undo for tweak changes; the app reopens
      on the last page; General > "Changed by IcyCleaner" lists exactly what the app changed.
- [ ] **Game art**: every game in Game Profiles shows its art in the list and the banner.

## 17. Third round

- [ ] **General tab**: cards in a grid; tabs, search, sort and Refresh work; applied cards glow; Apply All / Revert
      All only touch General tweaks; 2 columns at default size, 3 when the window is wider.
- [ ] **Controls**: toggles spring across and glow; checkboxes pop and draw the tick; the FPS slider fills blue;
      with Windows "Animation effects" off, nothing animates.
- [ ] **Resource use**: open on Home, then close to the tray: in Task Manager IcyCleaner drops to a few processes,
      roughly 250 MB, near 0% CPU (Game Boost on: about 2% of one core). No powershell.exe left running.
- [ ] **Automatic restore points**: turning on a Risky, Advanced or restart-required tweak creates a restore point
      first (System Restore list). Turn on "Allow Frequent Restore Points" and check two in a row both appear.
- [ ] **Devices**: Automatic shows the right type; choosing Laptop marks desktop-only tweaks and Apply All skips
      them; laptop profile on a laptop: unplug -> Balanced plan and a notification, plug in -> previous plan.
- [ ] **Mouse polling test**: a 1000 Hz mouse reads near 1000 while moving fast.
- [ ] **Processes**: list matches Task Manager roughly; grouping; ending a browser works; Windows processes have
      no End button and are refused.
- [ ] **Latency check** (Resources > Diagnostics): runs 20 s; with a known bad driver (e.g. some Wi-Fi drivers) it
      says "check" or "bad".
- [ ] **Driver backup**: as admin, backs up (folder opens, packages listed); Restore reinstalls (restart may be
      asked); the driver reinstall job makes a backup before DDU.
- [ ] **In-game overlay** (as admin): with a game in borderless mode, Show overlay -> FPS, 1% low, GPU load/temp,
      CPU top-left; clicks go through to the game; Hide removes it; "Overlay during Game Boost" shows it per session.
- [ ] **Per-game Boost**: give one game its own options (e.g. Pause Windows Update): during that game `sc query
      wuauserv` shows STOPPED, after it RUNNING; another game uses the defaults. Pause OneDrive: OneDrive exits and
      comes back.
- [ ] **Debloater**: as admin, "Not used in 6+ months" lists programs you haven't opened; "Select unused" picks them.
- [ ] **Change history**: "Undo from here" on an older change puts back that and everything after it only.
- [ ] **Froststrap** (Roblox selected): card shows; with Froststrap closed set FPS 240 -> its
      `ClientSettings\ClientAppSettings.json` has `"DFIntTaskSchedulerTargetFps": "240"`; Reset puts it back; with
      Froststrap open it refuses. In Roblox, the cap applies after launching through Froststrap.
- [ ] **Updates** (Settings): with `updateRepo` set and a newer GitHub release, it offers it; otherwise says so.

## 18. Fourth round

- [ ] **Per-game power plan**: give a game its own plan in Game Boost; during that game `powercfg /getactivescheme`
      shows it; after, the previous plan is back. A plan deleted later falls back to the best available.
- [ ] **Find the driver** (Resources > Diagnostics, as admin): Install the toolkit (one-time, from Microsoft);
      "Find the driver" traces 15 s and lists drivers by longest DPC/ISR. Compare with LatencyMon on the same PC.
- [ ] **CPU temperature**: "Set up CPU temperature" downloads the library (and installs PawnIO if missing); as admin
      the overlay shows CPU °C, close to HWiNFO / Ryzen Master / Intel XTU.
- [ ] **Auto-update**: set `"updateRepo": "owner/name"`, bump the version, `npm run dist`, upload the installer,
      `.blockmap` and `latest.yml` to a GitHub release. In an installed older copy: Settings > Check for updates ->
      Download -> progress -> "Restart and install" -> new version starts, backups and settings kept.

- [ ] **Always administrator**: starting IcyCleaner shows the Windows admin prompt; no "Not running as
      administrator" banner. "Start with Windows" on -> Task Scheduler has `\IcyCleaner\Start` (run with highest
      privileges); after signing in, IcyCleaner is in the tray with no prompt. Off -> the task is gone.
- [ ] **Driver job resume**: during a reinstall, `\IcyCleaner\DriverJob` exists; after the restart IcyCleaner opens
      (no prompt); after Continue the task is removed.

## 19. Across all machines

- [ ] No crash, no blank window, no stuck "busy" state on any page.
- [ ] Every action shows a result message bottom right.
- [ ] Keyboard: Tab reaches every control; Enter and Space activate; dialogs can be cancelled with the Cancel button.
- [ ] 125% and 150% display scaling: nothing overlaps or is cut off; sidebar collapse button works.
