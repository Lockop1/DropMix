/**
 * Pure room logic for the rooms spike: seats, resume tokens, host claim, capacity and tap
 * counting. No I/O, no clock, no randomness of its own: the Durable Object passes `now` and an
 * id source in, persists the returned record and sends the returned messages.
 *
 * The record (with tokens) never leaves the server. Clients only ever see `toSpikeState`, which
 * picks public fields one by one.
 */

import {
  avatarSchema,
  type ErrorCode,
  LIMITS,
  playerNameSchema,
  roomCodeSchema,
  tokenSchema,
} from '@stemdeck/protocol';
import { type SpikeState, type SpikeTap, spikeLastTapSchema } from '@stemdeck/protocol/spike';
import { z } from 'zod';
import { generatePlayerId, generateToken, type RandomBytes, tokensEqual } from './ids';

const seatSchema = z.strictObject({
  playerId: z.string().min(1).max(128),
  token: tokenSchema,
  name: playerNameSchema,
  avatar: avatarSchema,
  taps: z.number().int().min(0),
});
export type Seat = z.infer<typeof seatSchema>;

/** What the Durable Object stores under the `room` key. Validated again on every load. */
export const roomRecordSchema = z.strictObject({
  v: z.literal(1),
  code: roomCodeSchema,
  createdAt: z.number(),
  seq: z.number().int().min(0),
  host: z.strictObject({ playerId: z.string().min(1).max(128), token: tokenSchema }).nullable(),
  players: z.array(seatSchema).max(LIMITS.maxPlayers - 1),
  lastTap: spikeLastTapSchema.optional(),
});
export type RoomRecord = z.infer<typeof roomRecordSchema>;

/** Players may hold at most this many seats (the host holds the other one). */
export const MAX_PLAYER_SEATS = LIMITS.maxPlayers - 1;

export const DEFAULT_AVATAR = 'dot';

export function newRoom(code: string, now: number): RoomRecord {
  return { v: 1, code, createdAt: now, seq: 0, host: null, players: [] };
}

export type Role = 'host' | 'player';

export interface HelloInput {
  code: string;
  role: Role;
  name?: string | undefined;
  avatar?: string | undefined;
  resumeToken?: string | undefined;
}

export type Failure = { ok: false; code: ErrorCode; message: string };

export type HelloOutcome =
  | {
      ok: true;
      room: RoomRecord;
      seat: { playerId: string; role: Role; resumeToken: string };
      /** True when an existing seat was reclaimed with its token. */
      resumed: boolean;
    }
  | Failure;

/**
 * Seats a client. Host: the first host hello claims the host seat; later ones need the host
 * token. Player: a valid token reclaims its seat (same id, name and taps); anything else takes a
 * new seat if one is free.
 */
export function applyHello(
  room: RoomRecord,
  hello: HelloInput,
  random?: RandomBytes,
): HelloOutcome {
  if (hello.code !== room.code) {
    return { ok: false, code: 'bad_message', message: 'hello is for a different room' };
  }

  if (hello.role === 'host') {
    if (room.host === null) {
      const host = { playerId: generatePlayerId('host', random), token: generateToken(random) };
      return {
        ok: true,
        room: { ...room, host },
        seat: { playerId: host.playerId, role: 'host', resumeToken: host.token },
        resumed: false,
      };
    }
    if (hello.resumeToken !== undefined && tokensEqual(hello.resumeToken, room.host.token)) {
      return {
        ok: true,
        room,
        seat: { playerId: room.host.playerId, role: 'host', resumeToken: room.host.token },
        resumed: true,
      };
    }
    return { ok: false, code: 'not_host', message: 'this room already has a host' };
  }

  const token = hello.resumeToken;
  if (token !== undefined) {
    const seat = room.players.find((p) => tokensEqual(token, p.token));
    if (seat) {
      return {
        ok: true,
        room,
        seat: { playerId: seat.playerId, role: 'player', resumeToken: seat.token },
        resumed: true,
      };
    }
  }

  if (room.players.length >= MAX_PLAYER_SEATS) {
    return {
      ok: false,
      code: 'room_full',
      message: `rooms hold the host and ${MAX_PLAYER_SEATS} players`,
    };
  }
  const seat: Seat = {
    playerId: generatePlayerId('player', random),
    token: generateToken(random),
    name: hello.name ?? `Player ${room.players.length + 1}`,
    avatar: hello.avatar ?? DEFAULT_AVATAR,
    taps: 0,
  };
  return {
    ok: true,
    room: { ...room, players: [...room.players, seat] },
    seat: { playerId: seat.playerId, role: 'player', resumeToken: seat.token },
    resumed: false,
  };
}

export type TapOutcome = { ok: true; room: RoomRecord } | Failure;

/** Counts one tap. The server is authoritative: the count is never read from the client. */
export function applyTap(
  room: RoomRecord,
  playerId: string,
  tap: Pick<SpikeTap, 'tapId' | 'sentAt'>,
  serverTime: number,
): TapOutcome {
  const index = room.players.findIndex((p) => p.playerId === playerId);
  const seat = room.players[index];
  if (!seat) {
    return { ok: false, code: 'bad_message', message: 'only seated players can tap' };
  }
  const players = room.players.slice();
  players[index] = { ...seat, taps: seat.taps + 1 };
  return {
    ok: true,
    room: {
      ...room,
      players,
      lastTap: { playerId, tapId: tap.tapId, sentAt: tap.sentAt, serverTime },
    },
  };
}

/** Advances `seq`. Called once per broadcast, so every broadcast state has a fresh seq. */
export function bumpSeq(room: RoomRecord): RoomRecord {
  return { ...room, seq: room.seq + 1 };
}

export interface Presence {
  hostConnected: boolean;
  connectedPlayerIds: ReadonlySet<string>;
}

/** The public view of the room. Picks fields explicitly: tokens can never be copied across. */
export function toSpikeState(room: RoomRecord, presence: Presence): SpikeState {
  const state: SpikeState = {
    t: 'spike.state',
    seq: room.seq,
    players: room.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      connected: presence.connectedPlayerIds.has(p.playerId),
      taps: p.taps,
    })),
    host: { connected: presence.hostConnected },
  };
  if (room.lastTap) {
    const { playerId, tapId, sentAt, serverTime } = room.lastTap;
    state.lastTap = { playerId, tapId, sentAt, serverTime };
  }
  return state;
}

/** Parses a stored record; `null` for missing or unreadable data. */
export function parseRoomRecord(raw: unknown): RoomRecord | null {
  if (raw === undefined || raw === null) return null;
  const parsed = roomRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
