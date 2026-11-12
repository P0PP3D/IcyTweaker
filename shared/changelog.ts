// CHANGELOG.md -> the sections a user hasn't seen yet, for the "What's new" window after an update.
// The file is bundled into the app (Vite ?raw import), so the notes always match the installed version.

export interface ChangelogSection {
  version: string;
  /** The section's Markdown body (no heading). */
  body: string;
}

/** Compares dotted versions numerically: 0.1.10 is after 0.1.9. */
export function cmpVer(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Every `## vX.Y.Z` section, in file order (newest first). */
export function parseChangelog(md: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  const parts = md.replace(/\r\n/g, '\n').split(/^## v(\d+(?:\.\d+)*)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out.push({ version: parts[i], body: parts[i + 1].trim() });
  return out;
}

/** Sections newer than `seen` up to and including `current`, newest first. `seen` null = only `current`. */
export function unseen(sections: ChangelogSection[], current: string, seen: string | null): ChangelogSection[] {
  return sections
    .filter((s) => cmpVer(s.version, current) <= 0 && (seen ? cmpVer(s.version, seen) > 0 : s.version === current))
    .sort((a, b) => cmpVer(b.version, a.version));
}

export type NoteLine = { kind: 'heading'; text: string } | { kind: 'item'; text: string; depth: number } | { kind: 'text'; text: string };

/** The small Markdown subset CHANGELOG.md uses: `**Heading**` lines, `-` items (two-space indent = nested), text. */
export function noteLines(body: string): NoteLine[] {
  return body
    .split('\n')
    .filter((l) => l.trim())
    .map((l): NoteLine => {
      const item = /^(\s*)- (.*)$/.exec(l);
      if (item) return { kind: 'item', text: item[2], depth: Math.min(2, Math.floor(item[1].length / 2)) };
      const heading = /^\*\*(.+)\*\*$/.exec(l.trim());
      return heading ? { kind: 'heading', text: heading[1] } : { kind: 'text', text: l.trim() };
    });
}

/** `**bold**` runs inside a line: [text, bold][] pieces. */
export const boldParts = (s: string): Array<[string, boolean]> => s.split(/\*\*(.+?)\*\*/).map((t, i): [string, boolean] => [t, i % 2 === 1]).filter(([t]) => t);
