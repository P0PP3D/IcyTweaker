import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AnalyzeView, DirEntry, Progress } from '../../shared/types';
import { squarify } from '../treemap';
import { Button, ScanAge, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

const COLORS = ['bg-sky-500/70', 'bg-violet-500/70', 'bg-emerald-500/70', 'bg-amber-500/70', 'bg-rose-500/70', 'bg-cyan-500/70', 'bg-fuchsia-500/70', 'bg-lime-500/70'];
const W = 1000;
const H = 420;

function Treemap({ entries, onOpen }: { entries: DirEntry[]; onOpen: (e: DirEntry) => void }) {
  const shown = entries.filter((e) => e.size > 0).slice(0, 60);
  const rects = useMemo(() => squarify(shown.map((e) => e.size), { x: 0, y: 0, w: W, h: H }), [shown]);
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black/30 ring-1 ring-[var(--line)]" style={{ aspectRatio: `${W} / ${H}` }}>
      {shown.map((e, i) => {
        const r = rects[i];
        return (
          <button
            key={e.path}
            title={`${e.name} · ${formatBytes(e.size)}`}
            onClick={() => onOpen(e)}
            className={clsx('absolute overflow-hidden border border-black/40 p-1 text-left text-xs leading-tight text-white', COLORS[i % COLORS.length], e.isDir ? 'hover:brightness-125' : 'cursor-default opacity-70')}
            style={{ left: `${(100 * r.x) / W}%`, top: `${(100 * r.y) / H}%`, width: `${(100 * r.w) / W}%`, height: `${(100 * r.h) / H}%` }}
          >
            {r.w > 60 && r.h > 24 && (
              <>
                <div className="truncate font-medium">{e.name}</div>
                <div className="truncate opacity-80">{formatBytes(e.size)}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Analyzer({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [roots, setRoots] = useState<string[]>([]);
  const [root, setRoot] = useState('');
  const [view, setView] = useState<AnalyzeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  // When the shown result was scanned; `saved` = loaded from the last session (its folders can't be opened until a new scan).
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([window.api.analyzeRoots(), window.api.lastScans()]).then(([r, last]) => {
      setRoots(r);
      const a = last.analyze && r.includes(last.analyze.root) ? last.analyze : null;
      setRoot(a?.root ?? r[r.length - 1] ?? ''); // default: your user folder, quick and where most big files are
      if (a) {
        setView(a.view);
        setScanAt(a.at);
        setSaved(true);
      }
    });
    return window.api.onProgress((p) => p.task === 'analyze' && setProgress(p));
  }, []);

  const show = (r: AnalyzeView | { error: string }) => ('error' in r ? setError(r.error) : (setView(r), setError(null)));
  const open = async (p: string) =>
    saved ? setError('This is the saved result from your last scan. Press Analyze to scan again, then folders open.') : show(await window.api.analyzeOpen(p));

  async function analyze() {
    setScanning(true);
    setView(null);
    const r = await window.api.analyze(root);
    show(r);
    if (!('error' in r)) {
      setScanAt(new Date().toISOString());
      setSaved(false);
    }
    setScanning(false);
    setProgress(null);
  }

  async function remove(e: DirEntry) {
    const ok = await ask(`Delete ${e.name}?`, `${e.path}\n${formatBytes(e.size)}\n\nIt goes to the Recycle Bin, so you can still restore it from there.`, 'Move to Recycle Bin');
    if (!ok || !view) return;
    await act(() => window.api.trashPath(e.path));
    await open(view.path);
  }

  const crumbs = view ? view.path.slice(view.root.length).split('\\').filter(Boolean) : [];
  const crumbPath = (i: number) => [view!.root.replace(/\\$/, ''), ...crumbs.slice(0, i + 1)].join('\\');

  const Row = ({ e }: { e: DirEntry }) => (
    <li className="flex items-center gap-3 px-4 py-1.5 text-sm">
      {e.isDir ? (
        <button className="min-w-0 flex-1 truncate text-left text-sky-300 hover:underline" onClick={() => open(e.path)}>
          {e.name}\
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-slate-300" title={e.path}>
          {e.name}
        </span>
      )}
      <span className="w-20 text-right text-xs text-slate-400">{formatBytes(e.size)}</span>
      <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => window.api.revealPath(e.path)}>
        Show
      </button>
      {!e.isDir && (
        <button disabled={busy} className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40" onClick={() => remove(e)}>
          Delete
        </button>
      )}
    </li>
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Disk Analyzer</h2>
          <p className="text-sm text-slate-400">See what uses your space. Links and junctions are not followed, so nothing is counted twice. Deleted files go to the Recycle Bin.</p>
          <div className="mt-1">
            <ScanAge at={scanAt} saved={saved} />
          </div>
        </div>
        <div className="flex gap-2">
          <select value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Folder to analyze" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10" disabled={scanning}>
            {roots.map((r) => (
              <option key={r} value={r} className="bg-slate-900">
                {r}
              </option>
            ))}
          </select>
          {scanning ? (
            <Button onClick={() => window.api.cancelAnalyze()}>Stop</Button>
          ) : (
            <Button primary disabled={!root} onClick={analyze}>
              Analyze
            </Button>
          )}
        </div>
      </div>

      {scanning && progress && (
        <p className="truncate text-sm text-slate-400" role="status">
          {progress.done.toLocaleString()} files, {formatBytes(progress.bytes ?? 0)} so far… {progress.current}
        </p>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}

      {view && (
        <>
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
            <button className="text-sky-300 hover:underline" onClick={() => open(view.root)}>
              {view.root}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-slate-600">\</span>
                <button className="text-sky-300 hover:underline" onClick={() => open(crumbPath(i))}>
                  {c}
                </button>
              </span>
            ))}
            <span className="ml-2 text-slate-500">
              {formatBytes(view.size)}
              {view.inaccessible ? ` · ${view.inaccessible} folder(s) could not be read` : ''}
            </span>
          </nav>
          <Treemap entries={view.entries} onOpen={(e) => (e.isDir ? open(e.path) : undefined)} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">In this folder</h3>
              <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
                {view.entries.slice(0, 200).map((e) => (
                  <Row key={e.path} e={e} />
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Biggest files</h3>
              <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
                {view.topFiles.map((e) => (
                  <Row key={e.path} e={e} />
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
