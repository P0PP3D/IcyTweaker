// Tweak engine: tweak and fix definitions as data, plus the runner the IPC layer calls.
import type { ActionReport, AppState, FixMeta, PresetMeta, TweakMeta, TweakStatus } from '../../shared/types';
import { POWERSHELL_EXE, creatable, runningProcesses, dword, sameValue, type Hive, type RegValue, type SettingRef, type Value } from '../system/adapter';
import type { Safety, TweakContext } from '../system/safety';

export interface TweakDefinition extends TweakMeta {
  readState(ctx: TweakContext): Promise<TweakStatus>;
  /** option: chosen value for adjustable tweaks. */
  apply(ctx: TweakContext, option?: number): Promise<void>;
  revert(ctx: TweakContext): Promise<void>;
  /** Adjustable tweaks: current value. */
  readOption?(ctx: TweakContext): Promise<number | null>;
}

export interface Setting {
  ref: SettingRef;
  on: Value;
  /** Windows default, used on revert only if the app has no backup of this setting. null = delete. */
  off: Value | null;
  /** Bitmask settings: does the current value already count as applied? Default: equals `on`. */
  matches?: (cur: Value | null) => boolean;
  /** Bitmask settings: the value to write, given the current one. Default: `on`. */
  toOn?: (cur: Value | null) => Value;
  /**
   * Shared values (several tweaks own parts of one value, e.g. "a=1;b=1;"): revert removes only this tweak's part
   * instead of restoring the backup, which would also undo the other tweaks' parts. null = nothing of ours left: put
   * the backed-up original back (or delete the value if there's no backup).
   */
  toOff?: (cur: Value | null) => Value | null;
}

export interface Tweak extends TweakDefinition {
  settings: Setting[];
}

/**
 * A tweak made of one or more settings. Settings that don't exist on this PC and can't be created
 * (a missing task or service) are skipped; if none exist, the tweak is 'unavailable'.
 * Revert runs in reverse order (e.g. switch away from a power plan before deleting it).
 */
export function tweak(meta: TweakMeta, settings: Setting[]): Tweak {
  const { options } = meta;
  const isOn = (s: Setting, cur: Value | null) =>
    options
      ? (cur as RegValue | null)?.type === 'REG_DWORD' && options.some((o) => o.value === (cur as RegValue).data)
      : s.matches
        ? s.matches(cur)
        : sameValue(cur, s.on);

  return {
    ...meta,
    settings,
    async readState(ctx) {
      const cur = await Promise.all(settings.map((s) => ctx.read(s.ref)));
      // Skipped: settings that don't exist and can't be created, and settings whose "on" is also Windows' default
      // ("off"), e.g. Remote Registry, disabled out of the box. Those read the same either way, so they made
      // untouched groups show as "partial".
      const hits = settings.flatMap((s, i) => ((cur[i] === null && !creatable(s.ref)) || (!options && !s.matches && s.off !== undefined && sameValue(s.on, s.off)) ? [] : [isOn(s, cur[i])]));
      if (hits.length === 0) return 'unavailable';
      return hits.every(Boolean) ? 'applied' : hits.some(Boolean) ? 'partial' : 'not_applied';
    },
    async apply(ctx, option) {
      for (const s of settings) {
        const cur = await ctx.read(s.ref);
        if (!creatable(s.ref) && cur === null) continue;
        await ctx.set(s.ref, options && option !== undefined ? dword(option) : s.toOn ? s.toOn(cur) : s.on);
      }
    },
    async revert(ctx) {
      for (const s of [...settings].reverse()) {
        if (s.toOff) {
          const cur = await ctx.read(s.ref);
          if (!isOn(s, cur)) continue;
          const next = s.toOff(cur);
          if (next !== null) await ctx.set(s.ref, next);
          else if (!(await ctx.restore(s.ref))) await ctx.set(s.ref, null);
          continue;
        }
        if (await ctx.restore(s.ref)) continue;
        // No backup: the setting was changed outside the app. Only touch it if it holds our value, and only if
        // there is a default to write: "absent" can't be written to a power setting, task or service.
        if (s.off === null && !creatable(s.ref)) continue;
        if (isOn(s, await ctx.read(s.ref))) await ctx.set(s.ref, s.off);
      }
    },
    readOption: options
      ? async (ctx) => {
          const v = (await ctx.read(settings[0].ref)) as RegValue | null;
          return v?.type === 'REG_DWORD' ? v.data : null;
        }
      : undefined,
  };
}

export interface RegSetting {
  hive: Hive;
  key: string;
  name: string;
  on: RegValue;
  off: RegValue | null;
}

/** A tweak made of registry values. */
export const regTweak = (meta: TweakMeta, settings: RegSetting[]) =>
  tweak(
    meta,
    settings.map(({ on, off, ...r }) => ({ ref: { kind: 'reg', ...r }, on, off })),
  );

/** One-call DWORD tweak. defaultValue null = delete the value on revert. */
export const regDwordTweak = (meta: TweakMeta, v: { hive: Hive; key: string; name: string; enabled: number; defaultValue: number | null }) =>
  regTweak(meta, [{ hive: v.hive, key: v.key, name: v.name, on: dword(v.enabled), off: v.defaultValue === null ? null : dword(v.defaultValue) }]);

export interface FixDefinition extends FixMeta {
  /** Revert these tweaks first (e.g. Re-Enable Defender). */
  revertTweaks?: string[];
  /** Settings to change; backed up, so Undo All reverses them. */
  changes?: Array<[SettingRef, Value | null]>;
  /** PowerShell for the parts that are actions, not settings. Not undoable except by restore point. */
  script?: string;
  /** The "undo everything" card. */
  undoAll?: true;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createEngine(o: {
  tweaks: TweakDefinition[];
  presets: PresetMeta[];
  fixes?: FixDefinition[];
  safety: Safety;
  live: boolean;
  isAdmin: boolean;
  build: number;
  /** This PC, for tweaks meant for some hardware only. null values = unknown (never blocks). */
  hardware?: { laptop: boolean | null; ssd: boolean | null };
  /** Anti-cheats installed on this PC (e.g. 'Vanguard'). */
  antiCheats?: string[];
}) {
  const { tweaks, presets, safety } = o;
  const fixes = o.fixes ?? [];
  const rebootPending = new Set<string>();
  const supported = (t: TweakDefinition) => o.build >= t.builds.min && (t.builds.max === undefined || o.build <= t.builds.max);
  const status = (t: TweakDefinition) => t.readState(safety).catch((): TweakStatus => 'unknown');
  const statuses = () => Promise.all(tweaks.map(status));
  const dryNote = o.live ? '' : ' (dry-run: nothing written to Windows)';
  const needsAdmin = (x: { requiresAdmin: boolean }) => o.live && x.requiresAdmin && !o.isAdmin;
  /** Why a tweak doesn't fit this PC, or undefined. */
  const unfit = (t: TweakDefinition) =>
    t.hardware?.laptop === false && o.hardware?.laptop === true
      ? 'Not for laptops: more heat and less battery.'
      : t.hardware?.ssd === true && o.hardware?.ssd === false
        ? 'Only for SSDs: your system drive is a hard disk.'
        : undefined;
  const anticheatWarning = (t: TweakDefinition) => {
    const hit = t.anticheat?.names.filter((n) => o.antiCheats?.includes(n)) ?? [];
    return hit.length ? `${hit.join(' and ')} ${t.anticheat!.note}.` : undefined;
  };
  const refsOf = (t: TweakDefinition) => ('settings' in t ? (t as Tweak).settings.map((s) => s.ref) : []);
  /** When the app first changed any setting of this tweak. */
  const changedAt = (t: TweakDefinition) =>
    refsOf(t)
      .map((r) => safety.savedAt(r))
      .filter((x): x is string => !!x)
      .sort()[0];

  // One mutation at a time, so backup writes never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function mutate(fn: () => Promise<ActionReport>, reboot?: () => string | null): Promise<ActionReport> {
    const next = queue.then(async () => {
      // Only restart-required tweaks matter here; reading every tweak twice per change made each change slow.
      const watched = tweaks.filter((t) => t.requiresReboot);
      const before = await Promise.all(watched.map(status));
      const report = await fn();
      const after = await Promise.all(watched.map(status));
      watched.forEach((t, i) => before[i] !== after[i] && rebootPending.add(t.name));
      const extra = reboot?.();
      if (extra && report.ok) rebootPending.add(extra);
      return report;
    });
    queue = next.catch(() => {});
    return next;
  }

  /** Apply or revert one tweak. Returns an error message, or null on success. Always logs. */
  async function run(t: TweakDefinition, action: 'apply' | 'revert', option?: number): Promise<string | null> {
    let error: string | null = null;
    if (!supported(t)) error = `Not supported on Windows build ${o.build}.`;
    else if (needsAdmin(t)) error = 'Needs administrator. Relaunch as admin first.';
    else if (t.needsClosed && (await runningProcesses(safety.adapter).then((p) => t.needsClosed!.some((n) => p.has(n)))))
      error = `Close ${t.needsClosed.join(' / ')} first: it rewrites its settings when it exits.`;
    else {
      try {
        await (action === 'apply' ? t.apply(safety, option) : t.revert(safety));
      } catch (err) {
        error = errText(err);
      }
    }
    await safety.log(action, t.id, error === null, error ?? undefined);
    return error;
  }

  /** Restore point first; if that fails, change nothing. */
  async function withRestorePoint(label: string, fn: () => Promise<ActionReport>): Promise<ActionReport> {
    try {
      await safety.restorePoint(`IcyTweaker: ${label}`);
    } catch (err) {
      return { ok: false, message: `Restore point failed, nothing was changed: ${errText(err)}` };
    }
    return fn();
  }

  /** Bulk over `list`, skipping what is unsupported, unavailable, Risky (on apply) or already in the target state. */
  async function bulkFor(label: string, action: 'apply' | 'revert', list: TweakDefinition[]): Promise<ActionReport> {
    const st = await statuses();
    const todo = list.filter((t) => {
      const s = st[tweaks.indexOf(t)];
      if (!supported(t) || s === 'unavailable') return false;
      return action === 'apply' ? t.risk !== 'risky' && s !== 'applied' && !unfit(t) : s !== 'not_applied';
    });
    if (todo.length === 0) return { ok: true, message: 'Nothing to do.' };
    return withRestorePoint(label, async () => {
      const errors: string[] = [];
      for (const t of todo) {
        const e = await run(t, action);
        if (e) errors.push(`${t.name}: ${e}`);
      }
      const done = todo.length - errors.length;
      return errors.length
        ? { ok: false, message: `${label}: ${done}/${todo.length} done. ${errors.join(' | ')}` }
        : { ok: true, message: `${label}: ${done} tweak(s) done${dryNote}.` };
    });
  }

  async function undoAll(): Promise<ActionReport> {
    const count = safety.backupCount();
    if (count === 0) return { ok: true, message: 'Nothing to undo.' };
    return withRestorePoint('Undo all', async () => {
      const errors = await safety.undoAll();
      await safety.log('undo-all', `${count} setting(s)`, errors.length === 0, errors.join(' | ') || undefined);
      return errors.length
        ? { ok: false, message: `Undo all: ${errors.length} setting(s) failed. ${errors.join(' | ')}` }
        : { ok: true, message: `Undo all: restored ${count} setting(s)${dryNote}.` };
    });
  }

  // Apply All / Revert All belong to the General page: never services or network tweaks.
  const inCategory = (category: unknown) => tweaks.filter((t) => (t.page ?? 'general') === 'general' && (category === undefined || t.category === category));

  return {
    async getState(): Promise<Omit<AppState, 'onboarded'>> {
      const st = await statuses();
      const opts = await Promise.all(tweaks.map((t) => t.readOption?.(safety).catch(() => null)));
      return {
        live: o.live,
        isAdmin: o.isAdmin,
        build: o.build,
        dataDir: safety.dataDir,
        tweaks: tweaks.map((t, i) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
          risk: t.risk,
          requiresAdmin: t.requiresAdmin,
          requiresReboot: t.requiresReboot,
          builds: t.builds,
          warning: t.warning,
          options: t.options,
          page: t.page,
          group: t.group,
          needsClosed: t.needsClosed,
          currentOption: t.options ? (opts[i] ?? null) : undefined,
          hardware: t.hardware,
          anticheat: t.anticheat,
          unfit: unfit(t),
          anticheatWarning: anticheatWarning(t),
          changedAt: changedAt(t),
          status: st[i],
          supported: supported(t),
        })),
        fixes: fixes.map(({ id, name, description, risk, requiresAdmin, requiresReboot, permanent, warning, page }) => ({
          page,
          id,
          name,
          description,
          risk,
          requiresAdmin,
          requiresReboot,
          permanent,
          warning,
        })),
        rebootPending: [...rebootPending],
        backupCount: safety.backupCount(),
        presets,
      };
    },

    setTweak(id: unknown, on: unknown, opts?: { confirmed?: unknown; option?: unknown }): Promise<ActionReport> {
      const t = tweaks.find((x) => x.id === id);
      const option = opts?.option;
      const invalid = { ok: false, message: 'Invalid request.' };
      if (!t || typeof on !== 'boolean') return Promise.resolve(invalid);
      if (option !== undefined && !t.options?.some((x) => x.value === option)) return Promise.resolve(invalid);
      if (on && t.risk === 'risky' && opts?.confirmed !== true)
        return Promise.resolve({ ok: false, message: `${t.name} is Risky and needs confirmation.` });
      const body = async (): Promise<ActionReport> => {
        const e = await run(t, on ? 'apply' : 'revert', option as number | undefined);
        if (e) return { ok: false, message: `${t.name}: ${e}` };
        // Turned off but still on: the app never changed it (no backup) and the setting has no safe default to fall
        // back to (power, adapter, TCP values). Say so instead of a switch that silently flips back.
        if (!on && (await status(t)) === 'applied')
          return {
            ok: false,
            message: `${t.name} was already set this way before IcyTweaker (Windows' default or another tool), so there is no earlier value to go back to. Nothing was changed.`,
          };
        return { ok: true, message: `${t.name} ${on ? 'applied' : 'reverted'}${dryNote}.` };
      };
      // Single changes don't make a restore point (owner's decision): the backup undoes them, and Restart now offers one.
      return mutate(body);
    },

    applyAll: (category?: unknown) => mutate(() => bulkFor('Apply all', 'apply', inCategory(category))),
    revertAll: (category?: unknown) => mutate(() => bulkFor('Revert all', 'revert', inCategory(category))),

    applyPreset(id: unknown): Promise<ActionReport> {
      const p = presets.find((x) => x.id === id);
      if (!p) return Promise.resolve({ ok: false, message: 'Invalid request.' });
      return mutate(() => bulkFor(p.name, p.action, tweaks.filter((t) => p.tweakIds.includes('*') || p.tweakIds.includes(t.id))));
    },

    undoAll: () => mutate(undoAll),

    runFix(id: unknown, confirmed?: unknown): Promise<ActionReport> {
      const f = fixes.find((x) => x.id === id);
      if (!f) return Promise.resolve({ ok: false, message: 'Invalid request.' });
      if (f.risk === 'risky' && confirmed !== true) return Promise.resolve({ ok: false, message: `${f.name} is Risky and needs confirmation.` });
      if (needsAdmin(f)) return Promise.resolve({ ok: false, message: `${f.name}: needs administrator. Relaunch as admin first.` });
      if (f.undoAll) return mutate(undoAll);
      return mutate(
        () =>
          withRestorePoint(f.name, async () => {
            try {
              for (const tid of f.revertTweaks ?? []) await tweaks.find((t) => t.id === tid)?.revert(safety);
              for (const [ref, value] of f.changes ?? []) await safety.set(ref, value);
              if (f.script) await safety.adapter.exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', f.script], 600_000);
            } catch (err) {
              await safety.log('fix', f.id, false, errText(err));
              return { ok: false, message: `${f.name}: ${errText(err)}` };
            }
            await safety.log('fix', f.id, true, o.live ? undefined : 'dry-run: settings simulated, script not run');
            return { ok: true, message: `${f.name} done${dryNote}.` };
          }),
        () => (f.requiresReboot ? f.name : null),
      );
    },

    /** name: the user's own label (optional). Control characters dropped, 60 characters at most. */
    createRestorePoint: (name?: unknown) =>
      mutate(async () => {
        const label = typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 60) : '';
        try {
          await safety.restorePoint(`IcyTweaker: ${label || 'Manual restore point'}`, true); // asked for: always call Windows
          return { ok: true, message: o.live ? 'Restore point created.' : 'Restore point skipped (dry-run).' };
        } catch (err) {
          return { ok: false, message: `Restore point failed: ${errText(err)}` };
        }
      }),

    /**
     * Tweaks the app applied that are no longer applied (usually a Windows update put a value back).
     * Adjustable tweaks are left out (the chosen value isn't stored), and so is the active power plan,
     * which Game Boost changes on purpose during a session.
     */
    async drifted() {
      const st = await statuses();
      return tweaks
        .filter((t, i) => !t.options && st[i] !== 'applied' && st[i] !== 'unavailable' && refsOf(t).some((r) => r.kind !== 'activeScheme' && safety.savedAt(r)))
        .map((t) => ({ id: t.id, name: t.name, risk: t.risk }));
    },

    /** Re-apply drifted tweaks behind one restore point. Risky ones need confirmed: true. */
    reapply(ids: unknown, confirmed?: unknown): Promise<ActionReport> {
      const list = Array.isArray(ids) ? ids.map((id) => tweaks.find((t) => t.id === id)) : [];
      if (list.length === 0 || list.some((t) => !t)) return Promise.resolve({ ok: false, message: 'Invalid request.' });
      if (list.some((t) => t!.risk === 'risky') && confirmed !== true) return Promise.resolve({ ok: false, message: 'Re-applying Risky tweaks needs confirmation.' });
      return mutate(() =>
        withRestorePoint('Re-apply tweaks', async () => {
          const errors: string[] = [];
          for (const t of list) {
            const e = await run(t!, 'apply');
            if (e) errors.push(`${t!.name}: ${e}`);
          }
          return errors.length ? { ok: false, message: `Re-applied ${list.length - errors.length}/${list.length}. ${errors.join(' | ')}` } : { ok: true, message: `Re-applied ${list.length} tweak(s)${dryNote}.` };
        }),
      );
    },

    /** Apply a list (an imported settings file) behind one restore point. Risky ones need confirmed: true; tweaks that don't fit this PC are skipped. */
    applyList(items: Array<{ id: string; option?: number }>, label: string, confirmed?: boolean): Promise<ActionReport> {
      const list = items.map((i) => ({ t: tweaks.find((x) => x.id === i.id)!, option: i.option })).filter((x) => x.t);
      if (list.some((x) => x.t.risk === 'risky') && confirmed !== true) return Promise.resolve({ ok: false, message: 'This settings file includes Risky tweaks and needs confirmation.' });
      return mutate(() =>
        withRestorePoint(label, async () => {
          const errors: string[] = [];
          let skipped = 0;
          for (const { t, option } of list) {
            if (!supported(t) || unfit(t)) {
              skipped++;
              continue;
            }
            const e = await run(t, 'apply', option);
            if (e) errors.push(`${t.name}: ${e}`);
          }
          const done = list.length - skipped - errors.length;
          const note = skipped ? ` ${skipped} skipped (not for this PC or Windows build).` : '';
          return errors.length ? { ok: false, message: `${label}: ${done} applied.${note} Failed: ${errors.join(' | ')}` } : { ok: true, message: `${label}: ${done} tweak(s) applied${dryNote}.${note}` };
        }),
      );
    },

    /** One mutation at a time (single changes that don't need a restore point). */
    serial: (fn: () => Promise<ActionReport>) => mutate(fn),

    /** For the debloater, services levels and fixes elsewhere: `fn` behind a restore point, one mutation at a time. */
    withRestorePoint: (label: string, fn: () => Promise<ActionReport>) => mutate(() => withRestorePoint(label, fn)),
  };
}

