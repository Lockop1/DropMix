/**
 * Rubber Band backend (GPL-2.0). Package: `rubberband-wasm` (C API compiled to WASM).
 *
 * NON-PERMISSIVE: this module must only be reached through the dynamic import in
 * `registry.ts`, behind VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1. Never import it statically
 * from code that ships in the default web bundle. Personal use only (docs/BUILD_PROMPT.md §5.1).
 *
 * Uses the offline (study + process) mode with the R3 "finer" engine. Offline mode compensates
 * its own start delay; the output is then cut or zero-padded to exactly `outputFrames`.
 */

import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm';
import type { Stretcher, StretchRequest, StretchResult } from '../contracts';
import { fitLength, nowMs, semitonesToScale, validateRequest } from './common';

/** Frames per study/process call. */
const CHUNK = 8192;

export interface RubberBandStretcherOptions {
  /** Compiles the package's `rubberband.wasm` (fetch in a browser, fs in Node). */
  loadModule: () => Promise<WebAssembly.Module>;
  /** Engine: 'finer' (R3, default, best quality) or 'faster' (R2). */
  engine?: 'finer' | 'faster';
}

export class RubberBandStretcher implements Stretcher {
  readonly id = 'rubberband' as const;
  readonly license = 'GPL-2.0-or-later';
  readonly supportsFormant = true;
  private api: RubberBandInterface | null = null;
  private module: WebAssembly.Module | null = null;

  constructor(private readonly options: RubberBandStretcherOptions) {}

  async init(): Promise<void> {
    if (this.api) return;
    this.module ??= await this.options.loadModule();
    this.api = await RubberBandInterface.initialize(this.module);
  }

  async render(req: StretchRequest): Promise<StretchResult> {
    const inputFrames = validateRequest(req);
    if (!this.api) await this.init();
    const rb = this.api as RubberBandInterface;
    const t0 = nowMs();
    const C = req.channels.length;
    const M = req.outputFrames;

    let options =
      RubberBandOption.RubberBandOptionProcessOffline |
      RubberBandOption.RubberBandOptionPitchHighQuality |
      RubberBandOption.RubberBandOptionChannelsTogether;
    if ((this.options.engine ?? 'finer') === 'finer') {
      options |= RubberBandOption.RubberBandOptionEngineFiner;
    }
    if (req.formant) options |= RubberBandOption.RubberBandOptionFormantPreserved;

    const state = rb.rubberband_new(
      req.sampleRate,
      C,
      options,
      M / inputFrames,
      semitonesToScale(req.semitones),
    );
    const ptrArray = rb.malloc(C * 4);
    const ptrs: number[] = [];
    for (let c = 0; c < C; c++) {
      const p = rb.malloc(CHUNK * 4);
      ptrs.push(p);
      rb.memWritePtr(ptrArray + c * 4, p);
    }
    const outputs = req.channels.map(() => new Float32Array(M + CHUNK));
    let written = 0;
    try {
      rb.rubberband_set_expected_input_duration(state, inputFrames);
      rb.rubberband_set_max_process_size(state, CHUNK);
      const feed = (fn: 'study' | 'process') => {
        for (let pos = 0; pos < inputFrames; pos += CHUNK) {
          const count = Math.min(CHUNK, inputFrames - pos);
          for (let c = 0; c < C; c++) {
            rb.memWrite(
              ptrs[c] as number,
              (req.channels[c] as Float32Array).subarray(pos, pos + count),
            );
          }
          const final = pos + count >= inputFrames ? 1 : 0;
          if (fn === 'study') rb.rubberband_study(state, ptrArray, count, final);
          else {
            rb.rubberband_process(state, ptrArray, count, final);
            retrieve();
          }
        }
      };
      const retrieve = () => {
        for (;;) {
          const available = rb.rubberband_available(state);
          if (available <= 0) return;
          const got = rb.rubberband_retrieve(state, ptrArray, Math.min(CHUNK, available));
          if (got <= 0) return;
          const room = Math.min(got, M + CHUNK - written);
          for (let c = 0; c < C; c++) {
            (outputs[c] as Float32Array).set(rb.memReadF32(ptrs[c] as number, room), written);
          }
          written += room;
          if (room < got) return;
        }
      };
      feed('study');
      feed('process');
      retrieve();
    } finally {
      for (const p of ptrs) rb.free(p);
      rb.free(ptrArray);
      rb.rubberband_delete(state);
    }
    // Own-buffer arrays of exactly M frames (zero-padded if the engine returned fewer).
    const channels = outputs.map((ch) => fitLength(ch.slice(0, Math.min(written, M)), M));
    return {
      channels,
      renderMs: nowMs() - t0,
      formantApplied: req.formant,
    };
  }

  dispose(): void {
    this.api = null;
  }
}

export function createRubberBandStretcher(
  options: RubberBandStretcherOptions,
): RubberBandStretcher {
  return new RubberBandStretcher(options);
}
