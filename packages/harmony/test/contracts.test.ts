import { describe, expect, it } from 'vitest';
import {
  BEATS_PER_BAR,
  CYCLE_BARS,
  DEFAULT_ENTRY_EVERY,
  ROLES,
  STRETCH_LIMITS,
  TEMPO_RANGE,
  TRANSPOSE_RANGE,
} from '../src';

describe('harmony contract constants', () => {
  it('tempo range is 90–157 BPM and spans less than an octave', () => {
    expect(TEMPO_RANGE).toEqual({ min: 90, max: 157 });
    expect(TEMPO_RANGE.max / TEMPO_RANGE.min).toBeLessThan(2);
  });

  it('transposition stays within −6…+5 semitones (12 distinct shifts)', () => {
    expect(TRANSPOSE_RANGE).toEqual({ min: -6, max: 5 });
    expect(TRANSPOSE_RANGE.max - TRANSPOSE_RANGE.min + 1).toBe(12);
  });

  it('every role has soft stretch limits inside the hard cap', () => {
    for (const role of ROLES) {
      const soft = STRETCH_LIMITS.soft[role];
      expect(soft.min).toBeGreaterThanOrEqual(STRETCH_LIMITS.hard.min);
      expect(soft.max).toBeLessThanOrEqual(STRETCH_LIMITS.hard.max);
      expect(soft.min).toBeLessThan(1);
      expect(soft.max).toBeGreaterThan(1);
    }
  });

  it('grid constants and entry quantization defaults', () => {
    expect(BEATS_PER_BAR).toBe(4);
    expect(CYCLE_BARS).toBe(16);
    expect(DEFAULT_ENTRY_EVERY).toEqual({ beat: 1, bass: 1, loop: 2, lead: 4 });
  });
});
