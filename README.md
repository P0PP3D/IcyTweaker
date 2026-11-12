# IcyTweaker

A Windows 10/11 optimizer for gamers: tweaks, cleaning, Game Boost and per-game settings, with an undo for everything.

## Download

Get `IcyTweaker-Setup-x.y.z.exe` from [Releases](https://github.com/P0PP3D/IcyTweaker/releases/latest) and run it.

- **"Windows protected your PC"**: the installer isn't code-signed yet. Click **More info**, then **Run anyway**.
- It asks for **administrator** at every start (UAC). Most tweaks need it.
- Installed copies check this page for updates and only install one when you click.

## What it does

- **Tweaks**: general, network, services, power and advanced settings. Each one shows its risk and can be reverted.
- **Cleaner**: temp files, caches, shader caches, a disk analyzer, duplicate finder and privacy traces.
- **Game Boost**: when a game starts, switches to a performance power plan, lowers background apps, can pause Windows Update and OneDrive, free standby memory and change the display mode. All of it is undone when the game closes.
- **Game profiles**: competitive settings for Fortnite, VALORANT, Apex Legends, CS2, Marvel Rivals, Deadlock, Roblox, Minecraft, Dead by Daylight and The Outlast Trials, plus Play buttons and per-game Windows settings for every Steam and Epic game.
- **Overlay and session history**: FPS, 1% low, temperatures, and the apps that were busy when FPS dropped.
- **Debloater, startup manager, driver tools, restore points** and a full change history.

## Safety

- Every change backs up the original value first. Undo one tweak, everything since a date, or everything at once.
- Bulk changes create a System Restore point first.
- No telemetry and no accounts. The only network calls are the ones you start, such as the latency test, DNS benchmark, driver and tool downloads, and the update check.

Use at your own risk. Create a restore point before big changes.

## Build from source

Requires Node.js 22+ on Windows.

```
npm install
npm run dev      # development, dry-run: nothing on your PC is changed
npm test
npm run dist     # installer in release/
```

## License

MIT. See [LICENSE](LICENSE). Game names, logos and art belong to their owners; this project isn't affiliated with them (see `Docs/ASSETS.md`).
