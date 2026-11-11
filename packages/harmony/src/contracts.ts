/**
 * @stemdeck/harmony — contracts (owned by the orchestrator).
 *
 * All key/tempo/grid math in the project lives in this package and nowhere else.
 * Everything here is pure: no I/O, no time, no randomness, no runtime dependencies.
 * Spec: docs/BUILD_PROMPT.md §7.
 */

/** Card part type. `lead` = vocals, `loop` = melodic "other" stem, `beat` = drums, `bass` = bass. */
export type Role = 'lead' | 'loop' | 'beat' | 'bass';

export const ROLES: readonly Role[] = ['lead', 'loop', 'beat', 'bass'];

export type Mode = 'major' | 'minor';

/** A pitch class: integer 0–11 (C=0, C#=1 … B=11). */
export type PitchClass = number;

/**
 * PCS index: a key's 7-note set, named by its relative-major tonic (0–11).
 * C major and A minor both have PCS 0.
 */
export type Pcs = number;

export interface KeySig {
  tonic: PitchClass;
  mode: Mode;
}

/** Multiplier applied to a native BPM to treat it as half-time, as-is, or double-time. */
export type TempoFold = 0.5 | 1 | 2;

/** How often (in bars) a role may enter the mix. */
export type EntryEvery = 1 | 2 | 4;

/** Loop lengths in bars. */
export type LoopBars = 4 | 8 | 16;

// ---------------------------------------------------------------------------
// Tunable constants (mirrored in docs/ARCHITECTURE.md — change both together)
// ---------------------------------------------------------------------------

/** Global master-tempo range in BPM (inclusive). */
export const TEMPO_RANGE = { min: 90, max: 157 } as const;

/** Remix button range: BPM uniform in [min, max]. */
export const REMIX_BPM_RANGE = { min: 95, max: 140 } as const;

/** Transposition range in semitones (inclusive). */
export const TRANSPOSE_RANGE = { min: -6, max: 5 } as const;

/** A lead shifted by more than this many semitones (absolute) still plays but is flagged strained. */
export const LEAD_SOFT_SHIFT_LIMIT = 4;

/**
 * Stretch-ratio limits. Ratio r = masterBpm / (nativeBpm · fold): r > 1 plays faster.
 * Outside the soft range a stem is flagged strained. Outside the hard range the next fold is used.
 */
export const STRETCH_LIMITS = {
  soft: {
    lead: { min: 0.85, max: 1.18 },
    loop: { min: 0.8, max: 1.25 },
    beat: { min: 0.8, max: 1.25 },
    bass: { min: 0.8, max: 1.25 },
  },
  hard: { min: 0.66, max: 1.5 },
} as const satisfies {
  soft: Record<Role, { min: number; max: number }>;
  hard: { min: number; max: number };
};

export const BEATS_PER_BAR = 4;
/** A phrase is 4 bars: the default boundary for big musical changes. */
export const PHRASE_BARS = 4;
/** The global cycle every loop is phase-locked to. */
export const CYCLE_BARS = 16;

/** Default entry quantization per role, in bars. */
export const DEFAULT_ENTRY_EVERY: Readonly<Record<Role, EntryEvery>> = {
  beat: 1,
  bass: 1,
  loop: 2,
  lead: 4,
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface Transposition {
  /** Semitones to shift the stem by, within TRANSPOSE_RANGE. Always 0 for `beat`. */
  semitones: number;
  /** Whether the shift must use formant preservation (true only for `lead` with a non-zero shift). */
  formant: boolean;
  /** True when a lead is shifted beyond LEAD_SOFT_SHIFT_LIMIT. */
  strained: boolean;
}

export interface FoldedTempo {
  /** The BPM after folding, clamped into TEMPO_RANGE. */
  bpm: number;
  /** The power-of-two multiplier that was applied to the native BPM (…, 0.25, 0.5, 1, 2, 4, …). */
  feel: number;
}

export interface StretchPlan {
  /** The fold applied to the stem's native BPM. */
  fold: TempoFold;
  /** r = masterBpm / (nativeBpm · fold). r > 1 plays the stem faster (shorter). */
  ratio: number;
  /** True when the ratio is outside the role's soft limits. */
  strained: boolean;
  /** True when no fold lands inside the hard cap (the closest fold is returned anyway). */
  outOfRange: boolean;
}

/** Everything the audio engine needs to render one stem against a master. */
export interface StemFit {
  transposition: Transposition;
  stretch: StretchPlan;
  /** transposition.strained || stretch.strained */
  strained: boolean;
}

// ---------------------------------------------------------------------------
// API (implemented in src/index.ts; every function is exported by name)
// ---------------------------------------------------------------------------

export interface HarmonyApi {
  /** `mode === 'major' ? tonic : (tonic + 3) % 12`. */
  pcs(key: KeySig): Pcs;

  /**
   * Base transposition of a stem to the master (§7.1).
   * d = (masterPcs − stemPcs) mod 12, mapped into −6…+5.
   * A raw distance of 6 is the ±6 tie: every role resolves it to −6 (the only in-range value),
   * which is also the "prefer downward" rule for `lead`.
   * `beat` always returns 0.
   */
  transpositionFor(args: { stemPcs: Pcs; masterPcs: Pcs; role: Role }): Transposition;

  /**
   * Fold a song's native BPM by a power of two into TEMPO_RANGE.
   * The range spans less than an octave, so some tempos (e.g. 85) have no in-range fold: choose
   * the power-of-two multiple with the smallest log-distance to the range (inside the range the
   * distance is 0; on a tie prefer the smaller multiplier), then clamp the result into the range.
   */
  foldTempo(nativeBpm: number): FoldedTempo;

  /**
   * Choose the fold f ∈ {½, 1, 2} minimizing |log(M / (native·f))|, then apply the hard cap:
   * if the best fold's ratio is outside STRETCH_LIMITS.hard, use the next-best fold that is inside.
   */
  stretchFor(args: { nativeBpm: number; masterBpm: number; role: Role }): StretchPlan;

  /** transpositionFor + stretchFor in one call. */
  fitStem(args: {
    stemPcs: Pcs;
    nativeBpm: number;
    role: Role;
    master: { bpm: number; pcs: Pcs };
  }): StemFit;

  /**
   * The first bar index b ≥ fromBar with b mod entryEvery === 0.
   * `fromBar` may be fractional (a position inside a bar); the result is an integer bar index.
   */
  entryBoundary(args: { fromBar: number; entryEvery: EntryEvery }): number;

  /** Phase-lock offset of a loop inside the global cycle: globalBar mod loopBars (≥ 0). */
  loopOffsetBars(globalBar: number, loopBars: LoopBars): number;

  /** Seconds per bar at a BPM: 4 · 60 / bpm. */
  barSeconds(bpm: number): number;

  /** Exact output length of a rendered loop: round(bars · 4 · 60 / bpm · sampleRate). */
  loopFrames(args: { bars: LoopBars; bpm: number; sampleRate: number }): number;

  /** Clamp a BPM into TEMPO_RANGE. */
  clampBpm(bpm: number): number;
}
