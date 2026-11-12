// Advanced page tweaks (page 'advanced'). Power settings change the active plan, plugged-in (AC) values only.
import type { TweakMeta } from '../../shared/types';
import { dword, type SettingRef } from '../system/adapter';
import { regDwordTweak, tweak, type Tweak } from '../tweaks/engine';

const meta = (m: Pick<TweakMeta, 'id' | 'name' | 'description'> & Partial<TweakMeta>): TweakMeta => ({
  category: 'performance',
  risk: 'balanced',
  requiresAdmin: true,
  requiresReboot: false,
  builds: { min: 19041 },
  page: 'advanced',
  ...m,
});

const SUB_PROCESSOR = '54533251-82be-4824-96c1-47b60b740d00';
const cpu = (setting: string): SettingRef => ({ kind: 'power', scheme: 'current', sub: SUB_PROCESSOR, setting, ac: true });

/** Devices (GPU, network) whose driver exposes MSI settings. */
export interface MsiDevice {
  name: string;
  pnp: string;
}

export function advancedTweaks(msiDevices: MsiDevice[]): Tweak[] {
  return [
    regDwordTweak(
      meta({
        id: 'timer-resolution-global',
        name: 'Global Timer Resolution',
        description: 'Windows 11 only honors a high timer resolution for the app that asked for it. This makes such requests apply system-wide again, as on Windows 10.',
        requiresReboot: true,
        builds: { min: 22000 },
        warning: 'Slightly higher power use whenever any app requests a fine timer. Benefit varies by game.',
      }),
      { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel', name: 'GlobalTimerResolutionRequests', enabled: 1, defaultValue: null },
    ),
    tweak(meta({ id: 'cpu-core-parking-off', hardware: { laptop: false }, name: 'Core Parking Off', description: 'Keeps every CPU core available instead of parking idle ones (active power plan, plugged in).', warning: 'Higher idle power use.' }), [
      { ref: cpu('0cc5b647-c1df-4637-891a-dec35c318583'), on: 100, off: null }, // CPMINCORES, percent
    ]),
    tweak(
      meta({ id: 'cpu-min-state-100', hardware: { laptop: false }, name: 'Minimum Processor State 100%', description: 'Keeps the CPU at full clock instead of ramping up when a game asks for it (active power plan, plugged in).', warning: 'More heat and power use at idle.' }),
      [{ ref: cpu('893dee8e-2bef-41e0-89c6-b55d0929964c'), on: 100, off: null }], // PROCTHROTTLEMIN, percent
    ),
    tweak(meta({ id: 'cpu-boost-aggressive', name: 'Aggressive CPU Boost', description: 'Processor performance boost mode set to Aggressive (active power plan, plugged in).', risk: 'safe' }), [
      { ref: cpu('be337238-0d82-4146-a960-4f3749d470c7'), on: 2, off: null }, // PERFBOOSTMODE: 0 off, 1 on, 2 aggressive
    ]),
    tweak(
      meta({
        id: 'cpu-idle-disable',
        hardware: { laptop: false },
        name: 'CPU Idle States Off',
        description: 'Stops the CPU entering idle (C-) states, removing wake-up latency (active power plan, plugged in).',
        risk: 'risky',
        warning: 'The CPU runs at 100% load all the time: much more heat, fan noise and power. Only for short sessions on a desktop with good cooling.',
      }),
      [{ ref: cpu('5d76a2ca-e8c0-402f-a133-2158492d58ad'), on: 1, off: 0 }], // IDLEDISABLE
    ),
    ...msiDevices.map((d, i) =>
      regDwordTweak(
        meta({
          id: `msi-mode-${i}`,
          name: `MSI Mode: ${d.name}`,
          description: 'Message-signaled interrupts for this device instead of shared line-based ones. Most modern GPU and network drivers already use them.',
          risk: 'risky',
          requiresReboot: true,
          warning: 'If the device misbehaves or the screen stays black after the restart, boot into Safe Mode and turn this off (or use a restore point).',
        }),
        {
          hive: 'HKLM',
          key: `SYSTEM\\CurrentControlSet\\Enum\\${d.pnp}\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties`,
          name: 'MSISupported',
          enabled: 1,
          defaultValue: null,
        },
      ),
    ),
    tweak(
      meta({
        id: 'mitigations-off',
        name: 'CPU Security Mitigations Off',
        category: 'security',
        description: 'Turns off the Spectre variant 2 and Meltdown mitigations (Microsoft\'s documented override). Can raise performance on older CPUs.',
        risk: 'risky',
        requiresReboot: true,
        warning: 'Large security cost: malicious code (including in a browser) can read memory from other programs. Little or no gain on recent CPUs.',
      }),
      [
        { ref: { kind: 'reg', hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'FeatureSettingsOverride' }, on: dword(3), off: null },
        { ref: { kind: 'reg', hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'FeatureSettingsOverrideMask' }, on: dword(3), off: null },
      ],
    ),
    regDwordTweak(
      meta({
        id: 'memory-integrity-off',
        anticheat: { names: ['Vanguard', 'FACEIT'], note: 'may refuse to start on PCs they flag until Memory Integrity is back on' },
        name: 'Memory Integrity (HVCI) Off',
        category: 'security',
        description: 'Turns off Core Isolation > Memory Integrity, which can cost a few percent of performance in games.',
        risk: 'risky',
        requiresReboot: true,
        warning:
          'Lowers protection against malicious drivers. Valorant (Vanguard) and some other anti-cheats may refuse to run with it off on some PCs; the "Valorant HVCI Memory Integrity Fix" turns it back on.',
      }),
      { hive: 'HKLM', key: 'SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity', name: 'Enabled', enabled: 0, defaultValue: 1 },
    ),
  ];
}
