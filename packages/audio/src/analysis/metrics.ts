/** Small quality metrics shared by the unit tests, the benchmark and (later) the engine tests. */

/** True when every channel has exactly `frames` frames. */
export function hasExactLength(channels: ArrayLike<number>[], frames: number): boolean {
  return channels.length > 0 && channels.every((ch) => ch.length === frames);
}

/** True when both renders are sample-for-sample identical (bitwise for Float32Array). */
export function identicalRenders(a: Float32Array[], b: Float32Array[]): boolean {
  if (a.length !== b.length) return false;
  for (let c = 0; c < a.length; c++) {
    const x = a[c] as Float32Array;
    const y = b[c] as Float32Array;
    if (x.length !== y.length) return false;
    const xi = new Uint32Array(x.buffer, x.byteOffset, x.length);
    const yi = new Uint32Array(y.buffer, y.byteOffset, y.length);
    for (let i = 0; i < xi.length; i++) if (xi[i] !== yi[i]) return false;
  }
  return true;
}

export interface SeamStats {
  /** |x[0] − x[L−1]| (max over channels). */
  jump: number;
  /** RMS of |x[n+1] − x[n]| over the loop (same channel as `jump`). */
  rmsStep: number;
  /** jump / rmsStep: ≈1 means the seam looks like any other sample step. */
  ratio: number;
}

/**
 * Discontinuity across the loop boundary (last frame → first frame) relative to the typical
 * sample-to-sample step inside the loop. Reports the worst channel.
 */
export function seamDiscontinuity(loop: ArrayLike<number>[]): SeamStats {
  let worst: SeamStats = { jump: 0, rmsStep: 0, ratio: 0 };
  for (const x of loop) {
    const n = x.length;
    if (n < 2) continue;
    let ss = 0;
    for (let i = 1; i < n; i++) {
      const d = (x[i] as number) - (x[i - 1] as number);
      ss += d * d;
    }
    const rmsStep = Math.sqrt(ss / (n - 1));
    const jump = Math.abs((x[0] as number) - (x[n - 1] as number));
    const ratio = rmsStep > 0 ? jump / rmsStep : jump > 0 ? Number.POSITIVE_INFINITY : 0;
    if (ratio >= worst.ratio) worst = { jump, rmsStep, ratio };
  }
  return worst;
}

export interface Summary {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export function summarize(values: number[]): Summary {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0)
    return { min: Number.NaN, max: Number.NaN, mean: Number.NaN, median: Number.NaN };
  const mid = Math.floor(v.length / 2);
  const median =
    v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
  return {
    min: v[0] as number,
    max: v[v.length - 1] as number,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    median,
  };
}
