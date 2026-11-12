/** Dominant-frequency estimation for pitch-accuracy checks. */

import { hann, magnitudeSpectrum, nextPowerOfTwo, parabolicPeak } from '../dsp/fft';

export interface DominantFrequencyOptions {
  sampleRate: number;
  /** First frame of the analysis window. Default 0. */
  start?: number;
  /** Window length in frames. Default: the rest of the signal, at most 1 s. */
  length?: number;
  /** Zero-padding factor (power of two). Default 4. */
  zeroPad?: number;
  /** Ignore energy below this frequency. Default 20 Hz. */
  minHz?: number;
}

/** Frequency (Hz) of the strongest spectral peak, with parabolic sub-bin interpolation. */
export function dominantFrequency(x: ArrayLike<number>, options: DominantFrequencyOptions): number {
  const sr = options.sampleRate;
  const start = options.start ?? 0;
  const length = Math.min(options.length ?? Math.min(sr, x.length - start), x.length - start);
  if (length < 16) throw new RangeError('dominantFrequency: window too short');
  const frame = new Float64Array(length);
  for (let i = 0; i < length; i++) frame[i] = x[start + i] as number;
  const fftSize = nextPowerOfTwo(length) * (options.zeroPad ?? 4);
  const mag = magnitudeSpectrum(frame, fftSize, hann(length));
  const minBin = Math.max(1, Math.ceil(((options.minHz ?? 20) * fftSize) / sr));
  let best = minBin;
  for (let k = minBin; k < mag.length - 1; k++) {
    if ((mag[k] as number) > (mag[best] as number)) best = k;
  }
  return (parabolicPeak(mag, best) * sr) / fftSize;
}

/** Signed error in cents of `measuredHz` relative to `expectedHz`. */
export function centsError(measuredHz: number, expectedHz: number): number {
  return 1200 * Math.log2(measuredHz / expectedHz);
}
