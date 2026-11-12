/**
 * Render worker entry: receives { backend, request }, renders with that Stretcher, and transfers
 * the output channels back. Created by `createRenderWorker()`; talk to it via createStretchClient.
 */

import type { RenderWorkerRequest, RenderWorkerResponse } from './protocol';
import { createRenderHost } from './worker-host';

interface WorkerScope {
  postMessage(message: RenderWorkerResponse, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<RenderWorkerRequest>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const host = createRenderHost((message, transfer) => scope.postMessage(message, transfer));
scope.addEventListener('message', (e) => {
  void host.handle(e.data);
});
