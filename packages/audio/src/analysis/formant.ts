/**
 * Spectral-envelope analysis for the formant check.
 *
 * The vowel test signal is a harmonic pulse train through fixed formant filters, so its
 * spectral envelope is sampled exactly at the harmonics k·f0. We measure the harmonic levels
 * from a Welch-averaged spectrum, interpolate them in dB over log-frequency, and compare
 * envelopes by searching the shift (in semitones) that best aligns them.
 */

import { hann, magnitudeSpectrum, parabolicPeak } from '../dsp/fft';

export interface Envelope {
  /** Harmonic frequencies (Hz), ascending. */
  freqs: number[];
  /** Level at each harmonic (dB). */
  db: number[];
}

export interface EnvelopeOptions {
  sampleRate: number;
  /** Fundamental of the analysed signal (Hz). */
  f0: number;
  start?: number;
  length?: number;
  frameSize?: number;
  maxHz?: number;
}

/** Welch-averaged magnitude spectrum (Hann frames, 50% hop). */
export function averageSpectrum(
  x: ArrayLike<number>,
  start: number,
  length: number,
  frameSize: number,
): Float64Array {
  const w = hann(frameSize);
  const acc = new Float64Array(frameSize / 2 + 1);
  let frames = 0;
  const frame = new Float64Array(frameSize);
  for (let pos = start; pos + frameSize <= start + length; pos += frameSize / 2) {
    for (let i = 0; i < frameSize; i++) frame[i] = x[pos + i] as number;
    const mag = magnitudeSpectrum(frame, frameSize, w);
    for (let k = 0; k < acc.length; k++) acc[k] = (acc[k] as number) + (mag[k] as number) ** 2;
    frames++;
  }
  if (frames === 0) throw new RangeError('averageSpectrum: window shorter than one frame');
  for (let k = 0; k < acc.length; k++) acc[k] = Math.sqrt((acc[k] as number) / frames);
  return acc;
}

export function harmonicEnvelope(x: ArrayLike<number>, options: EnvelopeOptions): Envelope {
  const sr = options.sampleRate;
  const frameSize = options.frameSize ?? 4096;
  const start = options.start ?? 0;
  const length = options.length ?? x.length - start;
  const maxHz = options.maxHz ?? 4000;
  const spec = averageSpectrum(x, start, length, frameSize);
  const binHz = sr / frameSize;
  const freqs: number[] = [];
  const db: number[] = [];
  for (let h = 1; h * options.f0 <= maxHz; h++) {
    const centre = (h * options.f0) / binHz;
    const span = Math.max(1, Math.floor((0.3 * options.f0) / binHz));
    let best = Math.round(centre);
    for (let k = Math.round(centre) - span; k <= Math.round(centre) + span; k++) {
      if (k > 0 && k < spec.length - 1 && (spec[k] as number) > (spec[best] as number)) best = k;
    }
    const peak = parabolicPeak(spec, best);
    freqs.push(peak * binHz);
    db.push(20 * Math.log10((spec[best] as number) + 1e-12));
  }
  return { freqs, db };
}

/** Envelope level (dB) at `hz`, linear in dB over log-frequency; NaN outside the harmonics. */
export function envelopeAt(env: Envelope, hz: number): number {
  const f = env.freqs;
  if (f.length === 0 || hz < (f[0] as number) || hz > (f[f.length - 1] as number))
    return Number.NaN;
  let i = 0;
  while (i < f.length - 2 && (f[i + 1] as number) < hz) i++;
  const a = f[i] as number;
  const b = f[i + 1] as number;
  const t = b === a ? 0 : (Math.log(hz) - Math.log(a)) / (Math.log(b) - Math.log(a));
  return (env.db[i] as number) * (1 - t) + (env.db[i + 1] as number) * t;
}

/** Log-frequency grid from lo to hi with `perOctave` points per octave. */
export function logGrid(lo: number, hi: number, perOctave: number): number[] {
  const out: number[] = [];
  const n = Math.floor(Math.log2(hi / lo) * perOctave);
  for (let i = 0; i <= n; i++) out.push(lo * 2 ** (i / perOctave));
  return out;
}

/** The `count` strongest local maxima of the envelope between lo and hi Hz, ascending. */
export function formantPeaks(env: Envelope, count = 3, lo = 200, hi = 3800): number[] {
  const grid = logGrid(lo, hi, 96);
  const vals = grid.map((hz) => envelopeAt(env, hz));
  const peaks: { hz: number; db: number }[] = [];
  for (let i = 1; i < grid.length - 1; i++) {
    const v = vals[i] as number;
    if (Number.isNaN(v)) continue;
    if (v > (vals[i - 1] as number) && v >= (vals[i + 1] as number)) {
      peaks.push({ hz: grid[i] as number, db: v });
    }
  }
  return peaks
    .sort((a, b) => b.db - a.db)
    .slice(0, count)
    .map((p) => p.hz)
    .sort((a, b) => a - b);
}

/**
 * Semitone shift s such that test(f) ≈ reference(f · 2^(−s/12)), i.e. how far the formants of
 * `test` moved relative to `reference`. Levels are compared after removing their means.
 */
export function estimateFormantShift(
  reference: Envelope,
  test: Envelope,
  options: { minHz?: number; maxHz?: number; rangeSemitones?: number; stepSemitones?: number } = {},
): number {
  const grid = logGrid(options.minHz ?? 300, options.maxHz ?? 3200, 48);
  const range = options.rangeSemitones ?? 8;
  const step = options.stepSemitones ?? 0.05;
  let bestS = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  for (let s = -range; s <= range + 1e-9; s += step) {
    const scale = 2 ** (-s / 12);
    const pairs: [number, number][] = [];
    for (const hz of grid) {
      const t = envelopeAt(test, hz);
      const r = envelopeAt(reference, hz * scale);
      if (!Number.isNaN(t) && !Number.isNaN(r)) pairs.push([t, r]);
    }
    if (pairs.length < grid.length / 3) continue;
    const mt = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
    const mr = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    let err = 0;
    for (const [t, r] of pairs) err += (t - mt - (r - mr)) ** 2;
    err /= pairs.length;
    if (err < bestErr) {
      bestErr = err;
      bestS = s;
    }
  }
  // `|| 0` turns −0 into 0.
  return Math.round(bestS * 100) / 100 || 0;
}
