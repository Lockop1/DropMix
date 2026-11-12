/**
 * Synthetic test signals (no audio files, ever). Each is an N-bar stereo loop with handle bars
 * before and after, generated as one continuous piece of "music" so the handles are the real
 * continuation of the body, exactly like a Forge export.
 *
 * Deterministic: the same options always produce the same samples.
 */

import { bandpassCoefficients, biquadFilter, highpassCoefficients } from '../dsp/biquad';
import { mulberry32 } from '../dsp/prng';
import { BEATS_PER_BAR, beatFrameOf, type LoopLayout, loopLayout, totalBeats } from './layout';

export type SignalKind = 'click' | 'drums' | 'pad' | 'bass' | 'vowel' | 'sine';

export const SIGNAL_KINDS: readonly SignalKind[] = [
  'click',
  'drums',
  'pad',
  'bass',
  'vowel',
  'sine',
];

export interface SignalOptions {
  bpm?: number;
  bars?: number;
  handleBars?: number;
  sampleRate?: number;
  seed?: number;
  /** Sine only: frequency in Hz (default 440). */
  frequency?: number;
  /** Vowel only: fundamental in Hz (default 140). */
  f0?: number;
}

export interface TestSignal {
  kind: SignalKind;
  /** Stereo, planar. */
  channels: [Float32Array, Float32Array];
  layout: LoopLayout;
  /** Sample-exact onset frames (buffer-relative) of every beat, for `click` and `drums`. */
  onsets: number[];
  /** Sine: the frequency. Vowel: the formant centre frequencies. */
  meta: { frequency?: number; formantsHz?: number[]; f0?: number };
}

const DEFAULTS = { bpm: 120, bars: 4, handleBars: 1, sampleRate: 44100, seed: 1 } as const;

/** Vowel /a/ formants (Hz), bandwidths (Hz) and relative gains. */
export const VOWEL_FORMANTS = [
  { freq: 700, bw: 90, gain: 1 },
  { freq: 1220, bw: 110, gain: 0.5 },
  { freq: 2600, bw: 160, gain: 0.25 },
] as const;

export function generateSignal(kind: SignalKind, options: SignalOptions = {}): TestSignal {
  const bpm = options.bpm ?? DEFAULTS.bpm;
  const bars = options.bars ?? DEFAULTS.bars;
  const handleBars = options.handleBars ?? DEFAULTS.handleBars;
  const sampleRate = options.sampleRate ?? DEFAULTS.sampleRate;
  const seed = options.seed ?? DEFAULTS.seed;
  const layout = loopLayout(bpm, bars, handleBars, sampleRate);
  const left = new Float64Array(layout.totalFrames);
  const right = new Float64Array(layout.totalFrames);
  const onsets: number[] = [];
  const meta: TestSignal['meta'] = {};

  switch (kind) {
    case 'click':
      renderClicks(layout, left, right, onsets, seed);
      break;
    case 'drums':
      renderDrums(layout, left, right, onsets, seed);
      normalize([left, right], 0.8);
      break;
    case 'pad':
      renderPad(layout, left, right);
      break;
    case 'bass':
      renderBass(layout, left, right);
      break;
    case 'vowel': {
      const f0 = options.f0 ?? 140;
      renderVowel(layout, left, right, f0);
      meta.f0 = f0;
      meta.formantsHz = VOWEL_FORMANTS.map((f) => f.freq);
      break;
    }
    case 'sine': {
      const frequency = options.frequency ?? 440;
      for (let i = 0; i < layout.totalFrames; i++) {
        const v = 0.5 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
        left[i] = v;
        right[i] = v;
      }
      meta.frequency = frequency;
      break;
    }
  }

  return {
    kind,
    channels: [Float32Array.from(left), Float32Array.from(right)],
    layout,
    onsets,
    meta,
  };
}

/** Scales all channels together so the overall peak is `peak`. */
function normalize(channels: Float64Array[], peak: number): void {
  let max = 0;
  for (const ch of channels) for (const v of ch) max = Math.max(max, Math.abs(v));
  if (max === 0) return;
  const g = peak / max;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] as number) * g;
}

/** One click per beat: a 2.5 kHz decaying burst plus noise, at full amplitude on its onset frame. */
function renderClicks(
  layout: LoopLayout,
  left: Float64Array,
  right: Float64Array,
  onsets: number[],
  seed: number,
): void {
  const sr = layout.sampleRate;
  const rand = mulberry32(seed);
  const len = Math.round(0.03 * sr);
  const tau = 0.004 * sr;
  for (let beat = 0; beat < totalBeats(layout); beat++) {
    const start = beatFrameOf(layout, beat);
    onsets.push(start);
    const amp = beat % BEATS_PER_BAR === 0 ? 0.8 : 0.5;
    for (let k = 0; k < len && start + k < layout.totalFrames; k++) {
      const env = Math.exp(-k / tau);
      const tone = Math.cos((2 * Math.PI * 2500 * k) / sr);
      const noise = rand() * 2 - 1;
      const v = amp * env * (0.7 * tone + 0.3 * noise);
      left[start + k] = (left[start + k] as number) + v;
      right[start + k] = (right[start + k] as number) + v;
    }
  }
}

/** Kick on 1 and 3, snare on 2 and 4, closed hats on eighths. Onsets are the beats. */
function renderDrums(
  layout: LoopLayout,
  left: Float64Array,
  right: Float64Array,
  onsets: number[],
  seed: number,
): void {
  const sr = layout.sampleRate;
  const rand = mulberry32(seed);
  const n = layout.totalFrames;
  const add = (buf: Float64Array, i: number, v: number) => {
    if (i >= 0 && i < n) buf[i] = (buf[i] as number) + v;
  };
  const beats = totalBeats(layout);
  // Hats are filtered noise; generate one hat shape and reuse it (deterministic).
  const hatLen = Math.round(0.04 * sr);
  const hatNoise = new Float64Array(hatLen);
  for (let k = 0; k < hatLen; k++) hatNoise[k] = rand() * 2 - 1;
  const hat = biquadFilter(hatNoise, highpassCoefficients(7000, 0.7, sr));
  const snareLen = Math.round(0.18 * sr);
  const snareNoise = new Float64Array(snareLen);
  for (let k = 0; k < snareLen; k++) snareNoise[k] = rand() * 2 - 1;
  const snareBody = biquadFilter(snareNoise, bandpassCoefficients(1800, 0.8, sr));

  for (let beat = 0; beat < beats; beat++) {
    const start = beatFrameOf(layout, beat);
    onsets.push(start);
    const inBar = beat % BEATS_PER_BAR;
    if (inBar === 0 || inBar === 2) {
      // Kick: pitch sweep 140 → 45 Hz, ~300 ms.
      const len = Math.round(0.3 * sr);
      let phase = 0;
      for (let k = 0; k < len; k++) {
        const t = k / sr;
        const f = 45 + 95 * Math.exp(-t / 0.03);
        phase += (2 * Math.PI * f) / sr;
        const env = Math.exp(-t / 0.12);
        const click = k < 0.002 * sr ? 0.3 * (1 - k / (0.002 * sr)) : 0;
        const v = 0.7 * env * Math.sin(phase) + click;
        add(left, start + k, v);
        add(right, start + k, v);
      }
    } else {
      for (let k = 0; k < snareLen; k++) {
        const t = k / sr;
        const env = Math.exp(-t / 0.05);
        const tone = 0.25 * Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * 190 * t);
        const v = 0.55 * env * (snareBody[k] as number) * 2 + tone;
        add(left, start + k, v * 0.9);
        add(right, start + k, v);
      }
    }
    // Hats on the beat and the off-beat eighth.
    for (const off of [0, 0.5]) {
      const hs = Math.round((beat + off) * layout.framesPerBeat);
      for (let k = 0; k < hatLen; k++) {
        const env = Math.exp(-k / (0.012 * sr));
        const v = 0.3 * env * (hat[k] as number);
        add(left, hs + k, v);
        add(right, hs + k, v * 0.8);
      }
    }
  }
}

/** Band-limited sawtooth-like additive tone, phase-continuous. */
function additive(freq: number, t: number, harmonics: number, nyquist: number): number {
  let v = 0;
  for (let h = 1; h <= harmonics; h++) {
    if (freq * h >= nyquist) break;
    v += Math.sin(2 * Math.PI * freq * h * t) / h;
  }
  return v;
}

/** Sustained Cmaj7 chord pad with a slow tremolo and slight stereo detune. */
function renderPad(layout: LoopLayout, left: Float64Array, right: Float64Array): void {
  const sr = layout.sampleRate;
  const nyq = sr / 2;
  const notes = [261.63, 329.63, 392.0, 493.88];
  for (let i = 0; i < layout.totalFrames; i++) {
    const t = i / sr;
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
    let l = 0;
    let r = 0;
    for (const f of notes) {
      l += additive(f * 0.999, t, 6, nyq);
      r += additive(f * 1.001, t, 6, nyq);
    }
    left[i] = 0.09 * trem * l;
    right[i] = 0.09 * trem * r;
  }
}

/** One note per beat (C2 C2 G1 A#1 per bar), 5 ms attack, gentle decay, phase-continuous. */
function renderBass(layout: LoopLayout, left: Float64Array, right: Float64Array): void {
  const sr = layout.sampleRate;
  const nyq = sr / 2;
  const pattern = [65.41, 65.41, 49.0, 58.27];
  const beats = totalBeats(layout);
  let phase = 0;
  for (let beat = 0; beat < beats; beat++) {
    const start = beatFrameOf(layout, beat);
    const end = beatFrameOf(layout, beat + 1);
    const f = pattern[beat % pattern.length] as number;
    const attack = 0.005 * sr;
    for (let i = start; i < end; i++) {
      const k = i - start;
      const env = Math.min(1, k / attack) * (0.6 + 0.4 * Math.exp(-k / (0.25 * sr)));
      // Short release into the next note so note boundaries are not hard steps.
      const rel = Math.min(1, (end - i) / attack);
      phase += f / sr;
      let v = 0;
      for (let h = 1; h <= 8; h++) {
        if (f * h >= nyq) break;
        v += Math.sin(2 * Math.PI * h * phase) / (h * h * 0.5 + 0.5);
      }
      const s = 0.35 * env * rel * v;
      left[i] = s;
      right[i] = s;
    }
  }
}

/** Pulse train at f0 through three parallel formant band-passes (vowel /a/). */
function renderVowel(
  layout: LoopLayout,
  left: Float64Array,
  right: Float64Array,
  f0: number,
): void {
  const sr = layout.sampleRate;
  const n = layout.totalFrames;
  const pulses = new Float64Array(n);
  const period = sr / f0;
  // Fractional pulse positions spread over two samples (linear interpolation).
  for (let p = 0; p < n; p += period) {
    const i = Math.floor(p);
    const frac = p - i;
    if (i < n) pulses[i] = (pulses[i] as number) + (1 - frac);
    if (i + 1 < n) pulses[i + 1] = (pulses[i + 1] as number) + frac;
  }
  const mix = new Float64Array(n);
  for (const f of VOWEL_FORMANTS) {
    const y = biquadFilter(pulses, bandpassCoefficients(f.freq, f.freq / f.bw, sr));
    for (let i = 0; i < n; i++) mix[i] = (mix[i] as number) + f.gain * (y[i] as number);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i] as number));
  const g = peak > 0 ? 0.5 / peak : 0;
  for (let i = 0; i < n; i++) {
    const v = (mix[i] as number) * g;
    left[i] = v;
    right[i] = v;
  }
}
