// Networking: TCP tweaks, DNS presets for the active adapter, reset tools, hosts file check.
// DNS and hosts changes are settings (backed up; Undo All restores them). No network calls are made.
import { isIP } from 'node:net';
import type { DnsPreset, HostsError, NetAdapterView } from '../../shared/types';
import { POWERSHELL_EXE, REG_EXE, dword, type SystemAdapter } from '../system/adapter';
import type { Safety } from '../system/safety';
import { regDwordTweak, tweak, type FixDefinition, type Tweak } from '../tweaks/engine';

export const DNS_PRESETS: DnsPreset[] = [
  { id: 'cloudflare', name: 'Cloudflare', servers: '1.1.1.1,1.0.0.1' },
  { id: 'google', name: 'Google', servers: '8.8.8.8,8.8.4.4' },
  { id: 'quad9', name: 'Quad9', servers: '9.9.9.9,149.112.112.112' },
  { id: 'adguard', name: 'AdGuard (blocks ads)', servers: '94.140.14.14,94.140.15.15' },
  { id: 'dhcp', name: 'Automatic (from your router)', servers: 'dhcp' },
];

const INTERFACES = 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces';

/** Interface GUIDs that have an IPv4 address (static or DHCP). Read-only. */
export async function activeInterfaces(adapter: SystemAdapter): Promise<string[]> {
  const out = await adapter.query(REG_EXE, ['query', `HKLM\\${INTERFACES}`, '/s', '/reg:64'], 30_000).catch(() => '');
  const guids: string[] = [];
  let current: string | null = null;
  for (const line of out.split(/\r?\n/)) {
    const key = /\\Interfaces\\(\{[0-9A-F-]{36}\})$/i.exec(line.trim());
    if (key) current = key[1];
    const ip = /^\s+(DhcpIPAddress|IPAddress)\s+REG_\w+\s+(\d+\.\d+\.\d+\.\d+)/.exec(line);
    if (current && ip && ip[2] !== '0.0.0.0' && !guids.includes(current)) guids.push(current);
  }
  return guids;
}

const meta = { category: 'performance' as const, requiresAdmin: true, builds: { min: 19041 }, page: 'network' as const };

export interface Nic {
  name: string;
  description: string;
  wifi: boolean;
}

/** Physical network adapters (read-only): `Get-NetAdapter -Physical`. */
export async function physicalNics(adapter: SystemAdapter): Promise<Nic[]> {
  const out = await adapter
    .query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetAdapter -Physical | ForEach-Object { $_.Name + [char]9 + $_.InterfaceDescription + [char]9 + $_.MediaType }'], 30_000)
    .catch(() => '');
  return out
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 3 && p[0].trim())
    .map(([name, description, media]) => ({ name: name.trim(), description: description.trim(), wifi: /802\.11/.test(media) }));
}

/**
 * Per-adapter settings from Device Manager > Advanced, by registry keyword. Standard (*) keywords are Microsoft's
 * standardized INF keywords; the others are Realtek's (seen on a Realtek PCIe GbE adapter: 0 = Disabled for each).
 * A keyword the adapter doesn't have is skipped; an adapter with none of them gets no card.
 */
const NIC_TWEAKS: Array<{ id: string; name: string; description: string; risk: 'safe' | 'balanced'; keywords: string[] }> = [
  {
    id: 'energy',
    name: 'Energy saving off',
    description: 'Turns off Energy-Efficient Ethernet, Green Ethernet, Gigabit Lite and power saving, which can add delay or drop the link speed to save a little power.',
    risk: 'safe',
    keywords: ['*EEE', 'AdvancedEEE', 'EnableGreenEthernet', 'GigaLite', 'PowerSavingMode'],
  },
  {
    id: 'interrupt-moderation',
    name: 'Interrupt Moderation off',
    description: 'Handles each packet as it arrives instead of in batches: lower latency, slightly more CPU use.',
    risk: 'balanced',
    keywords: ['*InterruptModeration'],
  },
  {
    id: 'flow-control',
    name: 'Flow Control off',
    description: 'Stops the adapter pausing traffic when the other end is busy. Can lower latency spikes on a home network.',
    risk: 'balanced',
    keywords: ['*FlowControl'],
  },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function nicTweaks(nics: Nic[]): Tweak[] {
  return nics.flatMap((n) =>
    NIC_TWEAKS.map((t) =>
      tweak(
        {
          ...meta,
          id: `nic-${slug(n.name)}-${t.id}`,
          name: `${t.name}: ${n.name}`,
          description: `${n.description}. ${t.description} The adapter restarts to apply it (a few seconds offline).`,
          risk: t.risk,
          requiresReboot: false,
          group: n.name,
        },
        t.keywords.map((keyword) => ({ ref: { kind: 'netAdv' as const, adapter: n.name, keyword }, on: '0', off: null })),
      ),
    ),
  );
}

/** Networking page tweaks. The Nagle tweak covers the interfaces that have an address right now. */
export function networkTweaks(interfaces: string[], nics: Nic[] = []): Tweak[] {
  const list: Tweak[] = [
    regDwordTweak(
      {
        ...meta,
        id: 'network-throttling-off',
        name: 'Network Throttling Off',
        description: 'Stops Windows limiting network traffic while audio or video plays, so downloads and games are not slowed by a playing video.',
        risk: 'safe',
        requiresReboot: true,
      },
      // Windows default 10 packets per ms; 0xFFFFFFFF turns throttling off.
      { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile', name: 'NetworkThrottlingIndex', enabled: 0xffffffff, defaultValue: 10 },
    ),
    tweak(
      {
        ...meta,
        id: 'tcp-stack-baseline',
        name: 'TCP Stack Baseline',
        description: 'Receive window auto-tuning on Normal, Receive-Side Scaling on and ECN off: the settings that suit most home connections, in case another tool changed them.',
        risk: 'safe',
        requiresReboot: false,
      },
      [
        { ref: { kind: 'tcpGlobal', name: 'autotuninglevel' }, on: 'normal', off: null },
        { ref: { kind: 'tcpGlobal', name: 'rss' }, on: 'enabled', off: null },
        { ref: { kind: 'tcpGlobal', name: 'ecncapability' }, on: 'disabled', off: null },
      ],
    ),
  ];
  if (interfaces.length) {
    list.push(
      tweak(
        {
          ...meta,
          id: 'nagle-off',
          name: 'Nagle Off (TCP No Delay)',
          description:
            'Sends small TCP packets immediately instead of batching them, on your connected network adapters. Helps some older games that use TCP; most modern games use UDP and see no change.',
          risk: 'safe',
          requiresReboot: true,
        },
        interfaces.flatMap((guid) =>
          ['TcpAckFrequency', 'TCPNoDelay'].map((name) => ({ ref: { kind: 'reg' as const, hive: 'HKLM' as const, key: `${INTERFACES}\\${guid}`, name }, on: dword(1), off: null })),
        ),
      ),
    );
  }
  if (nics.some((n) => n.wifi)) {
    list.push(
      tweak(
        {
          ...meta,
          id: 'wifi-power-saving-off',
          name: 'Wi-Fi Power Saving Off (plugged in)',
          description: "Sets the power plan's Wireless Adapter Power Saving Mode to Maximum Performance while plugged in, so Wi-Fi doesn't nap between packets. On battery it stays as it is.",
          risk: 'safe',
          requiresReboot: false,
        },
        // Wireless Adapter Settings > Power Saving Mode: 0 = Maximum Performance ... 3 = Maximum Power Saving.
        [{ ref: { kind: 'power', scheme: 'current', sub: '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1', setting: '12bbebe6-58d6-4636-95bb-3217ef867c1a', ac: true }, on: 0, off: null }],
      ),
    );
  }
  return [...list, ...nicTweaks(nics)];
}

export const networkFixes: FixDefinition[] = [
  {
    id: 'flush-dns',
    name: 'Flush DNS',
    description: 'Clears the DNS cache, so websites that moved resolve to their new address.',
    risk: 'safe',
    requiresAdmin: false,
    requiresReboot: false,
    permanent: true,
    page: 'network',
    script: 'ipconfig /flushdns',
  },
  {
    id: 'winsock-reset',
    name: 'Winsock Reset',
    description: 'Resets the Windows network socket catalog, which fixes connections broken by old VPN or security software.',
    risk: 'balanced',
    requiresAdmin: true,
    requiresReboot: true,
    permanent: true,
    page: 'network',
    script: 'netsh winsock reset',
  },
  {
    id: 'ip-renew',
    name: 'Renew IP Address',
    description: 'Releases and renews your IP address from the router.',
    risk: 'safe',
    requiresAdmin: true,
    requiresReboot: false,
    permanent: true,
    page: 'network',
    warning: 'You are offline for a few seconds while it renews.',
    script: 'ipconfig /release; ipconfig /renew',
  },
];

export async function listAdapters(adapter: SystemAdapter, safety: Safety): Promise<NetAdapterView[]> {
  const out = await adapter.query(
    POWERSHELL_EXE,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, @{n='Guid';e={$_.InterfaceGuid}}, MediaType, LinkSpeed) | ConvertTo-Json -Compress",
    ],
    30_000,
  );
  const raw = JSON.parse(out.trim() || '[]');
  const list: Array<{ Name: string; InterfaceDescription: string; Guid: string; MediaType: string; LinkSpeed: string }> = Array.isArray(raw) ? raw : [raw];
  return Promise.all(
    list.map(async (a) => {
      const dns = (await safety.read({ kind: 'dns', guid: a.Guid })) as string | null;
      return {
        guid: a.Guid,
        name: a.Name,
        description: a.InterfaceDescription,
        media: a.MediaType,
        speed: a.LinkSpeed,
        dns,
        preset: DNS_PRESETS.find((p) => p.servers === dns)?.id ?? null,
      };
    }),
  );
}

const HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*\.?$/i;

/** Hosts file syntax: "IP hostname [hostname...]", comments after #. Returns one error per bad line. */
export function validateHosts(text: string): HostsError[] {
  const errors: HostsError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const [ip, ...names] = line.split(/\s+/);
    if (!isIP(ip)) errors.push({ line: i + 1, message: `"${ip}" is not an IP address.` });
    else if (names.length === 0) errors.push({ line: i + 1, message: 'A host name is missing after the IP address.' });
    else {
      const bad = names.find((n) => !HOSTNAME.test(n));
      if (bad) errors.push({ line: i + 1, message: `"${bad}" is not a valid host name.` });
    }
  });
  return errors;
}
