// Presets are just lists of tweak ids. Safe Optimize is derived from the General list; Restore Defaults uses '*'
// (every tweak on every page), so new tweaks join them automatically.
import type { PresetMeta } from '../../shared/types';
import { generalTweaks } from './general';
import { hasTag } from './tags';

// Preferences (dark mode, Explorer switches) are taste, not performance: never in a preset.
const safe = generalTweaks.filter((t) => t.risk === 'safe' && !hasTag(t.id, 'preference')).map((t) => t.id);

const lowLatency = ['core-power-plan', 'win32-priority', 'raw-aim-curve', 'usb-power-guard', 'stickykeys-guard', 'do-solo-mode', 'windowed-game-optimizations'];
const debloat = [
  'silent-app-installs-off',
  'nudge-blocker',
  'search-box-local',
  'search-cloud-off',
  'cloud-sync-off',
  'feedback-tasks-off',
  'sqm-tasks-off',
  'telemetry-zero',
  'usage-insights-off',
  'voice-activation-off',
  'experimentation-lock',
  'troubleshooter-scans-off',
  'media-player-tracking-off',
  'error-reporting-off',
];

export const presets: PresetMeta[] = [
  { id: 'safe-optimize', name: 'Safe Optimize', description: 'Every Safe tweak. The recommended starting point.', action: 'apply', tweakIds: safe, estimate: '+2–6% FPS', estimateNote: 'Mostly steadier 1% lows from less background work.' },
  {
    id: 'max-fps',
    name: 'Max FPS',
    description: 'Full CPU speed when plugged in, foreground priority for your game, and less background work competing with it.',
    action: 'apply',
    tweakIds: ['core-power-plan', 'win32-priority', 'process-count-reduction', 'do-solo-mode', 'winsat-benchmark-off', 'stickykeys-guard', 'power-throttling-off', 'fault-tolerant-heap-off', 'windowed-game-optimizations'],
    estimate: '+3–10% FPS',
    estimateNote: 'Most in CPU-limited games (high-refresh esports titles); little when the GPU is the limit.',
  },
  {
    id: 'low-latency',
    name: 'Low Latency',
    description: 'Raw mouse input, no USB power saving, foreground CPU priority and no peer-to-peer update traffic.',
    action: 'apply',
    tweakIds: lowLatency,
    estimate: '+1–4% FPS',
    estimateNote: 'Aimed at input delay and mouse feel more than FPS.',
  },
  {
    id: 'competitive',
    name: 'Competitive',
    description: 'Low Latency, plus no surprise restarts, installs or pop-ups mid-match.',
    action: 'apply',
    tweakIds: [...lowLatency, 'windows-update-improvements', 'nudge-blocker', 'silent-app-installs-off'],
    estimate: '+1–4% FPS',
    estimateNote: 'Low Latency, plus fewer mid-match interruptions (spikes rather than average FPS).',
  },
  { id: 'debloat-only', name: 'Debloat Only', description: 'Removes Windows nags, promos and data collection without touching performance settings.', action: 'apply', tweakIds: debloat, estimate: '+0–2% FPS', estimateNote: 'Less background activity; mainly fewer stutters.' },
  {
    id: 'streamer',
    name: 'Streamer',
    description: 'Keeps upload bandwidth and CPU for your stream, and stops pop-ups and restarts appearing on capture.',
    action: 'apply',
    tweakIds: ['core-power-plan', 'do-solo-mode', 'usb-power-guard', 'stickykeys-guard', 'nudge-blocker', 'windows-update-improvements'],
    estimate: '+2–5% FPS',
    estimateNote: 'Steadier frame pacing while encoding a stream.',
  },
  {
    id: 'restore-defaults',
    name: 'Restore Defaults',
    description: 'Reverts every tweak on every page back to how it was before the app changed it.',
    action: 'revert',
    tweakIds: ['*'], // every tweak on every page, including Services and Networking
    estimate: 'Back to stock',
    estimateNote: 'Undoes the gains above.',
  },
];
