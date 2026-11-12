// Per-game Windows settings, keyed by the game's .exe. All through the safety layer (backed up, Undo All covers them):
// - Graphics preference: what Settings > System > Display > Graphics writes.
// - Compatibility: the exe's Properties > Compatibility tab. Flags we don't manage are kept as they are.
// - CPU priority: Windows starts the exe at this priority every time (Image File Execution Options\PerfOptions).
import path from 'node:path';
import type { GameWinSettings } from '../../shared/types';
import { dword, sz, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';

export const gpuRef = (exe: string): SettingRef => ({ kind: 'reg', hive: 'HKCU', key: 'Software\\Microsoft\\DirectX\\UserGpuPreferences', name: exe });
export const compatRef = (exe: string): SettingRef => ({ kind: 'reg', hive: 'HKCU', key: 'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers', name: exe });
export const priorityRef = (exe: string): SettingRef => ({
  kind: 'reg',
  hive: 'HKLM',
  key: `SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${path.win32.basename(exe)}\\PerfOptions`,
  name: 'CpuPriorityClass',
});

/** Compatibility tab flags: fullscreen optimizations off, high-DPI scaling by the app, run as administrator. */
const FLAGS = { fso: 'DISABLEDXMAXIMIZEDWINDOWEDMODE', dpi: 'HIGHDPIAWARE', admin: 'RUNASADMIN' } as const;
/** CpuPriorityClass values: 3 = High, 6 = Above normal. */
const PRIORITY = { high: 3, above: 6 } as const;

const text = (v: unknown) => (v && typeof v === 'object' && 'data' in v ? String((v as { data: unknown }).data) : '');

export function parseGpu(v: unknown): 0 | 1 | 2 {
  const n = Number(/GpuPreference=(\d)/.exec(text(v))?.[1] ?? 0);
  return n === 1 || n === 2 ? n : 0;
}

/** The Layers value for these flags, keeping any flags we don't manage. null = nothing left (value removed). */
export function compatValue(current: string, want: { fso: boolean; dpi: boolean; admin: boolean }): string | null {
  const ours = new Set<string>(Object.values(FLAGS));
  const others = current.split(/\s+/).filter((f) => f && f !== '~' && !ours.has(f.toUpperCase()));
  const flags = [...others, ...(Object.keys(FLAGS) as Array<keyof typeof FLAGS>).filter((k) => want[k]).map((k) => FLAGS[k])];
  return flags.length ? `~ ${flags.join(' ')}` : null;
}

export async function readWinSettings(safety: Safety, exe: string): Promise<GameWinSettings> {
  const [gpu, compat, prio] = await Promise.all([safety.read(gpuRef(exe)), safety.read(compatRef(exe)), safety.read(priorityRef(exe))]);
  const flags = text(compat).toUpperCase().split(/\s+/);
  const p = prio && typeof prio === 'object' && 'data' in prio ? Number(prio.data) : 0;
  return {
    gpu: parseGpu(gpu),
    fso: flags.includes(FLAGS.fso),
    dpi: flags.includes(FLAGS.dpi),
    admin: flags.includes(FLAGS.admin),
    priority: p === PRIORITY.high ? 'high' : p === PRIORITY.above ? 'above' : 'default',
  };
}

export function validateWinSettings(v: unknown): GameWinSettings | null {
  const o = v as Partial<GameWinSettings> | null;
  if (!o || ![0, 1, 2].includes(o.gpu as number) || !['default', 'above', 'high'].includes(o.priority as string)) return null;
  if ([o.fso, o.dpi, o.admin].some((b) => typeof b !== 'boolean')) return null;
  return { gpu: o.gpu!, fso: o.fso!, dpi: o.dpi!, admin: o.admin!, priority: o.priority! };
}

/** Writes only what differs from now. Turning everything off removes the values (or puts back the user's own flags). */
export async function applyWinSettings(safety: Safety, exe: string, want: GameWinSettings): Promise<string[]> {
  const now = await readWinSettings(safety, exe);
  const changed: string[] = [];
  if (want.gpu !== now.gpu) {
    await safety.set(gpuRef(exe), want.gpu ? sz(`GpuPreference=${want.gpu};`) : null);
    changed.push('graphics preference');
  }
  if (want.fso !== now.fso || want.dpi !== now.dpi || want.admin !== now.admin) {
    const v = compatValue(text(await safety.read(compatRef(exe))), want);
    await safety.set(compatRef(exe), v === null ? null : sz(v));
    changed.push('compatibility');
  }
  if (want.priority !== now.priority) {
    await safety.set(priorityRef(exe), want.priority === 'default' ? null : dword(PRIORITY[want.priority]));
    changed.push('CPU priority');
  }
  return changed;
}

/** Puts this exe's three values back to what they were before the app first changed them. */
export async function resetWinSettings(safety: Safety, exe: string): Promise<void> {
  for (const ref of [gpuRef(exe), compatRef(exe), priorityRef(exe)]) await safety.restore(ref);
}
