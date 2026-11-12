import { describe, expect, it } from 'vitest';
import { type BenchResults, benchToMarkdown, flacMarkdown } from '../src/bench/markdown';
import { PERF_CASES, runPerfSuite } from '../src/bench/perf';
import { loopRequest } from '../src/bench/request';
import { generateSignal } from '../src/signals/generators';

describe('loopRequest', () => {
  it('asks for the master-tempo layout and copies the channels', () => {
    const s = generateSignal('pad', { bars: 2, bpm: 100 });
    const { request, output } = loopRequest(s.channels, s.layout, 125, -3, true);
    expect(request.ratio).toBe(1.25);
    expect(request.outputFrames).toBe(output.totalFrames);
    expect(output.bpm).toBe(125);
    expect(request.channels[0]).not.toBe(s.channels[0]);
    expect(request.channels[0]).toEqual(s.channels[0]);
    expect(request).toMatchObject({ semitones: -3, formant: true, sampleRate: 44100 });
  });
});

describe('runPerfSuite', () => {
  it('covers 8 and 16 bars × the four corners + r = 1', () => {
    expect(PERF_CASES).toHaveLength(10);
    expect(new Set(PERF_CASES.map((c) => c.bars))).toEqual(new Set([8, 16]));
  });

  it('times warm-up + runs per case, single and pooled, and computes medians', async () => {
    const calls = { single: 0, pool: 0 };
    const timed: boolean[] = [];
    const rep = await runPerfSuite({
      backend: 'fake',
      cases: [{ bars: 1, ratio: 1.25, semitones: 0 }],
      runs: 3,
      warmup: 2,
      poolSize: 2,
      renderSingle: async (req) => {
        calls.single++;
        expect(req.outputFrames).toBeGreaterThan(0);
        return { renderMs: 10, roundTripMs: 12, heapBytes: 1000 };
      },
      renderPool: async () => {
        calls.pool++;
        return { renderMs: 20, roundTripMs: 25 };
      },
      onTimed: (active) => timed.push(active),
    });
    expect(calls.single).toBe(2 + 3);
    expect(calls.pool).toBe(2 + 3 * 2);
    const row = rep.rows[0];
    expect(row).toMatchObject({
      singleMedianMs: 12,
      dspMedianMs: 10,
      poolPerRenderMedianMs: 25,
      heapBytesMax: 1000,
    });
    expect(row?.outputSec).toBeCloseTo(4.8, 1);
    expect(timed.filter((t) => t)).toHaveLength(3 + 3);
    expect(timed.at(-1)).toBe(false);
  });
});

describe('markdown', () => {
  const results: BenchResults = {
    environment: {
      label: 'unit test',
      userAgent: 'UA | with a pipe',
      hardwareConcurrency: 4,
      deviceMemoryGb: null,
      sampleRate: 44100,
      baseLatency: 0.01,
      outputLatency: null,
      features: { AudioWorklet: true, OPFS: false },
      timestamp: '2026-01-01T00:00:00Z',
    },
    candidates: [
      {
        id: 'signalsmith',
        label: 'Signalsmith Stretch',
        packageName: 'signalsmith-stretch',
        packageVersion: '1.3.2',
        license: 'MIT',
        permissive: true,
        offlineWorker: true,
        supportsFormant: true,
        initMs: 12,
        error: null,
      },
    ],
    perf: [],
    mainThread: {},
    quality: [],
    realtime: null,
    flac: [],
  };

  it('renders environment and candidate tables, escaping pipes inside cells', () => {
    const md = benchToMarkdown(results);
    expect(md).toContain('### Environment');
    expect(md).toContain('Measured on: **unit test**');
    expect(md).toContain('UA / with a pipe');
    expect(md).toContain(
      '| Signalsmith Stretch | signalsmith-stretch@1.3.2 | MIT | yes | yes | yes | 12 |',
    );
    expect(md).not.toContain('### Render time');
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) {
      expect(line.endsWith('|')).toBe(true);
    }
  });

  it('every table row has as many cells as its header', () => {
    const md = flacMarkdown([
      {
        label: '3 s',
        seconds: 3,
        bytes: 1,
        expectedFrames: 10,
        decodedFrames: 10,
        decodedSampleRate: 44100,
        ok: true,
        exactLength: true,
        maxErrorLsb: 0,
        floatScale: '1/32768',
        bitExact: true,
        encodeMs: 1,
        decodeMs: 2,
        error: null,
      },
    ]);
    const [head, , row] = md.split('\n');
    expect(row?.split('|').length).toBe(head?.split('|').length);
    expect(row).toContain('| yes | 1/32768 |');
  });
});
