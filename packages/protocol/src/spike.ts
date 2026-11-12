/**
 * SPIKE ONLY (task 0D, rooms spike). NOT part of protocol v1.
 *
 * Messages for the `/roomlab` latency/reconnect spike: a player taps, the server counts, everyone
 * sees the counts. Authorized by the orchestrator as a one-off file; it is deleted in Phase 3
 * when the real lobby/intent messages land. Nothing outside `apps/rooms` and
 * `apps/web/src/routes/roomlab` may import it.
 *
 * Imported as `@stemdeck/protocol/spike`. The v1 schemas in `./contracts` are reused unchanged;
 * the spike unions below add the two spike messages next to them.
 */

import { z } from 'zod';
import {
  avatarSchema,
  clientMessageSchema,
  LIMITS,
  playerNameSchema,
  serverMessageSchema,
} from './contracts';

const id = z.string().min(1).max(128);
const tapId = z.string().min(1).max(64);
const time = z.number();

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

/** A player taps. The server counts; the client never sends a count. */
export const spikeTapSchema = z.strictObject({
  t: z.literal('spike.tap'),
  /** Client-generated, unique per tap (lets the host page correlate a tap for latency). */
  tapId,
  /** Client wall-clock time (ms since epoch) when the tap was made. Informational only. */
  sentAt: time,
});
export type SpikeTap = z.infer<typeof spikeTapSchema>;

/** Everything a spike client may send: the v1 client messages plus `spike.tap`. */
export const spikeClientMessageSchema = z.discriminatedUnion('t', [
  ...clientMessageSchema.options,
  spikeTapSchema,
]);
export type SpikeClientMessage = z.infer<typeof spikeClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const spikePlayerSchema = z.strictObject({
  playerId: id,
  name: playerNameSchema,
  avatar: avatarSchema,
  connected: z.boolean(),
  taps: z.number().int().min(0),
});
export type SpikePlayer = z.infer<typeof spikePlayerSchema>;

export const spikeLastTapSchema = z.strictObject({
  playerId: id,
  tapId,
  sentAt: time,
  serverTime: time,
});
export type SpikeLastTap = z.infer<typeof spikeLastTapSchema>;

/** The full room state, broadcast to everyone on every change. Never carries a resume token. */
export const spikeStateSchema = z.strictObject({
  t: z.literal('spike.state'),
  /** Monotonic per room, survives hibernation. */
  seq: z.number().int().min(0),
  players: z.array(spikePlayerSchema).max(LIMITS.maxPlayers - 1),
  host: z.strictObject({ connected: z.boolean() }),
  lastTap: spikeLastTapSchema.optional(),
});
export type SpikeState = z.infer<typeof spikeStateSchema>;

/** Everything a spike server may send: the v1 server messages plus `spike.state`. */
export const spikeServerMessageSchema = z.discriminatedUnion('t', [
  ...serverMessageSchema.options,
  spikeStateSchema,
]);
export type SpikeServerMessage = z.infer<typeof spikeServerMessageSchema>;
