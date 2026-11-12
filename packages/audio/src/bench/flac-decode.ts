/**
 * FLAC decode test (docs/BUILD_PROMPT.md §5.1: "verify decode on iOS Safari"). Encodes a
 * synthetic 16-bit stereo signal in the browser, decodes it with decodeAudioData and checks the
 * decoded length and samples are exact. No audio file is stored anywhere.
 */

import { encodeFlacFromFloat } from '../flac/encoder';
import { generateSignal } from '../signals/generators';

export interface FlacDecodeResult {
  label: string;
  seconds: number;
  bytes: number;
  expectedFrames: number;
  decodedFrames: number | null;
  decodedSampleRate: number | null;
  ok: boolean;
  exactLength: boolean;
  /** Max |decoded − original 16-bit value| in LSBs of 16-bit (0 = bit-exact). */
  maxErrorLsb: number | null;
  /** int16 → float convention that matched best (see maxErrorLsb). */
  floatScale: string | null;
  /** Every decoded sample rounds back to its original 16-bit value (maxErrorLsb < 0.5). */
  bitExact: boolean;
  encodeMs: number;
  decodeMs: number | null;
  error: string | null;
}

export type DecodeFn = (bytes: ArrayBuffer, sampleRate: number) => Promise<AudioBuffer>;

/** decodeAudioData on an OfflineAudioContext at the stream's own rate (no resampling). */
export const defaultDecode: DecodeFn = (bytes, sampleRate) => {
  const ctx = new OfflineAudioContext(2, 1, sampleRate);
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Callback form as well: older Safari only supports callbacks.
    const p = ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('decode failed')));
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
};

export async function runFlacDecodeTest(options: {
  label: string;
  seconds: number;
  sampleRate?: number;
  decode?: DecodeFn;
}): Promise<FlacDecodeResult> {
  const sampleRate = options.sampleRate ?? 44100;
  // An odd length so the last FLAC block is short, which is where padding bugs show.
  const frames = Math.round(options.seconds * sampleRate) + 123;
  const bpm = 120;
  const bars = Math.ceil(frames / ((4 * 60 * sampleRate) / bpm));
  const drums = generateSignal('drums', { bpm, bars, handleBars: 0, sampleRate });
  const pad = generateSignal('pad', { bpm, bars, handleBars: 0, sampleRate });
  const channels = [0, 1].map((c) => {
    const out = new Float32Array(frames);
    const a = drums.channels[c] as Float32Array;
    const b = pad.channels[c] as Float32Array;
    for (let i = 0; i < frames; i++) out[i] = 0.6 * (a[i] as number) + 0.4 * (b[i] as number);
    return out;
  });
  const t0 = performance.now();
  const { flac, pcm } = encodeFlacFromFloat(channels, { sampleRate });
  const encodeMs = performance.now() - t0;
  const base: FlacDecodeResult = {
    label: options.label,
    seconds: Math.round((frames / sampleRate) * 100) / 100,
    bytes: flac.length,
    expectedFrames: frames,
    decodedFrames: null,
    decodedSampleRate: null,
    ok: false,
    exactLength: false,
    maxErrorLsb: null,
    floatScale: null,
    bitExact: false,
    encodeMs: Math.round(encodeMs),
    decodeMs: null,
    error: null,
  };
  try {
    const t1 = performance.now();
    const buffer = await (options.decode ?? defaultDecode)(flac.slice().buffer, sampleRate);
    const decodeMs = performance.now() - t1;
    // Decoders map int16 → float differently (÷32768, ÷32767, or asymmetric). Measure the
    // error under each convention and report the best: 0 means the PCM is bit-exact.
    const conventions: Record<string, (v: number) => number> = {
      '1/32768': (v) => v * 32768,
      '1/32767': (v) => v * 32767,
      asymmetric: (v) => (v >= 0 ? v * 32767 : v * 32768),
    };
    const errors: Record<string, number> = {};
    for (const [name, toInt] of Object.entries(conventions)) {
      let maxErr = 0;
      const n = Math.min(buffer.length, frames);
      for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
        const data = buffer.getChannelData(c);
        const ref = pcm[c] as Int32Array;
        for (let i = 0; i < n; i++) {
          maxErr = Math.max(maxErr, Math.abs(toInt(data[i] as number) - (ref[i] as number)));
        }
      }
      errors[name] = maxErr;
    }
    const [scale, maxErr] = Object.entries(errors).sort((a, b) => a[1] - b[1])[0] as [
      string,
      number,
    ];
    return {
      ...base,
      ok: true,
      decodedFrames: buffer.length,
      decodedSampleRate: buffer.sampleRate,
      exactLength: buffer.length === frames && buffer.numberOfChannels === 2,
      maxErrorLsb: Math.round(maxErr * 1000) / 1000,
      floatScale: scale,
      bitExact: maxErr < 0.5,
      decodeMs: Math.round(decodeMs * 10) / 10,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}
