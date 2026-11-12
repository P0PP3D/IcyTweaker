// Windows optional features ("Turn Windows features on or off"), each a tweak that turns one off (page 'features').
// Setting kind 'feature' (DISM, needs administrator; the backup keeps the original state, so Undo All turns it back
// on). Exact DISM feature names. A feature missing on this edition or build (Hyper-V on Home, PowerShell 2.0 on 24H2)
// reads as absent, so its card shows as unavailable.
import type { TweakMeta } from '../../shared/types';
import { tweak, type Tweak } from './engine';

const feature = (
  id: string,
  name: string,
  features: string[],
  description: string,
  extra: Partial<TweakMeta> = {},
): Tweak =>
  tweak(
    { id, name, description, category: 'system', page: 'features', risk: 'safe', requiresAdmin: true, requiresReboot: true, builds: { min: 19041 }, ...extra },
    features.map((f) => ({ ref: { kind: 'feature', name: f }, on: 'disabled', off: 'enabled' })),
  );

export const featureTweaks: Tweak[] = [
  feature('feature-smb1-off', 'SMB 1.0 Off', ['SMB1Protocol'], 'The 1980s file-sharing protocol behind WannaCry. Only very old NAS boxes and printers still need it.', { risk: 'balanced' }),
  feature('feature-powershell2-off', 'PowerShell 2.0 Off', ['MicrosoftWindowsPowerShellV2Root'], 'An old PowerShell version malware uses to slip past newer security checks. Nothing current needs it.'),
  feature('feature-xps-off', 'XPS Printing Off', ['Printing-XPSServices-Features'], 'Microsoft\'s old XPS document printer. "Print to PDF" stays.'),
  feature('feature-workfolders-off', 'Work Folders Off', ['WorkFolders-Client'], 'Company file sync for work PCs. Unused on home PCs.'),
  feature('feature-fax-off', 'Fax and Scan Off', ['FaxServicesClientPackage'], 'Windows Fax and Scan. Your scanner\'s own app and Windows Scan keep working.'),
  feature(
    'feature-hyperv-off',
    'Hyper-V Off',
    ['Microsoft-Hyper-V-All'],
    'Microsoft\'s virtual machine platform (Pro and up). Turning it off can lower input delay in games. Turn it back on if you use Hyper-V virtual machines.',
    { risk: 'balanced' },
  ),
  feature(
    'feature-vmp-off',
    'Virtual Machine Platform Off',
    ['VirtualMachinePlatform', 'HypervisorPlatform'],
    'The virtualization layer for WSL 2 and Android emulators. Off can lower input delay in games; leave it on if you use WSL, BlueStacks or similar.',
    { risk: 'balanced' },
  ),
  feature('feature-sandbox-off', 'Windows Sandbox Off', ['Containers-DisposableClientVM'], 'A throwaway Windows for testing programs (Pro and up). Uses the same virtualization as Hyper-V.'),
  feature('feature-recall-off', 'Recall Off (feature)', ['Recall'], 'Removes the Recall feature itself on Copilot+ PCs (screen snapshots). The Recall Off tweak only blocks it with a policy.', { builds: { min: 26100 } }),
];
