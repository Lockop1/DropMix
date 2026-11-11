/**
 * @stemdeck/protocol — room protocol v1 (owned by the orchestrator).
 *
 * Every message on the room WebSocket is JSON and is validated with these schemas on both ends.
 * Only text metadata crosses the network: never audio, never art.
 * Spec: docs/BUILD_PROMPT.md §10.3. Human-readable notes: docs/PROTOCOL.md.
 *
 * STATUS: draft. Phase 0 uses hello/welcome/ping/pong only (rooms spike). The lobby and view
 * messages are frozen in Phase 3 (task 3B); until then they may change without a version bump.
 */

import type {
  BoardState,
  CardInstance,
  ClientView,
  Intent,
  MasterState,
  PlayerSeat,
  PrivateView,
  PublicView,
  RejectCode,
  SlotState,
} from '@stemdeck/engine';
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Limits (mirrored in docs/ARCHITECTURE.md)
// ---------------------------------------------------------------------------

/** Room codes: 4 letters, no I / L / O (they read as 1 and 0). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export const LIMITS = {
  /** Messages per second per connection. */
  rateLimitPerSecond: 20,
  /** Largest accepted WebSocket frame, in bytes. */
  maxMessageBytes: 64 * 1024,
  nameMax: 20,
  /** Cards per host.catalog chunk. */
  catalogChunk: 200,
  /** Largest catalog a host may upload. */
  catalogMaxCards: 4000,
  /** Largest deck a player may submit. */
  deckMaxCards: 120,
  /** Host + 7 players. */
  maxPlayers: 8,
  /** Room expires after this long idle. */
  idleExpiryMs: 30 * 60 * 1000,
} as const;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(128);
const text = z.string().max(300);
const role = z.enum(['lead', 'loop', 'beat', 'bass']);
const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const cardKind = z.enum(['lead', 'loop', 'beat', 'bass', 'wild', 'fx']);
const slotIndex = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const pcs = z.number().int().min(0).max(11);
const modeId = z.enum(['freestyle', 'jam', 'clash', 'party', 'puzzle']);

export const roomCodeSchema = z.string().regex(ROOM_CODE_REGEX);
export const playerNameSchema = z.string().trim().min(1).max(LIMITS.nameMax);
export const avatarSchema = z.string().min(1).max(24);
export const tokenSchema = z.string().min(16).max(128);

/** The only card fields that may cross the network. */
export const catalogCardSchema = z.strictObject({
  cardId: id,
  kind: cardKind,
  level,
  title: text,
  artist: text,
  playlist: id.optional(),
});
export type CatalogCard = z.infer<typeof catalogCardSchema>;

export const intentSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('card.play'),
    cardId: id,
    slot: slotIndex,
    instanceId: id.optional(),
  }),
  z.strictObject({ type: z.literal('slot.pop'), slot: slotIndex }),
  z.strictObject({ type: z.literal('slot.clear'), slot: slotIndex }),
  z.strictObject({ type: z.literal('board.clear') }),
  z.strictObject({
    type: z.literal('master.set'),
    bpm: z.number().min(30).max(300).optional(),
    pcs: pcs.optional(),
  }),
  z.strictObject({ type: z.literal('master.remix') }),
  z.strictObject({ type: z.literal('settings.set'), respectSlotRoles: z.boolean() }),
]) satisfies z.ZodType<Intent>;

export const rejectCodeSchema = z.enum([
  'bad_intent',
  'unknown_card',
  'not_in_hand',
  'illegal_slot',
  'level_too_low',
  'duplicate_on_board',
  'slot_blocked',
  'slot_empty',
  'stack_full',
  'no_master',
  'not_your_turn',
  'not_host',
  'cooldown',
  'game_over',
  'not_supported',
]) satisfies z.ZodType<RejectCode>;

export const cardInstanceSchema = z.strictObject({
  instanceId: id,
  cardId: id,
  ownerId: id.nullable(),
}) satisfies z.ZodType<CardInstance>;

export const slotStateSchema = z.strictObject({
  index: slotIndex,
  accepts: z.array(role).min(1).max(4),
  stack: z.array(cardInstanceSchema).max(64),
  activeRole: role.nullable(),
  blocks: z
    .array(z.strictObject({ roles: z.array(role).max(4), untilTurn: z.number().int() }))
    .max(16),
}) satisfies z.ZodType<SlotState>;

export const masterStateSchema = z.strictObject({
  bpm: z.number().min(30).max(300),
  pcs,
  setBy: z.strictObject({
    reason: z.enum(['first', 'wild', 'remix', 'manual']),
    cardId: id.optional(),
  }),
}) satisfies z.ZodType<MasterState>;

export const boardStateSchema = z.strictObject({
  slots: z.array(slotStateSchema).length(5),
  master: masterStateSchema.nullable(),
}) satisfies z.ZodType<BoardState>;

export const playerSeatSchema = z.strictObject({
  playerId: id,
  name: playerNameSchema,
  avatar: avatarSchema,
  isHost: z.boolean(),
  team: z.number().int().min(0).max(3).nullable(),
}) satisfies z.ZodType<PlayerSeat>;

export const publicViewSchema = z.strictObject({
  modeId,
  phase: z.enum(['lobby', 'playing', 'results']),
  board: boardStateSchema,
  players: z.array(playerSeatSchema).max(LIMITS.maxPlayers),
  mode: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('freestyle'), respectSlotRoles: z.boolean() }),
  ]),
}) satisfies z.ZodType<PublicView>;

export const privateViewSchema = z.strictObject({
  playerId: id,
  hand: z.array(cardInstanceSchema).max(32),
}) satisfies z.ZodType<PrivateView>;

export const clientViewSchema = z.strictObject({
  seq: z.number().int().min(0),
  public: publicViewSchema,
  private: privateViewSchema.nullable(),
}) satisfies z.ZodType<ClientView>;

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export const helloSchema = z.strictObject({
  t: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  code: roomCodeSchema,
  role: z.enum(['host', 'player']),
  name: playerNameSchema.optional(),
  avatar: avatarSchema.optional(),
  /** Keeps the same seat across a refresh. The host's token is the host token. */
  resumeToken: tokenSchema.optional(),
});

export const hostCatalogSchema = z.strictObject({
  t: z.literal('host.catalog'),
  packId: id,
  /** Chunk index, 0-based, and the total chunk count. */
  chunk: z.number().int().min(0),
  chunks: z.number().int().min(1),
  cards: z.array(catalogCardSchema).max(LIMITS.catalogChunk),
});

export const lobbySettingsSchema = z.strictObject({
  t: z.literal('lobby.settings'),
  mode: modeId,
  /** Mode config, validated by the mode's own schema server-side. */
  cfg: z.record(z.string().max(40), z.json()),
});

export const lobbyDeckSchema = z.strictObject({
  t: z.literal('lobby.deck'),
  source: z.enum(['playlist', 'random', 'custom']),
  playlistId: id.optional(),
  cardIds: z.array(id).max(LIMITS.deckMaxCards).optional(),
});

export const lobbyReadySchema = z.strictObject({ t: z.literal('lobby.ready'), ready: z.boolean() });
export const lobbyStartSchema = z.strictObject({ t: z.literal('lobby.start') });

export const intentMessageSchema = z.strictObject({
  t: z.literal('intent'),
  /** Client-generated; intents are idempotent by intentId. */
  intentId: id,
  intent: intentSchema,
});

/** Ask for a fresh full view (after a seq gap). */
export const viewRequestSchema = z.strictObject({ t: z.literal('view.request') });

export const pingSchema = z.strictObject({ t: z.literal('ping'), time: z.number() });

export const clientMessageSchema = z.discriminatedUnion('t', [
  helloSchema,
  hostCatalogSchema,
  lobbySettingsSchema,
  lobbyDeckSchema,
  lobbyReadySchema,
  lobbyStartSchema,
  intentMessageSchema,
  viewRequestSchema,
  pingSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const errorCodeSchema = z.enum([
  'bad_message',
  'unsupported_version',
  'room_not_found',
  'room_full',
  'rate_limited',
  'not_host',
  'wrong_phase',
  'too_large',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const welcomeSchema = z.strictObject({
  t: z.literal('welcome'),
  v: z.literal(PROTOCOL_VERSION),
  playerId: id,
  resumeToken: tokenSchema,
  serverTime: z.number(),
});

export const viewMessageSchema = z.strictObject({
  t: z.literal('view'),
  seq: z.number().int().min(0),
  public: publicViewSchema,
  /** Present only for the recipient's own seat. Never another player's. */
  private: privateViewSchema.optional(),
});

export const ackSchema = z.strictObject({ t: z.literal('ack'), intentId: id });

export const rejectSchema = z.strictObject({
  t: z.literal('reject'),
  intentId: id,
  code: rejectCodeSchema,
  message: text,
});

export const pongSchema = z.strictObject({
  t: z.literal('pong'),
  /** Echo of ping.time. */
  time: z.number(),
  serverTime: z.number(),
});

export const errorSchema = z.strictObject({
  t: z.literal('error'),
  code: errorCodeSchema,
  message: text.optional(),
});

export const serverMessageSchema = z.discriminatedUnion('t', [
  welcomeSchema,
  viewMessageSchema,
  ackSchema,
  rejectSchema,
  pongSchema,
  errorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
