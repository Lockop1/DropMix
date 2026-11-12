import { describe, expect, it } from 'vitest';
import { seamDiscontinuity } from '../src/analysis/metrics';
import { AUDIO_TUNING } from '../src/contracts';
import { buildSeamlessLoop, crossfade, crossfadeGains, cutLoop } from '../src/seam';
import { generateSignal } from '../src/signals/generators';

describe('crossfade', () => {
  it('gains: linear sums to 1, equal-power sums to unit power', () => {
    for (const w of [0, 0.25, 0.5, 1]) {
      const [a, b] = crossfadeGains(w, 'linear');
      expect(a + b).toBeCloseTo(1, 12);
      const [c, d] = crossfadeGains(w, 'equal-power');
      expect(c * c + d * d).toBeCloseTo(1, 12);
    }
    expect(crossfadeGains(-1)).toEqual([1, 0]);
    expect(crossfadeGains(2)).toEqual([0, 1]);
  });

  it('ends purely on the target and starts near the source', () => {
    const out = crossfade(
      new Float32Array(10).fill(1),
      new Float32Array(10).fill(0),
      new Float32Array(10),
    );
    expect(out[9]).toBe(0);
    expect(out[0]).toBeCloseTo(0.9, 6);
    for (let i = 1; i < 10; i++) expect(out[i] as number).toBeLessThan(out[i - 1] as number);
  });
});

describe('buildSeamlessLoop', () => {
  const sr = 44100;
  const xf = Math.round(AUDIO_TUNING.seamCrossfadeSec * sr);

  it('returns exactly loopFrames and keeps the body untouched before the crossfade', () => {
    const s = generateSignal('pad', { bars: 2 });
    const loop = buildSeamlessLoop(s.channels, {
      bodyStart: s.layout.bodyStart,
      loopFrames: s.layout.bodyFrames,
      crossfadeFrames: xf,
    });
    expect(loop).toHaveLength(2);
    for (const [c, ch] of loop.entries()) {
      expect(ch.length).toBe(s.layout.bodyFrames);
      const src = s.channels[c] as Float32Array;
      expect(ch[0]).toBe(src[s.layout.bodyStart]);
      expect(ch[s.layout.bodyFrames - xf - 1]).toBe(
        src[s.layout.bodyStart + s.layout.bodyFrames - xf - 1],
      );
      // The last frame is the frame just before the body: the seam continues the audio.
      expect(ch[s.layout.bodyFrames - 1]).toBeCloseTo(src[s.layout.bodyStart - 1] as number, 6);
    }
  });

  it('removes the seam step of non-periodic material (pad and bass at an odd tempo)', () => {
    for (const kind of ['pad', 'bass'] as const) {
      const s = generateSignal(kind, { bars: 2, bpm: 131 });
      const opts = {
        bodyStart: s.layout.bodyStart,
        loopFrames: s.layout.bodyFrames,
        crossfadeFrames: xf,
      };
      const seamless = seamDiscontinuity(buildSeamlessLoop(s.channels, opts)).ratio;
      const cut = seamDiscontinuity(cutLoop(s.channels, opts.bodyStart, opts.loopFrames)).ratio;
      expect(seamless).toBeLessThan(2);
      expect(seamless).toBeLessThanOrEqual(cut);
    }
  });

  it('equal-power curve is also seamless', () => {
    const s = generateSignal('pad', { bars: 1, bpm: 97 });
    const loop = buildSeamlessLoop(s.channels, {
      bodyStart: s.layout.bodyStart,
      loopFrames: s.layout.bodyFrames,
      crossfadeFrames: xf,
      curve: 'equal-power',
    });
    expect(seamDiscontinuity(loop).ratio).toBeLessThan(2);
  });

  it('validates its arguments', () => {
    const ch = [new Float32Array(1000)];
    expect(() =>
      buildSeamlessLoop(ch, { bodyStart: 10, loopFrames: 100, crossfadeFrames: 20 }),
    ).toThrow(/handle/);
    expect(() =>
      buildSeamlessLoop(ch, { bodyStart: 500, loopFrames: 600, crossfadeFrames: 20 }),
    ).toThrow(/past/);
    expect(() =>
      buildSeamlessLoop(ch, { bodyStart: 100, loopFrames: 10, crossfadeFrames: 20 }),
    ).toThrow(RangeError);
    expect(
      buildSeamlessLoop(ch, { bodyStart: 0, loopFrames: 10, crossfadeFrames: 0 })[0]?.length,
    ).toBe(10);
  });
});
