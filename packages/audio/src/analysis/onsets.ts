/**
 * Onset timing measurement for click/drum loops with known grid positions.
 *
 * For each expected position, the detector looks inside ±searchMs for the first frame where a
 * short centred RMS envelope reaches `threshold` × the window's envelope peak, with linear
 * sub-frame interpolation. The same detector run on the dry (unstretched) signal gives its
 * bias, which callers subtract (`calibrateOnsetBias`).
 */

export interface OnsetOptions {
  sampleRate: number;
  /** Half-width of the search window around each expected onset. Default 25 ms. */
  searchMs?: number;
  /** Fraction of the local envelope peak that marks the onset. Default 0.5. */
  threshold?: number;
  /** Envelope RMS window (centred). Default 0.25 ms. */
  smoothMs?: number;
}

/** Mono mix-down (mean of channels), as Float64Array. */
export function mixDown(channels: ArrayLike<number>[]): Float64Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float64Array(n);
  for (const ch of channels)
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (ch[i] as number);
  if (channels.length > 1)
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) / channels.length;
  return out;
}

/** Centred RMS envelope over [lo, hi). Returns values for that range only. */
function envelope(x: ArrayLike<number>, lo: number, hi: number, half: number): Float64Array {
  const env = new Float64Array(hi - lo);
  for (let i = lo; i < hi; i++) {
    let s = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < x.length) {
        const v = x[k] as number;
        s += v * v;
        n++;
      }
    }
    env[i - lo] = n ? Math.sqrt(s / n) : 0;
  }
  return env;
}

/** Fractional frame of the onset nearest `expected`, or null if the window is silent. */
export function detectOnsetNear(
  x: ArrayLike<number>,
  expected: number,
  options: OnsetOptions,
): number | null {
  const sr = options.sampleRate;
  const search = Math.round(((options.searchMs ?? 25) / 1000) * sr);
  const threshold = options.threshold ?? 0.5;
  const half = Math.max(1, Math.round((((options.smoothMs ?? 0.25) / 1000) * sr) / 2));
  const lo = Math.max(0, Math.floor(expected) - search);
  const hi = Math.min(x.length, Math.ceil(expected) + search + 1);
  if (hi - lo < 2) return null;
  const env = envelope(x, lo, hi, half);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak <= 1e-6) return null;
  const level = threshold * peak;
  for (let i = 0; i < env.length; i++) {
    const v = env[i] as number;
    if (v >= level) {
      if (i === 0) return lo;
      const prev = env[i - 1] as number;
      const frac = v === prev ? 0 : (level - prev) / (v - prev);
      return lo + i - 1 + frac;
    }
  }
  return null;
}

export interface OnsetErrorStats {
  /** Signed error per expected onset, in ms (NaN when not found). */
  errorsMs: number[];
  maxAbsMs: number;
  meanAbsMs: number;
  /** Onsets the detector could not find. */
  missing: number;
}

/**
 * Measures each expected onset (fractional frames) in `x` and returns signed errors in ms,
 * after subtracting `biasFrames` (the detector's own bias on the dry signal).
 */
export function measureOnsetErrors(
  x: ArrayLike<number>,
  expected: number[],
  options: OnsetOptions & { biasFrames?: number },
): OnsetErrorStats {
  const bias = options.biasFrames ?? 0;
  const errorsMs: number[] = [];
  let missing = 0;
  let maxAbs = 0;
  let sumAbs = 0;
  for (const e of expected) {
    const found = detectOnsetNear(x, e, options);
    if (found === null) {
      missing++;
      errorsMs.push(Number.NaN);
      continue;
    }
    const err = ((found - bias - e) / options.sampleRate) * 1000;
    errorsMs.push(err);
    maxAbs = Math.max(maxAbs, Math.abs(err));
    sumAbs += Math.abs(err);
  }
  const found = expected.length - missing;
  return { errorsMs, maxAbsMs: maxAbs, meanAbsMs: found ? sumAbs / found : Number.NaN, missing };
}

/**
 * Mean detector offset (frames) on a dry signal whose onsets are exactly at `onsets`. Onsets
 * whose search window would be clipped by the buffer edges are skipped (the clipped window
 * biases the result).
 */
export function calibrateOnsetBias(x: ArrayLike<number>, onsets: number[], options: OnsetOptions) {
  const search = Math.round(((options.searchMs ?? 25) / 1000) * options.sampleRate);
  let sum = 0;
  let n = 0;
  for (const o of onsets) {
    if (o - search < 0 || o + search >= x.length) continue;
    const f = detectOnsetNear(x, o, options);
    if (f !== null) {
      sum += f - o;
      n++;
    }
  }
  return n ? sum / n : 0;
}
