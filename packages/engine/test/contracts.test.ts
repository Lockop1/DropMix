import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_CONFIG } from '../src';

describe('engine contract constants', () => {
  it('DEFAULT_BOARD_CONFIG has the five §6.2 slots', () => {
    expect(DEFAULT_BOARD_CONFIG.slots.map((s) => s.accepts)).toEqual([
      ['bass', 'beat'],
      ['beat'],
      ['beat', 'loop'],
      ['loop'],
      ['loop', 'lead'],
    ]);
  });

  it('DEFAULT_BOARD_CONFIG uses the recommended stack limit of 10', () => {
    expect(DEFAULT_BOARD_CONFIG.stackLimit).toBe(10);
  });
});
