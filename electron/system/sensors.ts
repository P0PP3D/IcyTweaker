// CPU temperature: LibreHardwareMonitor's library (MPL-2.0), downloaded once into the app data folder and checked
// against a pinned SHA-256 (the release is not code-signed), reading through the PawnIO driver (installed with
// winget if missing). Reading needs administrator; without it the sensor reports 0 and the app shows "—".
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { POWERSHELL_EXE, SC_EXE, type SystemAdapter } from './adapter';
import { download } from './download';

/** Pinned release: v0.9.6 (2026-02-14). Update both together after checking the new zip. */
export const LHM_URL = 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip';
export const LHM_SHA256 = '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001';
export const PAWNIO_INSTALL_ARGS = ['install', '--id', 'namazso.PawnIO', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'];

export const sha256File = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

/** The library folder, downloading and unpacking the pinned release if needed. Only our app data folder is written. */
export async function ensureLhm(adapter: Pick<SystemAdapter, 'query'>, toolsDir: string): Promise<string> {
  const dir = path.join(toolsDir, 'lhm-0.9.6');
  if (existsSync(path.join(dir, 'LibreHardwareMonitorLib.dll'))) return dir;
  await mkdir(toolsDir, { recursive: true });
  const zip = path.join(toolsDir, 'lhm-0.9.6.zip');
  await download(LHM_URL, zip);
  const hash = await sha256File(zip);
  if (hash !== LHM_SHA256) {
    await rm(zip, { force: true });
    throw new Error(`LibreHardwareMonitor download did not match the expected file (SHA-256 ${hash.slice(0, 12)}…). Nothing was installed.`);
  }
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force`], 120_000);
  await rm(zip, { force: true });
  return dir;
}

export const pawnioInstalled = (adapter: Pick<SystemAdapter, 'query'>) => adapter.query(SC_EXE, ['query', 'PawnIO']).then(() => true, () => false);

/** Prints the CPU package temperature every 2 s ('na' when unreadable). Sensor names: Intel "CPU Package", AMD "Core (Tctl/Tdie)". */
export const tempLoop = (dir: string) =>
  `$ErrorActionPreference='SilentlyContinue'; Add-Type -Path '${path.join(dir, 'LibreHardwareMonitorLib.dll').replace(/'/g, "''")}'; ` +
  '$c = New-Object LibreHardwareMonitor.Hardware.Computer; $c.IsCpuEnabled = $true; $c.Open(); ' +
  'while ($true) { $v = $null; foreach ($h in $c.Hardware) { $h.Update(); ' +
  "$t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1; " +
  "if (-not $t) { $t = $h.Sensors | Where-Object { $_.SensorType -eq 'Temperature' } | Sort-Object Value -Descending | Select-Object -First 1 }; " +
  'if ($t -and $t.Value -gt 0) { $v = [math]::Round($t.Value) } }; ' +
  "if ($v) { [Console]::Out.WriteLine($v) } else { [Console]::Out.WriteLine('na') }; Start-Sleep 2 }";

/** Long-running reader (only while the overlay runs). */
export function startCpuTemp(dir: string, onTemp: (c: number | null) => void): ChildProcess {
  const child = spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', tempLoop(dir)], { windowsHide: true });
  child.stdout?.on('data', (b: Buffer) => {
    const n = Number(b.toString().trim().split(/\r?\n/).pop());
    onTemp(Number.isFinite(n) && n > 0 ? n : null);
  });
  child.on('error', () => onTemp(null));
  return child;
}
