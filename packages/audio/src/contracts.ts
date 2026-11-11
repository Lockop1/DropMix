/**
 * @stemdeck/audio — contracts (owned by the orchestrator).
 *
 * The audio engine is a reconciler: the UI derives a DesiredMix from board state and calls
 * setDesired(); nothing outside this package touches Web Audio nodes.
 * Spec: docs/BUILD_PROMPT.md §8.
 */

import type { BoardState, FxSoundPresetId, Level, Role, SlotIndex } from '@stemdeck/engine';
import type { Catalog, PackHandle } from '@stemdeck/pack';

// ---------------------------------------------------------------------------
// Tunable constants (mirrored in docs/ARCHITECTURE.md — change both together)
// ---------------------------------------------------------------------------

/** Mix prominence per card level, in dB. */
export const LEVEL_GAIN_DB: Readonly<Record<Level, number>> = { 1: -5, 2: -2.5, 3: 0 };

export const AUDIO_TUNING = {
  /** Scheduler worker tick. */
  schedulerTickMs: 25,
  /** Everything is scheduled at least this far ahead on AudioContext time. */
  scheduleAheadSec: 0.15,
  /** Safety margin added to a render's ETA when choosing an entry boundary. */
  entryMarginSec: 0.1,
  /** Emit `cueing` when the entry boundary is more than this many bars away. */
  cueingBars: 2,
  /** Gain fade on every start/stop/swap. */
  fadeSec: 0.01,
  /** An outgoing source is stopped this long after its fade starts. */
  stopAfterSec: 0.03,
  /** Seam crossfade built from handle audio. */
  seamCrossfadeSec: 0.01,
  /** High-pass on every non-bass role. */
  nonBassHighpassHz: 120,
  /** Loop bus duck while a lead is active. */
  leadDucksLoopDb: -2,
  /** Render cache budgets. */
  cacheBytesDesktop: 256 * 1024 * 1024,
  cacheBytesMobile: 128 * 1024 * 1024,
  /** Render pool size is min(this, cores − 1), at least 1. */
  maxRenderWorkers: 3,
} as const;

// ---------------------------------------------------------------------------
// Desired mix (declarative input)
// ---------------------------------------------------------------------------

export interface DesiredStemSlot {
  slot: number;
  stemId: string;
  role: Role;
  levelGainDb: number;
  userGainDb: number;
  muted: boolean;
}

export interface DesiredFxSlot {
  slot: number;
  fxSound: FxSoundPresetId;
}

export type DesiredSlot = DesiredStemSlot | DesiredFxSlot | null;

export interface DesiredMix {
  master: { bpm: number; pcs: number } | null;
  /** One entry per board slot, in slot order. */
  slots: DesiredSlot[];
  /** Fire-once sounds. The engine plays each id at most once. */
  oneShots: { id: string; fxSound: FxSoundPresetId }[];
}

/** Per-slot user mix controls. Host-local UI state, not game state. */
export interface SlotMixSettings {
  userGainDb: number;
  muted: boolean;
}

export interface DeriveOpts {
  /** Per-slot user controls; missing slots default to 0 dB, unmuted. */
  slotMix?: Partial<Record<SlotIndex, SlotMixSettings>>;
  /** One-shots to carry through into the mix (from game events). */
  oneShots?: { id: string; fxSound: FxSoundPresetId }[];
  /** Override LEVEL_GAIN_DB. */
  levelGainDb?: Readonly<Record<Level, number>>;
}

/**
 * Pure. Implemented in src/derive.ts.
 * For each slot: empty → null; top card is fx → { fxSound }; otherwise the stem for
 * (card.songId, slot.activeRole) → a DesiredStemSlot. A top card whose stem cannot be found
 * yields null (never throws).
 */
export type DeriveDesiredMix = (
  board: BoardState,
  catalog: Catalog,
  opts?: DeriveOpts,
) => DesiredMix;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export type AudioEngineState = 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed';

export interface AudioEvents {
  /** A stem was accepted but its entry boundary is more than AUDIO_TUNING.cueingBars away. */
  cueing: { slot: number; stemId: string; entryBar: number; entryCtxTime: number };
  /** A stem (or slot FX loop) started sounding. */
  entered: { slot: number; stemId: string | null; bar: number; ctxTime: number };
  /** A slot's sound stopped. */
  left: { slot: number; stemId: string | null; bar: number; ctxTime: number };
  /** A stem is playing outside its soft stretch/shift limits. */
  strained: { slot: number; stemId: string; semitones: number; ratio: number };
  /** The audio thread could not keep up, or a render missed its boundary. */
  underrun: { reason: 'render-late' | 'context'; slot?: number };
  stateChange: { state: AudioEngineState };
}

export type AudioEventName = keyof AudioEvents;

export interface Transport {
  /** Current master BPM, or 0 when there is no master. */
  bpm(): number;
  /** Fractional bar position on the grid at an AudioContext time. */
  barAt(ctxTime: number): number;
  /** AudioContext time of the next bar boundary b with b mod everyBars === 0. */
  nextBoundary(everyBars: number): number;
}

export interface AudioEngine {
  /** Call from a user gesture. Resumes the context and plays a silent buffer (iOS). */
  unlock(): Promise<void>;
  /** Lazy decode on demand. Replaces any previously attached pack. */
  attachPack(pack: PackHandle): void;
  /** Declarative and idempotent: calling it twice with an equal mix does nothing. */
  setDesired(mix: DesiredMix): void;
  on<E extends AudioEventName>(e: E, cb: (p: AudioEvents[E]) => void): () => void;
  readonly transport: Transport;
  readonly state: AudioEngineState;
  /** Analyser-backed level per role, 0–1, for slot glow. Allocation-free. */
  roleLevel(role: Role): number;
  /** Phase 2, personal use. */
  exportMixWav?(bars: number): Promise<Blob>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stretcher (DSP backend; chosen by the Phase 0 audio spike)
// ---------------------------------------------------------------------------

export type StretcherId = 'signalsmith' | 'soundtouch' | 'rubberband';

export interface StretchRequest {
  /** Planar input, one Float32Array per channel, all the same length. Includes handle audio. */
  channels: Float32Array[];
  sampleRate: number;
  /** Tempo ratio r = masterBpm / (nativeBpm · fold). r > 1 → output is shorter. */
  ratio: number;
  /** Pitch shift in semitones, −6…+5. */
  semitones: number;
  /** Preserve formants (lead vocals). Backends without formant support ignore it and say so. */
  formant: boolean;
  /**
   * Exact number of output frames wanted for the whole input (handles included).
   * The backend must return exactly this many frames per channel.
   */
  outputFrames: number;
}

export interface StretchResult {
  channels: Float32Array[];
  /** Wall-clock milliseconds spent in DSP. */
  renderMs: number;
  /** False when `formant` was requested but the backend cannot do it. */
  formantApplied: boolean;
}

/**
 * Offline time-stretch + pitch-shift. Runs inside a Web Worker; never on the audio thread.
 * Must be deterministic: the same request yields the same samples.
 */
export interface Stretcher {
  readonly id: StretcherId;
  /** SPDX license id of the backend (e.g. 'MIT'). Non-permissive backends must be flag-gated. */
  readonly license: string;
  readonly supportsFormant: boolean;
  init(): Promise<void>;
  render(req: StretchRequest): Promise<StretchResult>;
  dispose(): void;
}
