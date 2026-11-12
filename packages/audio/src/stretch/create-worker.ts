/**
 * Spawns one render worker. Kept in its own module: the `new Worker(new URL(…), …)` pattern is
 * what Vite recognises to bundle the worker, and Node-side tests never import this file.
 */
export function createRenderWorker(): Worker {
  return new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
    name: 'stemdeck-render',
  });
}
