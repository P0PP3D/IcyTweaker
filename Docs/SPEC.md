# Windows Optimizer App — Master Feature Spec

Nov 11, 2026 · @pop

This is the full feature list for one Windows app that combines a tweaker and a cleaner: everything visible in your Paragon screenshots, everything in the two Krypt projects, and additions that fill real gaps. Each feature is tagged by where it came from, which tier it belongs in, and how risky it is.

## How to read this spec

Every feature carries three tags so you can hand any row straight to Claude Code as a task.

| Tag | Values | Meaning |
| --- | --- | --- |
| Source | PTU, KT, KC, NEW | PTU = seen in your Paragon screenshots. KT = Krypt Tweaker. KC = Krypt Cleaner. NEW = added here. |
| Tier | Free, Pro, Elite | Suggested paywall position. Your call; see the Tiers section. |
| Risk | Safe, Balanced, Risky | Safe regenerates or reverts cleanly. Balanced needs a reboot or changes behavior. Risky weakens security or can break Windows features, so it is off by default and confirmed by dialog. |

I could only see the Paragon pages you screenshotted. The Advanced and BIOS pages are locked in your account, so those sections are proposals, not copies.

## Foundation: the tweak engine and safety layer

Build this first. Every later page is a list of tweaks or actions that runs through it, which is why Paragon-style apps can show 28 tweaks with an applied counter, Apply All and Revert All.

| Component | What it does | Source | Tier |
| --- | --- | --- | --- |
| Tweak definition | Each tweak has id, name, category, description, risk, requiresAdmin, requiresReboot, readState(), apply(), revert() | KT | Free |
| Registry helper | One call for a DWORD tweak: hive, key, value name, enabled value, default value (or delete on revert) | KT | Free |
| Live state detection | Toggles reflect the real system state on open and on Refresh, not a saved flag. Shows Applied, Not applied, Partially enabled, or Unknown | PTU, KT | Free |
| Applied counter | "20/28 tweaks applied" per page and in the sidebar | PTU | Free |
| Apply All / Revert All | Per category, skips anything Risky unless confirmed | PTU | Free |
| Restore point | Real Windows restore point (Checkpoint-Computer) before any preset or bulk action | KT, PTU | Free |
| Value backup | Snapshot of every registry value, service start type and power setting the app can touch, taken before the first change, with one-click rollback | KT | Free |
| System Restore page | List restore points, create one, roll back, and show a history of what the app changed | PTU | Free |
| Risk labels and flags | Badges for risk, admin, reboot, permanent; warning count chip ("1 WARNING") that opens the explanation | PTU, KT | Free |
| Reboot banner | Collects tweaks that need a restart and offers one restart button | KT | Free |
| Admin elevation | Manifest or one-click UAC relaunch; clear banner when not elevated | KC, KT | Free |
| Action log | Every apply, revert, clean and error with timestamp, saved locally and exportable | KC, KT | Free |
| Toasts, no silent failures | Every action ends in a visible result | KC | Free |
| Presets | Safe Optimize, Max FPS, Low Latency, Competitive, Debloat Only, Streamer, Restore Defaults; each is just a list of tweak ids | KT | Free (basic), Pro (all) |
| Global search | Find any tweak or fix across every page and toggle it in place | KT | Free |
| Version gating | Each tweak declares supported Windows builds and desktop/laptop applicability; unsupported tweaks are hidden or marked | NEW | Free |
| Boot watchdog | If Windows fails to boot twice after a tweak batch, auto-roll back on next successful start | NEW | Pro |
| Onboarding | First-run explanation, restore point offer, and a recommended preset | KT | Free |

## Home dashboard and monitoring

The home page is what makes the app feel alive. It answers "how is my PC doing and what should I do next" in one screen.

| Feature | Details | Source | Tier |
| --- | --- | --- | --- |
| Optimization score | A number out of 1,000 with a rank label (Paragon shows "Lagger" at 141). Computed from how many tweaks are applied, startup load, free disk and driver status. Needs an honest formula you can explain | PTU | Free |
| Status strip | Last ran cleanup, driver status (Current / Update available), and "areas to review" count with a Review button that jumps to the first unapplied recommendation | PTU | Free |
| Live CPU, GPU, RAM rings | Usage plus used/total RAM, refreshed about once a second (systeminformation package) | PTU, KT | Free |
| Temperature monitor | Per-sensor graph. Needs a kernel sensor driver (LibreHardwareMonitor); shows a "Can't see CPU temps?" help sheet when sensors are unavailable | PTU | Pro |
| Disk usage bar | Used vs total with a colored breakdown by category and a "Clean up files" shortcut into the cleaner | PTU, KC | Free |
| System info | Full hardware and OS summary page | PTU, KT | Free |
| What's New | Changelog sheet with NEW badges on recently added pages and tweaks | PTU | Free |
| Game boost card | One-click session mode (see Additions). Paragon's equivalent is Windows Ascension, which is Edge-locked and whose behavior I could not see | PTU | Pro |
| Benchmark | CPU, GPU, memory and disk score out of 10,000 so users can run before and after. Runs locally, nothing uploaded | KT | Free |
| Frametime capture | Before/after frametime and 1% low capture in a real game via PresentMon | NEW | Elite |

## General tweaks

Paragon shows "20/28 tweaks applied" and the screenshots cover 29 distinct cards, so one is probably a button-style action rather than a counted toggle. Page features: category tabs (All, Performance, System, Graphics, Security), search, sort, Refresh, Apply All, Revert All, NEW badges, a per-card warning chip, and an Adjust control on Win32 Priority.

Implementation notes are my best reading of each description, not Paragon's code. Verify every registry path on a Windows VM before shipping; keys marked (verify) are ones I am not sure of.

| Tweak | What it does | How to build it | Risk |
| --- | --- | --- | --- |
| Core Power Plan | Optimized baseline power settings | Duplicate a base plan with powercfg, set AC/DC values, activate; revert by restoring the saved GUID | Safe |
| NVIDIA Profile | Optimized NVIDIA driver settings (Apply button, not a toggle) | Import a driver profile through NVAPI DRS or NVIDIA Profile Inspector style .nip files; back up the profile first | Balanced |
| Process Count Reduction | Fewer svchost processes | Set SvcHostSplitThresholdInKB under HKLM\\SYSTEM\\CurrentControlSet\\Control to a fixed value; reboot | Balanced |
| Win32 Priority | Foreground scheduling bias | Win32PrioritySeparation under PriorityControl; slider with a Restore Windows Default button | Balanced |
| Cloud Sync Off | Stops settings sync across devices | SettingSync policies (DisableSettingSync) | Safe |
| DO Solo Mode | Delivery Optimization downloads from Microsoft only | DODownloadMode = 0 | Safe |
| Experimentation Lock | Stops silent feature trials | PolicyManager AllowExperimentation = 0 (verify) | Safe |
| Feedback Tasks Off | Disables Windows feedback (SIUF) tasks | Disable scheduled tasks under Microsoft\\Windows\\Feedback\\Siuf | Safe |
| Hibernation Wipe | Disables hibernation and deletes hiberfil.sys | powercfg /hibernate off. Warn that it also removes Fast Startup | Balanced |
| Media Player Tracking Off | Stops Windows Media Player usage tracking | HKCU Media Player preferences (verify) | Safe |
| Nudge Blocker | Stops account nudges, engagement prompts, Spotlight subscriptions | ContentDeliveryManager SubscribedContent values plus related tasks | Safe |
| Proximity Deny | Blocks proximity/device pairing capability | CapabilityAccessManager proximity consent = Deny (verify) | Safe |
| Raw Aim Curve | Zero mouse acceleration with a flat curve | MouseSpeed, MouseThreshold1/2 = 0 and linear SmoothMouseXCurve/YCurve | Safe |
| RT Scan Trim | Less Defender sample submission and MRT reporting | Defender preferences (SubmitSamplesConsent) and MRT policy | Risky |
| Search Box Local | Removes web results from Start search | DisableSearchBoxSuggestions, BingSearchEnabled = 0 | Safe |
| Search Cloud Off | Disables AAD/MSA cloud search | SearchSettings IsAADCloudSearchEnabled, IsMSACloudSearchEnabled = 0 | Safe |
| Security Quiet | Hides Defender and firewall toasts | Security Center notification policies. Hides real alerts | Risky |
| Silent App Installs Off | Stops suggested and OEM apps installing themselves | SilentInstalledAppsEnabled, PreInstalledAppsEnabled, OEMPreInstalledAppsEnabled = 0 | Safe |
| SQM Tasks Off | Disables the Customer Experience consolidator task | Disable tasks under Customer Experience Improvement Program | Safe |
| StickyKeys Guard | Stops the Shift-five-times popup | StickyKeys, ToggleKeys and FilterKeys Flags under Control Panel\\Accessibility | Safe |
| Telemetry Zero | Minimum diagnostic data and no feedback prompts | AllowTelemetry plus DoNotShowFeedbackNotifications. Tell users that Home and Pro editions treat 0 as the minimum level | Safe |
| TRIM Force-On | Makes sure SSD TRIM is enabled | fsutil behavior set DisableDeleteNotify 0 | Safe |
| Troubleshooter Scans Off | Stops recommended troubleshooting scans | Disable Diagnosis scheduled tasks and the recommended-troubleshooting setting | Safe |
| Usage Insights Off | Stops Usage and Quality Insights maintenance | Disable that scheduled task (verify task name per build) | Safe |
| USB Power Guard | No USB selective suspend, so no input lag or audio dropouts | powercfg USB selective suspend setting = 0 plus device power-management flags | Safe |
| Voice Activation Off | Disables voice activation and its background tasks | Speech\_OneCore VoiceActivation preferences (verify) | Safe |
| WHQL Only | Prefer certified drivers | Driver signing / Windows Update driver policy (verify the exact key) | Balanced |
| Windows Update Improvements | Defers feature updates and surprise installs during play | Deferral and active-hours policies. Do not fully disable updates | Balanced |
| WinSAT Benchmark Off | Stops the background system benchmark | Disable the WinSAT scheduled task | Safe |

Also carry over from Krypt Tweaker: Game Mode, Game DVR and Game Bar off, fullscreen optimization behavior, hardware-accelerated GPU scheduling (reboot), MMCSS Games priority, SystemResponsiveness, network throttling off, TCP ack frequency and NoDelay, transparency and animation off, visual effects for performance, activity history off, advertising ID off, Copilot off, Edge sidebar and shopping assistant policies, OneDrive and Office telemetry policies.

## Debloater

Two tabs, Desktop apps and Store apps. Each row shows an icon, name, version, size, and install date, with search, sort, Refresh, multi-select, an Uninstall (n) button, and an Auto Debloat button that is paid.

| Feature | Details | Source | Tier |
| --- | --- | --- | --- |
| Desktop app list | Read the Uninstall keys (HKLM and HKCU, 32 and 64 bit); show size and install date, "N/A" and "Unknown" when missing | PTU | Free |
| Store app list | Get-AppxPackage for the user and provisioned packages; remove with Remove-AppxPackage | PTU, KT | Free |
| Multi-select uninstall | Queue silent uninstall strings, show progress per app, report failures | PTU | Free |
| Auto Debloat | Scan, then preselect only items on a curated safe-to-remove list; user reviews before anything runs | PTU | Pro |
| Vendor bloat detection | Flag OEM utilities (RGB suites, driver helpers, trial software) with a plain-language note that some are needed for fan or lighting control | NEW | Free |
| Protected list | Never offer drivers, runtimes, the Store itself, Windows Security, or anything needed by Windows Update | NEW | Free |
| Restore point before uninstall | Automatic, with the removed package list saved so Store apps can be reinstalled | NEW | Free |
| Leftover cleanup | After uninstall, offer to remove empty folders, orphan registry keys and scheduled tasks | NEW | Pro |
| Privacy switches without uninstalling | Telemetry, Cortana, lock-screen ads, Copilot and other noise switched off while apps stay installed | KT | Free |

## Services

The Paragon page is a grid of service groups. Each group has a master switch, a help icon, and sub-groups that show their own state, including Partially Enabled, Locked (behind a higher tier) and N/A (service not installed). A floating level selector sets how aggressive the whole page is: Off, Minimum, Medium, Extreme. A separate Disable Defender switch sits at the top.

| Group | Sub-groups seen | Source | Tier |
| --- | --- | --- | --- |
| User Features | Disable Platform & Devices (Hyper-V integration, mixed reality, connected devices); Disable Communication & Data (phone, messaging, notifications, sync) | PTU | Free for Minimum, Pro above |
| Connectivity | Disable Local & Discovery (device discovery, peer-to-peer, local network); Disable Remote & Sharing (remote desktop, file sharing, VPN, proxy) | PTU | Pro |
| Hardware & Display | Disable Peripherals & Display (printing, sensors, display enhancement, font cache); Disable Print & Misc (print config, network monitoring, compatibility assistant); Disable AMD Radeon Driver Services (crash recovery, external events; shows N/A if not installed) | PTU | Pro |
| Windows Services | Disable Updates & Windows Store/Xbox (Windows Update, BITS, Delivery Optimization, Store install); Disable Diagnostics & Maintenance (search indexing, diagnostics, performance logging, maintenance) | PTU | Pro |

What each level should mean, as a rule you can write once and test:

| Level | Rule |
| --- | --- |
| Off | Windows defaults. Revert everything the app changed |
| Minimum | Only services with no user-visible feature loss: telemetry, diagnostics tracking, retail demo, Xbox services when no Xbox app is in use |
| Medium | Adds services for features many users do not use: printing, Bluetooth, remote access, sensors. Show what breaks before applying |
| Extreme | Adds search indexing, update services and Store dependencies. Requires typed confirmation and a restore point |

Build rules that Paragon's UI implies but I cannot confirm: store each service's original start type before changing it; show a dependency check (what else needs this service) before disabling; compute "Partially Enabled" when only some services in a group match; hide groups for services that do not exist on the machine.

From Krypt Tweaker, also include a full service manager (search, filter, start type, start and stop, and a per-service description) and a startup manager (KT, KC, Free).

Disable Defender (PTU, Elite, Risky): see Risks and legal for why this needs guardrails and a Re-Enable Defender fix next to it.

## Networking

I did not get a Paragon Networking screenshot, so this section comes from the Edge and Apex plan descriptions (Network Optimizer, network tests), Krypt Tweaker, and standard practice.

| Feature | Details | Source | Tier |
| --- | --- | --- | --- |
| TCP and stack tweaks | Network throttling index, TCP ack frequency, TCPNoDelay, autotuning level, RSS, ECN, with revert | KT | Free |
| DNS presets | Cloudflare, Google, Quad9, AdGuard, and Restore automatic (DHCP); apply to the active adapter only | KT | Free |
| Reset tools | Flush DNS, Winsock reset, IP release and renew, full network reset | KT | Free |
| Hosts editor | View and edit the hosts file with a backup and syntax check | KT | Free |
| Network optimizer | One button that picks the best DNS, applies stack tweaks for the detected adapter type (Ethernet, Wi-Fi), and re-tests | PTU plan list | Elite |
| Latency and jitter test | Ping several regions, report average, jitter and packet loss, and graph it | PTU plan list | Pro |
| DNS benchmark | Time resolvers from the user's own connection and recommend the fastest | NEW | Free |
| Adapter tweaks | Interrupt moderation, Energy Efficient Ethernet, Green Ethernet, large send offload, per adapter with detection of what the driver supports | NEW | Pro |
| Wi-Fi tuning | Roaming aggressiveness, band preference, power saving off | NEW | Pro |
| Per-app bandwidth view | Which process is using the connection right now, with an option to lower its priority | NEW | Elite |
| MTU finder | Find the largest packet size that does not fragment | NEW | Elite |

## Game profiles

A two-pane page. The left list shows each game with its publisher and a status badge (Not Optimized, Not Installed) and a pin icon. The right pane edits that game's profile. Games visible: Fortnite, Valorant, Apex Legends, Counter-Strike 2, Overwatch 2, Marathon, Marvel Rivals, Call of Duty: Warzone, and more below the fold.

| Feature | Details | Source | Tier |
| --- | --- | --- | --- |
| Game list with status | Detect installs from Steam library folders, Epic manifests, Riot and Battle.net locations; badge Not Installed, Not Optimized or Optimized | PTU | Pro |
| Search, sort, refresh, pin | Pinned games float to the top | PTU | Pro |
| Recommended settings toggle | One switch that fills in a sensible competitive profile for that game | PTU | Pro |
| Resolution and max frame rate | Width, height, and an FPS cap field | PTU | Pro |
| Anti-aliasing | Dropdown per game (for example MSAA 2x) | PTU | Pro |
| NVIDIA Reflex | Off, On, On + Boost, where the game supports it | PTU | Pro |
| Additional options | Checkboxes: Enable Fullscreen, Disable V-Sync, Disable Dynamic Resolution, Disable HDR Output, Multithreaded Rendering, Disable Frame Rate Limits, Show FPS Counter, Low Effects Quality, Low Material Quality, Low Texture Quality, Low Detail Quality, Disable Shadows, Disable Vignette, Disable Bloom, Disable Distortion, Low Anti-Aliasing Quality | PTU | Pro |
| Apply Profile and Reset | Write the game's config, keep the original as a backup, and restore it on Reset | PTU | Pro |
| Per-game NVIDIA profile | A driver profile bound to the game's executable (locked in the screenshot) | PTU | Elite |
| Launch-time apply | A background watcher that applies a game's system settings when it starts and reverts when it exits | NEW | Elite |
| Community profiles | Import and export a profile as a small file to share | NEW | Elite |

How to build it: each game is a data file that lists the config path, the format (ini, cfg, json, xml), and a map from each option to the exact setting names in that game. Writing is a backup, a parse, a patch of only the keys you own, and a verify. Games rename settings in patches, so each profile needs a game-version field and a test that fails loudly when a key disappears. Never touch anti-cheat files, only the game's own settings files.

## App optimizer

Each card is a toggle that tunes one app's background resource use. Edge, Discord and Discord CPU Priority are open to the Core account; Chrome, Brave, Opera GX, Opera, Firefox and Spotify are locked to a paid tier. Two cards carry warning chips explaining a side effect.

| Card | What it does | How to build it | Source | Tier |
| --- | --- | --- | --- | --- |
| Microsoft Edge | Stops startup boost, background extensions and hardware acceleration when idle | Edge policy registry values | PTU | Free |
| Discord Optimization | Turns off Discord's hardware acceleration | Edit Discord's settings.json with Discord closed | PTU | Free |
| Discord CPU Priority | Runs Discord at Below Normal so games get CPU first, persisting across restarts | Image File Execution Options PerfOptions CpuPriorityClass for Discord.exe | PTU | Free |
| Chrome, Brave | Hardware acceleration and background mode off, memory saver on | Browser policy values | PTU | Pro |
| Opera, Opera GX | Same, plus GX limiters set to a sensible default | Preferences file edits | PTU | Pro |
| Firefox | Background tasks and hardware acceleration | user.js or policies.json | PTU | Pro |
| Spotify | Hardware acceleration off, startup behavior | prefs file edits | PTU | Pro |
| More apps | Steam (disable overlay and web helper load), Epic Launcher, OBS, Teams, Slack, VS Code | Per-app config edits | NEW | Pro |
| Startup items per app | Show what each app launches at boot and let the user turn it off | KT, KC | Free |  |

## Resources and fixes

### Resources page

Three tabs plus a walkthrough banner with a video link and carousel dots.

| Feature | Details | Source | Tier |
| --- | --- | --- | --- |
| Automated driver reinstall | Detect the installed NVIDIA or AMD driver and the latest official version, show both (Paragon showed Installed 617.42 and Available 621.14), then run a clean removal with Display Driver Uninstaller and install the fresh driver. Needs safe mode or a reboot step, so build it as a resumable job | PTU | Elite |
| Runtime and DirectX installer | Download and install Visual C++ 2005 to 2022, DirectX runtime and the .NET Desktop Runtime to fix missing DLL errors | PTU | Pro |
| System corruption check | Run chkdsk, SFC and DISM in order with live progress and a plain summary | PTU | Free |
| Shortcuts tab | Run buttons for Go to BIOS (restart to firmware), Disk Manager, Reset This PC, BitLocker settings, System Configuration and System Information | PTU | Free |
| Downloads tab | Curated official downloads: GPU drivers, chipset, DDU, benchmark and monitoring tools. I did not see this tab, so the list is my proposal | PTU | Free |
| Walkthrough video | In-app banner linking to your own video guides | PTU | Free |

### Fixes page

Every fix is a card with a Run Fix button, so each is a small script with a result message.

| Fix | What it does | Source |
| --- | --- | --- |
| Valorant Fix CFG | Enables Control Flow Guard and related mitigations that Vanguard expects | PTU |
| Valorant HVCI Memory Integrity Fix | Enables Memory Integrity for Valorant compatibility | PTU |
| NVIDIA Control Panel (No Microsoft Store) | Launches the control panel from the AppX package files directly | PTU |
| WiFi Fix | Sets WLAN AutoConfig and WinHttpAutoProxySvc to Automatic start | PTU |
| Bluetooth Fix | Restores the Bluetooth services to their correct start types | PTU |
| Error 2502/2503 Fix | Recreates the Temp folder and fixes permissions so Windows Installer works | PTU |
| Microsoft Store/Update Fix | Resets critical services and policies; fixes 0x80070422, 0x80070005 and Store download failures | PTU |
| Power and Sleep Setting | Sets SensorService back to Manual so the settings page opens | PTU |
| Re-Enable Defender | Fixes a blank Windows Security page and undoes Defender changes made by the app | PTU |
| Audio fix | Restart audio services, reset default device and exclusive-mode settings | NEW |
| Search and icon cache rebuild | Rebuild the Windows Search index and the icon and thumbnail caches | NEW |
| Print spooler reset | Clear stuck jobs and restart the spooler | NEW |
| Network full reset | Winsock, TCP/IP, firewall rules and adapters back to default | KT, NEW |
| Undo everything this app changed | One button that reverts every tweak and fix from the saved backups | NEW |

## Cleaner suite

Krypt Cleaner is the model here. Its core idea is a data-driven list of clean targets, each with a risk tier, an admin flag, a default-selected flag, and either folders to scan or a custom scan and clean function. Add a target by adding data, not UI code.

| Page | Details | Source | Tier |
| --- | --- | --- | --- |
| Health Check | One-click scan of safe targets only, a live dial of reclaimable space, then clean. Nothing risky runs here | KC | Free |
| Smart Cleaner | User and Windows temp, thumbnail, icon and font caches, shader caches, crash dumps, Windows Error Reporting, Delivery Optimization, update cache, Recycle Bin. Each tagged safe, caution or risky | KC | Free |
| Browser cleaning | Per profile for Chrome, Edge, Brave, Vivaldi, Opera, Opera GX and Firefox. Cache preselected; cookies and history opt-in; saved passwords gated as risky. Detects locked files and tells the user to close the browser | KC | Free (cache), Pro (the rest) |
| App and game caches | Discord, Spotify, Slack, Teams, Steam, Epic, VS Code, Adobe, plus NVIDIA, AMD and Intel shader caches | KC | Free |
| Privacy traces | Recent documents, Run history, Explorer search, typed URLs, program-launch records. Snapshotted to a backup before clearing so they can be restored | KC | Pro |
| Disk Optimizer | Detect each drive's media type: TRIM for SSDs, defrag for HDDs only, plus DISM WinSxS analyze and clean | KC | Pro |
| Disk Analyzer | Drill-down treemap of what uses space, biggest files called out with reveal and delete | KC | Free |
| Duplicate Finder | Size, then signature, then full hash, so only true copies are listed. Never auto-deletes; the user picks which to keep | KC | Pro |
| Old Files | Find large files not opened in a long time and offer to move or delete | KC | Pro |
| Drive Health | SMART status, SSD wear, temperature, power-on hours and error counters per physical disk. Read-only | KC | Free |
| Safe filesystem walking | Skip symlinks and junctions so OneDrive placeholders are not followed or double counted | KC | Free |
| Privacy backups | Where snapshots live, with restore and delete | KC | Free |
| Scheduled cleaning | Run Health Check weekly in the background, only when idle, with a summary toast | NEW | Pro |
| Storage Sense control | Configure Windows' own cleanup instead of duplicating it where it is already good enough | NEW | Free |

## Advanced and BIOS

Both pages are locked in your Core account, so I could not see them. Here is what is realistic to build, and I have marked what I am guessing.

### Advanced (proposal)

The Edge plan lists "Advanced Tailored Tweaks" and the Apex plan lists "Additional Advanced Tweaks". Tailored suggests the tweaks adapt to the detected hardware.

| Feature | Details | Risk |
| --- | --- | --- |
| Hardware detection first | Read CPU vendor and generation, GPU vendor, RAM, storage type, laptop or desktop, then show only tweaks that fit | Safe |
| Timer resolution | Global timer resolution request control (applies on Windows 11 with per-process behavior caveats) | Balanced |
| MSI mode and interrupt affinity | Enable message-signaled interrupts for GPU and NIC, steer interrupts to chosen cores | Risky |
| CPU power details | Core parking, minimum processor state, boost mode and C-state settings through powercfg | Balanced |
| MMCSS and scheduler | Games task priority, SystemResponsiveness, thread priority separation | Balanced |
| GPU registry tuning | Driver-specific latency and power settings per vendor | Balanced |
| Memory | Standby list and paging file guidance, with an honest warning that most "RAM cleaners" do not help | Balanced |
| Mitigations toggle | CPU vulnerability mitigations off for FPS. Large security cost, so Risky and hidden behind a warning screen | Risky |
| Core isolation (HVCI, VBS) | Show state and let the user choose, noting Valorant needs HVCI on | Risky |

### BIOS (proposal)

BIOS settings cannot be written safely from Windows on most PCs. The plan lists it under Apex with a "Check Support" chip, which suggests it only works on some boards. A realistic version:

| Feature | Details |
| --- | --- |
| Check Support | Identify the motherboard or laptop model and say whether the app can read or change settings on it |
| Read-only audit | Read what Windows can see: virtualization, Secure Boot, TPM, XMP or EXPO state, Resizable BAR, memory speed vs rated speed, and report items worth changing |
| Vendor tools | Where the maker offers a supported interface (Dell, Lenovo and HP expose WMI BIOS settings on many models), read and write through it with a backup |
| Guided checklist | For everything else, a step-by-step guide per board brand with a Restart to BIOS button (the Shortcuts tab already has it) |
| Never flash firmware | Out of scope. A bad flash bricks machines |

## Additions

Neither Paragon nor the Krypt apps have these, and each fixes a real gap. "Must" means I would not ship without it.

| Feature | Why it matters | Priority | Tier |
| --- | --- | --- | --- |
| Game boost session mode | On game launch: switch power plan, pause updates, lower named background apps, then undo everything on exit. This is the honest version of a "gaming mode" and uses the launch watcher | Must | Pro |
| Anti-cheat compatibility check | Warn before any tweak that can trip Vanguard, Easy Anti-Cheat, BattlEye or FACEIT (HVCI, mitigations, test signing, some services) | Must | Free |
| Launch-time re-check | Windows updates quietly undo tweaks; on start, compare state and offer to re-apply | Must | Free |
| Undo everything | One button restoring every value the app ever changed | Must | Free |
| Signed installer and auto-update | Code signing, update channel, rollback of a bad update. Without signing, SmartScreen and antivirus will flag the app | Must | Free |
| Export and import config | Save the applied set as a file, move it to another PC, or share it | Must | Free |
| Hardware-aware tweaks | Hide or adjust tweaks by laptop vs desktop, SSD vs HDD, CPU and GPU vendor | Must | Free |
| Monitor refresh check | Detect when a monitor runs at 60 Hz but supports far more, and link to the setting | Nice | Free |
| Startup and boot analysis | Measure boot time, show which startup items cost the most, and disable with one click | Must | Free |
| Process view | Live list with CPU, RAM and disk per process, an end-task button, and a "safe to close" hint | Nice | Free |
| DPC and interrupt latency check | A LatencyMon-style test that names the driver causing spikes | Nice | Elite |
| Chipset, audio and network driver updates | Detect and install through winget or the vendor's official installer. Never scrape driver sites | Nice | Elite |
| Driver backup | Export installed third-party drivers before any driver change | Nice | Pro |
| Windows 11 interface tweaks | Classic context menu, taskbar alignment, widgets and Recall controls, snap layouts | Nice | Free |
| Privacy overview | One page showing which apps use camera, microphone and location, with toggles | Nice | Free |
| Laptop profiles | Battery-aware profile that does not drain the battery the way a desktop profile would | Nice | Pro |
| Mouse and input tools | Polling rate test, pointer precision check, keyboard repeat rate | Nice | Free |
| In-game overlay | FPS, frametime, CPU and GPU temperature overlay | Later | Elite |
| Command line and silent mode | Apply a saved config with no UI, for creators who tune many PCs | Later | Elite |
| Telemetry choice | Anonymous crash reports and usage stats, off by default, with a clear switch | Nice | Free |
| Themes, accessibility, languages | Light and dark, keyboard navigation, screen reader labels, translated UI | Later | Free |

## Tiers

Paragon's pricing (screenshot at the start of this chat) is Core free, Edge $8 a month (struck from $12), Apex $15 a month (struck from $20). Treat those as a reference point only; set your own prices after you know what your build costs to support. The split below follows the same logic: free proves the app is safe, Pro adds convenience and automation, Elite adds the heavy and support-intensive features.

| Area | Free | Pro | Elite |
| --- | --- | --- | --- |
| Safety | Restore points, backups, logs, undo all, risk labels | Boot watchdog | Priority support |
| Home | Score, live monitoring, system info, benchmark | Temperature monitor | Frametime capture |
| Tweaks | Safe General tweaks, presets (basic) | All General tweaks, all presets, Advanced tailored tweaks | Additional Advanced tweaks, BIOS audit |
| Debloat | Manual desktop and Store debloat | Auto Debloat, leftover cleanup | Scheduled debloat check |
| Services | Minimum level, service manager | Medium level, all groups | Extreme level, Defender controls |
| Networking | Stack tweaks, DNS, resets, DNS benchmark | Latency test, adapter tweaks | Network optimizer, per-app view, MTU |
| Games and apps | Edge and Discord optimization | Game profiles, all app optimizers, game boost mode | Per-game driver profile, launch-time apply, community profiles |
| Resources | System check, shortcuts, downloads | Runtime installer | Automated driver reinstall, driver updates |
| Fixes | All fixes | All fixes | All fixes |
| Cleaner | Health Check, Smart Cleaner, analyzer, drive health | Privacy traces, duplicates, old files, scheduled cleaning | Everything |
| Account | No account needed | License key and one device | Multiple devices, early access builds |

Paragon also has a points balance and a shop cart in the sidebar. A points or referral system is optional and can wait until after launch. Keep every safety feature and every fix in Free: gating the undo button behind payment will cost you trust.

## Build order

Each phase ends with something you can run in a Windows VM and revert from a snapshot. Do not start a phase until the one before it passes its apply, detect, revert, verify tests.

1. **Engine and safety.** Tweak definition, registry helper, backup, restore point, action log, admin elevation. Ship five tweaks and one list page to prove the loop.
2. **Shell.** Sidebar, home page with live rings, global search, presets, reboot banner, onboarding.
3. **Core tweak pages.** Full General list, Debloater, Fixes, System Restore.
4. **Cleaner.** Health Check, Smart Cleaner, browsers, app caches, analyzer, drive health.
5. **System control.** Services with levels, Networking, Resources (system check, runtimes, shortcuts).
6. **Games and apps.** Game profile data files for the top games, launch detection, App Optimizer.
7. **Accounts and billing.** License keys, tier flags, Stripe or Paddle, signed installer, auto-update.
8. **Elite features.** Driver reinstall job, frametime capture, launch-time watcher, Advanced page, BIOS audit.
9. **Beta.** Test on Windows 10 22H2 and the current Windows 11 builds, laptop and desktop, NVIDIA and AMD, and with Vanguard and Easy Anti-Cheat installed.

For Claude Code, give it one phase at a time plus a CLAUDE.md that says: every tweak must have a working revert, create a restore point before bulk changes, never write outside the data it owns, and add an apply-detect-revert test for each tweak.

## Risks and legal

- **Defender features.** Disable Defender, Security Quiet and RT Scan Trim lower real protection. Modern Windows blocks many of these changes while Tamper Protection is on, and antivirus vendors often flag apps that try. Keep them off by default, confirm by dialog, show a persistent warning when active, ship Re-Enable Defender beside them, and restore Defender if the app is uninstalled. Consider "reduce scanning while a game runs" instead of switching Defender off.
- **Anti-cheat.** Vanguard, FACEIT and similar systems care about Secure Boot, TPM, Memory Integrity and driver signing. Tweaks that weaken those can get players kicked. Check before applying.
- **Performance claims.** Many of these tweaks do little on a modern PC. Do not advertise numbers like "60 to 240 FPS" unless you measured them on stated hardware; use the built-in before and after benchmark instead. False performance claims also create advertising-law exposure.
- **Originality.** Feature ideas are fair to reuse; Paragon's names (Windows Ascension, PTU Points), wording, art, video and layout are theirs. Name and word everything yourself.
- **Krypt code license.** Both Krypt projects are MIT, so reuse needs their copyright notice kept. Their README also asks people not to rebrand and resell, so use them for patterns and write your own implementation.
- **Third-party tools.** Check the license of every tool you bundle or download at runtime (Display Driver Uninstaller, LibreHardwareMonitor, PresentMon, systeminformation). Prefer downloading official builds at runtime over redistributing them.
- **Game names and logos.** Show game names as plain text and do not imply endorsement. Check each publisher's brand rules before using logos.
- **Code signing and false positives.** An unsigned app that edits the registry and stops services will be flagged by SmartScreen and some antivirus products. Budget for a signing certificate and submit false-positive reports after each release.
- **Billing.** Use a payment provider that handles cards for you, state renewal and cancellation terms clearly, and keep refunds simple.
- **Verification.** Every registry path and task name in this spec is from descriptions, not from reading Paragon's code. Confirm each one on a clean VM per Windows build before it ships.

## Sources

- Paragon Tweaking Utility: the pricing screenshot and the 15 app screenshots you attached (Home, Resources, Fixes, General tweaks, Debloater, Services, Game Profiles, App Optimizer). The Advanced, BIOS, Networking and Downloads pages were not visible.
- Krypt Tweaker (Krypt-Tweaker-main.zip, MIT, krypt.cc): tweak definitions, presets, restore, power, network, services and benchmark source.
- Krypt Cleaner (Krypt-Cleaner-main.zip, MIT, krypt.cc): clean targets, browsers, privacy, disk, analyzer, duplicates and health source.
- No web pages were opened for this version. Registry paths marked (verify) are not confirmed.
