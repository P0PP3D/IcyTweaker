# IcyTweaker changelog

Each section becomes the description of its GitHub release (see .github/workflows/release-notes.yml).

## v0.1.7

**New**
- **Focus Mode with Game Boost:** Focus Mode can now turn on by itself when a game starts and off when it closes.
- **Temperature history:** a minute-by-minute CPU and GPU temperature graph for each Game Boost session (Game Profiles → Performance), with the throttling limits marked.
- **Quick benchmark:** a 10-second CPU, memory and disk test (Resources → Diagnostics). Each run is compared with the one before, so you can see what your tweaks changed.
- **Old Drivers:** finds older versions of drivers you already have a newer version of, and removes them. A copy of each is saved first, and Windows refuses to remove any driver a device is using.
- **Windows Features:** turn off unused built-in features (SMB 1.0, PowerShell 2.0, Hyper-V, Windows Sandbox and more), each with a plain explanation, and all undoable.
- **Beginner guide:** a friendly 4-step walkthrough on first start, reopenable from Home and Settings.
- **Collapsible sidebar:** fold the General, Tweaks and Cleaner sections.

**Improved**
- **Branded installer:** IcyTweaker artwork and a welcome page.
- **Updates install silently and reopen the app by themselves.**

## v0.1.6

**New**
- **Explorer switches:** show file extensions, show hidden files, End Task on the taskbar, classic Alt+Tab, dark mode.
- **Labels on tweaks:** Power hungry, Beta and Preference. Presets never change Preference tweaks.
- **Launcher junk cleaning:** Steam logs, crash dumps and download cache; Epic, Riot and Ubisoft Connect logs and caches; game log files (Fortnite's can reach hundreds of MB).
- **More stores in the game library:** Riot, Ubisoft Connect, Xbox app / Game Pass and GOG, alongside Steam and Epic.
- **Driver checks for AMD and Intel graphics and your chipset**, with a button to the official driver page.

## v0.1.5

**New**
- **Startup Apps page** (replaces Processes): everything that starts with Windows, including scheduled tasks Task Manager doesn't show. Turn all on or off at once, or delete entries; deletions can be undone.
- **Focus Mode:** one switch (page or tray) pauses non-essential Windows services and closes background apps while you play, then brings them all back. Customizable, with exceptions.
- **Estimated FPS gain on every preset.**

**Fixed**
- Steam games now show their icons in Debloating.
- The Recycle Bin list works with any file name, and shows the right deletion time.
- The "Open NVIDIA Control Panel" button works.
- The Widgets switch explains when Windows protects the setting.

**Removed**
- The Competitive setup button.

## v0.1.4

**New**
- **9 tweaks:**
  - Optimizations for Windowed Games
  - Auto HDR
  - Power Throttling Off
  - Fast Startup Off
  - No Startup Delay
  - Background Apps Off
  - Instant Menus
  - Fault Tolerant Heap Off
  - Windows Error Reporting Off
- **Do Not Disturb during play** (Game Boost option).
- **Borderless windowed** option in Fortnite, VALORANT, Deadlock and The Outlast Trials profiles.
- **Icons on presets.**
- **Recycle Bin item list** with filter and sort.

**Changed**
- New Deadlock artwork, and Roblox shows its real icon.
- Removed the CS2, Apex Legends, Marvel Rivals and Minecraft profiles.

## v0.1.3

**New**
- **Every scanner remembers its last result** and shows how long ago it ran.
- **Named restore points.**
- **Old Files grouped by folder.**
- **Open Recycle Bin button.**
- **Artwork for library games.**
- **NVIDIA Control Panel button** next to the stretched-resolution tip.

**Fixed**
- Toggles show the truth: an "already set" label, no false "partial" states, and a message instead of a switch that silently flips back.
- The Windows settings box for games is aligned properly.

## v0.1.2

**New**
- **IcyCleaner is now IcyTweaker.**
- **Automatic updates.**
- **Home checkups:** display refresh rate, graphics driver age and shader cache size.
- **Game Profiles redesigned** with tabs (Profiles, Game Boost & overlay, Performance). It also adds:
  - resolution presets, including stretched ones
  - a sensitivity converter
  - a before/after FPS comparison
- **Overlay ping.**
- **Startup impact badges.**
- **Recycle Bin page.**
- **Launch animation** when starting a game.
- **Restore point and restart animations.**

**Fixed**
- The Play button starts games the way Windows does (fixes Riot Client only opening itself).
- Closing a game unlocks its profile again.
- Duplicate Finder and Old Files never suggest game, program or app-data files.
- Always-running Steam tools no longer keep Game Boost on.

**Improved**
- Readability, plus a Home page and UI polish.

## v0.1.0

First release (as IcyCleaner): tweaks, presets, cleaner, debloater, services, networking, game profiles, Game Boost, overlay, and full undo of every change.
