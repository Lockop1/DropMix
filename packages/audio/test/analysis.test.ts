import { describe, expect, it } from 'vitest';
import { estimateFormantShift, formantPeaks, harmonicEnvelope } from '../src/analysis/formant';
import {
  hasExactLength,
  identicalRenders,
  seamDiscontinuity,
  summarize,
} from '../src/analysis/metrics';
import {
  calibrateOnsetBias,
  detectOnsetNear,
  measureOnsetErrors,
  mixDown,
} from '../src/analysis/onsets';
import { centsError, dominantFrequency } from '../src/analysis/pitch';
import {
  fft,
  hann,
  isPowerOfTwo,
  magnitudeSpectrum,
  nextPowerOfTwo,
  parabolicPeak,
} from '../src/dsp/fft';
import { mulberry32 } from '../src/dsp/prng';
import { generateSignal } from '../src/signals/generators';

const SR = 44100;

describe('fft', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const rand = mulberry32(3);
    const x = Array.from({ length: n }, () => rand() * 2 - 1);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0;
      let i = 0;
      for (let t = 0; t < n; t++) {
        r += (x[t] as number) * Math.cos((-2 * Math.PI * k * t) / n);
        i += (x[t] as number) * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(i, 9);
    }
  });

  it('helpers', () => {
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(hann(5)[2]).toBeCloseTo(1, 12);
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    const mag = magnitudeSpectrum(
      Float64Array.from({ length: 8 }, () => 1),
      8,
    );
    expect(mag[0]).toBeCloseTo(8, 9);
    expect(parabolicPeak(Float64Array.of(1, 2, 1), 1)).toBeCloseTo(1, 12);
  });

  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('onset detector', () => {
  const click = generateSignal('click', { bars: 2 });
  const mono = mixDown(click.channels);

  it('finds every dry click within a fraction of a millisecond (detector bias)', () => {
    const bias = calibrateOnsetBias(mono, click.onsets, { sampleRate: SR });
    expect(Math.abs(bias)).toBeLessThan(0.0005 * SR);
    const stats = measureOnsetErrors(
      mono,
      click.onsets.slice(1).map((o) => o),
      { sampleRate: SR, biasFrames: bias },
    );
    expect(stats.missing).toBe(0);
    expect(stats.maxAbsMs).toBeLessThan(0.25);
  });

  it('measures a known delay', () => {
    const delay = 88; // 2 ms
    const shifted = new Float64Array(mono.length);
    shifted.set(mono.subarray(0, mono.length - delay), delay);
    const onsets = click.onsets.slice(1, -1);
    const dry = measureOnsetErrors(mono, onsets, { sampleRate: SR });
    const late = measureOnsetErrors(shifted, onsets, { sampleRate: SR });
    // Same click shapes, so each onset moves by exactly the delay.
    for (const [i, e] of late.errorsMs.entries()) {
      expect(e - (dry.errorsMs[i] as number)).toBeCloseTo((delay / SR) * 1000, 3);
    }
  });

  it('reports silence as missing', () => {
    const silent = new Float64Array(SR);
    expect(detectOnsetNear(silent, 1000, { sampleRate: SR })).toBeNull();
    const stats = measureOnsetErrors(silent, [1000, 2000], { sampleRate: SR });
    expect(stats.missing).toBe(2);
    expect(Number.isNaN(stats.meanAbsMs)).toBe(true);
  });

  it('mixDown averages channels', () => {
    expect([...mixDown([Float32Array.of(1, 0), Float32Array.of(0, 1)])]).toEqual([0.5, 0.5]);
  });
});

describe('pitch', () => {
  it('measures a sine to well under a cent', () => {
    for (const f of [110, 329.63, 440, 587.33]) {
      const x = Float64Array.from({ length: SR }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
      expect(Math.abs(centsError(dominantFrequency(x, { sampleRate: SR }), f))).toBeLessThan(0.1);
    }
  });

  it('cents', () => {
    expect(centsError(880, 440)).toBeCloseTo(1200, 9);
    expect(centsError(440 * 2 ** (1 / 1200), 440)).toBeCloseTo(1, 9);
  });
});

describe('formant envelope', () => {
  const vowel = generateSignal('vowel', { bars: 1 });
  const env = harmonicEnvelope(vowel.channels[0] as Float32Array, { sampleRate: SR, f0: 140 });

  it('finds the three formant peaks of the dry vowel', () => {
    const peaks = formantPeaks(env);
    expect(peaks).toHaveLength(3);
    for (const [i, target] of [700, 1220, 2600].entries()) {
      expect(Math.abs(1200 * Math.log2((peaks[i] as number) / target))).toBeLessThan(150);
    }
  });

  it('the shift estimate is 0 against itself and recovers a synthetic envelope shift', () => {
    expect(estimateFormantShift(env, env)).toBe(0);
    const up = { freqs: env.freqs.map((f) => f * 2 ** (3 / 12)), db: env.db };
    expect(estimateFormantShift(env, up)).toBeCloseTo(3, 1);
  });
});

describe('metrics', () => {
  it('exact length and identical renders', () => {
    expect(hasExactLength([new Float32Array(4), new Float32Array(4)], 4)).toBe(true);
    expect(hasExactLength([new Float32Array(4), new Float32Array(3)], 4)).toBe(false);
    expect(hasExactLength([], 4)).toBe(false);
    const a = [Float32Array.of(1, 2, 3)];
    expect(identicalRenders(a, [Float32Array.of(1, 2, 3)])).toBe(true);
    expect(identicalRenders(a, [Float32Array.of(1, 2, 3.001)])).toBe(false);
    expect(identicalRenders([Float32Array.of(0)], [Float32Array.of(-0)])).toBe(false);
  });

  it('seam discontinuity is ~1 for a periodic loop and large for a cut mid-cycle', () => {
    const n = 4410;
    const seamless = Float32Array.from({ length: n }, (_, i) =>
      Math.sin((2 * Math.PI * 10 * i) / n),
    );
    // The wrap step of a sine cut at a zero crossing is its steepest step: √2 × the RMS step.
    expect(seamDiscontinuity([seamless]).ratio).toBeLessThan(1.5);
    const cut = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 10.25 * i) / n));
    expect(seamDiscontinuity([cut]).ratio).toBeGreaterThan(20);
  });

  it('summarize', () => {
    expect(summarize([3, 1, 2, Number.NaN])).toEqual({ min: 1, max: 3, mean: 2, median: 2 });
    expect(summarize([1, 2, 3, 4]).median).toBe(2.5);
    expect(Number.isNaN(summarize([]).median)).toBe(true);
  });
});
