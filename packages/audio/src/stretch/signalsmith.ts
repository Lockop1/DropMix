/// <reference path="../types/vendor.d.ts" />
/**
 * Signalsmith Stretch backend (MIT). Package: `signalsmith-stretch` (official JS/WASM release).
 *
 * The package only ships an AudioWorklet node; its WASM factory is reachable only from inside
 * its processor class. To run it OFFLINE in a Web Worker we evaluate the module with the two
 * AudioWorkletGlobalScope names it checks for (`AudioWorkletProcessor`, `registerProcessor`)
 * stubbed, which makes it hand us the processor class. Constructing that class instantiates the
 * WASM module, whose C API we then drive directly (seek / process / flush) with exact frame
 * counts. Every stub is removed again as soon as it is no longer needed.
 *
 * Alignment: after `seek()` with a pre-roll ending at input frame E, the stretcher's current
 * input position is E − inputLatency, and its output is delayed by outputLatency frames. Seeking
 * to E = inputLatency + outputLatency·rate makes output frame j correspond to input frame
 * j·rate, so onsets land on the stretched grid without trimming.
 */

import type { Stretcher, StretchRequest, StretchResult } from '../contracts';
import { nowMs, validateRequest } from './common';

interface SignalsmithWasm {
  HEAP8: Int8Array;
  _presetDefault(channels: number, sampleRate: number): void;
  _presetCheaper(channels: number, sampleRate: number): void;
  _reset(): void;
  _inputLatency(): number;
  _outputLatency(): number;
  _setBuffers(channels: number, length: number): number;
  _setTransposeSemitones(semitones: number, tonalityLimit: number): void;
  _setFormantSemitones(semitones: number, compensatePitch: number): void;
  _setFormantBase(baseFreq: number): void;
  _seek(inputSamples: number, playbackRate: number): void;
  _process(inputSamples: number, outputSamples: number): void;
  _flush(outputSamples: number): void;
}

type ProcessorCtor = new (
  options: unknown,
) => {
  wasmReady: boolean;
  wasmModule: SignalsmithWasm | null;
};

interface ShimPort {
  postMessage(message: unknown): void;
  onmessage: unknown;
}

/** Instance → resolver, called when that processor posts ['ready', …]. */
const readyCallbacks = new WeakMap<object, () => void>();

/** Sets the given globals that are missing, runs `fn`, then removes exactly those again. */
async function withGlobals<T>(values: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const added: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(key in g)) {
      g[key] = value;
      added.push(key);
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of added) delete g[key];
  }
}

/** Read by the processor's constructor; the real sample rate is passed to presetDefault(). */
const CONSTRUCTOR_GLOBALS = { sampleRate: 44100, currentTime: 0 };

let processorClass: Promise<ProcessorCtor> | null = null;

function loadProcessorClass(): Promise<ProcessorCtor> {
  processorClass ??= (async () => {
    if (typeof (globalThis as Record<string, unknown>).registerProcessor === 'function') {
      throw new Error('the signalsmith offline backend runs in a Worker, not in an AudioWorklet');
    }
    class ShimProcessor {
      port: ShimPort;
      constructor() {
        const owner = this;
        this.port = {
          onmessage: null,
          postMessage(message: unknown) {
            if (Array.isArray(message) && message[0] === 'ready') readyCallbacks.get(owner)?.();
          },
        };
      }
    }
    let captured: ProcessorCtor | null = null;
    await withGlobals(
      {
        ...CONSTRUCTOR_GLOBALS,
        AudioWorkletProcessor: ShimProcessor,
        registerProcessor: (_name: string, ctor: ProcessorCtor) => {
          captured = ctor;
        },
      },
      () => import('signalsmith-stretch'),
    );
    if (!captured) {
      throw new Error('signalsmith-stretch did not register its processor (imported earlier?)');
    }
    return captured as ProcessorCtor;
  })();
  return processorClass;
}

/** One instantiation at a time, because the constructor globals are shared. */
let instantiateQueue: Promise<unknown> = Promise.resolve();

function instantiateWasm(): Promise<SignalsmithWasm> {
  const run = async () => {
    const ctor = await loadProcessorClass();
    return withGlobals(CONSTRUCTOR_GLOBALS, async () => {
      let resolveReady: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      // The WASM promise inside the constructor cannot resolve before this synchronous block
      // has registered the callback.
      const proc = new ctor({ numberOfOutputs: 1, outputChannelCount: [2] });
      readyCallbacks.set(proc, resolveReady);
      if (proc.wasmReady) resolveReady();
      await ready;
      if (!proc.wasmModule) throw new Error('signalsmith-stretch WASM failed to instantiate');
      return proc.wasmModule;
    });
  };
  const result = instantiateQueue.then(run, run);
  instantiateQueue = result.catch(() => undefined);
  return result;
}

/** Output frames produced per process() call. */
const BLOCK = 4096;
/** Tonality limit used by the package's own node (8 kHz). */
const TONALITY_HZ = 8000;

export interface SignalsmithOptions {
  /** 'default' (120 ms blocks) or 'cheaper' (shorter blocks, less CPU). Default 'default'. */
  preset?: 'default' | 'cheaper';
  /** Tonality limit in Hz (0 = none). Default 8000, as the package's own node. */
  tonalityHz?: number;
}

export class SignalsmithStretcher implements Stretcher {
  readonly id = 'signalsmith' as const;
  readonly license = 'MIT';
  readonly supportsFormant = true;
  private wasm: SignalsmithWasm | null = null;

  constructor(private readonly options: SignalsmithOptions = {}) {}

  async init(): Promise<void> {
    this.wasm ??= await instantiateWasm();
  }

  /** Bytes of WASM linear memory (for the benchmark's memory column). */
  wasmHeapBytes(): number {
    return this.wasm ? this.wasm.HEAP8.buffer.byteLength : 0;
  }

  async render(req: StretchRequest): Promise<StretchResult> {
    const inputFrames = validateRequest(req);
    if (!this.wasm) await this.init();
    const w = this.wasm as SignalsmithWasm;
    const t0 = nowMs();
    const C = req.channels.length;
    const M = req.outputFrames;
    const rate = inputFrames / M;
    const sr = req.sampleRate;

    if (this.options.preset === 'cheaper') w._presetCheaper(C, sr);
    else w._presetDefault(C, sr);
    w._reset();
    w._setTransposeSemitones(req.semitones, (this.options.tonalityHz ?? TONALITY_HZ) / sr);
    w._setFormantSemitones(0, req.formant ? 1 : 0);
    w._setFormantBase(0);
    const inLat = w._inputLatency();
    const outLat = w._outputLatency();
    const B = Math.ceil(BLOCK * rate) + 2 + inLat + 2 * outLat;
    const base = w._setBuffers(C, B) >> 2;
    const heap = () => new Float32Array(w.HEAP8.buffer);

    const outputs = req.channels.map(() => new Float32Array(M));
    // Copies input frames [start, start+count) into the WASM input buffers, zero outside the
    // input.
    const load = (start: number, count: number) => {
      const h = heap();
      const a = Math.max(0, start);
      const b = Math.min(inputFrames, start + count);
      for (let c = 0; c < C; c++) {
        const off = base + B * c;
        h.fill(0, off, off + count);
        if (b > a) h.set((req.channels[c] as Float32Array).subarray(a, b), off + (a - start));
      }
    };
    const store = (outPos: number, count: number) => {
      const h = heap();
      for (let c = 0; c < C; c++) {
        const off = base + B * (C + c);
        (outputs[c] as Float32Array).set(h.subarray(off, off + count), outPos);
      }
    };

    const preRoll = inLat + outLat * rate;
    const seekFrames = Math.round(preRoll);
    load(0, seekFrames);
    w._seek(seekFrames, rate);

    let inPos = seekFrames;
    let outPos = 0;
    const flushFrames = Math.min(outLat, M);
    const processFrames = M - flushFrames;
    while (outPos < processFrames) {
      const o = Math.min(BLOCK, processFrames - outPos);
      const target = Math.round(preRoll + (outPos + o) * rate);
      const i = Math.max(0, target - inPos);
      load(inPos, i);
      w._process(i, o);
      store(outPos, o);
      inPos += i;
      outPos += o;
    }
    if (flushFrames > 0) {
      w._flush(flushFrames);
      store(outPos, flushFrames);
    }
    return { channels: outputs, renderMs: nowMs() - t0, formantApplied: req.formant };
  }

  dispose(): void {
    // The WASM instance has no explicit free; dropping the reference releases it.
    this.wasm = null;
  }
}

export function createSignalsmithStretcher(options?: SignalsmithOptions): SignalsmithStretcher {
  return new SignalsmithStretcher(options);
}
