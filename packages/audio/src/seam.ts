/**
 * Seamless loop builder (docs/BUILD_PROMPT.md §8.3).
 *
 * A render covers [handle | body | handle]. The playable loop is exactly the body
 * (`loopFrames` = bars × 4 × 60/M × sampleRate, rounded on the grid). To hide the seam, the
 * last `crossfadeFrames` of the body are crossfaded into the handle audio that leads into the
 * body's first frame (the end of the pre-handle). The final loop frame is then the frame that
 * precedes the body in the render, so playing loop[L−1] → loop[0] is the same as playing the
 * render's own continuous audio across the downbeat: no step, no click.
 */

export type CrossfadeCurve = 'linear' | 'equal-power';

export interface SeamOptions {
  /** First body frame in the rendered buffer (= stretched handle length). */
  bodyStart: number;
  /** Exact loop length in frames. */
  loopFrames: number;
  /** Crossfade length in frames (AUDIO_TUNING.seamCrossfadeSec × sampleRate). */
  crossfadeFrames: number;
  /**
   * 'linear' (default): equal-gain, exact for correlated material (loops repeat, so the bar
   * before the body and the body's last bar are usually highly correlated).
   * 'equal-power': constant power for uncorrelated material.
   */
  curve?: CrossfadeCurve;
}

/** Gains (fadeOut, fadeIn) at position w ∈ [0, 1] of a crossfade. */
export function crossfadeGains(w: number, curve: CrossfadeCurve = 'linear'): [number, number] {
  const x = Math.min(1, Math.max(0, w));
  if (curve === 'equal-power') return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];
  return [1 - x, x];
}

/**
 * Crossfades `from` into `to` over their common length, writing into `out` (may alias `from`).
 * Frame i uses w = (i + 1) / n, so the last frame is purely `to`.
 */
export function crossfade(
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  out: Float32Array,
  curve: CrossfadeCurve = 'linear',
): Float32Array {
  const n = Math.min(from.length, to.length, out.length);
  for (let i = 0; i < n; i++) {
    const [a, b] = crossfadeGains((i + 1) / n, curve);
    out[i] = (from[i] as number) * a + (to[i] as number) * b;
  }
  return out;
}

/** Builds the seamless loop for every channel. Returns new arrays of exactly `loopFrames`. */
export function buildSeamlessLoop(channels: Float32Array[], options: SeamOptions): Float32Array[] {
  const { bodyStart, loopFrames, crossfadeFrames } = options;
  const curve = options.curve ?? 'linear';
  if (!Number.isInteger(bodyStart) || !Number.isInteger(loopFrames) || loopFrames <= 0) {
    throw new RangeError('buildSeamlessLoop: bodyStart and loopFrames must be integers');
  }
  if (!Number.isInteger(crossfadeFrames) || crossfadeFrames < 0 || crossfadeFrames > loopFrames) {
    throw new RangeError('buildSeamlessLoop: crossfadeFrames must be in 0…loopFrames');
  }
  if (bodyStart < crossfadeFrames) {
    throw new RangeError('buildSeamlessLoop: not enough handle audio before the body');
  }
  return channels.map((ch) => {
    if (bodyStart + loopFrames > ch.length) {
      throw new RangeError('buildSeamlessLoop: body extends past the rendered audio');
    }
    const loop = ch.slice(bodyStart, bodyStart + loopFrames);
    if (crossfadeFrames > 0) {
      const tailStart = loopFrames - crossfadeFrames;
      const tail = loop.subarray(tailStart);
      const lead = ch.subarray(bodyStart - crossfadeFrames, bodyStart);
      crossfade(tail, lead, tail, curve);
    }
    return loop;
  });
}

/** The naive loop (body cut without any crossfade), for comparison in the seam metric. */
export function cutLoop(channels: Float32Array[], bodyStart: number, loopFrames: number) {
  return channels.map((ch) => ch.slice(bodyStart, bodyStart + loopFrames));
}
