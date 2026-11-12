import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { AppState, CleanResult, CleanRisk, CleanTargetView, Progress, ScanResult } from '../../shared/types';
import { Badge, Banner, Button, MUTED_BADGE, Ring, formatBytes, type Ask } from '../ui';
import type { Act } from './General';

const RISK: Record<CleanRisk, string> = {
  safe: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  caution: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  risky: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

type Group = CleanTargetView['group'];

/** Targets, their last scan and clean results, and live progress, shared by every cleaner page. */
function useCleaner(group: Group | 'health', state: AppState) {
  const [targets, setTargets] = useState<CleanTargetView[] | null>(null);
  const [scans, setScans] = useState<Record<string, ScanResult>>({});
  const [cleaned, setCleaned] = useState<Record<string, CleanResult>>({});
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    const all = await window.api.listCleanTargets();
    // Health Check: safe, preselected targets only, and admin ones only when elevated (or in dry-run).
    setTargets(
      group === 'health'
        ? all.filter((t) => t.risk === 'safe' && t.defaultSelected && (!t.requiresAdmin || state.isAdmin || !state.live))
        : all.filter((t) => t.group === group),
    );
  }, [group, state.isAdmin, state.live]);
  useEffect(() => void load(), [load]);
  useEffect(() => window.api.onProgress((p) => (p.task === 'scan' || p.task === 'clean') && setProgress(p.done < p.total ? p : null)), []);

  async function scan(ids: string[]) {
    setCleaned({});
    const results = await window.api.scanCleanTargets(ids);
    setScans(Object.fromEntries(results.map((r) => [r.id, r])));
  }
  return { targets, scans, cleaned, setCleaned, progress, scan, load };
}

function ProgressLine({ p }: { p: Progress | null }) {
  if (!p) return null;
  return (
    <div className="space-y-1" role="status">
      <div className="text-sm text-slate-300">
        {p.task === 'scan' ? 'Scanning' : 'Cleaning'} {p.current}… ({p.done + 1}/{p.total})
      </div>
      <div className="h-2 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${(100 * p.done) / p.total}%` }} />
      </div>
    </div>
  );
}

async function confirmClean(ask: Ask, picked: CleanTargetView[], bytes: number) {
  const risky = picked.filter((t) => t.risk === 'risky');
  const caution = picked.filter((t) => t.risk === 'caution');
  const name = (t: CleanTargetView) => (t.subgroup ? `${t.subgroup}: ${t.name}` : t.name);
  const lines = [
    `About ${formatBytes(bytes)} from ${picked.length} item(s). Deleted files cannot be restored.`,
    ...(caution.length ? ['', 'You may notice:', ...caution.map((t) => `• ${name(t)}: ${t.description}`)] : []),
    ...(risky.length ? ['', 'RISKY, data is lost:', ...risky.map((t) => `• ${name(t)}: ${t.description}`)] : []),
  ];
  return ask(risky.length ? 'Delete saved passwords and clean?' : 'Clean now?', lines.join('\n'), 'Clean');
}

export function HealthCheck({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const { targets, scans, cleaned, setCleaned, progress, scan } = useCleaner('health', state);
  const [scanning, setScanning] = useState(false);
  const ids = (targets ?? []).map((t) => t.id);
  const total = Object.values(scans).reduce((a, r) => a + r.bytes, 0);
  const freed = Object.values(cleaned).reduce((a, r) => a + r.freed, 0);
  const scanned = Object.keys(scans).length > 0;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Health Check</h2>
        <p className="text-sm text-slate-400">One click: scans only Safe items (temp files, caches, crash dumps, error reports), which Windows and apps simply rebuild.</p>
      </div>
      <div className="flex flex-wrap items-center gap-8 rounded-xl bg-[var(--card)] p-6 ring-1 ring-[var(--line)]">
        <Ring
          label={scanning ? 'Scanning' : 'Scan'}
          value={progress ? Math.round((100 * progress.done) / progress.total) : scanned ? 100 : 0}
          detail={progress?.current}
        />
        <div className="space-y-3">
          <div className="text-4xl font-semibold text-slate-100">{formatBytes(freed || total)}</div>
          <div className="text-sm text-slate-400">
            {Object.keys(cleaned).length ? (state.live ? 'freed' : 'would be freed (dry-run: nothing deleted)') : scanned ? 'can be freed safely' : `${ids.length} safe item(s) to check`}
          </div>
          <div className="flex gap-2">
            <Button
              primary={!scanned}
              disabled={busy || scanning || ids.length === 0}
              onClick={async () => {
                setScanning(true);
                await scan(ids).finally(() => setScanning(false));
              }}
            >
              {scanned ? 'Scan again' : 'Scan'}
            </Button>
            <Button
              primary={scanned}
              disabled={busy || scanning || total === 0 || Object.keys(cleaned).length > 0}
              onClick={async () => {
                if (!(await confirmClean(ask, targets ?? [], total))) return;
                await act(async () => {
                  const r = await window.api.cleanTargets(ids.filter((id) => (scans[id]?.bytes ?? 0) > 0));
                  setCleaned(Object.fromEntries(r.results.map((x) => [x.id, x])));
                  return r.report;
                });
              }}
            >
              Clean {total ? formatBytes(total) : ''}
            </Button>
          </div>
        </div>
      </div>
      {scanned && (
        <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
          {(targets ?? []).map((t) => (
            <li key={t.id} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-slate-300">{t.name}</span>
              <span className="text-slate-400">{cleaned[t.id] ? resultText(cleaned[t.id], state.live) : formatBytes(scans[t.id]?.bytes ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function resultText(r: CleanResult, live: boolean) {
  if (r.skipped) return `skipped: ${r.skipped}`;
  return `${live ? 'freed' : 'would free'} ${formatBytes(r.freed)}${r.locked ? `, ${r.locked} in use` : ''}`;
}

const TITLES: Record<Group, [string, string]> = {
  system: ['Smart Cleaner', 'Windows temp files, caches, crash dumps, error reports, update caches and the Recycle Bin.'],
  browser: ['Browsers', 'Per profile. Cache is preselected; cookies and history are opt-in; deleting saved passwords is Risky. Close a browser before cleaning its cookies, history or passwords.'],
  app: ['App and game caches', 'Chat, music, game launchers, editors and GPU shader caches.'],
};

export function CleanerPage({ group, state, busy, act, ask }: { group: Group; state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const { targets, scans, cleaned, setCleaned, progress, scan, load } = useCleaner(group, state);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [scanning, setScanning] = useState(false);
  const sel = useMemo(() => selected ?? new Set((targets ?? []).filter((t) => t.defaultSelected).map((t) => t.id)), [selected, targets]);
  const picked = (targets ?? []).filter((t) => sel.has(t.id));
  const total = picked.reduce((a, t) => a + (scans[t.id]?.bytes ?? 0), 0);
  const blocked = picked.filter((t) => t.needsClosed && t.running);

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // Browsers: one block per browser profile. Others: one block.
  const sections = useMemo(() => {
    const m = new Map<string, CleanTargetView[]>();
    for (const t of targets ?? []) m.set(t.subgroup ?? '', [...(m.get(t.subgroup ?? '') ?? []), t]);
    return [...m.entries()];
  }, [targets]);

  const [title, intro] = TITLES[group];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
          <p className="text-sm text-slate-400">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || scanning || picked.length === 0}
            onClick={async () => {
              setScanning(true);
              await load();
              await scan(picked.map((t) => t.id)).finally(() => setScanning(false));
            }}
          >
            Scan selected
          </Button>
          <Button
            primary
            disabled={busy || scanning || picked.length === 0 || blocked.length > 0}
            onClick={async () => {
              if (!(await confirmClean(ask, picked, total))) return;
              await act(async () => {
                const r = await window.api.cleanTargets(
                  picked.map((t) => t.id),
                  picked.some((t) => t.risk === 'risky'),
                );
                setCleaned(Object.fromEntries(r.results.map((x) => [x.id, x])));
                return r.report;
              });
            }}
          >
            Clean selected {total ? `(${formatBytes(total)})` : ''}
          </Button>
        </div>
      </div>

      {blocked.length > 0 && (
        <Banner tone="warn">Close {[...new Set(blocked.map((t) => t.subgroup?.split(':')[0] ?? t.name))].join(', ')} first, or unselect its cookies, history and passwords.</Banner>
      )}
      <ProgressLine p={progress} />
      {!targets ? (
        <p className="text-sm text-slate-400">Finding what can be cleaned…</p>
      ) : targets.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing found on this PC.</p>
      ) : (
        sections.map(([sub, list]) => (
          <div key={sub} className="space-y-1">
            {sub && (
              <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold text-slate-300">
                {sub}
                {list[0].running && <Badge className={MUTED_BADGE}>running</Badge>}
              </h3>
            )}
            <ul className="divide-y divide-white/5 rounded-lg bg-[var(--card)] ring-1 ring-[var(--line)]">
              {list.map((t) => {
                const s = scans[t.id];
                const c = cleaned[t.id];
                return (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                    <input type="checkbox" className="mt-1 accent-sky-500" aria-label={`Select ${sub ? `${sub} ` : ''}${t.name}`} checked={sel.has(t.id)} disabled={busy} onChange={() => toggle(t.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{t.name}</span>
                        <Badge className={RISK[t.risk]}>{t.risk}</Badge>
                        {t.requiresAdmin && <Badge className="bg-violet-500/15 text-violet-300 ring-violet-500/30">admin</Badge>}
                        {!sub && t.running && <Badge className={MUTED_BADGE}>running</Badge>}
                      </div>
                      <p className="text-xs text-slate-400">{t.description}</p>
                    </div>
                    <div className={clsx('w-44 text-right text-xs', s?.error || c?.skipped ? 'text-rose-300' : 'text-slate-400')}>
                      {c ? resultText(c, state.live) : s ? (s.error ?? `${formatBytes(s.bytes)} · ${s.files} file(s)${s.inaccessible ? ` · ${s.inaccessible} unreadable` : ''}`) : ''}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Recycle Bin: how much it holds on every drive, and one button to empty it (Windows' own Clear-RecycleBin). */
export function RecycleBin({ busy, act, ask }: { busy: boolean; act: Act; ask: Ask }) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const load = useCallback(async () => setScan((await window.api.scanCleanTargets(['recycle-bin']))[0] ?? null), []);
  useEffect(() => void load(), [load]);
  const empty = scan !== null && scan.files === 0;
  async function emptyBin() {
    if (!(await ask('Empty the Recycle Bin?', `Permanently deletes everything in it (${formatBytes(scan!.bytes)}) on every drive. It can't be restored afterwards.`, 'Empty Recycle Bin'))) return;
    await act(async () => (await window.api.cleanTargets(['recycle-bin'])).report);
    await load();
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Recycle Bin</h2>
        <p className="text-sm text-slate-400">Files you deleted are kept here until you empty it. Emptying frees the space for good.</p>
      </div>
      <div className="flex flex-wrap items-center gap-6 rounded-xl bg-[var(--card)] p-6 ring-1 ring-[var(--line)]">
        <div className="grid h-20 w-20 place-items-center rounded-2xl bg-sky-500/10 ring-1 ring-sky-500/30">
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-sky-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-3xl font-semibold tabular-nums text-slate-50">{scan ? formatBytes(scan.bytes) : '…'}</div>
          <div className="text-sm text-slate-400">{scan === null ? 'Measuring…' : empty ? 'The Recycle Bin is empty.' : 'In the Recycle Bin on all drives'}</div>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void load()}>
            Refresh
          </Button>
          <Button disabled={busy} onClick={() => void window.api.openShortcut('recycle-bin').then(() => undefined)}>
            Open Recycle Bin
          </Button>
          <Button danger disabled={busy || !scan || empty} onClick={() => void emptyBin()}>
            Empty Recycle Bin
          </Button>
        </div>
      </div>
    </section>
  );
}
