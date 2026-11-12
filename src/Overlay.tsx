import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { OverlayStats } from '../shared/types';

/** The in-game overlay: a small translucent panel (the window is click-through and always on top). */
export function Overlay() {
  const [s, setS] = useState<OverlayStats | null>(null);
  useEffect(() => window.api.onOverlay(setS), []);
  const fpsColor = (fps: number | null) => (fps === null ? 'text-slate-400' : fps >= 120 ? 'text-emerald-300' : fps >= 60 ? 'text-sky-200' : 'text-amber-300');
  const row = (label: string, value: string, cls = 'text-slate-100') => (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className={clsx('font-semibold tabular-nums', cls)}>{value}</span>
    </div>
  );
  return (
    <div className="m-1 w-[220px] rounded-xl bg-black/65 px-3 py-2 font-mono text-[12px] leading-5 shadow-lg ring-1 ring-white/10">
      <div className="mb-0.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-sky-300">
        <span>IcyCleaner</span>
        <span className="truncate pl-2 text-slate-400">{s?.game ?? 'waiting…'}</span>
      </div>
      {row('FPS', s?.fps != null ? String(s.fps) : '—', fpsColor(s?.fps ?? null))}
      {row('1% low', s?.low1 != null ? String(s.low1) : '—', fpsColor(s?.low1 ?? null))}
      {row('Frame', s?.frametime != null ? `${s.frametime} ms` : '—')}
      {row('GPU', s?.gpuLoad != null ? `${s.gpuLoad}%${s.gpuTemp != null ? ` · ${s.gpuTemp}°C` : ''}` : '—', s?.gpuTemp != null && s.gpuTemp >= 83 ? 'text-rose-300' : 'text-slate-100')}
      {row('CPU', s?.cpu != null ? `${s.cpu}%${s.cpuTemp != null ? ` · ${s.cpuTemp}°C` : ''}` : '—', s?.cpuTemp != null && s.cpuTemp >= 90 ? 'text-rose-300' : 'text-slate-100')}
      {row('Ping', s?.ping != null ? `${s.ping} ms` : '—', s?.ping == null ? 'text-slate-400' : s.ping < 50 ? 'text-emerald-300' : s.ping < 100 ? 'text-sky-200' : 'text-amber-300')}
    </div>
  );
}
