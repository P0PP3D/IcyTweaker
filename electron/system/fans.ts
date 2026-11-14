// Fan curves for Game Boost: while a game with a curve runs, the motherboard's controllable fans follow it (CPU
// temperature -> fan speed). Through LibreHardwareMonitor's library and the PawnIO driver (the CPU temperature setup).
//
// Safety: the curve logic lives here (tested); the PowerShell helper only reports the temperature and sets what it is
// told. Fans never go below FAN_MIN, run at 100 % from FAN_PANIC, and are handed back to the BIOS (SetDefault) when the
// temperature can't be read, when the game closes, and when IcyTweaker exits or crashes: the helper reads its orders
// from our pipe, and a closed pipe makes it reset and quit.
// verify: SetSoftware / SetDefault on real boards (Super I/O chips LibreHardwareMonitor supports); laptops usually
// expose no controls, and then nothing is changed.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { FanPoint } from '../../shared/types';
import { POWERSHELL_EXE } from './adapter';

/** Lowest speed we ever set (%): a stopped fan under load is how hardware gets hurt. */
export const FAN_MIN = 30;
/** From this CPU temperature (°C) the fans run at 100 %, whatever the curve says. */
export const FAN_PANIC = 85;

/** 2-8 points, temperatures 30-95 °C rising, speeds FAN_MIN-100 %. Sorted; null = invalid. */
export function validateCurve(raw: unknown): FanPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 8) return null;
  const pts = raw.map((p) => ({ t: Math.round(Number((p as FanPoint)?.t)), pct: Math.round(Number((p as FanPoint)?.pct)) }));
  if (pts.some((p) => !(p.t >= 30 && p.t <= 95) || !(p.pct >= FAN_MIN && p.pct <= 100))) return null;
  pts.sort((a, b) => a.t - b.t);
  return pts.every((p, i) => i === 0 || p.t > pts[i - 1].t) ? pts : null;
}

/** Fan speed for a temperature: linear between points, flat outside them, FAN_MIN floor, 100 % from FAN_PANIC. null = hand back to the BIOS. */
export function fanDuty(curve: FanPoint[], temp: number | null): number | null {
  if (temp === null || !Number.isFinite(temp) || temp <= 0) return null;
  if (temp >= FAN_PANIC) return 100;
  let pct = curve[curve.length - 1].pct;
  if (temp <= curve[0].t) pct = curve[0].pct;
  else
    for (let i = 1; i < curve.length; i++)
      if (temp <= curve[i].t) {
        const [a, b] = [curve[i - 1], curve[i]];
        pct = a.pct + ((b.pct - a.pct) * (temp - a.t)) / (b.t - a.t);
        break;
      }
  return Math.round(Math.min(100, Math.max(FAN_MIN, pct)));
}

const libLoad = (dir: string) =>
  `$ErrorActionPreference='SilentlyContinue'; Add-Type -Path '${path.join(dir, 'LibreHardwareMonitorLib.dll').replace(/'/g, "''")}'; ` +
  '$c = New-Object LibreHardwareMonitor.Hardware.Computer; $c.IsCpuEnabled = $true; $c.IsMotherboardEnabled = $true; $c.IsControllerEnabled = $true; $c.Open(); ' +
  'function All($h) { $h; foreach ($s in $h.SubHardware) { All $s } }; $hw = @(foreach ($h in $c.Hardware) { All $h }); foreach ($h in $hw) { $h.Update() }; ' +
  "$fans = @($hw | ForEach-Object { $_.Sensors } | Where-Object { $_.SensorType -eq 'Control' -and $_.Control }); ";

/** Read-only: the controllable fan channels' names, one per line (none = this PC's fans can't be controlled). */
export const fanListScript = (dir: string) => `${libLoad(dir)}$fans | ForEach-Object { [Console]::Out.WriteLine($_.Name) }; $c.Close()`;

/** The helper: prints "fans N" (or "nofans" and quits), then per round the CPU temperature ("na" if unreadable) and reads one order. */
export const fanLoop = (dir: string) =>
  `${libLoad(dir)}if (-not $fans.Count) { [Console]::Out.WriteLine('nofans'); $c.Close(); exit }; [Console]::Out.WriteLine("fans $($fans.Count)"); ` +
  'function Reset { foreach ($f in $fans) { $f.Control.SetDefault() } }; ' +
  "$cpu = @($hw | Where-Object { \"$($_.HardwareType)\" -eq 'Cpu' }); " +
  'try { while ($true) { $v = $null; foreach ($h in $hw) { $h.Update() }; ' +
  "foreach ($h in $cpu) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1; " +
  "if (-not $t) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' } | Sort-Object Value -Descending | Select-Object -First 1 }; " +
  'if ($t -and $t.Value -gt 0) { $v = [math]::Round($t.Value) } }; ' +
  "if ($v) { [Console]::Out.WriteLine($v) } else { [Console]::Out.WriteLine('na') }; " +
  "$o = [Console]::In.ReadLine(); if ($null -eq $o -or $o -eq 'stop') { break }; " +
  "if ($o -eq 'default') { Reset } else { $d = [float]$o; if ($d -ge " + FAN_MIN + ' -and $d -le 100) { foreach ($f in $fans) { $f.Control.SetSoftware($d) } } else { Reset } }; ' +
  'Start-Sleep 2 } } finally { Reset; $c.Close() }';

/**
 * Fan test (an exec: dry-run records it): every controllable fan held at `pct` for `seconds`, then back to the BIOS
 * (finally, so also on errors). Prints "before|Name|rpm" lines, then "after|Name|rpm" lines.
 */
export const fanTestScript = (dir: string, pct: number, seconds: number) =>
  `${libLoad(dir)}if (-not $fans.Count) { [Console]::Out.WriteLine('nofans'); $c.Close(); exit }; ` +
  "function Rpm($tag) { foreach ($h in $hw) { $h.Update() }; $hw | ForEach-Object { $_.Sensors } | Where-Object { $_.SensorType -eq 'Fan' } | ForEach-Object { [Console]::Out.WriteLine(\"$tag|$($_.Name)|$([math]::Round($_.Value))\") } }; " +
  `try { Rpm 'before'; foreach ($f in $fans) { $f.Control.SetSoftware(${Math.round(pct)}) }; Start-Sleep ${Math.round(seconds)}; Rpm 'after' } finally { foreach ($f in $fans) { $f.Control.SetDefault() }; $c.Close() }`;

/** fanTestScript output -> per fan, its speed before and while held. */
export function parseFanTest(out: string): Array<{ name: string; before: number | null; after: number | null }> {
  const rows = new Map<string, { name: string; before: number | null; after: number | null }>();
  for (const line of out.split(/\r?\n/)) {
    const [tag, name, rpm] = line.trim().split('|');
    if ((tag !== 'before' && tag !== 'after') || !name) continue;
    const row = rows.get(name) ?? { name, before: null, after: null };
    row[tag] = Number.isFinite(Number(rpm)) ? Number(rpm) : null;
    rows.set(name, row);
  }
  return [...rows.values()];
}

/** Read-only reader for the Game Boost page: one JSON line every 2 s (CPU / GPU °C, fan RPM, fan power %). */
export const sensorLoop = (dir: string) =>
  `${libLoad(dir).replace('$c.IsControllerEnabled = $true;', '$c.IsControllerEnabled = $true; $c.IsGpuEnabled = $true;')}` +
  'while ($true) { foreach ($h in $hw) { $h.Update() }; ' +
  "$cpu = $null; foreach ($h in ($hw | Where-Object { \"$($_.HardwareType)\" -eq 'Cpu' })) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1; if (-not $t) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' } | Sort-Object Value -Descending | Select-Object -First 1 }; if ($t -and $t.Value -gt 0) { $cpu = [math]::Round($t.Value) } }; " +
  "$gpu = $null; foreach ($h in ($hw | Where-Object { \"$($_.HardwareType)\" -like 'Gpu*' })) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Core' } | Select-Object -First 1; if ($t -and $t.Value -gt 0 -and -not $gpu) { $gpu = [math]::Round($t.Value) } }; " +
  "$s = @($hw | ForEach-Object { $_.Sensors }); " +
  "$fanRpm = @($s | Where-Object { $_.SensorType -eq 'Fan' -and $_.Value -ne $null } | ForEach-Object { @{ name = $_.Name; value = [math]::Round($_.Value) } }); " +
  "$fanPct = @($s | Where-Object { $_.SensorType -eq 'Control' -and $_.Value -ne $null } | ForEach-Object { @{ name = $_.Name; value = [math]::Round($_.Value) } }); " +
  "[Console]::Out.WriteLine((@{ cpu = $cpu; gpu = $gpu; fans = $fanRpm; power = $fanPct } | ConvertTo-Json -Compress -Depth 3)); Start-Sleep 2 }";

export interface FanControl {
  stop(): void;
}

/** Runs `curve` until stop(). Live and administrator only (the caller checks); events go to onState. */
export function startFanControl(dir: string, curve: FanPoint[], onState: (s: { fans?: number; temp?: number | null; duty?: number | null; error?: string }) => void): FanControl {
  const child: ChildProcess = spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', fanLoop(dir)], { windowsHide: true });
  let buf = '';
  let stopped = false;
  child.stdin?.on('error', () => {}); // the helper quit first: nothing to send
  child.stdout?.on('data', (b: Buffer) => {
    buf += b.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop()!;
    for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
      if (line === 'nofans') onState({ error: "No fans on this PC can be controlled (common on laptops and some motherboards). Nothing was changed." });
      else if (line.startsWith('fans ')) onState({ fans: Number(line.slice(5)) });
      else {
        const temp = line === 'na' ? null : Number(line);
        const duty = fanDuty(curve, temp);
        onState({ temp, duty });
        if (!stopped) child.stdin?.write(`${duty ?? 'default'}\n`);
      }
    }
  });
  child.on('error', (e) => onState({ error: e.message }));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      child.stdin?.end('stop\n'); // the helper resets the fans and exits
      // Last resort for a hung helper (a kill skips its reset; the BIOS takes over again at the next restart).
      setTimeout(() => child.exitCode === null && child.kill(), 15_000).unref();
    },
  };
}
