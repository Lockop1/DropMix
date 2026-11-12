/** Device / browser capability snapshot for the lab's info panel and benchmark header. */

import type { EnvironmentInfo } from '@stemdeck/audio';

interface NavigatorExtras {
  deviceMemory?: number;
  audioSession?: { type: string };
  wakeLock?: unknown;
  storage?: { getDirectory?: unknown };
}

export function detectFeatures(): Record<string, boolean> {
  const nav = navigator as Navigator & NavigatorExtras;
  return {
    AudioWorklet: typeof AudioWorkletNode !== 'undefined',
    OfflineAudioContext: typeof OfflineAudioContext !== 'undefined',
    'Module Worker': typeof Worker !== 'undefined',
    WebAssembly: typeof WebAssembly !== 'undefined',
    OPFS: typeof nav.storage?.getDirectory === 'function',
    'Wake Lock': 'wakeLock' in nav,
    audioSession: 'audioSession' in nav,
    renderCapacity:
      typeof AudioContext !== 'undefined' && 'renderCapacity' in AudioContext.prototype,
    playbackStats: typeof AudioContext !== 'undefined' && 'playbackStats' in AudioContext.prototype,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
  };
}

export function deviceInfo(ctx: AudioContext | null, label: string): EnvironmentInfo {
  const nav = navigator as Navigator & NavigatorExtras;
  return {
    label,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    sampleRate: ctx?.sampleRate ?? null,
    baseLatency: ctx?.baseLatency ?? null,
    outputLatency: ctx && 'outputLatency' in ctx ? ctx.outputLatency : null,
    features: detectFeatures(),
    timestamp: new Date().toISOString(),
  };
}
