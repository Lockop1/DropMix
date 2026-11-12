/// <reference types="node" />
/** Node-side helpers to construct every backend directly (no Worker, no license gate). */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Stretcher, StretcherId } from '../src/contracts';
import { createRubberBandStretcher } from '../src/stretch/rubberband';
import { createSignalsmithStretcher } from '../src/stretch/signalsmith';
import { createSoundTouchStretcher } from '../src/stretch/soundtouch';

const require = createRequire(import.meta.url);

export function nodeStretcher(id: StretcherId): Stretcher {
  switch (id) {
    case 'signalsmith':
      return createSignalsmithStretcher();
    case 'soundtouch':
      return createSoundTouchStretcher();
    case 'rubberband':
      return createRubberBandStretcher({
        loadModule: async () =>
          WebAssembly.compile(
            await readFile(require.resolve('rubberband-wasm/dist/rubberband.wasm')),
          ),
      });
  }
}
