/**
 * @stemdeck/engine — contracts (owned by the orchestrator).
 *
 * Game rules live only in this package, as pure deterministic functions:
 * seeded RNG in state; no Math.random, Date.now, timers or I/O.
 * The rooms server and LocalRoom both call the same engine.
 * Spec: docs/BUILD_PROMPT.md §5.3, §6, §9, §11.
 */

import type { Pcs, Role } from '@stemdeck/harmony';

export type { Role } from '@stemdeck/harmony';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type PlayerId = string;
export type CardKind = Role | 'wild' | 'fx';
export type Level = 1 | 2 | 3;

/** Original procedural FX sound presets (§8.5). */
export type FxSoundPresetId = 'riser' | 'downlifter' | 'stutter' | 'siren' | 'subdrop' | 'stab';

export type FxCondition =
  | { type: 'slotEmpty' }
  | { type: 'playedOverRole'; role: Role }
  | { type: 'controls'; roles: Role[] }
  | { type: 'sameSongPair' };

export type FxAction =
  | { type: 'points'; target: 'self' | 'opponents' | 'all'; amount: number }
  | { type: 'extraMove' }
  | { type: 'draw'; count: number }
  | { type: 'reshuffleHand' }
  | { type: 'clear'; owner: 'opponents' | 'any'; roles?: Role[]; maxLevel?: Level }
  | { type: 'block'; roles: Role[]; turns: number }
  | { type: 'stealTop'; slot: 'chosen' };

export interface FxSpec {
  id: string;
  name: string;
  text: string;
  conditions: FxCondition[];
  actions: FxAction[];
  sound: FxSoundPresetId;
}

/**
 * A card definition. Song cards (`lead`/`loop`/`beat`/`bass`/`wild`) have a songId;
 * `fx` cards have `songId: null` and an `fx` spec.
 */
export interface CardDef {
  cardId: string;
  songId: string | null;
  kind: CardKind;
  level: Level;
  title: string;
  artist: string;
  playlist?: string;
  fx?: FxSpec;
}

/** One physical copy of a card in play. `ownerId` is null in solo Freestyle. */
export interface CardInstance {
  instanceId: string;
  cardId: string;
  ownerId: PlayerId | null;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type SlotIndex = 0 | 1 | 2 | 3 | 4;

export interface SlotState {
  index: SlotIndex;
  accepts: Role[];
  /** Bottom → top. Only the last card sounds. */
  stack: CardInstance[];
  /**
   * The role the top card sounds as. For a role card it is the card's role. For a wild it is the
   * role resolved when it was played (§6.2) and it does not change afterwards. Null when the slot
   * is empty or its top card is an FX card.
   */
  activeRole: Role | null;
  blocks: { roles: Role[]; untilTurn: number }[];
}

export interface MasterState {
  bpm: number;
  /** 0–11 */
  pcs: Pcs;
  setBy: { reason: 'first' | 'wild' | 'remix' | 'manual'; cardId?: string };
}

export interface BoardState {
  slots: SlotState[];
  master: MasterState | null;
}

export interface BoardConfig {
  slots: { accepts: Role[] }[];
  stackLimit: number;
}

/** §6.2 defaults. */
export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  slots: [
    { accepts: ['bass', 'beat'] },
    { accepts: ['beat'] },
    { accepts: ['beat', 'loop'] },
    { accepts: ['loop'] },
    { accepts: ['loop', 'lead'] },
  ],
  stackLimit: 10,
};

// ---------------------------------------------------------------------------
// Catalog as the engine sees it
// ---------------------------------------------------------------------------

/**
 * The musical facts the engine needs to set the master when a first card or a wild lands.
 * `bpm` is the song's native BPM (unfolded); the engine folds it with @stemdeck/harmony.
 * See docs/decisions/0003-engine-catalog-song-facts.md.
 */
export interface SongFacts {
  bpm: number;
  pcs: Pcs;
}

/** Plain-data, serializable card catalog. Built from a pack by @stemdeck/pack. */
export interface EngineCatalog {
  cards: Record<string, CardDef>;
  /** Keyed by songId. Every song card's songId must be present. */
  songs: Record<string, SongFacts>;
  /**
   * Which roles each song actually has a stem for. A wild needs all four. A role card whose stem
   * is missing is rejected with `unknown_card`.
   */
  songRoles: Record<string, Role[]>;
}

// ---------------------------------------------------------------------------
// Players, intents, events
// ---------------------------------------------------------------------------

export interface PlayerSeat {
  playerId: PlayerId;
  name: string;
  /** Avatar glyph id (original art). */
  avatar: string;
  isHost: boolean;
  /** Team index for team modes; null otherwise. */
  team: number | null;
}

export type ModeId = 'freestyle' | 'jam' | 'clash' | 'party' | 'puzzle';

/**
 * What a client asks for. Clients send intents only; the engine validates and applies them.
 * Phase 1 defines the Freestyle set. Later phases extend this union (never repurpose a type).
 */
export type Intent =
  /**
   * Play a card onto a slot. In Freestyle the card comes straight from the library (`cardId`).
   * In hand-based modes `instanceId` names the card in the actor's hand and is required.
   */
  | { type: 'card.play'; cardId: string; slot: SlotIndex; instanceId?: string }
  /** Remove the top card of a slot (Freestyle). */
  | { type: 'slot.pop'; slot: SlotIndex }
  /** Remove every card of a slot (Freestyle). */
  | { type: 'slot.clear'; slot: SlotIndex }
  /** Remove every card and reset the master to null (Freestyle). */
  | { type: 'board.clear' }
  /** Set master tempo and/or key by hand (Freestyle; host only in Jam). */
  | { type: 'master.set'; bpm?: number; pcs?: Pcs }
  /** Randomize master tempo + key from the seeded RNG (Freestyle Remix button). */
  | { type: 'master.remix' }
  /** Freestyle "respect slot roles" toggle. */
  | { type: 'settings.set'; respectSlotRoles: boolean };

export type IntentType = Intent['type'];

export type RejectCode =
  | 'bad_intent'
  | 'unknown_card'
  | 'not_in_hand'
  | 'illegal_slot'
  | 'level_too_low'
  | 'duplicate_on_board'
  | 'slot_blocked'
  | 'slot_empty'
  | 'stack_full'
  | 'no_master'
  | 'not_your_turn'
  | 'not_host'
  | 'cooldown'
  | 'game_over'
  | 'not_supported';

export type IntentResult = { ok: true } | { ok: false; code: RejectCode; message: string };

/** Things that happened, for UI animation and audio one-shots. Never the source of truth. */
export type GameEvent =
  | {
      type: 'card.played';
      slot: SlotIndex;
      instance: CardInstance;
      by: PlayerId;
      activeRole: Role | null;
    }
  | { type: 'card.removed'; slot: SlotIndex; instance: CardInstance; by: PlayerId | null }
  | { type: 'slot.cleared'; slot: SlotIndex; by: PlayerId | null }
  | { type: 'board.cleared'; by: PlayerId | null }
  | { type: 'master.changed'; master: MasterState | null }
  | { type: 'settings.changed'; respectSlotRoles: boolean };

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type RoomPhase = 'lobby' | 'playing' | 'results';

/** Freestyle's public mode state. Other modes add their own variants to ModePublic. */
export interface FreestylePublic {
  mode: 'freestyle';
  respectSlotRoles: boolean;
}

export type ModePublic = FreestylePublic;

/** Everything every participant may see. Must never contain hands or decks. */
export interface PublicView {
  modeId: ModeId;
  phase: RoomPhase;
  board: BoardState;
  players: PlayerSeat[];
  mode: ModePublic;
}

/** What only one player may see. Must never contain another player's cards. */
export interface PrivateView {
  playerId: PlayerId;
  hand: CardInstance[];
}

export interface ClientView {
  /** Monotonic per room. LocalRoom increments it on every applied intent. */
  seq: number;
  public: PublicView;
  private: PrivateView | null;
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/** xoshiro128** state: four uint32 words. Lives inside mode state so replays are exact. */
export type RngState = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Game modes
// ---------------------------------------------------------------------------

export interface TickCtx {
  /** Milliseconds, supplied by the caller (server clock or LocalRoom). The engine never reads a clock. */
  now: number;
}

export interface GameMode<S, Cfg> {
  id: ModeId;
  setup(cfg: Cfg, players: PlayerSeat[], seed: number): S;
  validate(s: S, actor: PlayerId, intent: Intent): IntentResult;
  /** Precondition: validate(s, actor, intent).ok. Must not mutate `s`. */
  apply(s: S, actor: PlayerId, intent: Intent, ctx: TickCtx): { state: S; events: GameEvent[] };
  /** Advance timers. Must not mutate `s`. */
  tick(s: S, ctx: TickCtx): { state: S; events: GameEvent[] };
  publicView(s: S): PublicView;
  privateView(s: S, player: PlayerId): PrivateView;
  isOver(s: S): boolean;
}

export interface FreestyleConfig {
  catalog: EngineCatalog;
  board?: BoardConfig;
  /** Default true. */
  respectSlotRoles?: boolean;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** Implemented by LocalRoom (engine in the browser) and RemoteRoom (engine in the Room DO). */
export interface RoomClient {
  readonly self: { playerId: PlayerId; isHost: boolean };
  /** Public state + my private state. */
  getView(): ClientView;
  subscribe(fn: (view: ClientView, events: GameEvent[]) => void): () => void;
  /** Resolves on ack/reject. Never throws for a rule rejection. */
  send(intent: Intent): Promise<IntentResult>;
}

/** One applied intent, as recorded by LocalRoom for replay. */
export interface IntentLogEntry {
  actor: PlayerId;
  intent: Intent;
  now: number;
}

/** Replaying `entries` against setup(cfg, players, seed) reproduces the exact state. */
export interface IntentLog {
  modeId: ModeId;
  seed: number;
  players: PlayerSeat[];
  entries: IntentLogEntry[];
}
