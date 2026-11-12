/**
 * createStretchClient + createRenderHost, wired through an in-process fake Worker that uses
 * structuredClone with a transfer list (so detaching behaves like a real postMessage).
 */

import { describe, expect, it } from 'vitest';
import { loopRequest } from '../src/bench/request';
import type { Stretcher, StretcherId, StretchRequest } from '../src/contracts';
import { generateSignal } from '../src/signals/generators';
import { createStretchClient, defaultPoolSize, type WorkerLike } from '../src/stretch/client';
import type { RenderWorkerRequest, RenderWorkerResponse } from '../src/stretch/protocol';
import {
  availableStretchers,
  loadStretcher,
  NONPERMISSIVE_STRETCHERS_ENABLED,
  STRETCHERS,
  StretcherUnavailableError,
} from '../src/stretch/registry';
import { createRenderHost } from '../src/stretch/worker-host';
import { nodeStretcher } from './backends.node';

type Listener = (e: { data: unknown }) => void;

/** A Worker stand-in running a render host on the same thread. */
function fakeWorker(load: (id: StretcherId) => Promise<Stretcher>, log: string[] = []): WorkerLike {
  const listeners: Record<string, Listener[]> = { message: [], error: [] };
  const host = createRenderHost((message: RenderWorkerResponse, transfer) => {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => {
      for (const l of listeners.message ?? []) l({ data });
    });
  }, load);
  return {
    postMessage(message: RenderWorkerRequest, transfer: Transferable[]) {
      log.push(message.type);
      const data = structuredClone(message, { transfer }) as RenderWorkerRequest;
      void host.handle(data);
    },
    addEventListener(type: string, l: Listener) {
      const list = listeners[type] ?? [];
      list.push(l);
      listeners[type] = list;
    },
    terminate() {
      host.dispose();
    },
  } as unknown as WorkerLike;
}

function req(ratio = 1.25, semitones = 2): StretchRequest {
  const s = generateSignal('click', { bars: 1 });
  return loopRequest(s.channels, s.layout, 120 * ratio, semitones).request;
}

describe('render client + worker host', () => {
  it('renders through the pool, transfers input and output, reports stats', async () => {
    const client = createStretchClient({
      size: 2,
      createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
    });
    const info = await client.init('signalsmith');
    expect(info).toMatchObject({ backend: 'signalsmith', license: 'MIT', supportsFormant: true });
    const r = req();
    const input = r.channels[0] as Float32Array;
    const res = await client.render('signalsmith', r);
    expect(input.length).toBe(0); // detached: transferred, not copied
    expect(res.channels[0]?.length).toBe(r.outputFrames);
    expect(res.workerMs).toBeGreaterThan(0);
    expect(res.roundTripMs).toBeGreaterThanOrEqual(res.renderMs);
    expect(res.heapBytes).toBeGreaterThan(0);
    client.dispose();
  }, 60_000);

  it('copies instead of transferring when asked', async () => {
    const client = createStretchClient({
      size: 1,
      createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
    });
    const r = req();
    const len = r.channels[0]?.length;
    await client.render('soundtouch', r, { transfer: false });
    expect(r.channels[0]?.length).toBe(len);
    client.dispose();
  });

  it('spreads concurrent renders over the least-busy workers and resolves each promise', async () => {
    const client = createStretchClient({
      size: 3,
      createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
    });
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() => client.render('soundtouch', req())),
    );
    expect(results.map((r) => r.workerIndex).sort()).toEqual([0, 0, 1, 1, 2]);
    expect(client.pending()).toEqual([0, 0, 0]);
    client.dispose();
  });

  it('rejects with the worker-side error and keeps working', async () => {
    const client = createStretchClient({
      size: 1,
      createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
    });
    await expect(client.render('signalsmith', { ...req(), semitones: 12 })).rejects.toThrow(
      /semitones/,
    );
    const ok = await client.render('signalsmith', req());
    expect(ok.channels).toHaveLength(2);
    client.dispose();
  }, 60_000);

  it('a failing backend load is reported and retried on the next request', async () => {
    let attempts = 0;
    const client = createStretchClient({
      size: 1,
      createWorker: () =>
        fakeWorker(async (id) => {
          attempts++;
          if (attempts === 1) throw new Error('wasm blew up');
          return nodeStretcher(id);
        }),
    });
    await expect(client.init('soundtouch')).rejects.toThrow('wasm blew up');
    await expect(client.init('soundtouch')).resolves.toMatchObject({ backend: 'soundtouch' });
    client.dispose();
  });

  it('dispose rejects pending renders', async () => {
    const client = createStretchClient({
      size: 1,
      createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
    });
    const p = client.render('soundtouch', req());
    client.dispose();
    await expect(p).rejects.toThrow(/disposed/);
    await expect(client.render('soundtouch', req())).rejects.toThrow(/disposed/);
  });

  it('pool size defaults to min(3, cores − 1), at least 1', () => {
    expect(defaultPoolSize(1)).toBe(1);
    expect(defaultPoolSize(2)).toBe(1);
    expect(defaultPoolSize(4)).toBe(3);
    expect(defaultPoolSize(16)).toBe(3);
    expect(() =>
      createStretchClient({
        size: 0,
        createWorker: () => fakeWorker(async (id) => nodeStretcher(id)),
      }),
    ).toThrow(RangeError);
  });
});

describe('license gate', () => {
  it('lists every candidate with its license; only Signalsmith is permissive', () => {
    expect(STRETCHERS.signalsmith).toMatchObject({ license: 'MIT', permissive: true });
    expect(STRETCHERS.soundtouch).toMatchObject({ license: 'LGPL-2.1', permissive: false });
    expect(STRETCHERS.rubberband).toMatchObject({ license: 'GPL-2.0-or-later', permissive: false });
  });

  it('without the build flag only the permissive backend loads', async () => {
    expect(availableStretchers()[0]).toBe('signalsmith');
    expect((await loadStretcher('signalsmith')).id).toBe('signalsmith');
    if (!NONPERMISSIVE_STRETCHERS_ENABLED) {
      expect(availableStretchers()).toEqual(['signalsmith']);
      await expect(loadStretcher('soundtouch')).rejects.toThrow(StretcherUnavailableError);
      await expect(loadStretcher('rubberband')).rejects.toThrow(
        /VITE_ENABLE_NONPERMISSIVE_STRETCHERS/,
      );
    } else {
      expect(availableStretchers()).toEqual(['signalsmith', 'soundtouch', 'rubberband']);
    }
  });
});
