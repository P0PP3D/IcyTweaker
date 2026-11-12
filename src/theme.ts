// Light / dark theme and accent colour: data attributes on <html>, styled in index.css. The last choice is also kept
// in localStorage so the first paint already has it (settings.json is the source of truth).
import type { Accent, AppSettings } from '../shared/types';

export const ACCENTS: Array<{ id: Accent; label: string; swatch: string }> = [
  { id: 'blue', label: 'Ice blue', swatch: '#38bdf8' },
  { id: 'cyan', label: 'Cyan', swatch: '#22d3ee' },
  { id: 'indigo', label: 'Indigo', swatch: '#818cf8' },
  { id: 'violet', label: 'Violet', swatch: '#a78bfa' },
  { id: 'emerald', label: 'Emerald', swatch: '#34d399' },
];

const KEY = 'icycleaner.theme';

export function applyTheme(s: Pick<AppSettings, 'theme' | 'accent'>) {
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme: s.theme, accent: s.accent }));
  } catch {
    // only the first paint is affected
  }
}

/** Before React renders: the last theme used. */
export function applyCachedTheme() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Pick<AppSettings, 'theme' | 'accent'> | null;
    if (s) applyTheme(s);
  } catch {
    // default dark + blue
  }
}
