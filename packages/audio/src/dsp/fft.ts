/**
 * Small, allocation-aware radix-2 FFT used by the analysis helpers (pitch, formant envelope).
 * Not used on the real-time audio path.
 */

interface Twiddles {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}

const twiddleCache = new Map<number, Twiddles>();

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function twiddles(n: number): Twiddles {
  let t = twiddleCache.get(n);
  if (t) return t;
  const half = n / 2;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  twiddleCache.set(n, t);
  return t;
}

/** In-place forward complex FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) {
    throw new RangeError(`fft: length must be a power of two (got ${n}/${im.length})`);
  }
  const { cos, sin, rev } = twiddles(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i] as number;
    if (j > i) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step] as number;
        const wi = sin[k * step] as number;
        const a = start + k;
        const b = a + half;
        const br = re[b] as number;
        const bi = im[b] as number;
        const xr = br * wr - bi * wi;
        const xi = br * wi + bi * wr;
        const ar = re[a] as number;
        const ai = im[a] as number;
        re[b] = ar - xr;
        im[b] = ai - xi;
        re[a] = ar + xr;
        im[a] = ai + xi;
      }
    }
  }
}

/** Hann window of length n (periodic=false: symmetric). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * Magnitude spectrum (bins 0…fftSize/2) of `frame` multiplied by `window`, zero-padded to
 * `fftSize` (a power of two ≥ frame length).
 */
export function magnitudeSpectrum(
  frame: ArrayLike<number>,
  fftSize: number,
  window?: ArrayLike<number>,
): Float64Array {
  if (frame.length > fftSize) throw new RangeError('magnitudeSpectrum: frame longer than fftSize');
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < frame.length; i++) {
    re[i] = (frame[i] as number) * (window ? (window[i] as number) : 1);
  }
  fft(re, im);
  const out = new Float64Array(fftSize / 2 + 1);
  for (let k = 0; k <= fftSize / 2; k++) {
    out[k] = Math.hypot(re[k] as number, im[k] as number);
  }
  return out;
}

/**
 * Sub-bin peak position by fitting a parabola through the log magnitudes of bins k−1, k, k+1.
 * Returns the fractional bin index.
 */
export function parabolicPeak(mag: ArrayLike<number>, k: number): number {
  if (k <= 0 || k >= mag.length - 1) return k;
  const eps = 1e-30;
  const a = Math.log((mag[k - 1] as number) + eps);
  const b = Math.log((mag[k] as number) + eps);
  const c = Math.log((mag[k + 1] as number) + eps);
  const denom = a - 2 * b + c;
  if (denom === 0) return k;
  const p = (0.5 * (a - c)) / denom;
  return k + Math.max(-0.5, Math.min(0.5, p));
}
