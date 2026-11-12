// Update check: compares this version with the latest GitHub release of the repository named in package.json
// ("updateRepo": "owner/name"). It only tells you and opens the release page: installing an update stays a
// deliberate download, since the installer is not code-signed yet.
import type { UpdateInfo } from '../../shared/types';

/** 1.2.10 > 1.2.9; a leading "v" and any "-beta" suffix are ignored. */
export function newerThan(a: string, b: string): boolean {
  const n = (v: string) => v.replace(/^v/i, '').split('-')[0].split('.').map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export async function checkUpdates(current: string, repo: string | undefined, get: typeof fetch = fetch): Promise<UpdateInfo> {
  const base: UpdateInfo = { current, latest: null, newer: false, url: null, configured: !!repo };
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ...base, configured: false };
  try {
    const r = await get(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { ...base, error: 'No releases published yet.' };
    if (!r.ok) return { ...base, error: `GitHub answered HTTP ${r.status}.` };
    const j = (await r.json()) as { tag_name?: string; html_url?: string };
    const latest = j.tag_name ?? null;
    const url = j.html_url && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : null;
    return { ...base, latest, url, newer: !!latest && newerThan(latest, current) };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}
