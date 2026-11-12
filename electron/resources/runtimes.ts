// Runtime and DirectX installer through winget (Microsoft's package manager): it downloads the official
// installers from Microsoft (IDs checked with `winget show`, all microsoft.com URLs) and verifies their hashes.
// The app itself downloads nothing. Installed runtimes can't be undone from the app's backup.
import path from 'node:path';
import type { RuntimeResult, RuntimeView } from '../../shared/types';
import type { SystemAdapter } from '../system/adapter';

export const RUNTIMES: RuntimeView[] = [
  ...['2005', '2008', '2010', '2012', '2013', '2015+'].flatMap((v) =>
    ['x86', 'x64'].map((a) => ({ id: `Microsoft.VCRedist.${v}.${a}`, name: `Visual C++ ${v === '2015+' ? '2015-2022' : v} (${a})`, group: 'Visual C++' })),
  ),
  // verify: winget's DirectX package is an .appx from Microsoft; check it installs the legacy d3dx9/xinput DLLs.
  { id: 'Microsoft.DirectX', name: 'DirectX End-User Runtime', group: 'DirectX' },
  { id: 'Microsoft.DotNet.DesktopRuntime.8', name: '.NET Desktop Runtime 8', group: '.NET' },
  { id: 'Microsoft.DotNet.DesktopRuntime.9', name: '.NET Desktop Runtime 9', group: '.NET' },
];

export const wingetPath = (localAppData: string) => path.join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe');

// verify: winget result codes. 0x8A15002B = no applicable upgrade, 0x8A150061 = already installed.
const ALREADY = new Set([-1978335189, -1978335135]);

export function summarizeWinget(code: number, out: string): Omit<RuntimeResult, 'id'> {
  if (code === 0) return { ok: true, summary: 'Installed.' };
  if (ALREADY.has(code)) return { ok: true, summary: 'Already installed and up to date.' };
  const last = out.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim();
  return { ok: false, summary: `Failed (code 0x${(code >>> 0).toString(16).toUpperCase()})${last ? `: ${last}` : '.'}` };
}

/** Installs one at a time. Dry-run records the commands and installs nothing. */
export async function installRuntimes(adapter: SystemAdapter, winget: string, ids: string[], onStep: (i: number, name: string) => void): Promise<RuntimeResult[]> {
  const results: RuntimeResult[] = [];
  for (const [i, id] of ids.entries()) {
    const r = RUNTIMES.find((x) => x.id === id)!;
    onStep(i, r.name);
    try {
      const { code, stdout } = await adapter.exec(
        winget,
        ['install', '--id', id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
        { timeoutMs: 20 * 60_000, okCodes: 'any' },
      );
      results.push({ id, ...(adapter.live ? summarizeWinget(code, stdout) : { ok: true, summary: 'Not installed (dry-run).' }) });
    } catch (err) {
      results.push({ id, ok: false, summary: (err as Error).message });
    }
  }
  return results;
}
