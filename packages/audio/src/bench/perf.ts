/**
 * Render-time benchmark (docs/BUILD_PROMPT.md §16.2 budgets). Backend-agnostic: it receives
 * render functions bound to a single-worker client and to a pool client.
 */

import { summarize } from '../analysis/metrics';
import type { StretchRequest } from '../contracts';
import { generateSignal, type SignalKind } from '../signals/generators';
import { loopRequest } from './request';

export interface PerfCase {
  bars: number;
  ratio: number;
  semitones: number;
}

/** 8 and 16 bars × the four corners (r 0.8/1.25 × t −5/+5) plus r = 1, t = 0. */
export const PERF_CASES: readonly PerfCase[] = [8, 16].flatMap((bars) => [
  { bars, ratio: 0.8, semitones: -5 },
  { bars, ratio: 0.8, semitones: 5 },
  { bars, ratio: 1.25, semitones: -5 },
  { bars, ratio: 1.25, semitones: 5 },
  { bars, ratio: 1, semitones: 0 },
]);

export interface TimedRender {
  /** DSP time reported by the backend. */
  renderMs: number;
  /** Main-thread round trip (queue + transfer + render), when rendered through a client. */
  roundTripMs?: number;
  heapBytes?: number;
}

export type PerfRenderFn = (request: StretchRequest) => Promise<TimedRender>;

export interface PerfOptions {
  backend: string;
  /** Render through a single worker. */
  renderSingle: PerfRenderFn;
  /** Render through a pool (e.g. 3 workers); omitted → no pool column. */
  renderPool?: PerfRenderFn;
  poolSize?: number;
  cases?: readonly PerfCase[];
  /** Timed runs per case (median reported). Default 5. */
  runs?: number;
  /** Untimed warm-up renders per case. Default 1. */
  warmup?: number;
  sourceBpm?: number;
  sampleRate?: number;
  signal?: SignalKind;
  formant?: boolean;
  onProgress?: (label: string) => void;
  /**
   * Called with true right before a timed render is posted and false when it returns
   * (requests are built before), e.g. to scope a main-thread probe to the render path.
   */
  onTimed?: (active: boolean) => void;
}

export interface PerfRow {
  bars: number;
  ratio: number;
  semitones: number;
  /** Seconds of input / output audio per channel (handles included). */
  inputSec: number;
  outputSec: number;
  /** Single worker: median round trip (falls back to DSP time without a client). */
  singleMedianMs: number;
  singleMinMs: number;
  singleMaxMs: number;
  /** Single worker: median DSP time inside the worker. */
  dspMedianMs: number;
  /** Pool: median wall time to render `poolSize` loops submitted at once. */
  poolBatchMedianMs: number | null;
  /** Pool: median per-render round trip while `poolSize` renders are in flight. */
  poolPerRenderMedianMs: number | null;
  /** Output seconds rendered per wall second (single worker). */
  speedX: number;
  heapBytesMax: number;
}

export interface PerfReport {
  backend: string;
  runs: number;
  warmup: number;
  poolSize: number | null;
  rows: PerfRow[];
}

const nowMs = () => performance.now();
const r1 = (x: number) => Math.round(x * 10) / 10;

export async function runPerfSuite(options: PerfOptions): Promise<PerfReport> {
  const runs = options.runs ?? 5;
  const warmup = options.warmup ?? 1;
  const poolSize = options.renderPool ? (options.poolSize ?? 3) : null;
  const sourceBpm = options.sourceBpm ?? 120;
  const sampleRate = options.sampleRate ?? 44100;
  const progress = options.onProgress ?? (() => {});
  const timed = options.onTimed ?? (() => {});
  const rows: PerfRow[] = [];
  const signals = new Map<number, ReturnType<typeof generateSignal>>();

  for (const c of options.cases ?? PERF_CASES) {
    let sig = signals.get(c.bars);
    if (!sig) {
      sig = generateSignal(options.signal ?? 'drums', { bpm: sourceBpm, bars: c.bars, sampleRate });
      signals.set(c.bars, sig);
    }
    const s = sig;
    const make = () =>
      loopRequest(s.channels, s.layout, sourceBpm * c.ratio, c.semitones, options.formant ?? false);
    const label = `${options.backend} ${c.bars} bars r=${c.ratio} t=${c.semitones}`;
    let heapMax = 0;
    for (let i = 0; i < warmup; i++) {
      progress(`${label} warm-up`);
      await options.renderSingle(make().request);
    }
    const single: number[] = [];
    const dsp: number[] = [];
    for (let i = 0; i < runs; i++) {
      progress(`${label} single ${i + 1}/${runs}`);
      const { request } = make();
      timed(true);
      const t0 = nowMs();
      const res = await options.renderSingle(request);
      const wall = nowMs() - t0;
      timed(false);
      single.push(res.roundTripMs ?? wall);
      dsp.push(res.renderMs);
      heapMax = Math.max(heapMax, res.heapBytes ?? 0);
    }
    let batch: number[] | null = null;
    let perRender: number[] | null = null;
    if (options.renderPool && poolSize) {
      batch = [];
      perRender = [];
      const pool = options.renderPool;
      // Warm every pool worker once.
      await Promise.all(Array.from({ length: poolSize }, () => pool(make().request)));
      for (let i = 0; i < runs; i++) {
        progress(`${label} pool×${poolSize} ${i + 1}/${runs}`);
        const reqs = Array.from({ length: poolSize }, () => make().request);
        timed(true);
        const t0 = nowMs();
        const results = await Promise.all(reqs.map((r) => pool(r)));
        batch.push(nowMs() - t0);
        timed(false);
        for (const res of results) {
          perRender.push(res.roundTripMs ?? res.renderMs);
          heapMax = Math.max(heapMax, res.heapBytes ?? 0);
        }
      }
    }
    const { request, output } = make();
    const inputSec = (request.channels[0]?.length ?? 0) / sampleRate;
    const outputSec = output.totalFrames / sampleRate;
    const ss = summarize(single);
    rows.push({
      bars: c.bars,
      ratio: c.ratio,
      semitones: c.semitones,
      inputSec: r1(inputSec),
      outputSec: r1(outputSec),
      singleMedianMs: r1(ss.median),
      singleMinMs: r1(ss.min),
      singleMaxMs: r1(ss.max),
      dspMedianMs: r1(summarize(dsp).median),
      poolBatchMedianMs: batch ? r1(summarize(batch).median) : null,
      poolPerRenderMedianMs: perRender ? r1(summarize(perRender).median) : null,
      speedX: r1((outputSec * 1000) / ss.median),
      heapBytesMax: heapMax,
    });
  }
  return { backend: options.backend, runs, warmup, poolSize, rows };
}
