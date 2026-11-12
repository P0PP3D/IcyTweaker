// Standby memory: Windows keeps recently used file data in the "standby" list. It is handed back on demand, but some
// games stutter when free memory runs out and pages have to be repurposed. This reads the free and standby lists and
// can purge the standby list (what RAMMap's "Empty Standby List" does). Needs administrator.
// Interface: NtQuerySystemInformation / NtSetSystemInformation, class SystemMemoryListInformation (80); the struct
// layout and the command (MemoryPurgeStandbyList = 4) are as published in the phnt headers (System Informer).
import { POWERSHELL_EXE, type SystemAdapter } from './adapter';

const CS = `
using System;
using System.Runtime.InteropServices;
public static class IcyMem {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct TP { public int Count; public LUID Luid; public int Attr; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, int access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string sys, string name, out LUID luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TP state, int len, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  [DllImport("ntdll.dll")] static extern int NtSetSystemInformation(int cls, ref int cmd, int len);
  static void Enable(string name) {
    IntPtr t;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28, out t)) throw new Exception("Needs administrator.");
    TP tp = new TP(); tp.Count = 1; tp.Attr = 2;
    if (!LookupPrivilegeValue(null, name, out tp.Luid)) throw new Exception("Unknown privilege " + name);
    AdjustTokenPrivileges(t, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    if (Marshal.GetLastWin32Error() != 0) throw new Exception("Needs administrator.");
  }
  // MB on the free (free + zeroed) and standby (all priorities) lists.
  public static long[] Lists() {
    Enable("SeProfileSingleProcessPrivilege");
    int n = 22 * IntPtr.Size;
    IntPtr b = Marshal.AllocHGlobal(n);
    try {
      int r;
      int st = NtQuerySystemInformation(80, b, n, out r);
      if (st != 0) throw new Exception("Memory lists unavailable (0x" + st.ToString("X") + ")");
      long standby = 0;
      for (int i = 5; i < 13; i++) standby += Marshal.ReadIntPtr(b, i * IntPtr.Size).ToInt64();
      long free = Marshal.ReadIntPtr(b, 0).ToInt64() + Marshal.ReadIntPtr(b, IntPtr.Size).ToInt64();
      return new long[] { free * 4096 / 1048576, standby * 4096 / 1048576 };
    } finally { Marshal.FreeHGlobal(b); }
  }
  public static void Purge() {
    Enable("SeProfileSingleProcessPrivilege");
    int cmd = 4;
    int st = NtSetSystemInformation(80, ref cmd, 4);
    if (st != 0) throw new Exception("Purge refused (0x" + st.ToString("X") + ")");
  }
}`;

/** Free memory below this and standby above this: worth purging during a game. */
export const PURGE_WHEN = { freeMb: 1024, standbyMb: 1024 } as const;

/** PowerShell arguments; -EncodedCommand keeps the C# quotes and line breaks intact. */
const script = (body: string) => [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(`$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${CS}\n'@\n${body}`, 'utf16le').toString('base64'),
];
const LISTS = '$l = [IcyMem]::Lists(); "$($l[0]) $($l[1])"';

export const parseLists = (out: string) => {
  const [free, standby] = out.trim().split(/\s+/).map(Number);
  return Number.isFinite(free) && Number.isFinite(standby) ? { freeMb: free, standbyMb: standby } : null;
};

/** Read-only: current free and standby MB. */
export async function memoryLists(adapter: SystemAdapter) {
  const out = await adapter.query(POWERSHELL_EXE, script(LISTS), 30_000).catch((e: Error) => {
    throw new Error(/Needs administrator/.test(e.message) ? 'Needs administrator: relaunch IcyCleaner as admin.' : 'Could not read the memory lists.');
  });
  const r = parseLists(out);
  if (!r) throw new Error('Could not read the memory lists.');
  return r;
}

/** Purges the standby list (a change: recorded, not run, in dry-run). onlyIfLow = only when PURGE_WHEN holds. */
export async function purgeStandby(adapter: SystemAdapter, onlyIfLow = false) {
  const cond = onlyIfLow ? `if ($l[0] -lt ${PURGE_WHEN.freeMb} -and $l[1] -gt ${PURGE_WHEN.standbyMb}) { [IcyMem]::Purge(); 'purged' }` : "[IcyMem]::Purge(); 'purged'";
  const { stdout } = await adapter.exec(POWERSHELL_EXE, script(`$l = [IcyMem]::Lists(); ${cond}`), 60_000);
  return stdout.includes('purged');
}
