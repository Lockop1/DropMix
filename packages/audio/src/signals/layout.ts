/**
 * Frame layout of a loop with handles: [handle | body (bars) | handle].
 * All positions are integer frames derived from the fractional bar grid by rounding, so the
 * same layout is reproduced exactly by every caller (generator, stretcher request, seam builder).
 */

export const BEATS_PER_BAR = 4;

export interface LoopLayout {
  sampleRate: number;
  bpm: number;
  /** Bars in the loop body. */
  bars: number;
  /** Bars of handle audio before and after the body. */
  handleBars: number;
  /** Fractional frames per beat at this BPM. */
  framesPerBeat: number;
  /** First body frame (= handle length before the body). */
  bodyStart: number;
  /** Body length in frames: exactly round(bars × 4 × 60/bpm × sampleRate) on the rounded grid. */
  bodyFrames: number;
  /** Whole buffer, handles included. */
  totalFrames: number;
}

export function loopLayout(
  bpm: number,
  bars: number,
  handleBars: number,
  sampleRate: number,
): LoopLayout {
  if (!(bpm > 0) || !(bars > 0) || handleBars < 0 || !(sampleRate > 0)) {
    throw new RangeError('loopLayout: bpm, bars and sampleRate must be > 0, handleBars ≥ 0');
  }
  const framesPerBeat = (60 / bpm) * sampleRate;
  const beatFrame = (beat: number) => Math.round(beat * framesPerBeat);
  const bodyStart = beatFrame(handleBars * BEATS_PER_BAR);
  const bodyEnd = beatFrame((handleBars + bars) * BEATS_PER_BAR);
  const totalFrames = beatFrame((2 * handleBars + bars) * BEATS_PER_BAR);
  return {
    sampleRate,
    bpm,
    bars,
    handleBars,
    framesPerBeat,
    bodyStart,
    bodyFrames: bodyEnd - bodyStart,
    totalFrames,
  };
}

/** Integer frame of a beat counted from the start of the buffer (handle included). */
export function beatFrameOf(layout: LoopLayout, beat: number): number {
  return Math.round(beat * layout.framesPerBeat);
}

/** Fractional (unrounded) frame of a beat counted from the start of the buffer. */
export function idealBeatFrame(layout: LoopLayout, beat: number): number {
  return beat * layout.framesPerBeat;
}

/** Number of beats in the whole buffer (handles included). */
export function totalBeats(layout: LoopLayout): number {
  return (2 * layout.handleBars + layout.bars) * BEATS_PER_BAR;
}

/**
 * Layout of the same loop stretched to `masterBpm`: this is what a render request asks for.
 * `outputFrames` of the StretchRequest is `stretched.totalFrames`.
 */
export function stretchedLayout(source: LoopLayout, masterBpm: number): LoopLayout {
  return loopLayout(masterBpm, source.bars, source.handleBars, source.sampleRate);
}
