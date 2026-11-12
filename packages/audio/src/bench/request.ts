/** Builds StretchRequests for loops with handles (the shape Phase 1 render-on-drop sends). */

import type { StretchRequest } from '../contracts';
import { type LoopLayout, stretchedLayout } from '../signals/layout';

export interface LoopRequest {
  request: StretchRequest;
  /** Layout of the rendered audio at the master tempo. */
  output: LoopLayout;
}

/**
 * A request that stretches a loop (layout `source`) to `masterBpm` and shifts it by
 * `semitones`. Output frames = the master-tempo layout's total, so the body is exactly
 * bars × 4 × 60/M × sampleRate frames on the rounded grid. Channels are copied unless
 * `copy` is false (the request may be transferred to a worker, detaching them).
 */
export function loopRequest(
  channels: Float32Array[],
  source: LoopLayout,
  masterBpm: number,
  semitones: number,
  formant = false,
  copy = true,
): LoopRequest {
  const output = stretchedLayout(source, masterBpm);
  return {
    request: {
      channels: copy ? channels.map((c) => c.slice()) : channels,
      sampleRate: source.sampleRate,
      ratio: masterBpm / source.bpm,
      semitones,
      formant,
      outputFrames: output.totalFrames,
    },
    output,
  };
}
