/**
 * Minimal typings for untyped stretcher packages. Only what the backends use.
 * Referenced with a triple-slash path from each backend so every consumer's type check sees it.
 */

/** Build-time flags read by the stretcher registry (Vite replaces them statically). */
interface ImportMetaEnv {
  readonly VITE_ENABLE_NONPERMISSIVE_STRETCHERS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Vite `?url` import of the Rubber Band WASM (flagged builds only). */
declare module 'rubberband-wasm/dist/rubberband.wasm?url' {
  const url: string;
  export default url;
}

declare module 'signalsmith-stretch' {
  /**
   * Main thread: creates an AudioWorkletNode with Signalsmith extensions.
   * In an AudioWorkletGlobalScope (or under the offline backend's shim) it registers the
   * processor instead and exports an empty object.
   */
  const SignalsmithStretch: (
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ) => Promise<SignalsmithStretchNode>;
  export default SignalsmithStretch;

  export interface SignalsmithSchedule {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface SignalsmithStretchNode extends AudioWorkletNode {
    inputTime: number;
    schedule(change: SignalsmithSchedule): Promise<unknown>;
    start(
      when?: number | SignalsmithSchedule,
      offset?: number,
      duration?: number,
    ): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    addBuffers(channels: Float32Array[], transfer?: Transferable[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    latency(): Promise<number>;
    configure(config: { blockMs?: number; intervalMs?: number; preset?: string }): Promise<void>;
  }
}

declare module 'soundtouchjs' {
  export interface FifoSampleBuffer {
    readonly vector: Float32Array;
    readonly frameCount: number;
    putSamples(samples: Float32Array, position?: number, numFrames?: number): void;
    receiveSamples(output: Float32Array, numFrames?: number): void;
    receive(numFrames?: number): void;
    clear(): void;
  }
  export class SoundTouch {
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    readonly inputBuffer: FifoSampleBuffer;
    readonly outputBuffer: FifoSampleBuffer;
    process(): void;
    clear(): void;
  }
}
