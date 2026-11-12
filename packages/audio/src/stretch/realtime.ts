/// <reference path="../types/vendor.d.ts" />
/**
 * Realtime comparison path (spike only): Signalsmith Stretch's own AudioWorklet node, looping
 * a buffer with the stretch applied live on the audio thread. Phase 1 renders on drop instead;
 * this exists to measure what realtime stretching would cost (docs/spikes/audio.md).
 *
 * Main thread only. The package builds its worklet module from a Blob URL.
 */

import type { SignalsmithStretchNode } from 'signalsmith-stretch';

export interface RealtimeLoopOptions {
  /** Tempo ratio (output plays this much faster). */
  rate: number;
  semitones: number;
  formant?: boolean;
  /** Loop region inside the buffer, in seconds. */
  loopStartSec: number;
  loopEndSec: number;
}

export interface RealtimeLoop {
  node: SignalsmithStretchNode;
  /** Starts playing the loop region at context time `when`. */
  start(when: number): Promise<void>;
  stop(when: number): Promise<void>;
  /** Output latency the node compensates for, in seconds. */
  latencySec: number;
}

export async function createRealtimeStretchLoop(
  context: BaseAudioContext,
  channels: Float32Array[],
  options: RealtimeLoopOptions,
): Promise<RealtimeLoop> {
  const { default: SignalsmithStretch } = await import('signalsmith-stretch');
  const node = await SignalsmithStretch(context, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels.length],
  });
  await node.addBuffers(channels.map((c) => c.slice()));
  const latencySec = await node.latency();
  const schedule = {
    rate: options.rate,
    semitones: options.semitones,
    formantCompensation: options.formant ?? false,
    loopStart: options.loopStartSec,
    loopEnd: options.loopEndSec,
  };
  return {
    node,
    latencySec,
    async start(when) {
      await node.schedule({ ...schedule, active: true, input: options.loopStartSec, output: when });
    },
    async stop(when) {
      await node.schedule({ active: false, output: when });
    },
  };
}
