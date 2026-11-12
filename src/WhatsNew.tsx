import { Fragment } from 'react';
import clsx from 'clsx';
import changelog from '../CHANGELOG.md?raw';
import { boldParts, noteLines, parseChangelog, unseen } from '../shared/changelog';
import { Icon } from './icons';
import { Button } from './ui';

const SECTIONS = parseChangelog(changelog);

/** Opens "What's new" for this version again (Settings). */
export const openWhatsNew = () => window.dispatchEvent(new Event('icy:whats-new'));

/** The notes of every version newer than `seen`, up to `current`. Null when there's nothing to show. */
export const notesSince = (current: string, seen: string | null) => unseen(SECTIONS, current, seen);

const Bold = ({ s }: { s: string }) => (
  <>
    {boldParts(s).map(([t, b], i) =>
      b ? (
        <strong key={i} className="font-semibold text-slate-100">
          {t}
        </strong>
      ) : (
        <Fragment key={i}>{t}</Fragment>
      ),
    )}
  </>
);

/** "What's new" after an update: what changed in every version since the one the user had. */
export function WhatsNew({ current, seen, onClose }: { current: string; seen: string | null; onClose: () => void }) {
  const sections = notesSince(current, seen);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <div className="page-in flex max-h-[85vh] w-full max-w-xl flex-col gap-4 rounded-2xl bg-[var(--panel)] p-6 shadow-2xl ring-1 ring-[var(--line)]">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/25">
            <Icon name="sparkles" className="h-5 w-5" />
          </span>
          <div>
            <h2 id="whats-new-title" className="text-xl font-semibold text-slate-50">
              What's new in IcyTweaker {current}
            </h2>
            {sections.length > 1 && <p className="text-sm text-slate-400">Everything since version {seen}.</p>}
          </div>
        </div>
        <div className="-mr-2 min-h-0 space-y-5 overflow-y-auto pr-2 text-sm leading-relaxed text-slate-300">
          {sections.length === 0 && <p>No notes for this version.</p>}
          {sections.map((s) => (
            <section key={s.version} className="space-y-1.5">
              {sections.length > 1 && <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Version {s.version}</h3>}
              {noteLines(s.body).map((l, i) =>
                l.kind === 'heading' ? (
                  <h4 key={i} className="pt-1.5 font-semibold text-slate-100">
                    {l.text}
                  </h4>
                ) : l.kind === 'item' ? (
                  <p key={i} className={clsx('relative', l.depth ? 'pl-9 text-slate-400' : 'pl-4')}>
                    <span className={clsx('absolute top-[0.6em] h-1.5 w-1.5 rounded-full', l.depth ? 'left-5 bg-slate-500' : 'left-0 bg-sky-400')} aria-hidden />
                    <Bold s={l.text} />
                  </p>
                ) : (
                  <p key={i}>
                    <Bold s={l.text} />
                  </p>
                ),
              )}
            </section>
          ))}
        </div>
        <div className="flex justify-end">
          <Button primary onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
