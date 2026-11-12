/**
 * /lab — audio spike page (task 0B). Phone-first: everything works at 360×640 with touch.
 *
 * Run the benchmark on any device, A/B the stretchers by ear, stress five loops at once and
 * test FLAC decoding. All audio is synthetic or a local file decoded in the browser; nothing
 * is uploaded anywhere.
 */

import {
  availableStretchers,
  type BenchResults,
  benchToMarkdown,
  createRenderWorker,
  createStretchClient,
  defaultPoolSize,
  type FlacDecodeResult,
  flacMarkdown,
  type LiveLoadResult,
  NONPERMISSIVE_STRETCHERS_ENABLED,
  type SignalKind,
  STRETCHERS,
  type StretchClient,
} from '@stemdeck/audio';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  type ABSource,
  buildVariants,
  fileSource,
  syntheticSource,
  type VariantTiming,
} from './ab';
import {
  ABPlayer,
  getContext,
  LoadMonitor,
  type LoopVariant,
  StressPlayer,
  toAudioBuffer,
  unlockAudio,
} from './audio';
import { deviceInfo } from './device';
import { installLabHook, measureLive, runAll, runFlac } from './lab-api';
import { MarkdownView } from './MarkdownView';

const button =
  'min-h-11 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium active:bg-white/20 disabled:opacity-40 touch-manipulation';
const primary =
  'min-h-11 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white active:bg-indigo-600 disabled:opacity-40 touch-manipulation';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export default function Lab() {
  const [ctx, setCtx] = useState<AudioContext | null>(getContext());
  const [results, setResults] = useState<BenchResults | null>(null);

  useEffect(() => installLabHook(setResults), []);

  const enableAudio = async () => {
    setCtx(await unlockAudio());
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-3 py-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Audio lab</h1>
        <p className="text-sm opacity-80">
          Stretcher spike (task 0B). Synthetic signals or a local file only; nothing leaves this
          device.{' '}
          <Link to="/" className="underline">
            Back home
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primary}
            onClick={enableAudio}
            data-testid="enable-audio"
          >
            {ctx?.state === 'running' ? 'Audio enabled' : 'Enable audio'}
          </button>
          <span className="text-xs opacity-70" data-testid="audio-state">
            {ctx ? `AudioContext ${ctx.state}, ${ctx.sampleRate} Hz` : 'Tap to unlock audio'}
          </span>
        </div>
      </header>
      <DevicePanel ctx={ctx} />
      <BenchmarkPanel results={results} onResults={setResults} />
      <ABPanel ctx={ctx} />
      <StressPanel ctx={ctx} />
      <FlacPanel />
    </div>
  );
}

function DevicePanel({ ctx }: { ctx: AudioContext | null }) {
  const info = useMemo(() => deviceInfo(ctx, 'this device'), [ctx]);
  return (
    <Section title="Device">
      <dl
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
        data-testid="device-info"
      >
        <dt className="opacity-70">User agent</dt>
        <dd className="break-all">{info.userAgent}</dd>
        <dt className="opacity-70">Cores</dt>
        <dd>{info.hardwareConcurrency ?? '—'}</dd>
        <dt className="opacity-70">Sample rate</dt>
        <dd>{info.sampleRate ? `${info.sampleRate} Hz` : 'enable audio'}</dd>
        <dt className="opacity-70">baseLatency</dt>
        <dd>{info.baseLatency !== null ? `${(info.baseLatency * 1000).toFixed(1)} ms` : '—'}</dd>
        <dt className="opacity-70">outputLatency</dt>
        <dd>
          {info.outputLatency !== null ? `${(info.outputLatency * 1000).toFixed(1)} ms` : '—'}
        </dd>
        <dt className="opacity-70">Support</dt>
        <dd className="break-words">
          {Object.entries(info.features)
            .map(([k, v]) => `${k}: ${v ? 'yes' : 'no'}`)
            .join(' · ')}
        </dd>
        <dt className="opacity-70">Backends</dt>
        <dd className="break-words">
          {availableStretchers()
            .map((id) => `${STRETCHERS[id].label} (${STRETCHERS[id].license})`)
            .join(', ')}
          {NONPERMISSIVE_STRETCHERS_ENABLED ? '' : ' — LGPL/GPL backends are off in this build'}
        </dd>
      </dl>
    </Section>
  );
}

function BenchmarkPanel({
  results,
  onResults,
}: {
  results: BenchResults | null;
  onResults: (r: BenchResults) => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; frac: number } | null>(null);
  const [mode, setMode] = useState<'quick' | 'full'>('quick');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markdown = useMemo(() => (results ? benchToMarkdown(results) : ''), [results]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const quick = mode === 'quick';
      const r = await runAll(
        {
          perf: quick
            ? {
                runs: 3,
                warmup: 1,
                cases: [
                  { bars: 8, ratio: 0.8, semitones: 5 },
                  { bars: 8, ratio: 1.25, semitones: -5 },
                ],
              }
            : {},
          quality: quick ? { quick: true } : {},
          realtime: {
            seconds: quick ? 8 : 20,
            live: getContext()?.state === 'running',
            liveSeconds: quick ? 4 : 10,
          },
          flac: { seconds: [3, 30] },
        },
        (msg, frac) => setProgress({ msg, frac }),
      );
      onResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Section title="Benchmark">
      <p className="text-sm opacity-80">
        Renders synthetic loops in Web Workers with every backend in this build and measures render
        time (8/16 bars, r 0.8/1.25, t ±5), onset timing, pitch, seams, formants, realtime load and
        FLAC decoding. Quick ≈ 1 min; full takes several minutes. Keep the screen on.
      </p>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">Benchmark size</legend>
        {(['quick', 'full'] as const).map((m) => (
          <label key={m} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="bench-mode"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {m === 'quick' ? 'Quick' : 'Full (5 runs, 8 + 16 bars)'}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          onClick={run}
          disabled={running}
          data-testid="run-benchmark"
        >
          {running ? 'Running…' : 'Run benchmark'}
        </button>
        <button
          type="button"
          className={button}
          disabled={!results}
          onClick={async () =>
            setCopied((await copyText(markdown)) ? 'Copied' : 'Copy failed: select the text below')
          }
        >
          Copy results as markdown
        </button>
      </div>
      {progress && (
        <div className="flex flex-col gap-1">
          <progress className="w-full" max={1} value={progress.frac} />
          <span className="text-xs break-words opacity-70" data-testid="bench-progress">
            {progress.msg}
          </span>
        </div>
      )}
      {copied && <p className="text-xs">{copied}</p>}
      {error && <p className="text-sm text-red-400 break-words">{error}</p>}
      {results && (
        <>
          <MarkdownView markdown={markdown} />
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">Markdown text</summary>
            <textarea
              readOnly
              className="h-48 w-full rounded bg-black/40 p-2 font-mono text-xs"
              value={markdown}
              data-testid="bench-markdown"
            />
          </details>
        </>
      )}
    </Section>
  );
}

const SIGNALS: SignalKind[] = ['drums', 'pad', 'bass', 'vowel', 'click'];

function ABPanel({ ctx }: { ctx: AudioContext | null }) {
  const [sourceKind, setSourceKind] = useState<SignalKind | 'file'>('drums');
  const [file, setFile] = useState<File | null>(null);
  const [fileBpm, setFileBpm] = useState(120);
  const [fileDownbeat, setFileDownbeat] = useState(0);
  const [bars, setBars] = useState(4);
  const [masterBpm, setMasterBpm] = useState(132);
  const [semitones, setSemitones] = useState(0);
  const [formant, setFormant] = useState(false);
  const [variants, setVariants] = useState<LoopVariant[]>([]);
  const [timings, setTimings] = useState<VariantTiming[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<ABPlayer | null>(null);
  const client = useRef<StretchClient | null>(null);

  useEffect(
    () => () => {
      player.current?.stop();
      client.current?.dispose();
    },
    [],
  );

  const render = useCallback(async () => {
    if (!ctx) return;
    setBusy(true);
    setStatus('Rendering…');
    try {
      client.current ??= createStretchClient({
        size: defaultPoolSize(),
        createWorker: createRenderWorker,
      });
      let source: ABSource;
      if (sourceKind === 'file') {
        if (!file) throw new Error('Choose a file first');
        source = await fileSource(file, ctx, fileBpm, bars, fileDownbeat);
      } else {
        source = syntheticSource(sourceKind, ctx.sampleRate, 120, bars);
      }
      const ratio = masterBpm / source.layout.bpm;
      if (ratio < 0.66 || ratio > 1.5)
        throw new Error(`ratio ${ratio.toFixed(2)} is outside 0.66–1.5`);
      const out = await buildVariants({
        ctx,
        client: client.current,
        source,
        backends: availableStretchers(),
        masterBpm,
        semitones,
        formant,
      });
      setVariants(out.variants);
      setTimings(out.timings);
      setStatus(`${source.label} → ${masterBpm} BPM, ${semitones >= 0 ? '+' : ''}${semitones} st`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctx, sourceKind, file, fileBpm, fileDownbeat, bars, masterBpm, semitones, formant]);

  const play = async (v: LoopVariant) => {
    if (!ctx) return;
    player.current ??= new ABPlayer(ctx);
    const at = await player.current.play(v);
    setPlaying(v.id);
    setStatus(
      `${v.label}: switches in ${Math.max(0, at - ctx.currentTime).toFixed(2)} s (next bar)`,
    );
  };

  return (
    <Section title="A/B by ear">
      {!ctx && <p className="text-sm text-amber-300">Enable audio first.</p>}
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          Source
          <select
            className="min-h-11 rounded bg-black/40 px-2"
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value as SignalKind | 'file')}
          >
            {SIGNALS.map((s) => (
              <option key={s} value={s}>
                {s} (synthetic, 120 BPM)
              </option>
            ))}
            <option value="file">Local file…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Bars
          <select
            className="min-h-11 rounded bg-black/40 px-2"
            value={bars}
            onChange={(e) => setBars(Number(e.target.value))}
          >
            {[1, 2, 4, 8].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {sourceKind === 'file' && (
          <>
            <label className="flex flex-col gap-1 sm:col-span-2">
              File (decoded here, never uploaded)
              <input
                type="file"
                accept="audio/*,.flac,.wav,.mp3,.m4a,.ogg"
                className="min-h-11 text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="flex flex-col gap-1">
              File BPM
              <input
                type="number"
                inputMode="decimal"
                className="min-h-11 rounded bg-black/40 px-2"
                value={fileBpm}
                min={60}
                max={200}
                step={0.01}
                onChange={(e) => setFileBpm(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              First downbeat (s)
              <input
                type="number"
                inputMode="decimal"
                className="min-h-11 rounded bg-black/40 px-2"
                value={fileDownbeat}
                min={0}
                step={0.001}
                onChange={(e) => setFileDownbeat(Number(e.target.value))}
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          Master BPM: {masterBpm}
          <input
            type="range"
            min={90}
            max={157}
            step={1}
            value={masterBpm}
            className="min-h-11"
            onChange={(e) => setMasterBpm(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1">
          Transpose (semitones)
          <select
            className="min-h-11 rounded bg-black/40 px-2"
            value={semitones}
            onChange={(e) => setSemitones(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => i - 6).map((t) => (
              <option key={t} value={t}>
                {t > 0 ? `+${t}` : t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={formant} onChange={(e) => setFormant(e.target.checked)} />
          Preserve formants (lead vocals)
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={!ctx || busy} onClick={render}>
          {busy ? 'Rendering…' : 'Render variants'}
        </button>
        <button
          type="button"
          className={button}
          disabled={!playing}
          onClick={() => {
            player.current?.stop();
            setPlaying(null);
          }}
        >
          Stop
        </button>
      </div>
      {status && <p className="text-xs break-words opacity-80">{status}</p>}
      {timings.length > 0 && (
        <ul className="text-xs opacity-80">
          {timings.map((t) => (
            <li key={t.id}>
              {t.label}: {t.error ? `failed (${t.error})` : `rendered in ${t.ms} ms`}
            </li>
          ))}
        </ul>
      )}
      {variants.length > 0 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Variants</legend>
          {variants.map((v) => (
            <button
              key={v.id}
              type="button"
              className={playing === v.id ? primary : button}
              aria-pressed={playing === v.id}
              onClick={() => play(v)}
            >
              {v.label}
            </button>
          ))}
        </fieldset>
      )}
      <p className="text-xs opacity-60">
        Switching happens on the next bar boundary (AudioContext time) with 10 ms fades. The
        original plays at its own tempo; every render plays at the master tempo.
      </p>
    </Section>
  );
}

function StressPanel({ ctx }: { ctx: AudioContext | null }) {
  const [mode, setMode] = useState<'plain' | 'stretch'>('plain');
  const [on, setOn] = useState(false);
  const [reading, setReading] = useState<LiveLoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stress = useRef<StressPlayer | null>(null);
  const monitor = useRef<LoadMonitor | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!on || !ctx) return;
    // UI refresh only (not audio timing).
    const id = setInterval(() => {
      if (monitor.current) setReading(monitor.current.read(mode, 5));
    }, 1000);
    return () => clearInterval(id);
  }, [on, ctx, mode]);

  useEffect(
    () => () => {
      stress.current?.stop();
      monitor.current?.stop();
    },
    [],
  );

  const toggle = async () => {
    if (!ctx) return;
    setError(null);
    if (on) {
      stress.current?.stop();
      monitor.current?.stop();
      setOn(false);
      return;
    }
    try {
      stress.current = new StressPlayer(ctx);
      const kinds: SignalKind[] = ['drums', 'pad', 'bass', 'vowel', 'click'];
      const sources = kinds.map((k) => syntheticSource(k, ctx.sampleRate, 120, 4));
      await stress.current.start(
        sources.map((s, i) =>
          mode === 'plain'
            ? {
                kind: 'buffer' as const,
                id: `s${i}`,
                label: s.label,
                buffer: toAudioBuffer(
                  ctx,
                  s.channels.map((c) =>
                    c.slice(s.layout.bodyStart, s.layout.bodyStart + s.layout.bodyFrames),
                  ),
                  ctx.sampleRate,
                ),
                bpm: 120,
                bars: 4,
              }
            : {
                kind: 'realtime' as const,
                id: `s${i}`,
                label: s.label,
                channels: s.channels,
                loopStartSec: s.layout.bodyStart / ctx.sampleRate,
                loopEndSec: (s.layout.bodyStart + s.layout.bodyFrames) / ctx.sampleRate,
                rate: 1.1,
                semitones: 3,
                formant: false,
                bpm: 132,
                bars: 4,
              },
        ),
      );
      monitor.current = new LoadMonitor(ctx);
      monitor.current.start();
      setOn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const timedTest = async () => {
    if (!ctx) return;
    setTesting(true);
    try {
      setReading(await measureLive(ctx, mode, 5, 10));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section title="5 loops stress">
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">Stress mode</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="stress-mode"
            checked={mode === 'plain'}
            disabled={on}
            onChange={() => setMode('plain')}
          />
          Render-on-drop (5 plain loops)
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="radio"
            name="stress-mode"
            checked={mode === 'stretch'}
            disabled={on}
            onChange={() => setMode('stretch')}
          />
          5 realtime stretch nodes
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={on ? primary : button}
          disabled={!ctx || testing}
          onClick={toggle}
          aria-pressed={on}
        >
          {on ? 'Stop 5 loops' : 'Play 5 loops'}
        </button>
        <button
          type="button"
          className={button}
          disabled={!ctx || on || testing}
          onClick={timedTest}
        >
          {testing ? 'Measuring 10 s…' : 'Timed 10 s test'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400 break-words">{error}</p>}
      {reading && (
        <p className="text-xs break-words" data-testid="stress-reading">
          {reading.source === 'none'
            ? 'This browser exposes no render-load or underrun API (renderCapacity / playbackStats): listen for dropouts.'
            : `source ${reading.source}: avg load ${reading.averageLoad?.toFixed(3) ?? '—'}, peak ${reading.peakLoad?.toFixed(3) ?? '—'}, underrun ratio ${reading.underrunRatio?.toFixed(4) ?? '—'}, underruns ${reading.underruns ?? '—'} over ${reading.seconds.toFixed(0)} s`}
        </p>
      )}
    </Section>
  );
}

function FlacPanel() {
  const [rows, setRows] = useState<FlacDecodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="FLAC decode">
      <p className="text-sm opacity-80">
        Encodes a synthetic 16-bit stereo signal to FLAC in the browser, then decodes it with
        decodeAudioData and checks length and samples are exact (3 s and 30 s).
      </p>
      <div>
        <button
          type="button"
          className={button}
          disabled={busy}
          data-testid="run-flac"
          onClick={async () => {
            setBusy(true);
            try {
              setRows(await runFlac([3, 30], () => {}));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Decoding…' : 'Run FLAC test'}
        </button>
      </div>
      {rows.length > 0 && <MarkdownView markdown={flacMarkdown(rows)} />}
    </Section>
  );
}
