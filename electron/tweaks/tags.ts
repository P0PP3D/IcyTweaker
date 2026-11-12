// Labels shown on tweaks (like Hone's): what to expect beyond the description.
//   power:      uses more power / runs warmer (CPU kept at full speed, timers, idle states)
//   beta:       its exact setting is marked "verify" in the source (not confirmed against every Windows build)
//   preference: a matter of taste, not performance: never part of a preset
import type { TweakTag } from '../../shared/types';

export const TWEAK_TAGS: Record<string, TweakTag[]> = {
  'core-power-plan': ['power'],
  'cpu-core-parking-off': ['power'],
  'cpu-min-state-100': ['power'],
  'cpu-boost-aggressive': ['power'],
  'cpu-idle-disable': ['power'],
  'timer-resolution-global': ['power'],

  'cloud-sync-off': ['beta'],
  'experimentation-lock': ['beta'],
  'media-player-tracking-off': ['beta'],
  'troubleshooter-scans-off': ['beta'],
  'usage-insights-off': ['beta'],
  'fullscreen-optimizations-off': ['beta'],
  'visual-effects-performance': ['beta'],
  'recall-off': ['beta'],
  'snap-layouts-off': ['beta'],
  'block-unsigned-drivers': ['beta'],
  'proximity-deny': ['beta'],

  'show-file-extensions': ['preference'],
  'show-hidden-files': ['preference'],
  'taskbar-end-task': ['preference'],
  'classic-alt-tab': ['preference'],
  'dark-mode': ['preference'],
  'classic-context-menu': ['preference'],
  'taskbar-left': ['preference'],
  'menu-delay-off': ['preference'],
};

export const hasTag = (id: string, tag: TweakTag) => !!TWEAK_TAGS[id]?.includes(tag);
