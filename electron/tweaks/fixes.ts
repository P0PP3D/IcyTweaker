// Fixes page: one-shot repairs. Each runs behind a restore point. `changes` are backed up (Undo All
// reverses them); `script` is an action that only a restore point can undo, so those fixes are `permanent`.
import { dword, type SettingRef, type StartType, type Value } from '../system/adapter';
import type { FixDefinition } from './engine';

const service = (name: string, start: StartType): [SettingRef, Value] => [{ kind: 'service', name }, start];
const delReg = (key: string, name: string): [SettingRef, null] => [{ kind: 'reg', hive: 'HKLM', key, name }, null];

const base = { risk: 'safe' as const, requiresAdmin: true, requiresReboot: false, permanent: false };

export const fixes: FixDefinition[] = [
  {
    ...base,
    id: 'valorant-cfg',
    name: 'Valorant Fix CFG',
    description: 'Turns Control Flow Guard back on system-wide. Vanguard refuses to start when it has been switched off.',
    permanent: true,
    requiresReboot: true,
    script: 'Set-ProcessMitigation -System -Enable CFG',
  },
  {
    ...base,
    id: 'valorant-hvci',
    name: 'Valorant HVCI Memory Integrity Fix',
    description: 'Turns Memory Integrity (Core isolation) on, which Vanguard can require.',
    risk: 'balanced',
    requiresReboot: true,
    warning: 'Drivers that are not compatible with Memory Integrity stop loading. Windows Security lists them if that happens.',
    changes: [[{ kind: 'reg', hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity', name: 'Enabled' }, dword(1)]],
  },
  {
    ...base,
    id: 'nvidia-control-panel',
    name: 'NVIDIA Control Panel (No Microsoft Store)',
    description: 'Opens NVIDIA Control Panel straight from its installed files, for when the Store version will not launch.',
    requiresAdmin: false,
    script:
      // A Store app's exe (under WindowsApps) can't be started by path ("Access is denied"): it starts by its app id.
      "$p = Get-AppxPackage -Name 'NVIDIACorp.NVIDIAControlPanel' | Select-Object -First 1; " +
      "if ($p) { $id = @((Get-AppxPackageManifest $p).Package.Applications.Application)[0].Id; " +
      "Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('shell:AppsFolder\\' + $p.PackageFamilyName + '!' + $id); return }; " +
      "$exe = Join-Path $env:ProgramFiles 'NVIDIA Corporation\\Control Panel Client\\nvcplui.exe'; " +
      "if (-not (Test-Path $exe)) { throw 'NVIDIA Control Panel is not installed.' }; Start-Process -FilePath $exe",
  },
  {
    ...base,
    id: 'wifi',
    name: 'WiFi Fix',
    description: 'Sets WLAN AutoConfig and WinHTTP Auto-Proxy back to start automatically.',
    // verify: WinHttpAutoProxySvc's registry key is protected on some builds, so sc config may be refused.
    changes: [service('WlanSvc', 'auto'), service('WinHttpAutoProxySvc', 'auto')],
  },
  {
    ...base,
    id: 'bluetooth',
    name: 'Bluetooth Fix',
    description: 'Restores the Bluetooth support and audio gateway services to their Windows default (Manual, start on demand).',
    changes: [service('bthserv', 'demand'), service('BTAGService', 'demand')],
  },
  {
    ...base,
    id: 'installer-2502',
    name: 'Error 2502/2503 Fix',
    description: 'Recreates your Temp folder and gives your account full control of it, so Windows Installer can unpack setups again.',
    requiresAdmin: false,
    permanent: true,
    script: 'New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null; icacls.exe "$env:TEMP" /grant "${env:USERNAME}:(OI)(CI)F" /T /C /Q | Out-Null',
  },
  {
    ...base,
    id: 'store-update',
    name: 'Microsoft Store/Update Fix',
    description:
      'Puts the Windows Update, BITS, Cryptographic and Store install services back to their default start types and removes policies that block the Store or Windows Update. Fixes 0x80070422 and most 0x80070005 errors.',
    requiresReboot: true,
    changes: [
      service('wuauserv', 'demand'),
      service('BITS', 'demand'),
      service('CryptSvc', 'auto'),
      service('InstallService', 'demand'),
      delReg('SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'RemoveWindowsStore'),
      delReg('SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'DisableStoreApps'),
      delReg('SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate', 'DisableWindowsUpdateAccess'),
      delReg('SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU', 'NoAutoUpdate'),
    ],
  },
  {
    ...base,
    id: 'power-sleep-settings',
    name: 'Power and Sleep Setting',
    description: 'Sets the Sensor Service back to Manual, which makes the Power & sleep settings page open again.',
    changes: [service('SensorService', 'demand')],
  },
  {
    ...base,
    id: 're-enable-defender',
    name: 'Re-Enable Defender',
    description:
      "Reverts the app's Defender tweaks (RT Scan Trim, Security Quiet), removes policies that switch Defender off, and resets the Windows Security app if its page is blank.",
    permanent: true,
    revertTweaks: ['rt-scan-trim', 'security-quiet', 'disable-defender'],
    changes: [
      delReg('SOFTWARE\\Policies\\Microsoft\\Windows Defender', 'DisableAntiSpyware'),
      delReg('SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection', 'DisableRealtimeMonitoring'),
    ],
    script: "Get-AppxPackage -Name 'Microsoft.SecHealthUI' | Reset-AppxPackage",
  },
  {
    ...base,
    id: 'audio',
    name: 'Audio Fix',
    description: 'Restarts the Windows Audio services, which brings back sound after a driver or device glitch.',
    permanent: true,
    script: 'Restart-Service -Name AudioEndpointBuilder -Force; Start-Service -Name Audiosrv',
  },
  {
    ...base,
    id: 'search-icon-cache',
    name: 'Search and Icon Cache Rebuild',
    description: 'Rebuilds the icon and thumbnail caches (Explorer restarts briefly) and tells Windows Search to rebuild its index.',
    permanent: true,
    script:
      "Stop-Process -Name explorer -Force; Start-Sleep -Seconds 2; " +
      "Remove-Item -Force -ErrorAction SilentlyContinue \"$env:LOCALAPPDATA\\IconCache.db\", \"$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\iconcache_*.db\", \"$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\thumbcache_*.db\"; " +
      'Start-Process explorer.exe; ' +
      "Stop-Service -Name WSearch -Force; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows Search' -Name SetupCompletedSuccessfully -Value 0; Start-Service -Name WSearch",
  },
  {
    ...base,
    id: 'print-spooler',
    name: 'Print Spooler Reset',
    description: 'Clears stuck print jobs and restarts the print spooler.',
    permanent: true,
    warning: 'Every queued print job is deleted.',
    script: "Stop-Service -Name Spooler -Force; Remove-Item -Force -ErrorAction SilentlyContinue \"$env:SystemRoot\\System32\\spool\\PRINTERS\\*\"; Start-Service -Name Spooler",
  },
  {
    ...base,
    id: 'network-reset',
    name: 'Network Full Reset',
    description: 'Resets Winsock, TCP/IP, the firewall and the DNS cache to Windows defaults.',
    risk: 'risky',
    permanent: true,
    requiresReboot: true,
    warning: 'Custom firewall rules (including ones games and apps added) are deleted, and static IP or DNS settings may need to be entered again.',
    script: 'netsh winsock reset; netsh int ip reset; netsh advfirewall reset; ipconfig /flushdns',
  },
  {
    ...base,
    id: 'undo-everything',
    name: 'Undo Everything This App Changed',
    description: 'Puts back every setting the app has ever changed, from its backup. Same as "Undo all changes" in the sidebar.',
    requiresAdmin: false,
    undoAll: true,
  },
];
