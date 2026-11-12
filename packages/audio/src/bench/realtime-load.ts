/**
 * Realtime-DSP cost comparison (spike): render N voices through an OfflineAudioContext and
 * time it. `plain` = render-on-drop playback (looping AudioBufferSourceNodes, zero DSP);
 * `stretch` = the same voices stretched live by Signalsmith's AudioWorklet node.
 * load = wall time / audio time: the share of one core the voices need in real time.
 */

import { createRealtimeStretchLoop } from '../stretch/realtime';

export type LoadMode = 'plain' | 'stretch';

export interface OfflineLoadOptions {
  mode: LoadMode;
  /** One planar loop per voice (stereo). */
  voices: Float32Array[][];
  sampleRate: number;
  /** Seconds of audio to render. */
  seconds: number;
  /** Stretch mode: tempo ratio and transposition per voice. */
  rate?: number;
  semitones?: number;
}

export interface OfflineLoadResult {
  mode: LoadMode;
  voices: number;
  seconds: number;
  renderMs: number;
  /** renderMs / (seconds × 1000). Above ~0.5 on a phone means real glitch risk. */
  load: number;
  /** RMS of the rendered mix (left channel); > 0 proves the voices produced audio. */
  outputRms: number;
}

export async function measureOfflineLoad(options: OfflineLoadOptions): Promise<OfflineLoadResult> {
  const { sampleRate, seconds, voices } = options;
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 1 / Math.max(1, voices.length);
  master.connect(ctx.destination);
  for (const loop of voices) {
    const frames = loop[0]?.length ?? 0;
    if (options.mode === 'plain') {
      const buf = ctx.createBuffer(loop.length, frames, sampleRate);
      for (const [c, ch] of loop.entries()) buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(master);
      src.start(0);
    } else {
      const rt = await createRealtimeStretchLoop(ctx, loop, {
        rate: options.rate ?? 1,
        semitones: options.semitones ?? 0,
        loopStartSec: 0,
        loopEndSec: frames / sampleRate,
      });
      rt.node.connect(master);
      await rt.start(0);
    }
  }
  const t0 = performance.now();
  const rendered = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  // Proof that the voices really sounded (a silent render would make the load meaningless).
  const out = rendered.getChannelData(0);
  let ss = 0;
  for (let i = 0; i < out.length; i++) ss += (out[i] as number) ** 2;
  return {
    mode: options.mode,
    voices: voices.length,
    seconds,
    renderMs: Math.round(renderMs),
    load: Math.round((renderMs / (seconds * 1000)) * 1000) / 1000,
    outputRms: Math.round(Math.sqrt(ss / Math.max(1, out.length)) * 1e4) / 1e4,
  };
}
