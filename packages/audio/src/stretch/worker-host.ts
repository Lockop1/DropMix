/**
 * Render-worker message handling, independent of the Worker global so it can be unit-tested.
 * Requests are processed one at a time in arrival order; results are transferred, never copied.
 */

import type { Stretcher, StretcherId } from '../contracts';
import { nowMs } from './common';
import type { RenderWorkerRequest, RenderWorkerResponse } from './protocol';
import { loadStretcher } from './registry';

export type PostFn = (message: RenderWorkerResponse, transfer: Transferable[]) => void;
export type LoadFn = (id: StretcherId) => Promise<Stretcher>;

interface HeapReporting {
  wasmHeapBytes?: () => number;
}

export interface RenderHost {
  handle(message: RenderWorkerRequest): Promise<void>;
  dispose(): void;
}

export function createRenderHost(post: PostFn, load: LoadFn = loadStretcher): RenderHost {
  const backends = new Map<StretcherId, Promise<{ stretcher: Stretcher; initMs: number }>>();
  let queue: Promise<void> = Promise.resolve();

  const getBackend = (id: StretcherId) => {
    let b = backends.get(id);
    if (!b) {
      b = (async () => {
        const t0 = nowMs();
        const stretcher = await load(id);
        await stretcher.init();
        return { stretcher, initMs: nowMs() - t0 };
      })();
      // A failed init is not cached, so a later request can retry.
      b.catch(() => backends.delete(id));
      backends.set(id, b);
    }
    return b;
  };

  const process = async (msg: RenderWorkerRequest) => {
    const t0 = nowMs();
    try {
      const { stretcher, initMs } = await getBackend(msg.backend);
      if (msg.type === 'init') {
        post(
          {
            type: 'ready',
            id: msg.id,
            backend: stretcher.id,
            license: stretcher.license,
            supportsFormant: stretcher.supportsFormant,
            initMs,
          },
          [],
        );
        return;
      }
      const result = await stretcher.render(msg.request);
      const transfer = [...new Set(result.channels.map((c) => c.buffer as ArrayBuffer))];
      const heapBytes = (stretcher as Stretcher & HeapReporting).wasmHeapBytes?.() ?? 0;
      post(
        { type: 'result', id: msg.id, result, stats: { workerMs: nowMs() - t0, heapBytes } },
        transfer,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      post({ type: 'error', id: msg.id, name: e.name, message: e.message }, []);
    }
  };

  return {
    handle(message) {
      const run = queue.then(() => process(message));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      for (const b of backends.values()) b.then((x) => x.stretcher.dispose()).catch(() => {});
      backends.clear();
    },
  };
}
