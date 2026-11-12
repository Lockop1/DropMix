/**
 * Main-thread client for a pool of render workers: one promise per render.
 *
 * Each request goes to the worker with the fewest jobs in flight (ties → lowest index); a worker
 * processes its jobs in order. Input channel buffers are transferred to the worker by default
 * (zero-copy: the caller's arrays become detached) and output buffers are transferred back.
 */

import {
  AUDIO_TUNING,
  type StretcherId,
  type StretchRequest,
  type StretchResult,
} from '../contracts';
import { nowMs } from './common';
import type {
  BackendInfo,
  RenderStats,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from './protocol';

/** The part of `Worker` the client uses (lets tests supply an in-process fake). */
export interface WorkerLike {
  postMessage(message: RenderWorkerRequest, transfer: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (e: MessageEvent<RenderWorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
  terminate(): void;
}

export interface StretchClientOptions {
  /** Pool size. Default: min(AUDIO_TUNING.maxRenderWorkers, cores − 1), at least 1. */
  size?: number;
  createWorker: () => WorkerLike;
}

export interface RenderOptions {
  /** Transfer the input buffers instead of copying them. Default true. */
  transfer?: boolean;
}

export interface ClientRenderResult extends StretchResult, RenderStats {
  /** Main-thread time from post to result (queueing + transfer + render). */
  roundTripMs: number;
  workerIndex: number;
}

export interface StretchClient {
  readonly size: number;
  /** Loads + inits `backend` in every worker; resolves with the slowest worker's info. */
  init(backend: StretcherId): Promise<BackendInfo>;
  render(
    backend: StretcherId,
    request: StretchRequest,
    options?: RenderOptions,
  ): Promise<ClientRenderResult>;
  /** Jobs currently in flight per worker. */
  pending(): number[];
  dispose(): void;
}

export function defaultPoolSize(cores?: number): number {
  const c = cores ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2) ?? 2;
  return Math.max(1, Math.min(AUDIO_TUNING.maxRenderWorkers, c - 1));
}

interface Pending {
  resolve: (msg: RenderWorkerResponse) => void;
  reject: (err: Error) => void;
  worker: number;
  postedAt: number;
}

export class StretchClientError extends Error {
  override name = 'StretchClientError';
}

export function createStretchClient(options: StretchClientOptions): StretchClient {
  const size = options.size ?? defaultPoolSize();
  if (!Number.isInteger(size) || size < 1) throw new RangeError('pool size must be ≥ 1');
  const workers: WorkerLike[] = [];
  const inFlight: number[] = [];
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;

  const settle = (msg: RenderWorkerResponse) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    inFlight[p.worker] = (inFlight[p.worker] as number) - 1;
    if (msg.type === 'error') {
      const err = new StretchClientError(msg.message);
      err.name = msg.name;
      p.reject(err);
    } else p.resolve(msg);
  };

  for (let i = 0; i < size; i++) {
    const w = options.createWorker();
    w.addEventListener('message', (e) => settle(e.data));
    w.addEventListener('error', (e) => {
      // A crashed worker fails everything it was doing.
      for (const [id, p] of pending) {
        if (p.worker !== i) continue;
        pending.delete(id);
        inFlight[i] = (inFlight[i] as number) - 1;
        p.reject(new StretchClientError(`render worker ${i} failed: ${e.message ?? 'error'}`));
      }
    });
    workers.push(w);
    inFlight.push(0);
  }

  const send = (worker: number, msg: RenderWorkerRequest, transfer: Transferable[]) =>
    new Promise<{ msg: RenderWorkerResponse; postedAt: number }>((resolve, reject) => {
      if (disposed) {
        reject(new StretchClientError('client disposed'));
        return;
      }
      const postedAt = nowMs();
      pending.set(msg.id, {
        resolve: (m) => resolve({ msg: m, postedAt }),
        reject,
        worker,
        postedAt,
      });
      inFlight[worker] = (inFlight[worker] as number) + 1;
      (workers[worker] as WorkerLike).postMessage(msg, transfer);
    });

  const pickWorker = () => {
    let best = 0;
    for (let i = 1; i < size; i++)
      if ((inFlight[i] as number) < (inFlight[best] as number)) best = i;
    return best;
  };

  return {
    size,
    async init(backend) {
      const infos = await Promise.all(
        workers.map((_, i) => send(i, { type: 'init', id: nextId++, backend }, [])),
      );
      let slowest: BackendInfo | null = null;
      for (const { msg } of infos) {
        if (msg.type !== 'ready') throw new StretchClientError('unexpected init response');
        const info: BackendInfo = {
          backend: msg.backend,
          license: msg.license,
          supportsFormant: msg.supportsFormant,
          initMs: msg.initMs,
        };
        if (!slowest || info.initMs > slowest.initMs) slowest = info;
      }
      return slowest as BackendInfo;
    },
    async render(backend, request, renderOptions = {}) {
      const transferInput = renderOptions.transfer ?? true;
      const req: StretchRequest = transferInput
        ? request
        : { ...request, channels: request.channels.map((c) => c.slice()) };
      const transfer = [...new Set(req.channels.map((c) => c.buffer as ArrayBuffer))];
      const worker = pickWorker();
      const { msg, postedAt } = await send(
        worker,
        { type: 'render', id: nextId++, backend, request: req },
        transfer,
      );
      if (msg.type !== 'result') throw new StretchClientError('unexpected render response');
      return { ...msg.result, ...msg.stats, roundTripMs: nowMs() - postedAt, workerIndex: worker };
    },
    pending: () => inFlight.slice(),
    dispose() {
      disposed = true;
      for (const w of workers) w.terminate();
      for (const p of pending.values()) p.reject(new StretchClientError('client disposed'));
      pending.clear();
    },
  };
}
