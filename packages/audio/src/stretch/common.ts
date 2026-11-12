/** Shared helpers for Stretcher backends. */

import type { StretchRequest } from '../contracts';

/** Transposition range allowed by the harmony rules (docs/BUILD_PROMPT.md §7.1). */
export const MIN_SEMITONES = -6;
export const MAX_SEMITONES = 5;
/** Hard stretch cap (docs/BUILD_PROMPT.md §7.2). */
export const MIN_RATIO = 0.66;
export const MAX_RATIO = 1.5;
/**
 * `ratio` and `inputFrames / outputFrames` describe the same thing; the frame counts win (they
 * are what makes the output exact), but a large disagreement means the caller built a bad
 * request.
 */
export const RATIO_TOLERANCE = 0.01;

export class StretchRequestError extends RangeError {
  override name = 'StretchRequestError';
}

/** Throws StretchRequestError when the request is malformed. Returns the input length. */
export function validateRequest(req: StretchRequest): number {
  if (!Array.isArray(req.channels) || req.channels.length === 0) {
    throw new StretchRequestError('at least one channel is required');
  }
  const first = req.channels[0] as Float32Array;
  const inputFrames = first.length;
  for (const ch of req.channels) {
    if (!(ch instanceof Float32Array))
      throw new StretchRequestError('channels must be Float32Array');
    if (ch.length !== inputFrames) throw new StretchRequestError('channels differ in length');
  }
  if (inputFrames === 0) throw new StretchRequestError('input is empty');
  if (!(req.sampleRate > 0)) throw new StretchRequestError('sampleRate must be > 0');
  if (!Number.isInteger(req.outputFrames) || req.outputFrames <= 0) {
    throw new StretchRequestError('outputFrames must be a positive integer');
  }
  if (!(req.ratio >= MIN_RATIO && req.ratio <= MAX_RATIO)) {
    throw new StretchRequestError(
      `ratio ${req.ratio} outside the hard cap ${MIN_RATIO}–${MAX_RATIO}`,
    );
  }
  if (!(req.semitones >= MIN_SEMITONES && req.semitones <= MAX_SEMITONES)) {
    throw new StretchRequestError(
      `semitones ${req.semitones} outside ${MIN_SEMITONES}…${MAX_SEMITONES}`,
    );
  }
  const effective = inputFrames / req.outputFrames;
  if (Math.abs(effective / req.ratio - 1) > RATIO_TOLERANCE) {
    throw new StretchRequestError(
      `ratio ${req.ratio} disagrees with inputFrames/outputFrames = ${effective.toFixed(5)}`,
    );
  }
  return inputFrames;
}

/** Wall clock in ms (performance.now where available). */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Pads with zeros or truncates to exactly `frames`. Returns the same array when it already fits. */
export function fitLength(channel: Float32Array, frames: number): Float32Array {
  if (channel.length === frames) return channel;
  const out = new Float32Array(frames);
  out.set(channel.subarray(0, Math.min(frames, channel.length)));
  return out;
}

export function semitonesToScale(semitones: number): number {
  return 2 ** (semitones / 12);
}
