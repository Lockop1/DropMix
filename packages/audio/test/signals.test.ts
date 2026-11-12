import { describe, expect, it } from 'vitest';
import { generateSignal, SIGNAL_KINDS } from '../src/signals/generators';
import {
  beatFrameOf,
  idealBeatFrame,
  loopLayout,
  stretchedLayout,
  totalBeats,
} from '../src/signals/layout';

describe('loop layout', () => {
  it('120 BPM, 4 bars, 1-bar handles at 44.1 kHz', () => {
    const l = loopLayout(120, 4, 1, 44100);
    expect(l.framesPerBeat).toBe(22050);
    expect(l.bodyStart).toBe(88200);
    expect(l.bodyFrames).toBe(4 * 4 * 22050);
    expect(l.totalFrames).toBe(6 * 4 * 22050);
  });

  it('body length is round(bars × 4 × 60/M × sr) on the rounded grid for awkward tempos', () => {
    for (const bpm of [91.3, 117, 133.33, 157]) {
      const l = loopLayout(bpm, 8, 1, 44100);
      const fpb = (60 / bpm) * 44100;
      expect(l.bodyStart).toBe(Math.round(4 * fpb));
      expect(l.bodyStart + l.bodyFrames).toBe(Math.round(36 * fpb));
      expect(Math.abs(l.bodyFrames - 32 * fpb)).toBeLessThanOrEqual(1);
      expect(l.totalFrames).toBe(Math.round(40 * fpb));
      expect(totalBeats(l)).toBe(40);
    }
  });

  it('stretched layout keeps bars and handles and changes tempo', () => {
    const src = loopLayout(120, 8, 1, 44100);
    const out = stretchedLayout(src, 150);
    expect(out.bars).toBe(8);
    expect(out.handleBars).toBe(1);
    expect(out.bpm).toBe(150);
    expect(out.totalFrames).toBe(Math.round(40 * ((60 / 150) * 44100)));
    expect(idealBeatFrame(out, 3)).toBeCloseTo(3 * 17640, 9);
    expect(beatFrameOf(out, 3)).toBe(52920);
  });

  it('rejects nonsense', () => {
    expect(() => loopLayout(0, 4, 1, 44100)).toThrow(RangeError);
    expect(() => loopLayout(120, 4, -1, 44100)).toThrow(RangeError);
  });
});

describe('synthetic signals', () => {
  it.each(SIGNAL_KINDS)(
    '%s is stereo, full length, finite, below clipping and deterministic',
    (kind) => {
      const a = generateSignal(kind, { bars: 2 });
      const b = generateSignal(kind, { bars: 2 });
      expect(a.channels).toHaveLength(2);
      for (const [c, ch] of a.channels.entries()) {
        expect(ch.length).toBe(a.layout.totalFrames);
        let peak = 0;
        let energy = 0;
        for (const v of ch) {
          expect(Number.isFinite(v)).toBe(true);
          peak = Math.max(peak, Math.abs(v));
          energy += v * v;
        }
        expect(peak).toBeLessThan(1);
        expect(energy).toBeGreaterThan(0);
        expect(ch).toEqual(b.channels[c]);
      }
    },
  );

  it('click onsets are sample-exact on the beat grid and start at full amplitude', () => {
    const s = generateSignal('click', { bpm: 133, bars: 2 });
    expect(s.onsets).toHaveLength(totalBeats(s.layout));
    for (const [k, o] of s.onsets.entries()) {
      expect(o).toBe(beatFrameOf(s.layout, k));
      expect(Math.abs(s.channels[0][o] as number)).toBeGreaterThan(0.2);
      if (o > 0) expect(Math.abs(s.channels[0][o - 1] as number)).toBeLessThan(1e-3);
    }
  });

  it('drum onsets are the beats', () => {
    const s = generateSignal('drums', { bars: 1, handleBars: 0 });
    expect(s.onsets).toEqual([0, 22050, 44100, 66150]);
  });

  it('a different seed changes the noise but not the grid', () => {
    const a = generateSignal('click', { bars: 1, seed: 1 });
    const b = generateSignal('click', { bars: 1, seed: 2 });
    expect(a.onsets).toEqual(b.onsets);
    expect(a.channels[0]).not.toEqual(b.channels[0]);
  });

  it('records sine frequency and vowel formants', () => {
    expect(generateSignal('sine', { bars: 1, frequency: 330 }).meta.frequency).toBe(330);
    const v = generateSignal('vowel', { bars: 1 });
    expect(v.meta.f0).toBe(140);
    expect(v.meta.formantsHz).toEqual([700, 1220, 2600]);
  });
});
