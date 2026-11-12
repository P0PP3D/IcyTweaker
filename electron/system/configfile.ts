// Export / import: the set of applied tweaks (with chosen values) and Game Boost settings, as a small JSON file
// to move to another PC or share. Importing only ever applies known tweak ids, through the normal engine.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { TweakView } from '../../shared/types';

export const CONFIG_KIND = 'icycleaner-config';

export interface ConfigFile {
  kind: typeof CONFIG_KIND;
  version: 1;
  exportedAt: string;
  /** Windows build it was exported on (informational). */
  build: number;
  tweaks: Array<{ id: string; option?: number }>;
  boost?: Record<string, unknown>;
}

export function buildConfig(tweaks: TweakView[], build: number, boost?: ConfigFile['boost']): ConfigFile {
  return {
    kind: CONFIG_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    build,
    tweaks: tweaks.filter((t) => t.status === 'applied').map((t) => (t.options && t.currentOption != null ? { id: t.id, option: t.currentOption } : { id: t.id })),
    boost,
  };
}

/** Share code: the same config, deflated and base64url'd behind a prefix, to paste in chat instead of sending a file. */
const CODE = 'ICY1.';
export const toShareCode = (cfg: ConfigFile) => CODE + deflateRawSync(JSON.stringify(cfg)).toString('base64url');
export function fromShareCode(code: string): string {
  const c = code.trim();
  if (!c.startsWith(CODE)) throw new Error('The clipboard does not hold an IcyCleaner share code.');
  try {
    return inflateRawSync(Buffer.from(c.slice(CODE.length), 'base64url'), { maxOutputLength: 1 << 20 }).toString('utf8');
  } catch {
    throw new Error('This share code is damaged or incomplete.');
  }
}

/** Validates a config file. Unknown tweak ids and options a tweak doesn't offer are dropped and counted. */
export function parseConfig(text: string, known: TweakView[]): { config: ConfigFile; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const r = raw as Partial<ConfigFile>;
  if (r?.kind !== CONFIG_KIND || r.version !== 1 || !Array.isArray(r.tweaks)) throw new Error('This is not an IcyCleaner settings file.');
  let skipped = 0;
  const seen = new Set<string>();
  const tweaks: ConfigFile['tweaks'] = [];
  for (const item of r.tweaks) {
    const t = known.find((k) => k.id === (item as { id?: unknown })?.id);
    const option = (item as { option?: unknown }).option;
    if (!t || seen.has(t.id) || (option !== undefined && !t.options?.some((o) => o.value === option))) {
      skipped++;
      continue;
    }
    seen.add(t.id);
    tweaks.push(option === undefined ? { id: t.id } : { id: t.id, option: option as number });
  }
  const b = r.boost;
  const boost = b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : undefined; // checked by validateBoost on import
  return { config: { kind: CONFIG_KIND, version: 1, exportedAt: String(r.exportedAt ?? ''), build: Number(r.build ?? 0), tweaks, boost }, skipped };
}
