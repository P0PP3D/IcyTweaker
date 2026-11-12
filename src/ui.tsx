import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import type { Risk, TweakStatus, TweakTag, TweakView } from '../shared/types';
import { Icon, type IconName } from './icons';

export const RISK_STYLE: Record<Risk, string> = {
  safe: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  balanced: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  risky: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

export const STATUS_TEXT: Record<TweakStatus, string> = {
  applied: 'Applied',
  not_applied: 'Not applied',
  partial: 'Partially applied',
  unknown: 'Unknown',
  unavailable: 'Not on this PC',
};

/** Ask the user to confirm. Resolves true on confirm. */
export type Ask = (title: string, body: string, confirmLabel?: string, typeToConfirm?: string) => Promise<boolean>;

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={clsx('whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide ring-1', className)}>{children}</span>;
}

export const MUTED_BADGE = 'bg-slate-500/15 text-slate-300 ring-slate-500/30';

export function Button({
  onClick,
  disabled,
  primary,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button" // never submits a surrounding form (its onClick does the work)
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'bg-rose-500/20 text-rose-100 ring-1 ring-rose-400/50 hover:bg-rose-500/30'
          : primary
            ? 'glow-accent bg-sky-500/20 text-sky-50 ring-1 ring-sky-400/60 hover:bg-sky-500/30'
            : 'bg-white/[0.04] text-slate-200 ring-1 ring-white/10 hover:bg-white/[0.08]',
      )}
    >
      {children}
    </button>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'reboot' | 'danger'; children: ReactNode }) {
  const style = {
    info: 'bg-sky-500/10 text-sky-200 ring-sky-500/20',
    warn: 'bg-amber-500/10 text-amber-200 ring-amber-500/20',
    reboot: 'bg-violet-500/10 text-violet-200 ring-violet-500/20',
    danger: 'bg-rose-500/10 text-rose-200 ring-rose-500/30',
  }[tone];
  return <div className={clsx('flex items-center justify-between gap-4 rounded-lg px-4 py-2 text-sm ring-1', style)}>{children}</div>;
}

/** "1 WARNING" chip that expands to show the warning text. */
const TAG_LOOK: Record<TweakTag, { label: string; cls: string; title: string }> = {
  power: { label: 'Power hungry', cls: 'bg-orange-500/10 text-orange-300 ring-orange-500/30', title: 'Uses more power and runs warmer: best on desktops, or laptops plugged in.' },
  beta: { label: 'Beta', cls: 'bg-violet-500/10 text-violet-300 ring-violet-500/30', title: "Its exact setting isn't confirmed on every Windows version yet. It can always be turned back off." },
  preference: { label: 'Preference', cls: 'bg-slate-500/10 text-slate-300 ring-slate-500/30', title: 'A matter of taste, not speed. Presets never change it.' },
};

/** Hone-style labels on a tweak (power hungry, beta, preference). */
export function TagChips({ tags }: { tags?: TweakTag[] }) {
  return (
    <>
      {(tags ?? []).map((tag) => (
        <span key={tag} title={TAG_LOOK[tag].title} className={clsx('rounded-md px-1.5 py-0.5 text-xs font-medium ring-1', TAG_LOOK[tag].cls)}>
          {TAG_LOOK[tag].label}
        </span>
      ))}
    </>
  );
}

export function WarningChip({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/25"
      >
        1 warning
      </button>
      {open && <p className="basis-full text-sm text-amber-200/90">{text}</p>}
    </>
  );
}

/** Risk, admin, restart and other flags shared by tweak and fix cards. */
export function Flags({ risk, requiresAdmin, requiresReboot, extra }: { risk: Risk; requiresAdmin: boolean; requiresReboot: boolean; extra?: ReactNode }) {
  return (
    <>
      <Badge className={RISK_STYLE[risk]}>{risk}</Badge>
      {requiresAdmin && <Badge className="bg-violet-500/15 text-violet-300 ring-violet-500/30">admin</Badge>}
      {requiresReboot && <Badge className={MUTED_BADGE}>restart</Badge>}
      {extra}
    </>
  );
}

export function TweakRow({
  t,
  busy,
  onToggle,
  onOption,
  statusText = STATUS_TEXT,
}: {
  t: TweakView;
  busy: boolean;
  onToggle: (on: boolean) => void | Promise<unknown>;
  onOption: (v: number) => void;
  statusText?: Record<TweakStatus, string>;
}) {
  const on = t.status === 'applied';
  const disabled = busy || !t.supported || t.status === 'unavailable';
  return (
    <li className={clsx('flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3', (!t.supported || t.status === 'unavailable') && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-100">{t.name}</span>
          <Flags
            risk={t.risk}
            requiresAdmin={t.requiresAdmin}
            requiresReboot={t.requiresReboot}
            extra={!t.supported && <Badge className={MUTED_BADGE}>unsupported build</Badge>}
          />
          {t.unfit && (
            <span title={t.unfit}>
              <Badge className="bg-orange-500/15 text-orange-300 ring-orange-500/30">not for this PC</Badge>
            </span>
          )}
          {t.anticheatWarning && (
            <span title={t.anticheatWarning}>
              <Badge className="bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30">anti-cheat</Badge>
            </span>
          )}
          <WarningChip text={t.warning} />
          <TagChips tags={t.tags} />
          {t.changedAt && <span className="text-xs text-slate-500">changed {new Date(t.changedAt).toLocaleDateString()}</span>}
          {!t.changedAt && t.status === 'applied' && (
            <span className="text-xs text-slate-500" title="IcyTweaker didn't change this: it was already set (Windows' default or another tool).">
              already set
            </span>
          )}
        </div>
        {(t.unfit || t.anticheatWarning) && <p className="mt-1 text-xs text-orange-200/90">{[t.unfit, t.anticheatWarning].filter(Boolean).join(' ')}</p>}
        <p className="mt-1 text-sm text-slate-400">{t.description}</p>
        {t.options && (
          <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            Adjust:
            <select
              disabled={disabled}
              value={on ? String(t.currentOption) : ''}
              onChange={(e) => onOption(Number(e.target.value))}
              className="rounded-md bg-white/5 px-2 py-1 text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
            >
              {!on && <option value="">Windows default{t.currentOption != null ? ` (0x${t.currentOption.toString(16)})` : ''}</option>}
              {t.options.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900">
                  {o.label}
                </option>
              ))}
            </select>
            {on && (
              <button disabled={disabled} onClick={() => onToggle(false)} className="text-sky-300 hover:underline disabled:opacity-40">
                Restore Windows default
              </button>
            )}
          </label>
        )}
      </div>
      <span className={clsx('w-28 text-right text-xs', on ? 'text-sky-300' : t.status === 'partial' ? 'text-amber-300' : 'text-slate-500')}>
        {statusText[t.status]}
      </span>
      <Toggle on={on} partial={t.status === 'partial'} label={t.name} disabled={disabled} onChange={onToggle} />
    </li>
  );
}

/** Animated switch (styles: .toggle in index.css). partial = some of its settings are on. */
// Flips at once and pulses while the change runs (a restore point can take a while), then shows the real state.
export function Toggle({ on, partial, label, disabled, onChange }: { on: boolean; partial?: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void | Promise<unknown> }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const shown = pending ?? on;
  return (
    <button
      role="switch"
      aria-checked={shown}
      aria-busy={pending !== null}
      aria-label={label}
      data-partial={!shown && partial ? '' : undefined}
      disabled={disabled || pending !== null}
      onClick={() => {
        setPending(!on);
        void Promise.resolve(onChange(!on)).finally(() => setPending(null));
      }}
      className={clsx('toggle', pending !== null && 'animate-pulse')}
    >
      <span className="knob" />
    </button>
  );
}

const CATEGORY_ICON: Record<TweakView['category'], IconName> = { performance: 'bolt', system: 'sliders', graphics: 'sparkles', security: 'shield' };

/** A tweak as a card (General page grid). Glows blue when applied, amber when partly applied. */
export function TweakCard({
  t,
  busy,
  onToggle,
  onOption,
}: {
  t: TweakView;
  busy: boolean;
  onToggle: (on: boolean) => void | Promise<unknown>;
  onOption: (v: number) => void;
}) {
  const on = t.status === 'applied';
  const disabled = busy || !t.supported || t.status === 'unavailable';
  return (
    <li
      data-state={on ? 'applied' : t.status === 'partial' ? 'partial' : 'off'}
      className={clsx('tweak-card flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)]', (!t.supported || t.status === 'unavailable') && 'opacity-55')}
    >
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3.5">
        <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--card-2)] transition-colors', on ? 'text-sky-300' : 'text-slate-400')}>
          <Icon name={CATEGORY_ICON[t.category]} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-slate-100">{t.name}</div>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <p className="text-sm leading-relaxed text-slate-400">{t.description}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Flags risk={t.risk} requiresAdmin={t.requiresAdmin} requiresReboot={t.requiresReboot} extra={!t.supported && <Badge className={MUTED_BADGE}>unsupported build</Badge>} />
          {t.unfit && (
            <span title={t.unfit}>
              <Badge className="bg-orange-500/15 text-orange-300 ring-orange-500/30">not for this PC</Badge>
            </span>
          )}
          {t.anticheatWarning && (
            <span title={t.anticheatWarning}>
              <Badge className="bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30">anti-cheat</Badge>
            </span>
          )}
          <WarningChip text={t.warning} />
        </div>
        {(t.unfit || t.anticheatWarning) && <p className="text-xs text-orange-200/90">{[t.unfit, t.anticheatWarning].filter(Boolean).join(' ')}</p>}
        {t.tags?.length ? (
          <div className="flex flex-wrap gap-1.5">
            <TagChips tags={t.tags} />
          </div>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div className="min-w-0 text-xs">
            <div className={clsx(on ? 'text-sky-300' : t.status === 'partial' ? 'text-amber-300' : 'text-slate-500')}>{STATUS_TEXT[t.status]}</div>
            {t.changedAt && <div className="text-slate-600">changed {new Date(t.changedAt).toLocaleDateString()}</div>}
            {!t.changedAt && t.status === 'applied' && (
              <div className="text-slate-600" title="IcyTweaker didn't change this: it was already set (Windows' default or another tool).">
                already set
              </div>
            )}
          </div>
          {t.options ? (
            <div className="flex flex-col items-end gap-1.5">
              <select
                disabled={disabled}
                value={on ? String(t.currentOption) : ''}
                onChange={(e) => onOption(Number(e.target.value))}
                aria-label={`${t.name} value`}
                className="max-w-[12rem] rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 disabled:opacity-40"
              >
                {!on && <option value="">Windows default{t.currentOption != null ? ` (0x${t.currentOption.toString(16)})` : ''}</option>}
                {t.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {on && (
                <button disabled={disabled} onClick={() => onToggle(false)} className="text-xs text-sky-300 hover:underline disabled:opacity-40">
                  Restore Windows default
                </button>
              )}
            </div>
          ) : (
            <Toggle on={on} partial={t.status === 'partial'} label={t.name} disabled={disabled} onChange={onToggle} />
          )}
        </div>
      </div>
    </li>
  );
}

/** Modal confirm dialog. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  typeToConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** If set, the confirm button stays disabled until the user types this word. */
  typeToConfirm?: string;
  onClose: (ok: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const blocked = !!typeToConfirm && typed.trim() !== typeToConfirm;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-2xl">
        <h2 id="confirm-title" className="text-lg font-semibold text-slate-100">
          {title}
        </h2>
        <p className="max-h-[50vh] overflow-y-auto whitespace-pre-line text-sm text-slate-300">{body}</p>
        {typeToConfirm && (
          <label className="block space-y-1 text-sm text-slate-300">
            Type <span className="font-mono font-semibold text-rose-300">{typeToConfirm}</span> to confirm:
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={`Type ${typeToConfirm} to confirm`}
              className="block w-full rounded-md bg-white/5 px-3 py-1.5 font-mono text-slate-100 ring-1 ring-white/10"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button primary={!typeToConfirm} danger={!!typeToConfirm} disabled={blocked} onClick={() => onClose(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Usage ring. value null = unavailable. */
export function Ring({ label, value, detail }: { label: string; value: number | null; detail?: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = value ?? 0;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--card)] p-5 ring-1 ring-[var(--line)]">
      <div className="relative">
        <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90" role="img" aria-label={`${label} ${value === null ? 'unavailable' : `${pct}%`}`}>
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-white/10" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            className={clsx('transition-[stroke-dashoffset] duration-500 ease-out', pct > 85 ? 'stroke-rose-400' : pct > 60 ? 'stroke-amber-400' : 'stroke-sky-400')}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold text-slate-100">{value === null ? 'n/a' : `${pct}%`}</div>
      </div>
      <div className="text-sm font-medium text-slate-300">{label}</div>
      <div className="h-4 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

/** A feature card: icon tile, title and subtitle header, body, optional right-aligned footer. */
export function FeatureCard({
  icon,
  title,
  subtitle,
  tag,
  children,
  footer,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  tag?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      {tag && <span className="absolute right-5 top-0 rounded-b-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 ring-1 ring-sky-400/30">{tag}</span>}
      <div className="flex items-center gap-4 border-b border-[var(--line)] px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--card-2)] text-sky-300">
          <Icon name={icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-100">{title}</div>
          {subtitle && <div className="text-sm text-slate-400">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="space-y-3 px-5 py-4 text-sm text-slate-300">{children}</div>}
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3">{footer}</div>}
    </div>
  );
}

/** Checkmark list. */
export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i} className="flex items-center gap-2 text-slate-300">
          <Icon name="check" className="h-4 w-4 text-sky-400" />
          {i}
        </li>
      ))}
    </ul>
  );
}

/** Pill tabs with icons. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; icon?: IconName }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition',
            value === t.id ? 'bg-white/[0.07] text-slate-50 ring-1 ring-white/10' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {t.icon && <Icon name={t.icon} className="h-4 w-4" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const formatBytes =(n: number | null) =>
  n === null ? 'N/A' : n === 0 ? '0 B' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** "3 min ago", "2 h ago", "4 days ago" (ISO time in the past). */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** When the shown result was scanned, e.g. "Last scan 2 h ago". */
export function ScanAge({ at, saved }: { at: string | null; saved?: boolean }) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-slate-400 ring-1 ring-white/10" title={new Date(at).toLocaleString()}>
      <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
      Last scan {ago(at)}
      {saved ? ' (saved result)' : ''}
    </span>
  );
}
