import { describe, expect, it } from 'vitest';
import { AUDIO_TUNING, LEVEL_GAIN_DB } from '../src';

describe('audio contract constants', () => {
  it('level gains are L1 −5 dB, L2 −2.5 dB, L3 0 dB', () => {
    expect(LEVEL_GAIN_DB).toEqual({ 1: -5, 2: -2.5, 3: 0 });
  });

  it('every start/stop fade is at least 5 ms', () => {
    expect(AUDIO_TUNING.fadeSec).toBeGreaterThanOrEqual(0.005);
    expect(AUDIO_TUNING.seamCrossfadeSec).toBeGreaterThanOrEqual(0.005);
    expect(AUDIO_TUNING.stopAfterSec).toBeGreaterThan(AUDIO_TUNING.fadeSec);
  });
});
