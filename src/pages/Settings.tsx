import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AppSettings, AppState, Progress, UpdateInfo } from '../../shared/types';
import { Icon } from '../icons';
import { Button, FeatureCard, RISK_STYLE, Badge, Toggle, type Ask } from '../ui';
import type { Act } from './General';
import { ACCENTS, applyTheme } from '../theme';

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Toggle on={on} label={label} disabled={disabled} onChange={onChange} />
  );
}

const ROWS: Array<{ key: 'tray' | 'notify' | 'startWithWindows' | 'weeklyClean' | 'overlayWithBoost' | 'hotkeys' | 'autoUpdate'; name: string; description: string }> = [
  { key: 'autoUpdate', name: 'Automatic updates', description: 'Check GitHub for a new version every few hours, download it in the background and install it when you quit IcyTweaker. Off: only when you press the buttons under Updates.' },
  { key: 'tray', name: 'Keep running in the tray', description: 'Closing the window keeps IcyTweaker in the system tray, so Game Boost and scheduled cleaning keep working. Quit from the tray icon.' },
  { key: 'notify', name: 'Notifications', description: 'Tell me when Game Boost starts and ends, and when the weekly Health Check has run.' },
  { key: 'startWithWindows', name: 'Start with Windows', description: 'Start IcyTweaker in the tray when you sign in (as administrator, through a scheduled task, without a prompt).' },
  { key: 'overlayWithBoost', name: 'Overlay during Game Boost', description: 'Show the in-game overlay (FPS, 1% low, GPU temperature) automatically while Game Boost runs a game. Needs administrator.' },
  { key: 'hotkeys', name: 'Global hotkeys', description: 'Ctrl+Shift+O shows or hides the overlay for the game you are playing; Ctrl+Shift+B turns Game Boost on or off. They work while IcyTweaker runs, even in the tray.' },
  { key: 'weeklyClean', name: 'Weekly Health Check', description: 'Once a week, when the PC has been idle for 10 minutes, clean the safe Health Check items. Runs while IcyTweaker is open or in the tray.' },
];

function Updates({ busy, act }: { busy: boolean; act: Act }) {
  const [u, setU] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => window.api.onProgress((p) => p.task === 'update' && setProgress(p.current ? p : null)), []);
  return (
    <FeatureCard
      icon="download"
      title="Updates"
      subtitle={u ? `This is version ${u.current}` : 'Check for a newer IcyTweaker'}
      footer={
        <>
          {u?.downloaded ? (
            <Button primary disabled={busy} onClick={() => window.api.installUpdate()}>
              Restart and install {u.latest}
            </Button>
          ) : u?.canInstall ? (
            <Button
              primary
              disabled={busy || !!progress}
              onClick={() =>
                act(async () => {
                  const r = await window.api.downloadUpdate();
                  setU(await window.api.checkUpdates());
                  return r;
                })
              }
            >
              {progress ? `Downloading ${Math.round((100 * progress.done) / Math.max(progress.total, 1))}%…` : `Download ${u.latest}`}
            </Button>
          ) : (
            u?.newer &&
            u.url && (
              <Button primary disabled={busy} onClick={() => window.api.openUpdatePage()}>
                Get {u.latest}
              </Button>
            )
          )}
          <Button
            disabled={busy || checking}
            onClick={async () => {
              setChecking(true);
              setU(await window.api.checkUpdates());
              setChecking(false);
            }}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </>
      }
    >
      {!u ? (
        <p>With Automatic updates on (above), new versions download by themselves and install when you quit. You can also check now.</p>
      ) : !u.configured ? (
        <p className="text-amber-300">No release page is set up for this build yet (package.json "updateRepo").</p>
      ) : u.error ? (
        <p className="text-rose-300">{u.error}</p>
      ) : u.newer ? (
        <p className="text-emerald-300">Version {u.latest} is available.</p>
      ) : (
        <p>You have the latest version{u.latest ? ` (${u.latest})` : ''}.</p>
      )}
    </FeatureCard>
  );
}

export function Settings({ state, busy, act, ask }: { state: AppState; busy: boolean; act: Act; ask: Ask }) {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => void window.api.getSettings().then(setS), []);
  const save = async (patch: Partial<AppSettings>) => {
    if (!s) return;
    const { lastCleanAt: _ignored, ...rest } = { ...s, ...patch };
    const next = await window.api.setSettings(rest);
    setS(next);
    applyTheme(next);
  };

  async function importConfig(fromClipboard = false) {
    const r = await window.api.readConfig(fromClipboard);
    if (!r.summary) {
      if (r.error && r.error !== 'Import cancelled.') await act(async () => ({ ok: false, message: r.error! }));
      return;
    }
    const sum = r.summary;
    const risky = sum.tweaks.filter((t) => t.risk === 'risky');
    const body = [
      `${sum.tweaks.length} tweak(s) to apply from ${sum.file}${sum.exportedAt ? ` (exported ${new Date(sum.exportedAt).toLocaleString()})` : ''}:`,
      ...sum.tweaks.map((t) => `• ${t.name}${t.risk === 'risky' ? ' (Risky)' : ''}`),
      sum.skipped ? `\n${sum.skipped} entr(ies) skipped: unknown here or not valid.` : '',
      sum.boost ? '\nGame Boost settings are included.' : '',
      '\nTweaks that don\'t fit this PC are skipped. A restore point is created first.',
    ].join('\n');
    const ok = await ask('Import settings?', body, 'Apply', risky.length ? 'IMPORT' : undefined);
    if (!ok) return;
    await act(() => window.api.applyConfig(risky.length > 0));
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Settings</h2>
        <p className="text-sm text-slate-400">How IcyTweaker runs, and moving your setup to another PC.</p>
      </div>
      <ul className="space-y-2">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-100">{r.name}</div>
              <p className="text-sm text-slate-400">{r.description}</p>
              {r.key === 'weeklyClean' && s?.lastCleanAt && <p className="text-xs text-slate-500">Last run {new Date(s.lastCleanAt).toLocaleString()}</p>}
            </div>
            <Switch on={!!s?.[r.key]} label={r.name} disabled={busy || !s} onChange={(v) => save({ [r.key]: v })} />
          </li>
        ))}
      </ul>
      <FeatureCard icon="sparkles" title="Appearance" subtitle="Theme and accent colour">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex gap-1 rounded-lg bg-white/5 p-1 ring-1 ring-[var(--line)]" role="radiogroup" aria-label="Theme">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={s?.theme === t}
                disabled={busy || !s}
                onClick={() => save({ theme: t })}
                className={clsx('rounded-md px-3 py-1 text-sm capitalize', s?.theme === t ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40' : 'text-slate-400 hover:text-slate-200')}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={s?.accent === a.id}
                aria-label={a.label}
                title={a.label}
                disabled={busy || !s}
                onClick={() => save({ accent: a.id })}
                style={{ background: a.swatch }}
                className={clsx('h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-[var(--card)] transition', s?.accent === a.id ? 'ring-slate-200' : 'ring-transparent hover:ring-white/30')}
              />
            ))}
          </div>
        </div>
      </FeatureCard>
      <FeatureCard
        icon="layers"
        title="Export and import"
        subtitle="Your applied tweaks and Game Boost setup as one file"
        footer={
          <>
            <Button disabled={busy} onClick={() => importConfig()}>
              <Icon name="download" className="h-4 w-4" />
              Import…
            </Button>
            <Button disabled={busy} onClick={() => importConfig(true)}>
              Import from clipboard
            </Button>
            <Button disabled={busy} onClick={() => act(() => window.api.copyShareCode())}>
              Copy share code
            </Button>
            <Button primary disabled={busy} onClick={() => act(() => window.api.exportConfig())}>
              Export…
            </Button>
          </>
        }
      >
        <p>Save everything you've applied to a small file, or copy it as a share code to paste in Discord. Importing shows the list first and only applies tweaks this version of IcyTweaker knows.</p>
        <p className="text-xs text-slate-500">
          Risky tweaks in a file need you to type IMPORT. <Badge className={RISK_STYLE.risky}>risky</Badge>
        </p>
      </FeatureCard>
      <Updates busy={busy} act={act} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-slate-100">
            <span className={clsx('h-2.5 w-2.5 rounded-full', state.live ? 'bg-rose-400' : 'bg-sky-400')} />
            {state.live ? 'Live mode' : 'Dry-run mode'}
          </div>
          <p className="text-sm text-slate-400">
            {state.live ? 'Changes are written to Windows. Every original value is backed up first.' : 'Changes are only simulated; nothing is written to Windows.'} {state.backupCount} setting(s) changed so far.
          </p>
          <p className="truncate text-xs text-slate-500" title={state.dataDir}>
            Backup and log: {state.dataDir}
          </p>
        </div>
        <Button danger disabled={busy || state.backupCount === 0} onClick={() => act(() => window.api.undoAll())}>
          <Icon name="undo" className="h-4 w-4" />
          Undo all changes ({state.backupCount})
        </Button>
      </div>
    </section>
  );
}
