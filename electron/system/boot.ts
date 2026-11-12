// Boot analysis: Windows' own boot timing (Diagnostics-Performance event 100) and the apps it found slowing
// startup (event 101). Read-only. The log is readable by administrators only.
import type { BootInfo } from '../../shared/types';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

export const BOOT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$log = 'Microsoft-Windows-Diagnostics-Performance/Operational'
function Get-EventFields($e) { $d = @{}; ([xml]$e.ToXml()).Event.EventData.Data | ForEach-Object { $d[$_.Name] = $_.'#text' }; $d }
$out = @{ lastBoot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o'); boots = @(); slow = @(); error = $null }
try {
  $out.boots = @(Get-WinEvent -FilterHashtable @{ LogName = $log; Id = 100 } -MaxEvents 10 -ErrorAction Stop | ForEach-Object {
    $d = Get-EventFields $_; @{ at = $_.TimeCreated.ToString('o'); total = [int]$d.BootTime; main = [int]$d.MainPathBootTime; post = [int]$d.BootPostBootTime } })
  $out.slow = @(Get-WinEvent -FilterHashtable @{ LogName = $log; Id = 101 } -MaxEvents 50 -ErrorAction SilentlyContinue | ForEach-Object {
    $d = Get-EventFields $_; @{ name = $d.FriendlyName; file = $d.Name; total = [int]$d.TotalTime; degradation = [int]$d.DegradationTime } })
} catch { $out.error = $_.Exception.Message }
$out | ConvertTo-Json -Depth 4 -Compress
`;

export function parseBoot(json: string, admin: boolean): BootInfo {
  const r = JSON.parse(json) as {
    lastBoot: string;
    boots: Array<{ at: string; total: number; main: number; post: number }> | null;
    slow: Array<{ name: string; file: string; total: number; degradation: number }> | null;
    error: string | null;
  };
  const boots = (r.boots ?? []).filter((b) => b.total > 0);
  // Event 101 repeats per boot; keep each app's worst recent slowdown.
  const slow = new Map<string, { name: string; degradationMs: number }>();
  for (const s of r.slow ?? []) {
    const name = s.name || s.file;
    if (name && s.degradation > (slow.get(name)?.degradationMs ?? 0)) slow.set(name, { name, degradationMs: s.degradation });
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    lastBoot: r.lastBoot,
    lastBootMs: boots[0]?.total ?? null,
    averageBootMs: avg(boots.map((b) => b.total)),
    // Boot to desktop vs the "post boot" part where startup apps load.
    lastMainMs: boots[0]?.main ?? null,
    lastPostMs: boots[0]?.post ?? null,
    slowApps: [...slow.values()].sort((a, b) => b.degradationMs - a.degradationMs).slice(0, 10),
    note: boots.length ? undefined : admin ? 'Windows has no boot timing recorded yet (it records after some restarts).' : 'Boot times are in a log only administrators can read. Relaunch as admin to see them.',
  };
}

export async function bootInfo(adapter: Pick<SystemAdapter, 'query'>, admin: boolean): Promise<BootInfo> {
  return parseBoot(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', BOOT_SCRIPT], 60_000), admin);
}
