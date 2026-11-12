// Debloater: list installed desktop and Store apps (read-only query), flag protected / vendor / suggested,
// and uninstall the ones the user picked. Uninstall commands come from main's own listing, never the renderer.
import type { AppItem } from '../../shared/types';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CMD_EXE, POWERSHELL_EXE, type SystemAdapter } from './adapter';
import { appExes, lastRun, NOT_A_LAUNCH, runTimes } from './usage';

const LIST_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
         'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
         'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$d = foreach ($p in $paths) {
  Get-ItemProperty $p | Where-Object { $_.DisplayName -and $_.UninstallString -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName } |
    Select-Object @{n='key';e={$_.PSPath -replace '^.*::',''}}, DisplayName, DisplayVersion, Publisher, EstimatedSize, InstallDate, UninstallString, QuietUninstallString, InstallLocation, DisplayIcon
}
$s = Get-AppxPackage | Select-Object Name, PackageFullName, Version, Publisher, IsFramework, NonRemovable, InstallLocation, @{n='SignatureKind';e={"$($_.SignatureKind)"}}
[pscustomobject]@{ desktop = @($d); store = @($s) } | ConvertTo-Json -Depth 3 -Compress
`;

interface RawDesktop {
  key: string;
  DisplayName: string;
  DisplayVersion?: string;
  Publisher?: string;
  EstimatedSize?: number;
  InstallDate?: string;
  UninstallString: string;
  QuietUninstallString?: string;
  InstallLocation?: string;
  DisplayIcon?: string;
}
interface RawStore {
  Name: string;
  PackageFullName: string;
  Version: string;
  Publisher: string;
  IsFramework: boolean;
  NonRemovable: boolean;
  InstallLocation?: string;
  SignatureKind: string;
}

/** A Store app's own icon: Square44x44Logo (else Logo) from its manifest, at the variant Windows would pick for 32 px. */
export async function storeLogo(dir: string): Promise<string | null> {
  const manifest = await readFile(path.join(dir, 'AppxManifest.xml'), 'utf8').catch(() => '');
  const rel = /Square44x44Logo="([^"]+)"/.exec(manifest)?.[1] ?? /<Logo>([^<]+)<\/Logo>/.exec(manifest)?.[1];
  if (!rel) return null;
  const full = path.join(dir, rel);
  if (existsSync(full)) return full;
  // Assets ship as scale / target-size variants: Logo.png -> Logo.targetsize-32_altform-unplated.png, Logo.scale-100.png ...
  const ext = path.extname(full).toLowerCase();
  const base = path.basename(full, ext).toLowerCase() + '.';
  const files = (await readdir(path.dirname(full)).catch(() => [] as string[])).filter((f) => f.toLowerCase().startsWith(base) && f.toLowerCase().endsWith(ext));
  const rank = (f: string) => ['targetsize-32_altform-unplated', 'targetsize-32', 'scale-100', 'targetsize-48'].findIndex((t) => f.toLowerCase().includes(t)) >>> 0; // -1 -> last
  const best = files.sort((a, b) => rank(a) - rank(b))[0];
  return best ? path.join(path.dirname(full), best) : null;
}

/** A desktop app's icon file: DisplayIcon when it's an .exe or .ico, else the first program in its install folder. */
export async function desktopIconFile(installLocation?: string, displayIcon?: string): Promise<string | null> {
  const icon = displayIcon?.replace(/^"|"?(,-?\d+)?$/g, '').trim();
  if (icon && /\.(exe|ico)$/i.test(icon) && existsSync(icon)) return icon;
  const dir = installLocation?.replace(/^"|"$/g, '');
  if (!dir) return null;
  const exe = (await readdir(dir).catch(() => [] as string[])).find((f) => f.toLowerCase().endsWith('.exe') && !NOT_A_LAUNCH.test(f));
  return exe ? path.join(dir, exe) : null;
}

/** Never offered for removal. */
const PROTECTED_STORE: Array<[RegExp, string]> = [
  [/^Microsoft\.(WindowsStore|StorePurchaseApp|DesktopAppInstaller)$/i, 'Microsoft Store and app installer'],
  [/^Microsoft\.SecHealthUI$/i, 'Windows Security'],
  [/^Microsoft\.(VCLibs|UI\.Xaml|NET\.|WindowsAppRuntime|Services\.Store)/i, 'Runtime other apps need'],
  [/^Microsoft\.(Windows\.ShellExperienceHost|Windows\.StartMenuExperienceHost|AAD\.BrokerPlugin|AccountsControl|LockApp|Win32WebViewHost|Windows\.CloudExperienceHost|WebExperience)/i, 'Part of Windows'],
  [/^(NVIDIACorp|AdvancedMicroDevicesInc|AppUp\.Intel|RealtekSemiconductorCorp|DolbyLaboratories|WavesAudio)\./i, 'Driver companion app'],
];
const PROTECTED_DESKTOP: Array<[RegExp, string]> = [
  [/Visual C\+\+|\.NET (Runtime|Framework|Desktop Runtime)|DirectX|Windows App Runtime|WebView2|Windows Desktop Runtime/i, 'Runtime other apps need'],
  [/driver|chipset|Management Engine|Rapid Storage|HD Audio|Audio Driver|NVIDIA (Graphics|PhysX|FrameView)|AMD Software|Radeon Software/i, 'Driver'],
  [/^Microsoft (Update Health Tools|Edge Update)|Windows PC Health Check|Microsoft Edge$/i, 'Needed by Windows Update or Windows'],
];

/** Vendor utilities and trialware, with a plain-language note. */
const VENDOR_NOTES: Array<[RegExp, string]> = [
  [/McAfee|Norton|Avast|AVG|WildTangent|ExpressVPN.*Trial|Booking\.com|Candy Crush/i, 'Trial or promo software that came with the PC. Usually safe to remove.'],
  [/Armoury Crate|iCUE|Razer Synapse|MSI Center|Dragon Center|G HUB|Logitech Gaming|SteelSeries GG|RGB Fusion|Gigabyte Control Center|Mystic Light|Aura/i, 'Hardware utility. It may control fans, RGB lighting or device settings; remove only if you do not need those.'],
  [/HP Support Assistant|Dell SupportAssist|Lenovo (Vantage|System Update)|MyASUS|Acer Care Center|Alienware Command Center/i, 'Manufacturer utility. It delivers BIOS and driver updates for this PC; keep it unless you update those yourself.'],
];

/** Store apps that are safe to remove for almost everyone. */
const SUGGESTED_STORE = new Set(
  [
    'Microsoft.BingNews',
    'Microsoft.BingWeather',
    'Microsoft.GetHelp',
    'Microsoft.Getstarted',
    'Microsoft.MicrosoftSolitaireCollection',
    'Microsoft.People',
    'Microsoft.WindowsFeedbackHub',
    'Microsoft.MicrosoftOfficeHub',
    'Microsoft.Todos',
    'Microsoft.WindowsMaps',
    'Microsoft.ZuneVideo',
    'Clipchamp.Clipchamp',
    'MicrosoftCorporationII.QuickAssist',
    'Microsoft.BingSearch',
    'Microsoft.549981C3F5F10', // Cortana
  ].map((n) => n.toLowerCase()),
);

const match = (rules: Array<[RegExp, string]>, text: string) => rules.find(([re]) => re.test(text))?.[1] ?? null;
const asArray = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const yyyymmdd = (s?: string) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** MsiExec /I{GUID} → silent /X{GUID}. Anything else: the vendor's own uninstaller (may show a window). */
export function uninstallCommand(raw: { UninstallString: string; QuietUninstallString?: string }): { command: string; interactive: boolean } {
  if (raw.QuietUninstallString) return { command: raw.QuietUninstallString, interactive: false };
  const msi = /msiexec(\.exe)?\s+\/[IX]\s*(\{[0-9A-F-]{36}\})/i.exec(raw.UninstallString);
  if (msi) return { command: `MsiExec.exe /X${msi[2]} /qn /norestart`, interactive: false };
  return { command: raw.UninstallString, interactive: true };
}

interface Entry {
  item: AppItem;
  /** How to remove it: a command line (desktop) or a package full name (store). */
  remove: { kind: 'desktop'; command: string } | { kind: 'store'; fullName: string };
  /** Where to look for its exes (desktop apps). */
  where?: { installLocation?: string; displayIcon?: string };
  /** Store app package folder (for its logo). */
  storeDir?: string;
}

export function parseApps(json: string): Entry[] {
  const data = JSON.parse(json || '{}') as { desktop?: RawDesktop | RawDesktop[]; store?: RawStore | RawStore[] };
  const desktop = asArray(data.desktop).map((d): Entry => {
    const { command, interactive } = uninstallCommand(d);
    const text = `${d.DisplayName} ${d.Publisher ?? ''}`;
    return {
      item: {
        key: `desktop:${d.key}`,
        kind: 'desktop',
        name: d.DisplayName,
        version: d.DisplayVersion ?? null,
        publisher: d.Publisher ?? null,
        sizeBytes: d.EstimatedSize ? d.EstimatedSize * 1024 : null,
        installDate: yyyymmdd(d.InstallDate),
        protected: match(PROTECTED_DESKTOP, d.DisplayName),
        vendorNote: match(VENDOR_NOTES, text),
        suggested: false,
        interactive,
        lastUsed: null,
        unused: false,
      },
      remove: { kind: 'desktop', command },
      where: { installLocation: d.InstallLocation, displayIcon: d.DisplayIcon },
    };
  });
  const store = asArray(data.store)
    .filter((s) => !s.IsFramework)
    .map((s): Entry => ({
      item: {
        key: `store:${s.PackageFullName}`,
        kind: 'store',
        name: s.Name,
        version: s.Version,
        publisher: s.Publisher?.replace(/^CN=([^,]+).*$/, '$1') ?? null,
        sizeBytes: null,
        installDate: null,
        protected: s.NonRemovable || s.SignatureKind === 'System' ? 'Part of Windows' : match(PROTECTED_STORE, s.Name),
        vendorNote: match(VENDOR_NOTES, s.Name),
        suggested: SUGGESTED_STORE.has(s.Name.toLowerCase()),
        interactive: false,
        lastUsed: null,
        unused: false,
      },
      remove: { kind: 'store', fullName: s.PackageFullName },
      storeDir: s.InstallLocation,
    }));
  // Duplicate uninstall entries (same app under HKLM and WOW6432Node) collapse to one row.
  const seen = new Set<string>();
  return [...desktop, ...store].filter((e) => {
    const id = `${e.item.kind}|${e.item.name}|${e.item.version}`.toLowerCase();
    return seen.has(id) ? false : (seen.add(id), true);
  });
}

export const UNUSED_DAYS = 180;
const DAY = 86_400_000;
/** Not opened for UNUSED_DAYS, installed at least that long ago (or unknown), and removable. */
export function isUnused(item: AppItem, lastRunMs: number | null, now = Date.now()): boolean {
  if (item.protected || lastRunMs === null) return false; // never seen running: no evidence either way
  const installed = item.installDate ? Date.parse(item.installDate) : 0;
  return now - lastRunMs >= UNUSED_DAYS * DAY && now - installed >= UNUSED_DAYS * DAY;
}

export function createDebloater(adapter: SystemAdapter) {
  let entries = new Map<string, Entry>();

  return {
    async list(): Promise<AppItem[]> {
      const json = await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', LIST_SCRIPT], 120_000);
      entries = new Map(parseApps(json).map((e) => [e.item.key, e]));
      // Last opened (desktop apps): flags ones not opened for UNUSED_DAYS that were installed at least that long ago.
      const { times } = await runTimes(adapter);
      if (times.size) {
        for (const e of entries.values()) {
          if (!e.where) continue;
          const t = lastRun(await appExes(e.where.installLocation, e.where.displayIcon), times);
          e.item.lastUsed = t ? new Date(t).toISOString() : null;
          e.item.unused = isUnused(e.item, t);
        }
      }
      return [...entries.values()].map((e) => e.item).sort((a, b) => a.name.localeCompare(b.name));
    },
    /** Icon file for each app of the last list(): key -> .exe / .ico / .png path, or null. Read-only. */
    async iconFiles(): Promise<Map<string, string | null>> {
      const files = await Promise.all(
        [...entries].map(([key, e]) => (e.storeDir ? storeLogo(e.storeDir) : desktopIconFile(e.where?.installLocation, e.where?.displayIcon)).then((f) => [key, f] as const)),
      );
      return new Map(files);
    },
    /** Only keys from the last list(), never protected ones. */
    lookup(key: unknown): Entry | undefined {
      const e = typeof key === 'string' ? entries.get(key) : undefined;
      return e && !e.item.protected ? e : undefined;
    },
    async uninstall(e: Entry) {
      if (e.remove.kind === 'store') {
        const name = e.remove.fullName.replace(/'/g, "''");
        await adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', `Remove-AppxPackage -Package '${name}'`], 600_000);
      } else {
        // Uninstall strings are command lines (quotes, arguments), so cmd.exe runs them as written.
        await adapter.exec(CMD_EXE, ['/d', '/s', '/c', `"${e.remove.command}"`], 1_800_000);
      }
    },
  };
}
