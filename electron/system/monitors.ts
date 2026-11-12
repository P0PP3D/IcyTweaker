// Monitor refresh check: each display's current refresh rate vs the highest it offers at the current resolution.
// Read-only (EnumDisplaySettings through a small C# helper compiled by PowerShell).
import type { DisplayMode, MonitorInfo } from '../../shared/types';
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

export const MONITOR_SCRIPT = "Add-Type -TypeDefinition @\"\nusing System;\nusing System.Collections.Generic;\nusing System.Runtime.InteropServices;\npublic static class IcyDisplays {\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]\n  public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]\n  public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName; public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput; public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight; }\n  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE dd, int flags);\n  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);\n  public static string Run() {\n    var rows = new List<string>();\n    for (int i = 0; ; i++) {\n      var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);\n      if (!EnumDisplayDevices(null, i, ref dd, 0)) break;\n      if ((dd.StateFlags & 1) == 0) continue; // attached to the desktop\n      var mon = new DISPLAY_DEVICE(); mon.cb = Marshal.SizeOf(mon);\n      string name = EnumDisplayDevices(dd.DeviceName, 0, ref mon, 0) ? mon.DeviceString : dd.DeviceName;\n      var cur = new DEVMODE(); cur.dmSize = (short)Marshal.SizeOf(cur);\n      if (!EnumDisplaySettings(dd.DeviceName, -1, ref cur)) continue;\n      int max = cur.dmDisplayFrequency;\n      var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(m);\n      for (int k = 0; EnumDisplaySettings(dd.DeviceName, k, ref m); k++)\n        if (m.dmPelsWidth == cur.dmPelsWidth && m.dmPelsHeight == cur.dmPelsHeight && m.dmDisplayFrequency > max) max = m.dmDisplayFrequency;\n      rows.Add(name.Replace(\"|\", \" \") + \"|\" + cur.dmPelsWidth + \"|\" + cur.dmPelsHeight + \"|\" + cur.dmDisplayFrequency + \"|\" + max);\n    }\n    return string.Join(\"\\n\", rows);\n  }\n}\n\"@\n[IcyDisplays]::Run()\n";

/** One line per display: name|width|height|current Hz|max Hz. */
export function parseMonitors(out: string): MonitorInfo[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split('|'))
    .filter((p) => p.length === 5 && p.slice(1).every((x) => /^\d+$/.test(x)))
    .map(([name, w, h, cur, max]) => ({ name, width: +w, height: +h, hz: +cur, maxHz: +max }));
}

// Game Boost display mode (primary display): Set changes the mode for this sign-in only (flags 0 = not saved to
// the registry), Reset goes back to the mode saved in the registry. A crash mid-game leaves the game's mode until
// the next sign-in. Only modes the display lists itself are set. verify: on a real multi-monitor PC.
const modeScript = (call: string) => `Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IcyDisplayMode {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName; public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput; public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName; public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency, dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, int flags, IntPtr param);
  public static string Modes() {
    var rows = new List<string>();
    var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(m);
    for (int k = 0; EnumDisplaySettings(null, k, ref m); k++) {
      string r = m.dmPelsWidth + "|" + m.dmPelsHeight + "|" + m.dmDisplayFrequency;
      if (m.dmBitsPerPel == 32 && !rows.Contains(r)) rows.Add(r);
    }
    return string.Join("\\n", rows);
  }
  public static int Set(int w, int h, int hz) {
    var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(m);
    for (int k = 0; EnumDisplaySettings(null, k, ref m); k++)
      if (m.dmBitsPerPel == 32 && m.dmPelsWidth == w && m.dmPelsHeight == h && m.dmDisplayFrequency == hz) return ChangeDisplaySettingsEx(null, ref m, IntPtr.Zero, 0, IntPtr.Zero);
    return -100;
  }
  public static int Reset() { return ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero); }
}
"@
[IcyDisplayMode]::${call}
`;
const ps = (call: string) => ['-NoProfile', '-NonInteractive', '-Command', modeScript(call)];

export const validMode = (m: unknown): DisplayMode | null => {
  const x = m as Partial<DisplayMode> | null;
  const ok = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  return x && ok(x.width, 640, 15360) && ok(x.height, 480, 8640) && ok(x.hz, 24, 1000) ? { width: x.width!, height: x.height!, hz: x.hz! } : null;
};

/** The primary display's 32-bit modes, largest first. Read-only. */
export async function displayModes(adapter: Pick<SystemAdapter, 'query'>): Promise<DisplayMode[]> {
  const out = await adapter.query(POWERSHELL_EXE, ps('Modes()'), 60_000);
  return out
    .split(/\r?\n/)
    .map((l) => validMode(Object.fromEntries(['width', 'height', 'hz'].map((k, i) => [k, Number(l.trim().split('|')[i])]))))
    .filter((m): m is DisplayMode => !!m)
    .sort((a, b) => b.width * b.height - a.width * a.height || b.hz - a.hz);
}

/** Sets a mode (null = back to the saved one). Throws unless Windows reports success. */
export async function setDisplayMode(adapter: Pick<SystemAdapter, 'exec' | 'live'>, mode: DisplayMode | null) {
  const m = mode && validMode(mode);
  if (mode && !m) throw new Error('Invalid display mode.');
  const { stdout } = await adapter.exec(POWERSHELL_EXE, ps(m ? `Set(${m.width}, ${m.height}, ${m.hz})` : 'Reset()'), 60_000);
  const code = Number(stdout.trim());
  if (adapter.live && code !== 0) throw new Error(code === -100 ? 'The display does not offer that mode.' : `Windows refused the display mode (code ${code}).`);
}

export async function monitors(adapter: Pick<SystemAdapter, 'query'>): Promise<MonitorInfo[]> {
  return parseMonitors(await adapter.query(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', MONITOR_SCRIPT], 60_000));
}
