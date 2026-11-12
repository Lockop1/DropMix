/** Messages between the main thread (createStretchClient) and the render worker. */

import type { StretcherId, StretchRequest, StretchResult } from '../contracts';

export type RenderWorkerRequest =
  | { type: 'init'; id: number; backend: StretcherId }
  | { type: 'render'; id: number; backend: StretcherId; request: StretchRequest };

export interface BackendInfo {
  backend: StretcherId;
  license: string;
  supportsFormant: boolean;
  /** Time to create + init the backend in the worker (WASM compile/instantiate). */
  initMs: number;
}

export interface RenderStats {
  /** Worker-side wall time from message receipt to result post (includes backend init if lazy). */
  workerMs: number;
  /** WASM linear-memory size of the backend after the render, 0 when not applicable. */
  heapBytes: number;
}

export type RenderWorkerResponse =
  | ({ type: 'ready'; id: number } & BackendInfo)
  | { type: 'result'; id: number; result: StretchResult; stats: RenderStats }
  | { type: 'error'; id: number; name: string; message: string };
