// Analysis helpers (tests, benchmarks, Phase 1 audio tests).
export * from './analysis/formant';
export * from './analysis/metrics';
export * from './analysis/onsets';
export * from './analysis/pitch';
// Spike benchmark harness (/lab).
export * from './bench/flac-decode';
export * from './bench/main-thread';
export * from './bench/markdown';
export * from './bench/perf';
export * from './bench/quality';
export * from './bench/realtime-load';
export * from './bench/request';
export * from './contracts';
// FLAC test-stream encoder.
export * from './flac/encoder';
// Seamless loops (render-on-drop).
export * from './seam';
// Synthetic test signals and loop layout.
export * from './signals/generators';
export * from './signals/layout';
// Stretchers (render-on-drop). Non-permissive backends are NOT exported: they are reachable
// only through loadStretcher() behind VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1.
export * from './stretch/client';
export * from './stretch/common';
export { createRenderWorker } from './stretch/create-worker';
export type * from './stretch/protocol';
export * from './stretch/realtime';
export * from './stretch/registry';
export * from './stretch/signalsmith';
export * from './stretch/worker-host';
