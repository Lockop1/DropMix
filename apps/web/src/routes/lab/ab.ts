/**
 * A/B sources and variants for /lab: a synthetic signal or a local file (decoded in the
 * browser, never uploaded), rendered by each available backend into seamless loops.
 */

import {
  AUDIO_TUNING,
  buildSeamlessLoop,
  generateSignal,
  type LoopLayout,
  loopLayout,
  loopRequest,
  type SignalKind,
  STRETCHERS,
  type StretchClient,
  type StretcherId,
} from '@stemdeck/audio';
import { type LoopVariant, toAudioBuffer } from './audio';

export interface ABSource {
  label: string;
  /** Stereo, handles included. */
  channels: Float32Array[];
  layout: LoopLayout;
}

export function syntheticSource(
  kind: SignalKind,
  sampleRate: number,
  bpm = 120,
  bars = 4,
): ABSource {
  const s = generateSignal(kind, { bpm, bars, sampleRate });
  return { label: `${kind} (synthetic, ${bpm} BPM)`, channels: s.channels, layout: s.layout };
}

/**
 * Decodes a local file with the page's AudioContext (no network) and cuts
 * [downbeat − 1 bar, downbeat + bars + 1 bar) out of it, zero-padded where the file is short.
 */
export async function fileSource(
  file: File,
  ctx: BaseAudioContext,
  nativeBpm: number,
  bars: number,
  downbeatSec: number,
): Promise<ABSource> {
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  const sr = decoded.sampleRate;
  const layout = loopLayout(nativeBpm, bars, 1, sr);
  const start = Math.round(downbeatSec * sr) - layout.bodyStart;
  const channels = [0, 1].map((c) => {
    const src = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
    const out = new Float32Array(layout.totalFrames);
    const a = Math.max(0, start);
    const b = Math.min(src.length, start + layout.totalFrames);
    if (b > a) out.set(src.subarray(a, b), a - start);
    return out;
  });
  return { label: `${file.name} (local file, ${nativeBpm} BPM)`, channels, layout };
}

export interface VariantTiming {
  id: string;
  label: string;
  ms: number | null;
  error: string | null;
}

export async function buildVariants(options: {
  ctx: AudioContext;
  client: StretchClient;
  source: ABSource;
  backends: StretcherId[];
  masterBpm: number;
  semitones: number;
  formant: boolean;
}): Promise<{ variants: LoopVariant[]; timings: VariantTiming[] }> {
  const { ctx, client, source, masterBpm, semitones, formant } = options;
  const sr = source.layout.sampleRate;
  const xf = Math.round(AUDIO_TUNING.seamCrossfadeSec * sr);
  const variants: LoopVariant[] = [];
  const timings: VariantTiming[] = [];
  const original = buildSeamlessLoop(source.channels, {
    bodyStart: source.layout.bodyStart,
    loopFrames: source.layout.bodyFrames,
    crossfadeFrames: xf,
  });
  variants.push({
    kind: 'buffer',
    id: 'original',
    label: `Original (${source.layout.bpm} BPM, 0 st)`,
    buffer: toAudioBuffer(ctx, original, sr),
    bpm: source.layout.bpm,
    bars: source.layout.bars,
  });
  const results = await Promise.all(
    options.backends.map(async (id) => {
      const { request, output } = loopRequest(
        source.channels,
        source.layout,
        masterBpm,
        semitones,
        formant,
      );
      try {
        const res = await client.render(id, request);
        const loop = buildSeamlessLoop(res.channels, {
          bodyStart: output.bodyStart,
          loopFrames: output.bodyFrames,
          crossfadeFrames: xf,
        });
        return { id, loop, ms: res.roundTripMs, formantApplied: res.formantApplied, error: null };
      } catch (err) {
        return { id, loop: null, ms: null, formantApplied: false, error: String(err) };
      }
    }),
  );
  for (const r of results) {
    const label = `${STRETCHERS[r.id].label}${formant && !r.formantApplied && r.loop ? ' (no formant)' : ''}`;
    timings.push({ id: r.id, label, ms: r.ms === null ? null : Math.round(r.ms), error: r.error });
    if (r.loop) {
      variants.push({
        kind: 'buffer',
        id: r.id,
        label,
        buffer: toAudioBuffer(ctx, r.loop, sr),
        bpm: masterBpm,
        bars: source.layout.bars,
      });
    }
  }
  variants.push({
    kind: 'realtime',
    id: 'realtime',
    label: 'Signalsmith realtime (AudioWorklet)',
    channels: source.channels,
    loopStartSec: source.layout.bodyStart / sr,
    loopEndSec: (source.layout.bodyStart + source.layout.bodyFrames) / sr,
    rate: masterBpm / source.layout.bpm,
    semitones,
    formant,
    bpm: masterBpm,
    bars: source.layout.bars,
  });
  return { variants, timings };
}
