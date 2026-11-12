import { useEffect, useMemo, useState } from 'react';
import type { DuplicateGroup, OldFile, PrivacySnapshot, PrivacyTraceView, Progress } from '../../shared/types';
import { Icon } from '../icons';
import { Button, FeatureCard, ScanAge, formatBytes, type Ask, Loading, pathMenu } from '../ui';
import type { Act } from './General';

function RootPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  useEffect(() => {
    void window.api.findRoots().then((r) => {
      setRoots(r);
      if (!value) onChange(r.at(-1) ?? ''); // your user folder by default
    });
  }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Folder to scan" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
      {roots.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

const name = (p: string) => p.split('\\').pop() ?? p;

/**
 * Scan progress on its own fixed-height line: the count has a fixed width and the path is cut to fit, so nothing
 * jumps or wraps as the text changes.
 */
function ScanLine({ p }: { p: Progress | null }) {
  const comparing = p?.current.startsWith('Comparing ');
  return (
    <div className="flex h-5 items-center gap-3 overflow-hidden text-xs text-slate-500" aria-live="off">
      <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-500/25 border-t-sky-400" aria-hidden />
      <span className="w-32 shrink-0 tabular-nums text-slate-400">{p ? `${p.done.toLocaleString()} files found` : 'Starting…'}</span>
      <span className="min-w-0 flex-1 truncate" title={p?.current}>
        {p ? (comparing ? p.current : `Looking in ${p.current}`) : ''}
      </span>
    </div>
  );
}

export function Duplicates({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [root, setRoot] = useState('');
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  /** Files picked for removal. The first copy of each group starts unpicked (kept). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scanAt, setScanAt] = useState<string | null>(null);
  useEffect(() => window.api.onProgress((p) => p.task === 'find' && p.label === 'duplicates' && setProgress(p.current ? p : null)), []);
  // Suggest keeping the oldest copy of each set, removing the rest.
  const showGroups = (gs: DuplicateGroup[]) => {
    setGroups(gs);
    setPicked(new Set(gs.flatMap((g) => [...g.files].sort((a, b) => a.modified.localeCompare(b.modified)).slice(1).map((f) => f.path))));
  };
  // A scan still running (started before leaving this page) is picked up again; else the last result shows.
  useEffect(() => {
    void window.api.findStatus().then(async (s) => {
      if (s.duplicates) {
        setRoot(s.duplicates.root);
        setProgress(s.duplicates.progress);
        return scan(s.duplicates.root);
      }
      const l = await window.api.lastScans();
      if (!l.duplicates) return;
      setRoot(l.duplicates.root);
      showGroups(l.duplicates.groups);
      setScanAt(l.duplicates.at);
    });
  }, []);

  async function scan(r0 = root) {
    setScanning(true);
    setGroups(null);
    const r = await window.api.findDuplicates(r0); // joins the running scan of the same folder
    showGroups(r.groups);
    setError(r.error);
    if (!r.error) setScanAt(new Date().toISOString());
    setScanning(false);
    setProgress(null);
  }

  const toggle = (p: string, on: boolean) => setPicked((s) => (on ? new Set(s).add(p) : new Set([...s].filter((x) => x !== p))));
  const allPicked = (g: DuplicateGroup) => g.files.every((f) => picked.has(f.path));
  const bytes = useMemo(() => (groups ?? []).reduce((a, g) => a + g.files.filter((f) => picked.has(f.path)).length * g.size, 0), [groups, picked]);
  const blocked = (groups ?? []).some(allPicked);

  async function remove() {
    const ok = await ask('Move duplicates to the Recycle Bin?', `${picked.size} file(s), ${formatBytes(bytes)}. One copy of every set is kept. You can restore them from the Recycle Bin.`, 'Move to Recycle Bin');
    if (!ok) return;
    let moved: string[] = [];
    await act(async () => {
      const r = await window.api.trashFound([...picked]);
      moved = r.moved ?? [];
      return r;
    });
    // Drop what moved (no new scan: that took as long as the first one).
    const gone = new Set(moved);
    showGroups((groups ?? []).map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1));
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Duplicate Finder</h2>
        <p className="text-sm text-slate-400">Finds files that are exact copies (same size, then same content hash). Nothing is removed until you choose; one copy of each set is always kept.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RootPicker value={root} onChange={setRoot} />
        <Button primary disabled={busy || scanning || !root} onClick={() => void scan()}>
          {scanning ? 'Scanning…' : 'Scan'}
        </Button>
        {scanning && <Button onClick={() => window.api.cancelFind()}>Cancel</Button>}
        {!scanning && <ScanAge at={scanAt} />}
      </div>
      {scanning && <ScanLine p={progress} />}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {groups && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm">
            <span className="text-slate-300">
              {groups.length} set(s) of copies (files of 1 MB and up). Picked: <span className="font-semibold text-slate-100">{picked.size}</span> · {formatBytes(bytes)}
            </span>
            <Button primary disabled={busy || picked.size === 0 || blocked} onClick={remove}>
              Move picked to Recycle Bin
            </Button>
          </div>
          {blocked && <p className="text-sm text-amber-300">Every copy of a set is picked. Keep at least one.</p>}
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.files[0].path} className="space-y-1 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
                <div className="text-sm font-medium text-slate-100">
                  {name(g.files[0].path)} <span className="font-normal text-slate-500">· {formatBytes(g.size)} each · {g.files.length} copies</span>
                </div>
                {g.files.map((f) => (
                  <label key={f.path} className="flex items-center gap-2 text-xs text-slate-400" {...pathMenu(f.path)}>
                    <input type="checkbox" className="accent-sky-500" checked={picked.has(f.path)} onChange={(e) => toggle(f.path, e.target.checked)} />
                    <span className="truncate" title={f.path}>
                      {f.path}
                    </span>
                    <span className="ml-auto shrink-0 text-slate-500">{new Date(f.modified).toLocaleDateString()}</span>
                  </label>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Old files grouped by the folder they're in. Groups are in folder-path order, so a folder's subfolders follow it
 * directly; files inside a group are biggest first. Labels are relative to the scanned root.
 */
export function byFolder(files: OldFile[], root: string) {
  const groups = new Map<string, OldFile[]>();
  for (const f of files) {
    const dir = f.path.slice(0, f.path.lastIndexOf('\\'));
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  const base = root.replace(/\\+$/, '').toLowerCase();
  return [...groups]
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([dir, fs]) => ({
      dir,
      label: dir.toLowerCase().startsWith(base) && dir.length > base.length ? dir.slice(base.length).replace(/^\\/, '') : dir,
      bytes: fs.reduce((a, f) => a + f.size, 0),
      files: [...fs].sort((a, b) => b.size - a.size),
    }));
}

export function OldFiles({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [root, setRoot] = useState('');
  const [days, setDays] = useState(365);
  const [files, setFiles] = useState<OldFile[] | null>(null);
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => window.api.onProgress((p) => p.task === 'find' && p.label === 'oldfiles' && setProgress(p.current ? p : null)), []);
  // A scan still running (started before leaving this page) is picked up again; else the last result shows.
  useEffect(() => {
    void window.api.findStatus().then(async (s) => {
      if (s.oldfiles) {
        setRoot(s.oldfiles.root);
        setDays(s.oldfiles.days);
        setProgress(s.oldfiles.progress);
        return scan(s.oldfiles.root, s.oldfiles.days);
      }
      const l = await window.api.lastScans();
      if (!l.oldfiles) return;
      setRoot(l.oldfiles.root);
      setDays(l.oldfiles.days);
      setFiles(l.oldfiles.files);
      setScanAt(l.oldfiles.at);
    });
  }, []);

  async function scan(r0 = root, d0 = days) {
    setScanning(true);
    setFiles(null);
    const r = await window.api.findOldFiles(r0, d0); // joins the running scan with the same settings
    setProgress(null);
    setFiles(r.files);
    setError(r.error);
    if (!r.error) setScanAt(new Date().toISOString());
    setPicked(new Set());
    setScanning(false);
  }
  const bytes = (files ?? []).filter((f) => picked.has(f.path)).reduce((a, f) => a + f.size, 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Old Files</h2>
        <p className="text-sm text-slate-400">Large files (50 MB and up) you haven't opened or changed in a long time. Pick what to move to the Recycle Bin.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RootPicker value={root} onChange={setRoot} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Not used for" className="rounded-md bg-white/5 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
          {[90, 180, 365, 730].map((d) => (
            <option key={d} value={d}>
              Not used for {d >= 365 ? `${d / 365} year(s)` : `${d} days`}
            </option>
          ))}
        </select>
        <Button primary disabled={busy || scanning || !root} onClick={() => void scan()}>
          {scanning ? 'Scanning…' : 'Scan'}
        </Button>
        {scanning && <Button onClick={() => window.api.cancelFind()}>Cancel</Button>}
        {!scanning && <ScanAge at={scanAt} />}
      </div>
      {scanning && <ScanLine p={progress} />}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {files && (
        <FeatureCard
          icon="drive"
          title={`${files.length} old file(s)`}
          subtitle={`${formatBytes(files.reduce((a, f) => a + f.size, 0))} in total`}
          footer={
            <Button
              primary
              disabled={busy || picked.size === 0}
              onClick={async () => {
                if (!(await ask('Move to the Recycle Bin?', `${picked.size} file(s), ${formatBytes(bytes)}. You can restore them from the Recycle Bin.`, 'Move to Recycle Bin'))) return;
                let moved: string[] = [];
                await act(async () => {
                  const r = await window.api.trashFound([...picked]);
                  moved = r.moved ?? [];
                  return r;
                });
                // Drop what moved (no new scan: that took as long as the first one).
                const gone = new Set(moved);
                setFiles((fs) => (fs ?? []).filter((f) => !gone.has(f.path)));
                setPicked((s) => new Set([...s].filter((p) => !gone.has(p))));
              }}
            >
              Move picked to Recycle Bin ({formatBytes(bytes)})
            </Button>
          }
        >
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {byFolder(files, root).map((g) => {
              const all = g.files.every((f) => picked.has(f.path));
              const some = !all && g.files.some((f) => picked.has(f.path));
              const setAll = (on: boolean) =>
                setPicked((s) => {
                  const n = new Set(s);
                  for (const f of g.files) on ? n.add(f.path) : n.delete(f.path);
                  return n;
                });
              return (
                <li key={g.dir}>
                  <details open className="rounded-lg bg-[var(--card-2)] ring-1 ring-[var(--line)]">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`Pick all in ${g.label}`}
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some;
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setAll(e.target.checked)}
                      />
                      <Icon name="box" className="h-4 w-4 shrink-0 text-sky-300" />
                      <span className="truncate font-medium text-slate-100" title={g.dir} {...pathMenu(g.dir)}>
                        {g.label}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">
                        {g.files.length} file(s) · {formatBytes(g.bytes)}
                      </span>
                    </summary>
                    <ul className="space-y-1 border-t border-[var(--line)] px-3 py-2">
                      {g.files.map((f) => (
                        <li key={f.path} {...pathMenu(f.path)}>
                          <label className="flex items-center gap-2 text-xs text-slate-300">
                            <input type="checkbox" checked={picked.has(f.path)} onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(f.path) : new Set([...s].filter((x) => x !== f.path))))} />
                            <span className="truncate" title={f.path}>
                              {f.path.slice(g.dir.length + 1)}
                            </span>
                            <span className="ml-auto shrink-0 text-slate-500">
                              {formatBytes(f.size)} · last used {new Date(f.lastUsed).toLocaleDateString()}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </FeatureCard>
      )}
    </section>
  );
}

export function Privacy({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [traces, setTraces] = useState<PrivacyTraceView[] | null>(null);
  const [snaps, setSnaps] = useState<PrivacySnapshot[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const load = async () => {
    const t = await window.api.privacyTraces();
    setTraces(t);
    setPicked(new Set(t.filter((x) => x.count > 0).map((x) => x.id)));
    setSnaps(await window.api.privacySnapshots());
  };
  useEffect(() => void load(), []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Privacy Traces</h2>
        <p className="text-sm text-slate-400">Lists Windows keeps of what you ran, searched and opened. Everything cleared here is backed up first and can be put back.</p>
      </div>
      <FeatureCard
        icon="sparkles"
        title="Clear traces"
        subtitle="Registry lists go into the backup (Undo All restores them); recent items are kept as a privacy backup below"
        footer={
          <Button
            primary
            disabled={busy || picked.size === 0}
            onClick={async () => {
              if (!(await ask('Clear the selected traces?', 'They are backed up first, so you can restore them.', 'Clear'))) return;
              await act(() => window.api.clearPrivacy([...picked]));
              await load();
            }}
          >
            Clear selected
          </Button>
        }
      >
        {!traces ? (
          <Loading text="Reading…" />
        ) : (
          <ul className="space-y-2">
            {traces.map((t) => (
              <li key={t.id}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-sky-500"
                    checked={picked.has(t.id)}
                    disabled={t.count === 0}
                    onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(t.id) : new Set([...s].filter((x) => x !== t.id))))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-slate-100">{t.name}</span> <span className="text-xs text-slate-500">{t.count} entr(ies)</span>
                    <span className="block text-xs text-slate-400">{t.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </FeatureCard>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Privacy backups</h3>
        {snaps.length === 0 ? (
          <p className="text-sm text-slate-500">No backups of recent items yet.</p>
        ) : (
          <ul className="space-y-2">
            {snaps.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-sm">
                <span className="flex-1 text-slate-200">
                  {s.id.replace(/T(\d{2})-(\d{2})-(\d{2}).*/, ' $1:$2')} <span className="text-slate-500">· {s.files} recent item(s)</span>
                </span>
                <Button disabled={busy} onClick={() => act(() => window.api.restorePrivacy(s.id)).then(load)}>
                  Restore
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (!(await ask('Delete this privacy backup?', 'Its recent items can no longer be restored.', 'Delete'))) return;
                    await act(() => window.api.deletePrivacySnapshot(s.id));
                    await load();
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
