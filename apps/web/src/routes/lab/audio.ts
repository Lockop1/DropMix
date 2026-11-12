/**
 * Lab-only Web Audio code (throwaway spike; the real engine is Phase 1 task 1C).
 *
 * Timing rules still apply: every start/stop/switch is scheduled on AudioContext time on a bar
 * grid with ≥ 5 ms gain fades. setTimeout/setInterval are used only to refresh UI readouts.
 */

import { AUDIO_TUNING, createRealtimeStretchLoop, type LiveLoadResult } from '@stemdeck/audio';

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

let sharedContext: AudioContext | null = null;

export function getContext(): AudioContext | null {
  return sharedContext;
}

/**
 * Call from a tap. Creates/resumes the context, plays one silent buffer (iOS unlock) and asks
 * for the 'playback' audio session so the iOS silent switch does not mute the lab.
 */
export async function unlockAudio(): Promise<AudioContext> {
  const nav = navigator as Navigator & AudioSessionNavigator;
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // Not settable on this browser; ignore.
    }
  }
  sharedContext ??= new AudioContext({ latencyHint: 'interactive' });
  const ctx = sharedContext;
  const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = silent;
  src.connect(ctx.destination);
  src.start();
  await ctx.resume();
  return ctx;
}

export function toAudioBuffer(ctx: BaseAudioContext, channels: Float32Array[], sampleRate: number) {
  const buf = ctx.createBuffer(channels.length, channels[0]?.length ?? 1, sampleRate);
  for (const [c, ch] of channels.entries()) buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c);
  return buf;
}

const FADE = AUDIO_TUNING.fadeSec;
const STOP_AFTER = AUDIO_TUNING.stopAfterSec;
const AHEAD = AUDIO_TUNING.scheduleAheadSec;

/** A playable loop: a buffer of exactly `bars` bars at `bpm`, or a realtime stretch voice. */
export type LoopVariant =
  | { kind: 'buffer'; id: string; label: string; buffer: AudioBuffer; bpm: number; bars: number }
  | {
      kind: 'realtime';
      id: string;
      label: string;
      /** Source channels (handles included) and where the body sits, in seconds. */
      channels: Float32Array[];
      loopStartSec: number;
      loopEndSec: number;
      rate: number;
      semitones: number;
      formant: boolean;
      bpm: number;
      bars: number;
    };

interface Voice {
  variant: LoopVariant;
  gain: GainNode;
  stop(at: number): void;
}

/**
 * A/B player: one variant at a time, switching on the next bar boundary of the current grid.
 * The grid re-anchors at the switch so the bar count stays continuous across tempo changes
 * (original at native tempo vs renders at master tempo).
 */
export class ABPlayer {
  private voice: Voice | null = null;
  private anchor = 0;
  private barSec = 2;
  private bars = 4;
  /** Bar index (within the loop) at `anchor`. */
  private anchorBar = 0;

  constructor(private readonly ctx: AudioContext) {}

  get playingId(): string | null {
    return this.voice?.variant.id ?? null;
  }

  /** Context time of the next bar boundary at least `AHEAD` from now. */
  nextBarTime(): number {
    const earliest = this.ctx.currentTime + AHEAD;
    if (!this.voice) return earliest;
    const k = Math.ceil((earliest - this.anchor) / this.barSec);
    return this.anchor + k * this.barSec;
  }

  async play(variant: LoopVariant): Promise<number> {
    const at = this.nextBarTime();
    const barIndex = this.voice
      ? (this.anchorBar + Math.round((at - this.anchor) / this.barSec)) % this.bars
      : 0;
    const newBarSec = (4 * 60) / variant.bpm;
    const voice = await this.startVoice(variant, at, barIndex, newBarSec);
    this.voice?.stop(at);
    this.voice = voice;
    this.anchor = at;
    this.anchorBar = barIndex;
    this.barSec = newBarSec;
    this.bars = variant.bars;
    return at;
  }

  stop(): void {
    if (!this.voice) return;
    this.voice.stop(this.ctx.currentTime + 0.02);
    this.voice = null;
  }

  private async startVoice(
    variant: LoopVariant,
    at: number,
    barIndex: number,
    barSec: number,
  ): Promise<Voice> {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + FADE);
    gain.connect(ctx.destination);
    const fadeOut = (t: number) => {
      // Level at t: fully up once the fade-in has finished, else still silent (a switch
      // before this voice ever sounded).
      const level = t >= at + FADE ? 1 : 0;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(level, t);
      gain.gain.linearRampToValueAtTime(0, t + FADE);
    };
    if (variant.kind === 'buffer') {
      const src = ctx.createBufferSource();
      src.buffer = variant.buffer;
      src.loop = true;
      src.connect(gain);
      src.start(at, (barIndex * barSec) % variant.buffer.duration);
      return {
        variant,
        gain,
        stop: (t) => {
          fadeOut(t);
          src.stop(t + STOP_AFTER);
          src.onended = () => gain.disconnect();
        },
      };
    }
    const rt = await createRealtimeStretchLoop(ctx, variant.channels, {
      rate: variant.rate,
      semitones: variant.semitones,
      formant: variant.formant,
      loopStartSec: variant.loopStartSec,
      loopEndSec: variant.loopEndSec,
    });
    rt.node.connect(gain);
    // The node schedules input positions: bar `barIndex` of the body, in source seconds.
    const sourceBarSec = (variant.loopEndSec - variant.loopStartSec) / variant.bars;
    await rt.node.schedule({
      active: true,
      output: at,
      input: variant.loopStartSec + barIndex * sourceBarSec,
      rate: variant.rate,
      semitones: variant.semitones,
      formantCompensation: variant.formant,
      loopStart: variant.loopStartSec,
      loopEnd: variant.loopEndSec,
    });
    return {
      variant,
      gain,
      stop: (t) => {
        fadeOut(t);
        void rt.stop(t + STOP_AFTER).then(() => {
          // Disconnect once silent (UI-side cleanup, not audio timing).
          setTimeout(() => {
            rt.node.disconnect();
            gain.disconnect();
          }, 500);
        });
      },
    };
  }
}

/** Live load reading from whichever API this browser has. */
export class LoadMonitor {
  private readonly cap: AudioRenderCapacityLike | null;
  private readonly stats: AudioPlaybackStatsLike | null;
  private samples: { avg: number; peak: number; underrun: number }[] = [];
  private startStats: { events: number; duration: number } | null = null;
  private startedAt = 0;
  private listener: ((e: Event) => void) | null = null;

  constructor(private readonly ctx: AudioContext) {
    const c = ctx as AudioContext & {
      renderCapacity?: AudioRenderCapacityLike;
      playbackStats?: AudioPlaybackStatsLike;
    };
    this.cap = c.renderCapacity ?? null;
    this.stats = c.playbackStats ?? null;
  }

  get source(): string {
    return this.cap ? 'renderCapacity' : this.stats ? 'playbackStats' : 'none';
  }

  start(): void {
    this.samples = [];
    this.startedAt = this.ctx.currentTime;
    if (this.cap) {
      this.listener = (e: Event) => {
        const u = e as Event & { averageLoad: number; peakLoad: number; underrunRatio: number };
        this.samples.push({ avg: u.averageLoad, peak: u.peakLoad, underrun: u.underrunRatio });
      };
      this.cap.addEventListener('update', this.listener);
      this.cap.start({ updateInterval: 1 });
    }
    if (this.stats) {
      this.startStats = {
        events: this.stats.underrunEvents ?? 0,
        duration: this.stats.totalDuration ?? 0,
      };
    }
  }

  read(mode: 'plain' | 'stretch', voices: number): LiveLoadResult {
    const seconds = this.ctx.currentTime - this.startedAt;
    const r: LiveLoadResult = {
      mode,
      voices,
      seconds,
      source: this.source,
      averageLoad: null,
      peakLoad: null,
      underrunRatio: null,
      underruns: null,
    };
    if (this.samples.length) {
      r.averageLoad = this.samples.reduce((a, s) => a + s.avg, 0) / this.samples.length;
      r.peakLoad = Math.max(...this.samples.map((s) => s.peak));
      r.underrunRatio = Math.max(...this.samples.map((s) => s.underrun));
    }
    if (this.stats && this.startStats) {
      r.underruns = (this.stats.underrunEvents ?? 0) - this.startStats.events;
    }
    return r;
  }

  stop(): void {
    if (this.cap) {
      this.cap.stop();
      if (this.listener) this.cap.removeEventListener('update', this.listener);
    }
  }
}

interface AudioRenderCapacityLike extends EventTarget {
  start(options?: { updateInterval?: number }): void;
  stop(): void;
}

interface AudioPlaybackStatsLike {
  underrunEvents?: number;
  underrunDuration?: number;
  totalDuration?: number;
}

/** "5 loops" stress test: N voices at once, plain buffers or realtime stretch nodes. */
export class StressPlayer {
  private stops: ((t: number) => void)[] = [];

  constructor(private readonly ctx: AudioContext) {}

  get playing(): boolean {
    return this.stops.length > 0;
  }

  async start(voices: LoopVariant[]): Promise<void> {
    this.stop();
    const ctx = this.ctx;
    const at = ctx.currentTime + AHEAD + 0.1;
    const master = ctx.createGain();
    master.gain.value = 1 / Math.sqrt(Math.max(1, voices.length));
    master.connect(ctx.destination);
    for (const v of voices) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + FADE);
      gain.connect(master);
      if (v.kind === 'buffer') {
        const src = ctx.createBufferSource();
        src.buffer = v.buffer;
        src.loop = true;
        src.connect(gain);
        src.start(at);
        this.stops.push((t) => {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(1, t);
          gain.gain.linearRampToValueAtTime(0, t + FADE);
          src.stop(t + STOP_AFTER);
        });
      } else {
        const rt = await createRealtimeStretchLoop(ctx, v.channels, {
          rate: v.rate,
          semitones: v.semitones,
          formant: v.formant,
          loopStartSec: v.loopStartSec,
          loopEndSec: v.loopEndSec,
        });
        rt.node.connect(gain);
        await rt.start(at);
        this.stops.push((t) => {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(1, t);
          gain.gain.linearRampToValueAtTime(0, t + FADE);
          void rt.stop(t + STOP_AFTER);
        });
      }
    }
  }

  stop(): void {
    const t = this.ctx.currentTime + 0.02;
    for (const s of this.stops) s(t);
    this.stops = [];
  }
}
