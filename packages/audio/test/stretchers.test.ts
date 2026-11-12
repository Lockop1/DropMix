/**
 * Stretcher contract tests, run directly in Node against every backend (no Worker, no license
 * gate: the gate is a bundling concern tested in registry.test.ts and by grepping dist/).
 */

import { describe, expect, it } from 'vitest';
import { identicalRenders } from '../src/analysis/metrics';
import { runQualitySuite } from '../src/bench/quality';
import { loopRequest } from '../src/bench/request';
import type { StretcherId, StretchRequest } from '../src/contracts';
import { generateSignal } from '../src/signals/generators';
import { StretchRequestError, validateRequest } from '../src/stretch/common';
import { soundTouchMeanDriftFrames } from '../src/stretch/soundtouch';
import { nodeStretcher } from './backends.node';

const IDS: StretcherId[] = ['signalsmith', 'soundtouch', 'rubberband'];

function request(bars: number, ratio: number, semitones: number, formant = false): StretchRequest {
  const s = generateSignal('drums', { bars, bpm: 120 });
  return loopRequest(s.channels, s.layout, 120 * ratio, semitones, formant).request;
}

describe('validateRequest', () => {
  const ok = request(1, 1.25, 2);
  it('accepts a well-formed request', () => {
    expect(validateRequest(ok)).toBe(ok.channels[0]?.length);
  });
  it.each([
    ['no channels', { channels: [] }],
    ['ragged channels', { channels: [new Float32Array(10), new Float32Array(9)] }],
    ['ratio beyond the hard cap', { ratio: 1.6 }],
    ['semitones beyond +5', { semitones: 6 }],
    ['semitones beyond −6', { semitones: -7 }],
    ['fractional outputFrames', { outputFrames: 10.5 }],
    ['ratio disagreeing with the frame counts', { ratio: 1.0 }],
  ])('rejects %s', (_label, patch) => {
    expect(() => validateRequest({ ...ok, ...patch } as StretchRequest)).toThrow(
      StretchRequestError,
    );
  });
});

describe.each(IDS)('%s backend', (id) => {
  it('identifies itself and its license', () => {
    const s = nodeStretcher(id);
    expect(s.id).toBe(id);
    expect(s.license).toMatch(
      id === 'signalsmith' ? /^MIT$/ : id === 'soundtouch' ? /^LGPL/ : /^GPL/,
    );
  });

  it('returns exactly outputFrames per channel for the four corners and r = 1', async () => {
    const s = nodeStretcher(id);
    await s.init();
    for (const [r, t] of [
      [0.8, -5],
      [0.8, 5],
      [1.25, -5],
      [1.25, 5],
      [1, 0],
    ] as const) {
      const req = request(1, r, t);
      const res = await s.render(req);
      expect(res.channels).toHaveLength(2);
      for (const ch of res.channels) {
        expect(ch.length).toBe(req.outputFrames);
        expect(ch.byteOffset).toBe(0);
        expect(ch.buffer.byteLength).toBe(req.outputFrames * 4);
      }
      expect(res.renderMs).toBeGreaterThanOrEqual(0);
    }
    s.dispose();
  }, 120_000);

  it('handles mono input and reports formantApplied truthfully', async () => {
    const s = nodeStretcher(id);
    const stereo = request(1, 1.1, 3, true);
    const req = { ...stereo, channels: [stereo.channels[0] as Float32Array] };
    const res = await s.render(req);
    expect(res.channels).toHaveLength(1);
    expect(res.channels[0]?.length).toBe(req.outputFrames);
    expect(res.formantApplied).toBe(s.supportsFormant);
    const off = await s.render({ ...req, formant: false });
    expect(off.formantApplied).toBe(false);
  }, 120_000);

  it('is deterministic (bit-identical renders), also across instances', async () => {
    const a = nodeStretcher(id);
    const b = nodeStretcher(id);
    const x = await a.render(request(1, 1.25, 5, true));
    const y = await a.render(request(1, 1.25, 5, true));
    const z = await b.render(request(1, 1.25, 5, true));
    expect(identicalRenders(x.channels, y.channels)).toBe(true);
    expect(identicalRenders(x.channels, z.channels)).toBe(true);
  }, 120_000);

  it('rejects an invalid request', async () => {
    const s = nodeStretcher(id);
    await expect(s.render({ ...request(1, 1, 0), semitones: 9 })).rejects.toThrow(
      StretchRequestError,
    );
  });
});

describe('quality (default candidate, Node)', () => {
  it('Signalsmith: onsets within ±2 ms, pitch within 10 cents, seams ≈ continuous, formants kept', async () => {
    const s = nodeStretcher('signalsmith');
    const q = await runQualitySuite({
      backend: 'signalsmith',
      supportsFormant: true,
      render: (r) => s.render(r),
      bars: 2,
      quick: true,
    });
    expect(q.exactLength).toBe(q.renders);
    expect(q.deterministic).toBe(true);
    for (const o of q.onsets) {
      expect(o.missing).toBe(0);
      expect(o.maxAbsMs).toBeLessThanOrEqual(2);
    }
    for (const p of q.pitch) expect(Math.abs(p.cents)).toBeLessThan(10);
    for (const seam of q.seams) expect(seam.ratioCrossfaded).toBeLessThan(3);
    const on = q.formant.find((f) => f.formant);
    const off = q.formant.find((f) => !f.formant);
    expect(Math.abs(on?.envelopeShift ?? 99)).toBeLessThan(1);
    expect(Math.abs((off?.envelopeShift ?? 0) - (off?.semitones ?? 0))).toBeLessThan(1);
  }, 120_000);
});

describe('soundTouchMeanDriftFrames', () => {
  it('is zero at tempo 1 without pitch shift and changes sign with the tempo direction', () => {
    expect(soundTouchMeanDriftFrames(1, 0)).toBeCloseTo(0, 9);
    expect(soundTouchMeanDriftFrames(0.8, 0)).toBeLessThan(0);
    expect(soundTouchMeanDriftFrames(1.25, 0)).toBeGreaterThan(0);
  });
  it('matches the hand-derived value at r = 0.8 (sequence 114 ms, overlap 352 frames)', () => {
    const s = Math.floor((44100 * 114) / 1000) - 352;
    expect(soundTouchMeanDriftFrames(0.8, 0)).toBeCloseTo((-s * 0.2) / 1.6, 6);
  });
});
