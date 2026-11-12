/**
 * Automated stretcher quality suite (docs/spikes/audio.md, "Quality"). Backend-agnostic: it
 * only needs a render function, so it runs against a backend directly (Node unit tests) or
 * through the worker pool (the /lab page).
 */

import { estimateFormantShift, formantPeaks, harmonicEnvelope } from '../analysis/formant';
import { hasExactLength, identicalRenders, seamDiscontinuity } from '../analysis/metrics';
import { calibrateOnsetBias, measureOnsetErrors, mixDown } from '../analysis/onsets';
import { centsError, dominantFrequency } from '../analysis/pitch';
import { AUDIO_TUNING, type StretchRequest, type StretchResult } from '../contracts';
import { buildSeamlessLoop, cutLoop } from '../seam';
import { generateSignal, type SignalKind } from '../signals/generators';
import { BEATS_PER_BAR, idealBeatFrame } from '../signals/layout';
import { loopRequest } from './request';

export type RenderFn = (request: StretchRequest) => Promise<StretchResult>;

export type QualityCheck = 'onset' | 'pitch' | 'seam' | 'formant' | 'determinism';
export const ALL_QUALITY_CHECKS: readonly QualityCheck[] = [
  'onset',
  'pitch',
  'seam',
  'formant',
  'determinism',
];

export interface QualityOptions {
  backend: string;
  supportsFormant: boolean;
  render: RenderFn;
  /** Body length of the test loops. Default 4. */
  bars?: number;
  /** Native tempo of the test loops. Default 120. */
  sourceBpm?: number;
  sampleRate?: number;
  checks?: readonly QualityCheck[];
  /** Fewer cases per check (CI / the short e2e test). */
  quick?: boolean;
  onProgress?: (label: string) => void;
}

export interface OnsetRow {
  ratio: number;
  semitones: number;
  onsets: number;
  maxAbsMs: number;
  meanAbsMs: number;
  missing: number;
}

export interface PitchRow {
  ratio: number;
  semitones: number;
  expectedHz: number;
  measuredHz: number;
  cents: number;
}

export interface SeamRow {
  signal: SignalKind;
  ratio: number;
  semitones: number;
  /** Boundary jump / RMS sample step with the 10 ms handle crossfade. */
  ratioCrossfaded: number;
  /** Same for a plain cut of the body (no crossfade), for comparison. */
  ratioCut: number;
}

export interface FormantRow {
  semitones: number;
  formant: boolean;
  formantApplied: boolean;
  /** Measured envelope shift in semitones (≈0 = formants preserved, ≈t = shifted with pitch). */
  envelopeShift: number;
  peaksHz: number[];
}

export interface QualityReport {
  backend: string;
  bars: number;
  sourceBpm: number;
  renders: number;
  exactLength: number;
  onsets: OnsetRow[];
  pitch: PitchRow[];
  seams: SeamRow[];
  formant: FormantRow[];
  /** Reference envelope peaks of the dry vowel. */
  formantReferenceHz: number[];
  deterministic: boolean | null;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export async function runQualitySuite(options: QualityOptions): Promise<QualityReport> {
  const bars = options.bars ?? 4;
  const sourceBpm = options.sourceBpm ?? 120;
  const sampleRate = options.sampleRate ?? 44100;
  const checks = new Set(options.checks ?? ALL_QUALITY_CHECKS);
  const quick = options.quick ?? false;
  const progress = options.onProgress ?? (() => {});
  const report: QualityReport = {
    backend: options.backend,
    bars,
    sourceBpm,
    renders: 0,
    exactLength: 0,
    onsets: [],
    pitch: [],
    seams: [],
    formant: [],
    formantReferenceHz: [],
    deterministic: null,
  };
  const sig = (kind: SignalKind) => generateSignal(kind, { bpm: sourceBpm, bars, sampleRate });

  const render = async (kind: SignalKind, ratio: number, semitones: number, formant = false) => {
    const s = sig(kind);
    const { request, output } = loopRequest(
      s.channels,
      s.layout,
      sourceBpm * ratio,
      semitones,
      formant,
    );
    const result = await options.render(request);
    report.renders++;
    if (hasExactLength(result.channels, request.outputFrames)) report.exactLength++;
    return { signal: s, result, output };
  };

  if (checks.has('onset')) {
    const click = sig('click');
    const sopt = { sampleRate };
    const bias = calibrateOnsetBias(mixDown(click.channels), click.onsets, sopt);
    const cases: [number, number][] = quick
      ? [
          [0.8, 0],
          [1.25, 0],
        ]
      : [
          [0.8, 0],
          [1.25, 0],
          [0.8, -5],
          [1.25, 5],
        ];
    for (const [ratio, semitones] of cases) {
      progress(`onset r=${ratio} t=${semitones}`);
      const { result, output } = await render('click', ratio, semitones);
      const first = output.handleBars * BEATS_PER_BAR;
      const expected: number[] = [];
      for (let b = first; b < first + bars * BEATS_PER_BAR; b++)
        expected.push(idealBeatFrame(output, b));
      const stats = measureOnsetErrors(mixDown(result.channels), expected, {
        ...sopt,
        biasFrames: bias,
      });
      report.onsets.push({
        ratio,
        semitones,
        onsets: expected.length,
        maxAbsMs: round(stats.maxAbsMs),
        meanAbsMs: round(stats.meanAbsMs),
        missing: stats.missing,
      });
    }
  }

  if (checks.has('pitch')) {
    const ratios = quick ? [1.25] : [0.8, 1.25];
    const shifts = quick ? [5] : [-5, 0, 5];
    for (const ratio of ratios) {
      for (const semitones of shifts) {
        progress(`pitch r=${ratio} t=${semitones}`);
        const { signal, result, output } = await render('sine', ratio, semitones);
        const base = signal.meta.frequency as number;
        const expectedHz = base * 2 ** (semitones / 12);
        const len = Math.min(sampleRate, output.bodyFrames);
        const start = output.bodyStart + Math.floor((output.bodyFrames - len) / 2);
        const measuredHz = dominantFrequency(result.channels[0] as Float32Array, {
          sampleRate,
          start,
          length: len,
        });
        report.pitch.push({
          ratio,
          semitones,
          expectedHz: round(expectedHz, 2),
          measuredHz: round(measuredHz, 2),
          cents: round(centsError(measuredHz, expectedHz), 2),
        });
      }
    }
  }

  if (checks.has('seam')) {
    const cases: [SignalKind, number, number][] = quick
      ? [['pad', 1.25, 5]]
      : [
          ['pad', 0.8, -5],
          ['pad', 1.25, 5],
          ['bass', 0.8, -5],
          ['bass', 1.25, 5],
        ];
    for (const [kind, ratio, semitones] of cases) {
      progress(`seam ${kind} r=${ratio} t=${semitones}`);
      const { result, output } = await render(kind, ratio, semitones);
      const crossfadeFrames = Math.round(AUDIO_TUNING.seamCrossfadeSec * sampleRate);
      const loop = buildSeamlessLoop(result.channels, {
        bodyStart: output.bodyStart,
        loopFrames: output.bodyFrames,
        crossfadeFrames,
      });
      const cut = cutLoop(result.channels, output.bodyStart, output.bodyFrames);
      report.seams.push({
        signal: kind,
        ratio,
        semitones,
        ratioCrossfaded: round(seamDiscontinuity(loop).ratio, 2),
        ratioCut: round(seamDiscontinuity(cut).ratio, 2),
      });
    }
  }

  if (checks.has('formant')) {
    const vowel = sig('vowel');
    const f0 = vowel.meta.f0 as number;
    const body = { start: vowel.layout.bodyStart, length: vowel.layout.bodyFrames };
    const reference = harmonicEnvelope(vowel.channels[0] as Float32Array, {
      sampleRate,
      f0,
      ...body,
    });
    report.formantReferenceHz = formantPeaks(reference).map((f) => Math.round(f));
    const modes = options.supportsFormant ? [false, true] : [false];
    for (const semitones of quick ? [5] : [-5, 5]) {
      for (const formant of modes) {
        progress(`formant t=${semitones} formant=${formant}`);
        const { result, output } = await render('vowel', 1, semitones, formant);
        const env = harmonicEnvelope(result.channels[0] as Float32Array, {
          sampleRate,
          f0: f0 * 2 ** (semitones / 12),
          start: output.bodyStart,
          length: output.bodyFrames,
        });
        report.formant.push({
          semitones,
          formant,
          formantApplied: result.formantApplied,
          envelopeShift: estimateFormantShift(reference, env),
          peaksHz: formantPeaks(env).map((f) => Math.round(f)),
        });
      }
    }
  }

  if (checks.has('determinism')) {
    progress('determinism');
    const a = await render('drums', 1.25, 5, options.supportsFormant);
    const b = await render('drums', 1.25, 5, options.supportsFormant);
    report.deterministic = identicalRenders(a.result.channels, b.result.channels);
  }

  return report;
}
