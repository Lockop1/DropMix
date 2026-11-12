/// <reference path="../types/vendor.d.ts" />
/**
 * SoundTouch backend (LGPL-2.1). Package: `soundtouchjs` (pure JavaScript WSOLA port).
 *
 * NON-PERMISSIVE: this module must only be reached through the dynamic import in
 * `registry.ts`, behind VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1. Never import it statically
 * from code that ships in the default web bundle.
 *
 * soundtouchjs only processes interleaved stereo, so channels are processed in pairs (a mono
 * or odd last channel is paired with itself). No formant support.
 */

import { SoundTouch } from 'soundtouchjs';
import type { Stretcher, StretchRequest, StretchResult } from '../contracts';
import { nowMs, validateRequest } from './common';

/** Input frames pushed per process() call. */
const CHUNK = 8192;

/**
 * Mean timing drift (output frames) of soundtouchjs's WSOLA, used as a latency correction.
 *
 * Inside each WSOLA sequence the input plays at speed 1, so content drifts against the nominal
 * time map by up to S·(1 − tempo)/tempo before the next sequence snaps it back (S = sequence
 * length − overlap, both auto-chosen from the tempo exactly as soundtouchjs does). The mean of
 * that sawtooth is −S·(1 − tempo)/(2·tempo). When pitch goes up, soundtouchjs stretches first
 * and then resamples by the pitch factor, which scales the drift by 1/pitch. Positive = late.
 *
 * Subtracting the mean centres the error; the ± half-sawtooth jitter is inherent to WSOLA
 * and is what the onset metric reports.
 */
export function soundTouchMeanDriftFrames(tempo: number, semitones: number): number {
  // soundtouchjs never passes the real sample rate to its Stretch stage: frame counts are
  // always derived from 44100.
  const sampleRate = 44100;
  // soundtouchjs constants (Stretch auto sequence / overlap settings).
  const AUTOSEQ_K = (50 - 125) / (4 - 0.25);
  const AUTOSEQ_C = 125 - AUTOSEQ_K * 0.25;
  const pitch = Math.exp(Math.LN2 * (semitones / 12));
  const stretchTempo = tempo / pitch;
  const seqMs = Math.floor(Math.min(125, Math.max(50, AUTOSEQ_C + AUTOSEQ_K * stretchTempo)) + 0.5);
  const seqFrames = Math.floor((sampleRate * seqMs) / 1000);
  let overlap = (sampleRate * 8) / 1000;
  overlap = Math.max(16, overlap);
  overlap -= overlap % 8;
  const s = seqFrames - overlap;
  const drift = (-s * (1 - stretchTempo)) / (2 * stretchTempo);
  return pitch > 1 ? drift / pitch : drift;
}

function renderPair(
  left: Float32Array,
  right: Float32Array,
  rate: number,
  semitones: number,
  outputFrames: number,
): [Float32Array, Float32Array] {
  const st = new SoundTouch();
  st.tempo = rate;
  st.pitchSemitones = semitones;
  const n = left.length;
  // Late content → drop leading frames; early content → prepend silence.
  const skip = Math.round(soundTouchMeanDriftFrames(rate, semitones));
  const want = outputFrames + Math.max(0, skip);
  const collected = new Float32Array(want * 2);
  let got = 0;
  const drain = () => {
    const avail = st.outputBuffer.frameCount;
    if (avail <= 0) return;
    const take = Math.min(avail, want - got);
    if (take > 0) {
      const tmp = new Float32Array(take * 2);
      st.outputBuffer.receiveSamples(tmp, take);
      collected.set(tmp, got * 2);
      got += take;
    }
    // Discard anything beyond what we need.
    if (st.outputBuffer.frameCount > 0) st.outputBuffer.receive(st.outputBuffer.frameCount);
  };
  const interleaved = new Float32Array(CHUNK * 2);
  for (let pos = 0; pos < n && got < want; pos += CHUNK) {
    const count = Math.min(CHUNK, n - pos);
    for (let i = 0; i < count; i++) {
      interleaved[2 * i] = left[pos + i] as number;
      interleaved[2 * i + 1] = right[pos + i] as number;
    }
    st.inputBuffer.putSamples(interleaved, 0, count);
    st.process();
    drain();
  }
  // Flush with silence until the requested length is reached (bounded).
  interleaved.fill(0);
  let guard = 0;
  while (got < want && guard++ < 1000) {
    st.inputBuffer.putSamples(interleaved, 0, CHUNK);
    st.process();
    drain();
  }
  const outL = new Float32Array(outputFrames);
  const outR = new Float32Array(outputFrames);
  for (let j = Math.max(0, -skip); j < outputFrames; j++) {
    outL[j] = collected[2 * (j + skip)] as number;
    outR[j] = collected[2 * (j + skip) + 1] as number;
  }
  return [outL, outR];
}

export class SoundTouchStretcher implements Stretcher {
  readonly id = 'soundtouch' as const;
  readonly license = 'LGPL-2.1';
  readonly supportsFormant = false;

  async init(): Promise<void> {}

  async render(req: StretchRequest): Promise<StretchResult> {
    const inputFrames = validateRequest(req);
    const t0 = nowMs();
    const rate = inputFrames / req.outputFrames;
    const out: Float32Array[] = [];
    for (let c = 0; c < req.channels.length; c += 2) {
      const l = req.channels[c] as Float32Array;
      const r = (req.channels[c + 1] ?? l) as Float32Array;
      const [ol, or] = renderPair(l, r, rate, req.semitones, req.outputFrames);
      out.push(ol);
      if (c + 1 < req.channels.length) out.push(or);
    }
    return { channels: out, renderMs: nowMs() - t0, formantApplied: false };
  }

  dispose(): void {}
}

export function createSoundTouchStretcher(): SoundTouchStretcher {
  return new SoundTouchStretcher();
}
