/// <reference path="../types/vendor.d.ts" />
/**
 * Stretcher registry and license gate.
 *
 * Only permissive backends are statically reachable from the default web bundle. LGPL/GPL
 * backends are loaded with dynamic import() inside a branch that is a compile-time constant
 * `false` unless the build sets VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1, so with the flag off
 * the bundler drops their code entirely (verified by grepping `dist/`, see docs/spikes/audio.md).
 */

import type { Stretcher, StretcherId } from '../contracts';
import { createSignalsmithStretcher } from './signalsmith';

export interface StretcherInfo {
  id: StretcherId;
  label: string;
  /** npm package that provides the DSP. */
  packageName: string;
  packageVersion: string;
  /** SPDX id read from the installed package (package.json + LICENSE). */
  license: string;
  /** MIT/BSD/Apache/ISC/Zlib. Non-permissive backends need the build flag. */
  permissive: boolean;
  supportsFormant: boolean;
}

export const STRETCHERS: Readonly<Record<StretcherId, StretcherInfo>> = {
  signalsmith: {
    id: 'signalsmith',
    label: 'Signalsmith Stretch',
    packageName: 'signalsmith-stretch',
    packageVersion: '1.3.2',
    license: 'MIT',
    permissive: true,
    supportsFormant: true,
  },
  soundtouch: {
    id: 'soundtouch',
    label: 'SoundTouch',
    packageName: 'soundtouchjs',
    packageVersion: '0.3.0',
    license: 'LGPL-2.1',
    permissive: false,
    supportsFormant: false,
  },
  rubberband: {
    id: 'rubberband',
    label: 'Rubber Band (R3)',
    packageName: 'rubberband-wasm',
    packageVersion: '3.3.0',
    // package.json says "GPLv2"; the bundled LICENSE is the GPL v2 text and Rubber Band itself
    // is "GPL v2 or later".
    license: 'GPL-2.0-or-later',
    permissive: false,
    supportsFormant: true,
  },
};

/** Build-time flag. A compile-time constant in Vite builds, so dead branches are removed. */
export const NONPERMISSIVE_STRETCHERS_ENABLED: boolean =
  import.meta.env.VITE_ENABLE_NONPERMISSIVE_STRETCHERS === '1';

/** Backends this build can load, default first. */
export function availableStretchers(): StretcherId[] {
  return NONPERMISSIVE_STRETCHERS_ENABLED
    ? ['signalsmith', 'soundtouch', 'rubberband']
    : ['signalsmith'];
}

export class StretcherUnavailableError extends Error {
  override name = 'StretcherUnavailableError';
}

/** Compiles a WASM file by URL (streaming when the server sends application/wasm). */
async function compileWasm(url: string): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compileStreaming(fetch(url));
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
    return WebAssembly.compile(await res.arrayBuffer());
  }
}

/** Creates (but does not init) a backend. Non-permissive ids need the build flag. */
export async function loadStretcher(id: StretcherId): Promise<Stretcher> {
  if (id === 'signalsmith') return createSignalsmithStretcher();
  if (import.meta.env.VITE_ENABLE_NONPERMISSIVE_STRETCHERS === '1') {
    if (id === 'soundtouch') {
      const { createSoundTouchStretcher } = await import('./soundtouch');
      return createSoundTouchStretcher();
    }
    if (id === 'rubberband') {
      const [{ createRubberBandStretcher }, { default: wasmUrl }] = await Promise.all([
        import('./rubberband'),
        import('rubberband-wasm/dist/rubberband.wasm?url'),
      ]);
      return createRubberBandStretcher({ loadModule: () => compileWasm(wasmUrl) });
    }
  }
  throw new StretcherUnavailableError(
    STRETCHERS[id] && !STRETCHERS[id].permissive
      ? `${id} is ${STRETCHERS[id].license}; build with VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1`
      : `unknown stretcher ${String(id)}`,
  );
}
