// Startup manager: what launches at sign-in, turned on or off the way Task Manager does it, through the
// StartupApproved flags (REG_BINARY; first byte odd = disabled). The Run entries themselves are never deleted,
// so turning an item back on is always possible, and every flag change is backed up (Undo All restores it).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StartupItemView } from '../../shared/types';
import { REG_EXE, binary, type Hive, type SettingRef } from '../system/adapter';
import type { Safety } from '../system/safety';

const RUN = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
/** Flag Windows writes when it first sees an item: enabled, no timestamp. */
const ENABLED = '020000000000000000000000';

interface Source {
  id: string;
  hive: Hive;
  location: string;
  /** Registry Run key, or a startup folder. */
  key?: string;
  folder?: string;
  approved: string;
}

export function startupSources(env: { APPDATA: string; ProgramData: string }): Source[] {
  const startMenu = 'Microsoft\\Windows\\Start Menu\\Programs';
  return [
    { id: 'hkcu-run', hive: 'HKCU', key: RUN, approved: `${APPROVED}\\Run`, location: 'Registry: your account' },
    { id: 'hklm-run', hive: 'HKLM', key: RUN, approved: `${APPROVED}\\Run`, location: 'Registry: all users' },
    { id: 'hklm-run32', hive: 'HKLM', key: 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `${APPROVED}\\Run32`, location: 'Registry: all users (32-bit)' },
    { id: 'user-folder', hive: 'HKCU', folder: path.join(env.APPDATA, startMenu, 'Startup'), approved: `${APPROVED}\\StartupFolder`, location: 'Startup folder: your account' },
    { id: 'common-folder', hive: 'HKLM', folder: path.join(env.ProgramData, startMenu, 'StartUp'), approved: `${APPROVED}\\StartupFolder`, location: 'Startup folder: all users' },
  ];
}

/** Values of one registry key from `reg query` (read-only). */
export function parseRegValues(out: string): Array<{ name: string; data: string }> {
  return out
    .split(/\r?\n/)
    .map((l) => /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && m[1] !== '(Default)')
    .map((m) => ({ name: m[1], data: m[3] }));
}

const enabledFlag = (v: unknown) => {
  const hex = typeof v === 'object' && v !== null && (v as { type: string }).type === 'REG_BINARY' ? (v as { data: string }).data : '';
  return hex.length < 2 || (parseInt(hex.slice(0, 2), 16) & 1) === 0;
};

export function createStartup(safety: Safety, sources: Source[]) {
  const flagRef = (s: Source, name: string): SettingRef => ({ kind: 'reg', hive: s.hive, key: s.approved, name });

  return {
    async list(): Promise<StartupItemView[]> {
      const items: StartupItemView[] = [];
      for (const s of sources) {
        const entries = s.key
          ? parseRegValues(await safety.adapter.query(REG_EXE, ['query', `${s.hive}\\${s.key}`, '/reg:64']).catch(() => ''))
          : (await readdir(s.folder!).catch(() => [] as string[])).filter((f) => f.toLowerCase() !== 'desktop.ini').map((f) => ({ name: f, data: path.join(s.folder!, f) }));
        for (const e of entries) {
          items.push({
            id: `${s.id}|${e.name}`,
            name: e.name.replace(/\.lnk$/i, ''),
            command: e.data,
            location: s.location,
            enabled: enabledFlag(await safety.read(flagRef(s, e.name))),
            requiresAdmin: s.hive === 'HKLM',
          });
        }
      }
      return items;
    },

    /** Only items from `list()`; main checks the id. */
    async setEnabled(id: string, enabled: boolean) {
      const [sid, ...rest] = id.split('|');
      const s = sources.find((x) => x.id === sid);
      if (!s) throw new Error('Unknown startup source.');
      const ref = flagRef(s, rest.join('|'));
      const cur = await safety.read(ref);
      if (cur === null && enabled) return; // no flag = already on
      const hex = typeof cur === 'object' && cur?.type === 'REG_BINARY' && cur.data.length >= 2 ? cur.data : ENABLED;
      const first = parseInt(hex.slice(0, 2), 16);
      const next = (enabled ? first & ~1 : first | 1).toString(16).padStart(2, '0');
      await safety.set(ref, binary(next + hex.slice(2)));
    },
  };
}
