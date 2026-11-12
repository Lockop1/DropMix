/** Markdown tables for benchmark results (pasted into docs/spikes/audio.md and playtest docs). */

import type { FlacDecodeResult } from './flac-decode';
import type { MainThreadStats } from './main-thread';
import type { PerfReport } from './perf';
import type { QualityReport } from './quality';
import type { OfflineLoadResult } from './realtime-load';

export interface EnvironmentInfo {
  /** Free text: where this was measured (e.g. "cloud container, headless Chromium"). */
  label: string;
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  sampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  features: Record<string, boolean>;
  timestamp: string;
}

export interface CandidateRow {
  id: string;
  label: string;
  packageName: string;
  packageVersion: string;
  license: string;
  permissive: boolean;
  /** Loaded and rendered offline inside a Web Worker in this run. */
  offlineWorker: boolean | null;
  supportsFormant: boolean;
  /** Worker-side load + init (WASM compile/instantiate) in ms. */
  initMs: number | null;
  error: string | null;
}

export interface LiveLoadResult {
  mode: 'plain' | 'stretch';
  voices: number;
  seconds: number;
  /** Source of the numbers: 'renderCapacity', 'playbackStats' or 'none'. */
  source: string;
  averageLoad: number | null;
  peakLoad: number | null;
  underrunRatio: number | null;
  underruns: number | null;
}

export interface BenchResults {
  environment: EnvironmentInfo;
  candidates: CandidateRow[];
  perf: PerfReport[];
  mainThread: Record<string, MainThreadStats>;
  quality: QualityReport[];
  realtime: { offline: OfflineLoadResult[]; live: LiveLoadResult[] } | null;
  flac: FlacDecodeResult[];
}

const fmt = (v: unknown, digits = 1): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(digits) : String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
};

/** A pipe inside a cell would split it; replace it. */
const cell = (s: string) => s.replaceAll('|', '/').replaceAll('\n', ' ');

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

export function environmentMarkdown(env: EnvironmentInfo): string {
  const features = Object.entries(env.features)
    .map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`)
    .join(', ');
  return [
    `Measured on: **${env.label}** (${env.timestamp})`,
    '',
    table(
      ['field', 'value'],
      [
        ['user agent', env.userAgent],
        ['hardwareConcurrency', fmt(env.hardwareConcurrency, 0)],
        ['deviceMemory (GB)', fmt(env.deviceMemoryGb, 0)],
        ['AudioContext sampleRate', fmt(env.sampleRate, 0)],
        ['baseLatency (ms)', env.baseLatency === null ? '—' : fmt(env.baseLatency * 1000)],
        ['outputLatency (ms)', env.outputLatency === null ? '—' : fmt(env.outputLatency * 1000)],
        ['features', features],
      ],
    ),
  ].join('\n');
}

export function candidatesMarkdown(rows: CandidateRow[]): string {
  return table(
    [
      'backend',
      'package',
      'license',
      'default bundle',
      'offline in worker',
      'formant',
      'init (ms)',
    ],
    rows.map((c) => [
      c.label,
      `${c.packageName}@${c.packageVersion}`,
      c.license,
      c.permissive ? 'yes' : 'no (flag)',
      c.error ? `no: ${c.error}` : fmt(c.offlineWorker),
      fmt(c.supportsFormant),
      fmt(c.initMs, 0),
    ]),
  );
}

export function perfMarkdown(
  reports: PerfReport[],
  mainThread: Record<string, MainThreadStats>,
): string {
  const rows: string[][] = [];
  for (const rep of reports) {
    for (const r of rep.rows) {
      rows.push([
        rep.backend,
        String(r.bars),
        fmt(r.ratio, 2),
        (r.semitones > 0 ? '+' : '') + String(r.semitones),
        fmt(r.outputSec),
        fmt(r.singleMedianMs, 0),
        `${fmt(r.singleMinMs, 0)}–${fmt(r.singleMaxMs, 0)}`,
        fmt(r.dspMedianMs, 0),
        fmt(r.poolBatchMedianMs, 0),
        fmt(r.poolPerRenderMedianMs, 0),
        fmt(r.speedX),
        r.heapBytesMax ? fmt(r.heapBytesMax / 2 ** 20) : '—',
      ]);
    }
  }
  const head = [
    'backend',
    'bars',
    'r',
    't',
    'out (s)',
    '1 worker median (ms)',
    'min–max',
    'DSP median (ms)',
    `pool batch (ms)`,
    'pool per render (ms)',
    '× realtime',
    'WASM heap (MB)',
  ];
  const runs = reports[0] ? `${reports[0].runs} runs after ${reports[0].warmup} warm-up` : '';
  const pool = reports[0]?.poolSize
    ? `pool = ${reports[0].poolSize} workers, batch = ${reports[0].poolSize} renders submitted at once`
    : '';
  const mt = table(
    [
      'backend',
      'longest main-thread task (ms)',
      'max event-loop gap (ms)',
      'peak main JS heap (MB)',
    ],
    Object.entries(mainThread).map(([b, s]) => [
      b,
      s.longestTaskMs === null
        ? 'n/a'
        : s.longestTaskMs === 0
          ? '<50 (none)'
          : fmt(s.longestTaskMs, 0),
      fmt(s.maxGapMs),
      s.peakJsHeapBytes === null ? 'n/a' : fmt(s.peakJsHeapBytes / 2 ** 20),
    ]),
  );
  return [`Median of ${runs}; ${pool}.`, '', table(head, rows), '', mt].join('\n');
}

export function qualityMarkdown(reports: QualityReport[]): string {
  const out: string[] = [];
  out.push(
    table(
      ['backend', 'renders', 'exact length', 'deterministic'],
      reports.map((q) => [
        q.backend,
        String(q.renders),
        `${q.exactLength}/${q.renders}`,
        fmt(q.deterministic),
      ]),
    ),
  );
  out.push(
    '',
    '**Onset timing** (click loop, every body beat vs the ideal grid; target ±2 ms)',
    '',
  );
  out.push(
    table(
      ['backend', 'r', 't', 'onsets', 'max abs error (ms)', 'mean abs error (ms)', 'missing'],
      reports.flatMap((q) =>
        q.onsets.map((o) => [
          q.backend,
          fmt(o.ratio, 2),
          String(o.semitones),
          String(o.onsets),
          fmt(o.maxAbsMs, 2),
          fmt(o.meanAbsMs, 2),
          String(o.missing),
        ]),
      ),
    ),
  );
  out.push('', '**Pitch** (440 Hz sine; dominant frequency over 1 s of the body)', '');
  out.push(
    table(
      ['backend', 'r', 't', 'expected (Hz)', 'measured (Hz)', 'error (cents)'],
      reports.flatMap((q) =>
        q.pitch.map((p) => [
          q.backend,
          fmt(p.ratio, 2),
          String(p.semitones),
          fmt(p.expectedHz, 2),
          fmt(p.measuredHz, 2),
          fmt(p.cents, 2),
        ]),
      ),
    ),
  );
  out.push('', '**Seam** (|x[0] − x[L−1]| / RMS sample step; ≈1 = like any other step)', '');
  out.push(
    table(
      ['backend', 'signal', 'r', 't', '10 ms handle crossfade', 'plain cut'],
      reports.flatMap((q) =>
        q.seams.map((s) => [
          q.backend,
          s.signal,
          fmt(s.ratio, 2),
          String(s.semitones),
          fmt(s.ratioCrossfaded, 2),
          fmt(s.ratioCut, 2),
        ]),
      ),
    ),
  );
  const ref = reports.find((q) => q.formantReferenceHz.length)?.formantReferenceHz ?? [];
  out.push(
    '',
    `**Formant** (vowel /a/, r = 1; envelope shift: 0 = formants kept, ≈t = moved with pitch; dry peaks ${ref.join(' / ')} Hz)`,
    '',
  );
  out.push(
    table(
      [
        'backend',
        't',
        'formant requested',
        'formantApplied',
        'envelope shift (st)',
        'envelope peaks (Hz)',
      ],
      reports.flatMap((q) =>
        q.formant.map((f) => [
          q.backend,
          String(f.semitones),
          fmt(f.formant),
          fmt(f.formantApplied),
          fmt(f.envelopeShift, 2),
          f.peaksHz.join(' / '),
        ]),
      ),
    ),
  );
  return out.join('\n');
}

export function realtimeMarkdown(r: NonNullable<BenchResults['realtime']>): string {
  const out = [
    table(
      [
        'mode',
        'voices',
        'audio (s)',
        'offline render (ms)',
        'load (share of one core)',
        'output RMS',
      ],
      r.offline.map((o) => [
        o.mode === 'plain'
          ? 'render-on-drop (plain looping buffers)'
          : 'realtime stretch (AudioWorklet)',
        String(o.voices),
        fmt(o.seconds, 0),
        fmt(o.renderMs, 0),
        fmt(o.load, 3),
        fmt(o.outputRms, 4),
      ]),
    ),
  ];
  if (r.live.length) {
    out.push(
      '',
      table(
        [
          'mode',
          'voices',
          'seconds',
          'source',
          'avg load',
          'peak load',
          'underrun ratio',
          'underruns',
        ],
        r.live.map((l) => [
          l.mode,
          String(l.voices),
          fmt(l.seconds, 0),
          l.source,
          fmt(l.averageLoad, 3),
          fmt(l.peakLoad, 3),
          fmt(l.underrunRatio, 4),
          fmt(l.underruns, 0),
        ]),
      ),
    );
  }
  return out.join('\n');
}

export function flacMarkdown(rows: FlacDecodeResult[]): string {
  return table(
    [
      'test',
      'audio (s)',
      'bytes',
      'decoded',
      'expected frames',
      'decoded frames',
      'exact length',
      'max error (LSB)',
      'bit-exact',
      'int16→float',
      'encode (ms)',
      'decode (ms)',
    ],
    rows.map((f) => [
      f.label,
      fmt(f.seconds, 2),
      String(f.bytes),
      f.ok ? 'yes' : `no: ${f.error}`,
      String(f.expectedFrames),
      fmt(f.decodedFrames, 0),
      fmt(f.exactLength),
      fmt(f.maxErrorLsb, 3),
      fmt(f.bitExact),
      f.floatScale ?? '—',
      fmt(f.encodeMs, 0),
      fmt(f.decodeMs),
    ]),
  );
}

export function benchToMarkdown(r: BenchResults): string {
  const parts = [
    '### Environment',
    '',
    environmentMarkdown(r.environment),
    '',
    '### Candidates',
    '',
    candidatesMarkdown(r.candidates),
  ];
  if (r.perf.length) parts.push('', '### Render time', '', perfMarkdown(r.perf, r.mainThread));
  if (r.quality.length) parts.push('', '### Quality', '', qualityMarkdown(r.quality));
  if (r.realtime)
    parts.push('', '### Realtime vs render-on-drop', '', realtimeMarkdown(r.realtime));
  if (r.flac.length) parts.push('', '### FLAC decode', '', flacMarkdown(r.flac));
  return parts.join('\n');
}
