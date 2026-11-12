// Hardware detection and the BIOS audit. Read-only: one PowerShell query (CIM + one registry value) and nvidia-smi.
// Nothing here writes firmware or BIOS settings; changing them is left to the BIOS itself (Restart to BIOS).
import path from 'node:path';
import type { AuditItem, HardwareInfo } from '../../shared/types';
import { POWERSHELL_EXE, type SystemAdapter } from '../system/adapter';

export const HW_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS
$board = Get-CimInstance Win32_BaseBoard
$mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { @{ speed = $_.Speed; configured = $_.ConfiguredClockSpeed; type = $_.SMBIOSMemoryType; size = $_.Capacity; part = "$($_.PartNumber)".Trim() } })
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; driver = $_.DriverVersion; pnp = $_.PNPDeviceID } })
$nics = @(Get-CimInstance Win32_NetworkAdapter -Filter "PhysicalAdapter=True AND NetEnabled=True" | ForEach-Object { @{ name = $_.Name; pnp = $_.PNPDeviceID } })
$tpm = Get-CimInstance -Namespace root/cimv2/Security/MicrosoftTpm -ClassName Win32_Tpm
$dg = Get-CimInstance -Namespace root/Microsoft/Windows/DeviceGuard -ClassName Win32_DeviceGuard
$vendor = if (Get-CimInstance -Namespace root/dcim/sysman/biosattributes -ClassName EnumerationAttribute | Select-Object -First 1) { 'Dell' } elseif (Get-CimInstance -Namespace root/wmi -ClassName Lenovo_BiosSetting | Select-Object -First 1) { 'Lenovo' } elseif (Get-CimInstance -Namespace root/HP/InstrumentedBIOS -ClassName HP_BIOSSetting | Select-Object -First 1) { 'HP' } else { $null }
@{
  maker = $cs.Manufacturer; model = $cs.Model; hypervisor = $cs.HypervisorPresent
  cpu = "$($cpu.Name)".Trim(); cpuVendor = $cpu.Manufacturer; cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; vtFirmware = $cpu.VirtualizationFirmwareEnabled
  biosVersion = $bios.SMBIOSBIOSVersion; biosDate = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
  boardMaker = $board.Manufacturer; board = $board.Product
  memory = $mem; gpus = $gpus; nics = $nics; chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes); battery = [bool](Get-CimInstance Win32_Battery)
  secureBoot = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State').UEFISecureBootEnabled
  tpm = if ($tpm) { @{ enabled = $tpm.IsEnabled_InitialValue; version = $tpm.SpecVersion } } else { $null }
  vbs = $dg.VirtualizationBasedSecurityStatus; hvciRunning = @($dg.SecurityServicesRunning) -contains 2
  biosVendorTool = $vendor
  systemSsd = $(try { $n = (Get-Partition -DriveLetter $env:SystemDrive.TrimEnd(':')).DiskNumber; $m = "$((Get-PhysicalDisk | Where-Object DeviceId -eq "$n").MediaType)"; if ($m -eq 'SSD') { $true } elseif ($m -eq 'HDD') { $false } else { $null } } catch { $null })
} | ConvertTo-Json -Depth 4 -Compress
`;

/** SMBIOS chassis types that are portable (laptop, notebook, tablet, convertible, ...). */
const PORTABLE = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32]);
const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseHardware(json: string): HardwareInfo {
  const r = JSON.parse(json);
  const memory = arr<{ speed: number; configured: number; type: number; size: number; part: string }>(r.memory);
  return {
    maker: r.maker ?? '',
    model: r.model ?? '',
    board: [r.boardMaker, r.board].filter(Boolean).join(' '),
    boardMaker: r.boardMaker ?? '',
    biosVersion: r.biosVersion ?? null,
    biosDate: r.biosDate ?? null,
    cpu: r.cpu ?? '',
    cpuVendor: /amd/i.test(r.cpuVendor ?? '') ? 'AMD' : /intel/i.test(r.cpuVendor ?? '') ? 'Intel' : 'other',
    cores: r.cores ?? 0,
    threads: r.threads ?? 0,
    laptop: !!r.battery || arr<number>(r.chassis).some((c) => PORTABLE.has(c)),
    gpus: arr<{ name: string; driver: string; pnp: string }>(r.gpus).map((g) => ({
      name: g.name,
      driver: g.driver,
      pnp: g.pnp,
      vendor: /VEN_10DE/i.test(g.pnp) ? 'NVIDIA' : /VEN_1002/i.test(g.pnp) ? 'AMD' : /VEN_8086/i.test(g.pnp) ? 'Intel' : 'other',
    })),
    nics: arr<{ name: string; pnp: string }>(r.nics),
    memory: {
      totalBytes: memory.reduce((a, m) => a + (m.size ?? 0), 0),
      modules: memory.length,
      // SMBIOS memory type 26 = DDR4, 34 = DDR5.
      type: memory[0]?.type === 34 ? 'DDR5' : memory[0]?.type === 26 ? 'DDR4' : null,
      ratedMTs: memory.length ? Math.min(...memory.map((m) => m.speed ?? 0)) : null,
      runningMTs: memory.length ? Math.min(...memory.map((m) => m.configured ?? 0)) : null,
    },
    virtualization: { firmware: r.vtFirmware ?? null, hypervisor: !!r.hypervisor },
    secureBoot: r.secureBoot === 1 ? true : r.secureBoot === 0 ? false : null,
    tpm: r.tpm ? { enabled: !!r.tpm.enabled, version: String(r.tpm.version ?? '').split(',')[0].trim() || null } : null,
    vbsRunning: r.vbs === 2,
    hvciRunning: !!r.hvciRunning,
    biosVendorTool: r.biosVendorTool ?? null,
    systemSsd: typeof r.systemSsd === 'boolean' ? r.systemSsd : null,
  };
}

/** nvidia-smi -q -d MEMORY: BAR1 larger than 256 MiB means Resizable BAR is on. Labels are not localized. */
export function rebarFromSmi(text: string): boolean | null {
  const m = /BAR1 Memory Usage\s*[\r\n]+\s*Total\s*:\s*(\d+)\s*MiB/i.exec(text);
  return m ? Number(m[1]) > 256 : null;
}

export async function detectHardware(adapter: SystemAdapter, systemRoot: string): Promise<{ hw: HardwareInfo; rebar: boolean | null }> {
  const hw = parseHardware(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', HW_SCRIPT], 60_000));
  let rebar: boolean | null = null;
  if (hw.gpus.some((g) => g.vendor === 'NVIDIA')) {
    rebar = rebarFromSmi(await adapter.query(path.join(systemRoot, 'System32', 'nvidia-smi.exe'), ['-q', '-d', 'MEMORY']).catch(() => ''));
  }
  return { hw, rebar };
}

// JEDEC top speeds: a kit running at or below these usually has XMP/EXPO off (a rated-3200 DDR4 kit is the exception).
const JEDEC_TOP = { DDR4: 2666, DDR5: 4800 };

/** Plain findings worth acting on. status: good / check (worth a look) / info (unknown or not applicable). */
export function auditBios(hw: HardwareInfo, rebar: boolean | null): AuditItem[] {
  const items: AuditItem[] = [];
  const { memory: m } = hw;
  if (m.runningMTs && m.ratedMTs) {
    const belowRated = m.runningMTs < m.ratedMTs;
    const atJedec = !!m.type && m.runningMTs <= JEDEC_TOP[m.type];
    items.push({
      id: 'xmp',
      name: hw.cpuVendor === 'AMD' ? 'Memory profile (XMP / EXPO / DOCP)' : 'Memory profile (XMP)',
      status: belowRated || atJedec ? 'check' : 'good',
      detail:
        `${m.type ?? 'RAM'} running at ${m.runningMTs} MT/s; modules report ${m.ratedMTs} MT/s.` +
        (belowRated ? ' It runs below its rating: turn on the memory profile in the BIOS.' : atJedec ? ' This is a standard (JEDEC) speed; if your kit is sold faster, turn on its memory profile.' : ' Looks like the profile is on.'),
    });
  }
  items.push({
    id: 'rebar',
    name: 'Resizable BAR',
    status: rebar === true ? 'good' : rebar === false ? 'check' : 'info',
    detail:
      rebar === true
        ? 'On (the GPU exposes all of its memory to the CPU).'
        : rebar === false
          ? 'Off. On RTX 30-series and newer (or Radeon RX 6000+), turn on "Above 4G Decoding" and "Re-Size BAR" in the BIOS. Needs UEFI boot (CSM off).'
          : 'Windows can not tell on this GPU. Check "Re-Size BAR" / "Smart Access Memory" in the BIOS or the GPU control panel.',
  });
  items.push({
    id: 'secure-boot',
    name: 'Secure Boot',
    status: hw.secureBoot ? 'good' : hw.secureBoot === false ? 'check' : 'info',
    detail: hw.secureBoot ? 'On.' : hw.secureBoot === false ? 'Off. Valorant (Vanguard) requires it on Windows 11, and some other anti-cheats do too.' : 'Unknown (legacy BIOS boot?).',
  });
  items.push({
    id: 'tpm',
    name: 'TPM',
    status: hw.tpm ? (hw.tpm.enabled ? 'good' : 'check') : 'info',
    detail: hw.tpm
      ? hw.tpm.enabled
        ? `On (version ${hw.tpm.version ?? 'unknown'}).`
        : 'Present but off. Turn on fTPM (AMD) or PTT (Intel) in the BIOS; Windows 11 and Vanguard need it.'
      : 'Not readable without administrator.',
  });
  items.push({
    id: 'virtualization',
    name: 'CPU virtualization (SVM / VT-x)',
    status: hw.virtualization.firmware || hw.virtualization.hypervisor ? 'good' : 'info',
    detail: hw.virtualization.hypervisor
      ? 'On, and a hypervisor is running (VBS, WSL or Hyper-V).'
      : hw.virtualization.firmware
        ? 'On in the BIOS.'
        : 'Off. Only needed for WSL, Android apps, VMs and Memory Integrity; leave it off if you use none.',
  });
  items.push({
    id: 'bios-version',
    name: 'BIOS version',
    status: 'info',
    detail: `${hw.biosVersion ?? 'unknown'}${hw.biosDate ? `, released ${hw.biosDate}` : ''}. Update it from ${hw.boardMaker || 'the maker'}'s support page only if a release note fixes something you have; never flash during a storm or on battery.`,
  });
  return items;
}

/** Where the common settings live, per board brand. Menu names change between models and BIOS versions. */
export const BIOS_GUIDES: Array<{ brand: RegExp; name: string; steps: string[] }> = [
  {
    brand: /asus/i,
    name: 'ASUS',
    steps: ['F7 for Advanced Mode.', 'Memory profile: Ai Tweaker > Ai Overclock Tuner > XMP I (Intel) or DOCP / EXPO (AMD).', 'Resizable BAR: Advanced > PCI Subsystem Settings > Above 4G Decoding and Re-Size BAR Support.', 'TPM: Advanced > PCH-FW Configuration (Intel PTT) or Advanced > AMD fTPM Configuration.'],
  },
  {
    brand: /micro-star|msi/i,
    name: 'MSI',
    steps: ['F7 for Advanced Mode.', 'Memory profile: OC > Extreme Memory Profile (XMP), or "A-XMP" / "EXPO" on the main screen.', 'Resizable BAR: Settings > Advanced > PCIe/PCI Sub-system Settings > Above 4G memory and Re-Size BAR Support.', 'TPM: Settings > Security > Trusted Computing > AMD fTPM switch / Intel PTT.'],
  },
  {
    brand: /gigabyte/i,
    name: 'Gigabyte',
    steps: ['F2 for Advanced Mode.', 'Memory profile: Tweaker > Extreme Memory Profile (X.M.P.) or EXPO.', 'Resizable BAR: Settings > IO Ports > Above 4G Decoding and Re-Size BAR Support.', 'TPM: Settings > Miscellaneous > AMD CPU fTPM / Intel Platform Trust Technology (PTT).'],
  },
  {
    brand: /asrock/i,
    name: 'ASRock',
    steps: ['F6 for Advanced Mode.', 'Memory profile: OC Tweaker > DRAM Configuration > Load XMP Setting (or EXPO).', 'Resizable BAR: Advanced > PCI Configuration > Above 4G Decoding and C.A.M. (Clever Access Memory).', 'TPM: Security > AMD fTPM switch / Intel PTT.'],
  },
];
export const GENERIC_GUIDE = [
  'Laptops and prebuilt PCs often hide memory and PCIe options; look for the maker\'s own utility instead.',
  'Memory profile: look for XMP, EXPO or DOCP on the main or overclocking screen.',
  'Resizable BAR: look for "Above 4G Decoding" and "Re-Size BAR" / "Smart Access Memory" under PCIe settings.',
  'Save with F10 and confirm. If the PC fails to start after a memory change, it usually resets itself after three tries.',
];
