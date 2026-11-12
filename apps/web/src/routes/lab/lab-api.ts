/**
 * Benchmark orchestration for /lab, also exposed as `window.__stemdeckLab` so
 * e2e/bench/lab-bench.mjs (and lab.spec.ts) can drive it headlessly.
 */

import {
  ALL_QUALITY_CHECKS,
  availableStretchers,
  type BenchResults,
  benchToMarkdown,
  type CandidateRow,
  createRenderWorker,
  createStretchClient,
  generateSignal,
  type LiveLoadResult,
  loopRequest,
  type MainThreadStats,
  measureOfflineLoad,
  type OfflineLoadResult,
  PERF_CASES,
  type PerfCase,
  type PerfReport,
  type QualityCheck,
  type QualityReport,
  runFlacDecodeTest,
  runPerfSuite,
  runQualitySuite,
  STRETCHERS,
  type StretchClient,
  type StretcherId,
  startMainThreadProbe,
} from '@stemdeck/audio';
import { getContext, LoadMonitor, StressPlayer, toAudioBuffer } from './audio';
import { deviceInfo } from './device';

export interface RunAllOptions {
  /** Default: every backend this build can load. */
  backends?: StretcherId[];
  /** Environment label for the report header. */
  label?: string;
  perf?: false | { runs?: number; warmup?: number; cases?: PerfCase[]; poolSize?: number };
  quality?: false | { bars?: number; checks?: QualityCheck[]; quick?: boolean };
  realtime?: false | { seconds?: number; voices?: number; live?: boolean; liveSeconds?: number };
  flac?: false | { seconds?: number[] };
}

export type ProgressFn = (message: string, fraction: number) => void;

const SR = 44100;

function newClient(size: number): StretchClient {
  return createStretchClient({ size, createWorker: createRenderWorker });
}

export async function probeCandidates(backends: StretcherId[]): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = [];
  const all = Object.keys(STRETCHERS) as StretcherId[];
  for (const id of all) {
    const info = STRETCHERS[id];
    const row: CandidateRow = {
      id,
      label: info.label,
      packageName: info.packageName,
      packageVersion: info.packageVersion,
      license: info.license,
      permissive: info.permissive,
      offlineWorker: null,
      supportsFormant: info.supportsFormant,
      initMs: null,
      error: null,
    };
    if (!backends.includes(id)) {
      row.error = availableStretchers().includes(id)
        ? 'not selected'
        : 'not in this build (flag off)';
      rows.push(row);
      continue;
    }
    const client = newClient(1);
    try {
      const ready = await client.init(id);
      row.initMs = Math.round(ready.initMs);
      // A tiny render proves the backend really works offline inside the worker.
      const sig = generateSignal('click', { bars: 1, sampleRate: SR });
      const { request } = loopRequest(sig.channels, sig.layout, 150, 2);
      const res = await client.render(id, request);
      row.offlineWorker = res.channels.every((c) => c.length === request.outputFrames);
    } catch (err) {
      row.offlineWorker = false;
      row.error = err instanceof Error ? err.message : String(err);
    } finally {
      client.dispose();
    }
    rows.push(row);
  }
  return rows;
}

export async function runPerf(
  backends: StretcherId[],
  opts: Exclude<RunAllOptions['perf'], false | undefined>,
  progress: ProgressFn,
): Promise<{ reports: PerfReport[]; mainThread: Record<string, MainThreadStats> }> {
  const reports: PerfReport[] = [];
  const mainThread: Record<string, MainThreadStats> = {};
  const poolSize = opts.poolSize ?? 3;
  for (const [i, id] of backends.entries()) {
    const single = newClient(1);
    const pool = newClient(poolSize);
    try {
      await single.init(id);
      await pool.init(id);
      const probe = startMainThreadProbe();
      const cases = opts.cases ?? PERF_CASES;
      let done = 0;
      const total = cases.length * (opts.runs ?? 5) * 2;
      const rep = await runPerfSuite({
        backend: id,
        renderSingle: (req) => single.render(id, req),
        renderPool: (req) => pool.render(id, req),
        poolSize,
        cases,
        runs: opts.runs ?? 5,
        warmup: opts.warmup ?? 1,
        sampleRate: SR,
        onTimed: (active) => (active ? probe.resume() : probe.pause()),
        onProgress: (label) => {
          if (!label.endsWith('warm-up')) done++;
          progress(`perf: ${label}`, (i + Math.min(1, done / total)) / backends.length);
        },
      });
      mainThread[id] = probe.stop();
      reports.push(rep);
    } finally {
      single.dispose();
      pool.dispose();
    }
  }
  return { reports, mainThread };
}

export async function runQuality(
  backends: StretcherId[],
  opts: Exclude<RunAllOptions['quality'], false | undefined>,
  progress: ProgressFn,
): Promise<QualityReport[]> {
  const out: QualityReport[] = [];
  for (const [i, id] of backends.entries()) {
    const client = newClient(1);
    try {
      const info = await client.init(id);
      out.push(
        await runQualitySuite({
          backend: id,
          supportsFormant: info.supportsFormant,
          render: (req) => client.render(id, req),
          bars: opts.bars ?? 4,
          checks: opts.checks ?? ALL_QUALITY_CHECKS,
          quick: opts.quick ?? false,
          sampleRate: SR,
          onProgress: (label) => progress(`quality ${id}: ${label}`, i / backends.length),
        }),
      );
    } finally {
      client.dispose();
    }
  }
  return out;
}

/** The five loops used by the realtime comparison and the stress toggle. */
function stressSources(sampleRate: number, bars = 4) {
  return (['drums', 'pad', 'bass', 'vowel', 'click'] as const).map((k) =>
    generateSignal(k, { bars, sampleRate, bpm: 120 }),
  );
}

export async function runRealtime(
  opts: Exclude<RunAllOptions['realtime'], false | undefined>,
  progress: ProgressFn,
): Promise<{ offline: OfflineLoadResult[]; live: LiveLoadResult[] }> {
  const seconds = opts.seconds ?? 20;
  const voices = opts.voices ?? 5;
  const sources = stressSources(SR).slice(0, voices);
  const offline: OfflineLoadResult[] = [];
  // Render-on-drop playback: the voices are already rendered, so play the source bodies.
  progress('realtime: plain buffers (offline context)', 0.1);
  offline.push(
    await measureOfflineLoad({
      mode: 'plain',
      voices: sources.map((s) =>
        s.channels.map((c) =>
          c.slice(s.layout.bodyStart, s.layout.bodyStart + s.layout.bodyFrames),
        ),
      ),
      sampleRate: SR,
      seconds,
    }),
  );
  progress('realtime: 5 Signalsmith worklet nodes (offline context)', 0.4);
  offline.push(
    await measureOfflineLoad({
      mode: 'stretch',
      voices: sources.map((s) => s.channels),
      sampleRate: SR,
      seconds,
      rate: 1.25,
      semitones: 5,
    }),
  );
  const live: LiveLoadResult[] = [];
  const ctx = getContext();
  if (opts.live && ctx && ctx.state === 'running') {
    for (const mode of ['plain', 'stretch'] as const) {
      progress(`realtime: live ${mode}`, mode === 'plain' ? 0.6 : 0.8);
      live.push(await measureLive(ctx, mode, voices, opts.liveSeconds ?? 10));
    }
  }
  return { offline, live };
}

/** Plays `voices` loops for `seconds` on the live context and reads the load monitor. */
export async function measureLive(
  ctx: AudioContext,
  mode: 'plain' | 'stretch',
  voices: number,
  seconds: number,
): Promise<LiveLoadResult> {
  const sources = stressSources(ctx.sampleRate).slice(0, voices);
  const player = new StressPlayer(ctx);
  const monitor = new LoadMonitor(ctx);
  await player.start(
    sources.map((s, i) =>
      mode === 'plain'
        ? {
            kind: 'buffer' as const,
            id: `v${i}`,
            label: s.kind,
            buffer: toAudioBuffer(
              ctx,
              s.channels.map((c) =>
                c.slice(s.layout.bodyStart, s.layout.bodyStart + s.layout.bodyFrames),
              ),
              ctx.sampleRate,
            ),
            bpm: 120,
            bars: 4,
          }
        : {
            kind: 'realtime' as const,
            id: `v${i}`,
            label: s.kind,
            channels: s.channels,
            loopStartSec: s.layout.bodyStart / ctx.sampleRate,
            loopEndSec: (s.layout.bodyStart + s.layout.bodyFrames) / ctx.sampleRate,
            rate: 1.25,
            semitones: 5,
            formant: false,
            bpm: 150,
            bars: 4,
          },
    ),
  );
  monitor.start();
  // Waiting for wall-clock time to pass is UI/benchmark plumbing, not audio scheduling.
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const result = monitor.read(mode, voices);
  monitor.stop();
  player.stop();
  return result;
}

export async function runFlac(seconds: number[], progress: ProgressFn) {
  const out = [];
  for (const [i, s] of seconds.entries()) {
    progress(`FLAC decode ${s} s`, i / seconds.length);
    out.push(
      await runFlacDecodeTest({ label: `${s} s stereo 16-bit`, seconds: s, sampleRate: SR }),
    );
  }
  return out;
}

export async function runAll(
  options: RunAllOptions = {},
  onProgress?: ProgressFn,
): Promise<BenchResults> {
  const progress: ProgressFn = onProgress ?? (() => {});
  const backends = options.backends ?? availableStretchers();
  const label = options.label ?? 'this device';
  const results: BenchResults = {
    environment: deviceInfo(getContext(), label),
    candidates: [],
    perf: [],
    mainThread: {},
    quality: [],
    realtime: null,
    flac: [],
  };
  progress('probing candidates', 0);
  results.candidates = await probeCandidates(backends);
  const working = backends.filter((b) => results.candidates.find((c) => c.id === b)?.offlineWorker);
  if (options.quality !== false) {
    results.quality = await runQuality(working, options.quality ?? {}, (m, f) =>
      progress(m, 0.05 + 0.25 * f),
    );
  }
  if (options.perf !== false) {
    const perf = await runPerf(working, options.perf ?? {}, (m, f) => progress(m, 0.3 + 0.5 * f));
    results.perf = perf.reports;
    results.mainThread = perf.mainThread;
  }
  if (options.realtime !== false) {
    results.realtime = await runRealtime(options.realtime ?? {}, (m, f) =>
      progress(m, 0.8 + 0.1 * f),
    );
  }
  if (options.flac !== false) {
    results.flac = await runFlac(
      options.flac ? (options.flac.seconds ?? [3, 30]) : [3, 30],
      (m, f) => progress(m, 0.9 + 0.1 * f),
    );
  }
  progress('done', 1);
  return results;
}

export interface LabHook {
  runAll: typeof runAll;
  probeCandidates: typeof probeCandidates;
  runFlac: (seconds?: number[]) => ReturnType<typeof runFlac>;
  toMarkdown: typeof benchToMarkdown;
  available: () => StretcherId[];
  deviceInfo: (label?: string) => ReturnType<typeof deviceInfo>;
  /** Last results produced by the page's Run button (or a hook call). */
  last: BenchResults | null;
}

declare global {
  interface Window {
    __stemdeckLab?: LabHook;
  }
}

export function installLabHook(onResults: (r: BenchResults) => void): () => void {
  const hook: LabHook = {
    runAll: async (opts, progress) => {
      const r = await runAll(opts, progress);
      hook.last = r;
      onResults(r);
      return r;
    },
    probeCandidates,
    runFlac: (seconds = [3, 30]) => runFlac(seconds, () => {}),
    toMarkdown: benchToMarkdown,
    available: availableStretchers,
    deviceInfo: (label = 'this device') => deviceInfo(getContext(), label),
    last: null,
  };
  window.__stemdeckLab = hook;
  return () => {
    if (window.__stemdeckLab === hook) delete window.__stemdeckLab;
  };
}
