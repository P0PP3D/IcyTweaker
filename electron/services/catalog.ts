// Services page data. Each sub-group is a normal tweak (its switch disables every service in it that
// exists here; revert restores the backed-up start types). Levels cut across groups by each service's `level`.
//
// level: minimum = no user-visible loss (telemetry, diagnostics tracking, retail demo, Xbox when unused);
//        medium  = features many people don't use (printing, Bluetooth, remote access, sensors, sharing);
//        extreme = search indexing, updates and Store; null = only through its sub-group switch.
// def: Windows' default start type, used on revert only when the app has no backup of that service.
import type { ServiceLevel, TweakMeta } from '../../shared/types';
import type { StartType } from '../system/adapter';
import { tweak, type Tweak } from '../tweaks/engine';

export interface CatalogService {
  name: string;
  def: StartType;
  level: Exclude<ServiceLevel, 'off'> | null;
  /** What stops working while it is disabled. */
  breaks: string;
  /** Xbox services: Minimum only when the Xbox app is not installed, otherwise Medium. */
  xbox?: true;
}

interface SubGroup {
  id: string;
  name: string;
  description: string;
  services: CatalogService[];
}

export interface ServiceGroup {
  id: string;
  name: string;
  subgroups: SubGroup[];
}

const s = (name: string, def: StartType, level: CatalogService['level'], breaks: string, extra: Partial<CatalogService> = {}): CatalogService => ({ name, def, level, breaks, ...extra });

export const serviceGroups: ServiceGroup[] = [
  {
    id: 'user-features',
    name: 'User Features',
    subgroups: [
      {
        id: 'platform-devices',
        name: 'Disable Platform & Devices',
        description: 'Hyper-V guest integration, mixed reality, offline maps and connected devices.',
        services: [
          ...['vmickvpexchange', 'vmicguestinterface', 'vmicshutdown', 'vmicheartbeat', 'vmicvmsession', 'vmicrdv', 'vmictimesync', 'vmicvss'].map((n) =>
            s(n, 'demand', 'medium', 'Integration when Windows itself runs inside a Hyper-V virtual machine.'),
          ),
          s('MixedRealityOpenXRSvc', 'demand', 'medium', 'Windows Mixed Reality headsets.'),
          s('spectrum', 'demand', 'medium', 'Windows Mixed Reality spatial perception.'),
          s('MapsBroker', 'delayed-auto', 'minimum', 'Automatic updates of offline maps in the Maps app.'),
          s('CDPSvc', 'delayed-auto', 'medium', 'Nearby sharing, Phone Link and other connected-device features.'),
        ],
      },
      {
        id: 'communication-data',
        name: 'Disable Communication & Data',
        description: 'Phone calls, WAP push messages and push notifications.',
        services: [
          s('PhoneSvc', 'demand', 'medium', 'Phone calls through Phone Link.'),
          s('dmwappushservice', 'demand', 'minimum', 'WAP push messages (device management).'),
          s('WpnService', 'auto', null, 'All toast notifications, including from games, chat apps and Windows.'),
        ],
      },
    ],
  },
  {
    id: 'connectivity',
    name: 'Connectivity',
    subgroups: [
      {
        id: 'local-discovery',
        name: 'Disable Local & Discovery',
        description: 'Finding devices, media players and PCs on your local network.',
        services: [
          s('SSDPSRV', 'demand', 'medium', 'Discovering UPnP devices such as media servers and network printers.'),
          s('upnphost', 'demand', 'medium', 'Hosting UPnP devices on this PC.'),
          s('FDResPub', 'demand', 'medium', 'This PC showing up in other PCs’ Network folder.'),
          s('fdPHost', 'demand', 'medium', 'Finding other PCs and devices in the Network folder.'),
          s('lltdsvc', 'demand', 'medium', 'The network map in Network and Sharing Center.'),
        ],
      },
      {
        id: 'remote-sharing',
        name: 'Disable Remote & Sharing',
        description: 'Remote Desktop, file sharing, connection sharing and VPN dial-up.',
        services: [
          s('RemoteRegistry', 'disabled', 'minimum', 'Other PCs editing this PC’s registry (off by default).'),
          s('TermService', 'demand', 'medium', 'Remote Desktop into this PC.'),
          s('SessionEnv', 'demand', 'medium', 'Remote Desktop configuration.'),
          s('UmRdpService', 'demand', 'medium', 'Printer and drive redirection in Remote Desktop.'),
          s('LanmanServer', 'auto', 'medium', 'Sharing this PC’s files and printers on the network.'),
          s('SharedAccess', 'demand', 'medium', 'Mobile hotspot and Internet Connection Sharing.'),
          s('RasMan', 'demand', 'medium', 'Built-in Windows VPN and dial-up connections (third-party VPN apps usually keep working).'),
          s('RasAuto', 'demand', 'medium', 'Automatic dial-up connections.'),
        ],
      },
    ],
  },
  {
    id: 'hardware-display',
    name: 'Hardware & Display',
    subgroups: [
      {
        id: 'peripherals-display',
        name: 'Disable Peripherals & Display',
        description: 'Sensors, scanners and cameras using WIA, and Bluetooth.',
        services: [
          s('SensorService', 'demand', 'medium', 'Screen auto-rotation and light sensors on laptops and tablets.'),
          s('SensrSvc', 'demand', 'medium', 'Sensor monitoring (adaptive brightness).'),
          s('SensorDataService', 'demand', 'medium', 'Sensor data for apps.'),
          s('stisvc', 'demand', 'medium', 'Scanners, and some webcams that use Windows Image Acquisition.'),
          s('bthserv', 'demand', 'medium', 'All Bluetooth devices: headphones, controllers, mice and keyboards.'),
          s('BTAGService', 'demand', 'medium', 'Bluetooth headset microphones and calls.'),
          s('BthAvctpSvc', 'demand', 'medium', 'Bluetooth audio play/pause and volume buttons.'), // verify: Manual on most builds, Automatic on some
        ],
      },
      {
        id: 'print-misc',
        name: 'Disable Print & Misc',
        description: 'Printing and fax, the compatibility assistant, link tracking and media sharing.',
        services: [
          s('Spooler', 'auto', 'medium', 'All printing, including "Print to PDF".'),
          s('PrintNotify', 'demand', 'medium', 'Printer extensions and notifications.'),
          s('Fax', 'demand', 'medium', 'Sending and receiving faxes.'),
          s('PcaSvc', 'delayed-auto', 'medium', 'Compatibility fixes and warnings for old programs.'),
          s('TrkWks', 'auto', 'medium', 'Shortcuts that follow files moved between NTFS drives on a network.'),
          s('WMPNetworkSvc', 'demand', 'medium', 'Sharing your Windows Media Player library on the network.'),
        ],
      },
      {
        id: 'amd-radeon',
        name: 'Disable AMD Radeon Driver Services',
        description: 'AMD crash recovery and external events. Shows N/A on PCs without an AMD driver.',
        services: [
          // verify: service names (no AMD driver on the dev PC).
          s('AMD Crash Defender Service', 'auto', null, 'AMD driver crash recovery and reporting.'),
          s('AMD External Events Utility', 'auto', null, 'AMD hotkeys, and FreeSync in some games.'),
        ],
      },
    ],
  },
  {
    id: 'windows-services',
    name: 'Windows Services',
    subgroups: [
      {
        id: 'updates-store-xbox',
        name: 'Disable Updates & Windows Store/Xbox',
        description: 'Windows Update, background transfers, Store installs and Xbox services.',
        services: [
          s('wuauserv', 'demand', 'extreme', 'Windows Update, including security updates.'),
          s('UsoSvc', 'delayed-auto', 'extreme', 'Scheduling and installing Windows updates.'),
          s('BITS', 'demand', 'extreme', 'Background downloads for Windows Update and some apps.'),
          s('InstallService', 'demand', 'extreme', 'Installing and updating Microsoft Store apps.'),
          s('XblAuthManager', 'demand', 'minimum', 'Xbox app and Game Pass sign-in.', { xbox: true }),
          s('XblGameSave', 'demand', 'minimum', 'Xbox cloud saves.', { xbox: true }),
          s('XboxNetApiSvc', 'demand', 'minimum', 'Xbox Live multiplayer networking.', { xbox: true }),
        ],
      },
      {
        id: 'diagnostics-maintenance',
        name: 'Disable Diagnostics & Maintenance',
        description: 'Telemetry, error reporting, performance logging, troubleshooting and search indexing.',
        services: [
          s('DiagTrack', 'auto', 'minimum', 'Sending diagnostic data to Microsoft.'),
          s('diagnosticshub.standardcollector.service', 'demand', 'minimum', 'Visual Studio diagnostics collection.'),
          s('WerSvc', 'demand', 'minimum', 'Sending crash reports to Microsoft and app developers.'),
          s('RetailDemo', 'demand', 'minimum', 'Store demo mode.'),
          s('pla', 'demand', 'minimum', 'Performance Monitor data collector sets.'),
          s('DPS', 'auto', 'extreme', 'Troubleshooters and network problem detection.'),
          s('WdiServiceHost', 'demand', 'extreme', 'Diagnostics used by troubleshooters.'),
          s('WdiSystemHost', 'demand', 'extreme', 'Diagnostics used by troubleshooters.'),
          s('WSearch', 'delayed-auto', 'extreme', 'Fast search in Start and File Explorer (searches get slow).'),
        ],
      },
    ],
  },
];

export const catalogServices = serviceGroups.flatMap((g) => g.subgroups.flatMap((sg) => sg.services));

/** One tweak per sub-group, shown on the Services page. */
export const serviceTweaks: Tweak[] = serviceGroups.flatMap((g) =>
  g.subgroups.map((sg) =>
    tweak(
      {
        id: `services-${sg.id}`,
        name: sg.name,
        category: 'system',
        description: sg.description,
        risk: 'balanced',
        requiresAdmin: true,
        requiresReboot: false,
        builds: { min: 19041 },
        page: 'services',
        group: g.name,
        warning: `While disabled: ${sg.services.map((x) => x.breaks).join(' ')}`,
      } satisfies TweakMeta,
      sg.services.map((x) => ({ ref: { kind: 'service', name: x.name }, on: 'disabled', off: x.def })),
    ),
  ),
);
