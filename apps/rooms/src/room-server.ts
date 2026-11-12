/**
 * The Room Durable Object: one instance per room code, addressed with `idFromName(code)`.
 *
 * A thin adapter over the pure modules in `./logic`: it decodes frames, asks the room logic what
 * to do, persists the record to Durable Object storage after every change and sends the result.
 * WebSocket hibernation is on (partyserver's `hibernate: true`), so per-connection data lives in
 * the socket attachment (`connection.setState`) and room data lives in storage.
 */

import { type Connection, type ConnectionContext, Server, type WSMessage } from 'partyserver';
import { CLOSE, closeCodeFor } from './logic/close-codes';
import {
  alarmTimeFor,
  decideOnAlarm,
  resolveIdleExpiryMs,
  shouldRecordActivity,
} from './logic/expiry';
import { decodeClientFrame, encodeServerFrame, errorFrame } from './logic/frames';
import { RateLimiter } from './logic/rate-limit';
import {
  applyHello,
  applyTap,
  bumpSeq,
  newRoom,
  type Presence,
  parseRoomRecord,
  type Role,
  type RoomRecord,
  toSpikeState,
} from './logic/room';

declare global {
  namespace Cloudflare {
    interface Env {
      Room: DurableObjectNamespace<Room>;
      /** Idle expiry in ms (string, from `vars`). Defaults to `LIMITS.idleExpiryMs`. */
      ROOM_IDLE_EXPIRY_MS?: string;
    }
  }
}

export type Env = Cloudflare.Env;

/** Stored in the socket attachment, so it survives hibernation. `null` until `hello` succeeds. */
type Seated = { playerId: string; role: Role };

const ROOM_KEY = 'room';
const ACTIVITY_KEY = 'activity';

export class Room extends Server<Env> {
  static override options = { hibernate: true };

  #loaded = false;
  #room: RoomRecord | null = null;
  #lastActivity = 0;
  #lastActivityRecorded = 0;
  readonly #limiters = new WeakMap<WebSocket, RateLimiter>();

  get #idleMs(): number {
    return resolveIdleExpiryMs(this.env.ROOM_IDLE_EXPIRY_MS);
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#room = parseRoomRecord(await this.ctx.storage.get(ROOM_KEY));
    const activity = await this.ctx.storage.get<number>(ACTIVITY_KEY);
    this.#lastActivity = Math.max(this.#lastActivity, activity ?? 0);
    this.#lastActivityRecorded = activity ?? 0;
    this.#loaded = true;
  }

  override async onStart(): Promise<void> {
    await this.#load();
  }

  // -------------------------------------------------------------------------------------------
  // RPC from the Worker (POST /rooms, GET /rooms/:code)
  // -------------------------------------------------------------------------------------------

  /** Creates the room. `false` when this code is already a live room (the caller retries). */
  async create(): Promise<boolean> {
    await this.#load();
    if (this.#room) return false;
    const now = Date.now();
    this.#room = newRoom(this.name, now);
    await this.ctx.storage.put(ROOM_KEY, this.#room);
    await this.#recordActivity(now, true);
    return true;
  }

  async exists(): Promise<boolean> {
    await this.#load();
    if (!this.#room) await this.#forget();
    return this.#room !== null;
  }

  // -------------------------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------------------------

  override async onConnect(connection: Connection, _ctx: ConnectionContext): Promise<void> {
    await this.#load();
    if (!this.#room) {
      // Normally the Worker refuses unknown codes before they get here (see index.ts): closing a
      // hibernatable socket from onConnect works, but the close reaches the client only after
      // ~10 s in local workerd. This path only covers a room that expired in between.
      this.#refuse(connection, 'room_not_found', 'no room with this code');
      await this.#forget();
      return;
    }
    connection.setState(null);
    await this.#recordActivity(Date.now());
  }

  override async onMessage(connection: Connection, raw: WSMessage): Promise<void> {
    const now = Date.now();
    let limiter = this.#limiters.get(connection);
    if (!limiter) {
      limiter = new RateLimiter();
      this.#limiters.set(connection, limiter);
    }
    const decision = limiter.take(now);
    if (decision !== 'ok') {
      if (decision === 'drop_and_notify') {
        connection.send(errorFrame('rate_limited', 'too many messages; this one was dropped'));
      }
      return;
    }

    await this.#load();
    if (!this.#room) {
      this.#refuse(connection, 'room_not_found', 'this room has expired');
      return;
    }
    await this.#recordActivity(now);

    const seated = connection.state as Seated | null;
    const decoded = decodeClientFrame(raw);
    if (!decoded.ok) {
      if (decoded.code === 'unsupported_version' && !seated) {
        this.#refuse(connection, decoded.code, decoded.message);
      } else {
        connection.send(errorFrame(decoded.code, decoded.message));
      }
      return;
    }

    const msg = decoded.msg;
    if (!seated) {
      if (msg.t !== 'hello') {
        connection.send(errorFrame('bad_message', 'the first frame must be hello'));
        return;
      }
      await this.#hello(connection, msg, now);
      return;
    }

    switch (msg.t) {
      case 'ping':
        connection.send(encodeServerFrame({ t: 'pong', time: msg.time, serverTime: now }));
        return;
      case 'hello':
        connection.send(errorFrame('bad_message', 'already joined'));
        return;
      case 'spike.tap': {
        if (seated.role !== 'player') {
          connection.send(errorFrame('bad_message', 'only seated players can tap'));
          return;
        }
        const outcome = applyTap(this.#room, seated.playerId, msg, now);
        if (!outcome.ok) {
          connection.send(errorFrame(outcome.code, outcome.message));
          return;
        }
        this.#room = outcome.room;
        await this.#broadcastState();
        return;
      }
      default:
        connection.send(errorFrame('wrong_phase', `${msg.t} is not available in the rooms spike`));
    }
  }

  override async onClose(connection: Connection): Promise<void> {
    this.#limiters.delete(connection);
    const seated = connection.state as Seated | null;
    if (!seated) return;
    await this.#load();
    if (this.#room) await this.#broadcastState(connection);
  }

  override async onAlarm(): Promise<void> {
    await this.#load();
    if (!this.#room) {
      await this.#forget();
      return;
    }
    const decision = decideOnAlarm(Date.now(), this.#lastActivity, this.#idleMs);
    if (!decision.expire) {
      await this.ctx.storage.setAlarm(decision.nextAlarmAt);
      return;
    }
    for (const connection of this.getConnections()) {
      this.#refuse(connection, 'room_not_found', 'this room has expired');
    }
    this.#room = null;
    await this.#forget();
  }

  // -------------------------------------------------------------------------------------------

  async #hello(
    connection: Connection,
    hello: {
      code: string;
      role: Role;
      name?: string | undefined;
      avatar?: string | undefined;
      resumeToken?: string | undefined;
    },
    now: number,
  ): Promise<void> {
    if (!this.#room) return;
    const outcome = applyHello(this.#room, hello);
    if (!outcome.ok) {
      this.#refuse(connection, outcome.code, outcome.message);
      return;
    }
    const { seat } = outcome;
    // One live socket per seat: a resumed seat takes over from a stale socket.
    for (const other of this.getConnections()) {
      const s = other.state as Seated | null;
      if (other !== connection && s?.playerId === seat.playerId) {
        other.setState(null);
        try {
          other.close(CLOSE.replaced, 'seat taken over by a newer connection');
        } catch {
          // already closing
        }
      }
    }
    connection.setState({ playerId: seat.playerId, role: seat.role } satisfies Seated);
    this.#room = outcome.room;
    connection.send(
      encodeServerFrame({
        t: 'welcome',
        v: 1,
        playerId: seat.playerId,
        resumeToken: seat.resumeToken,
        serverTime: now,
      }),
    );
    await this.#broadcastState();
  }

  /** Bumps `seq`, persists the record, then sends the full state to every seated socket. */
  async #broadcastState(closing?: Connection): Promise<void> {
    if (!this.#room) return;
    this.#room = bumpSeq(this.#room);
    await this.ctx.storage.put(ROOM_KEY, this.#room);
    const frame = encodeServerFrame(toSpikeState(this.#room, this.#presence(closing)));
    for (const connection of this.getConnections()) {
      if (connection === closing || connection.state === null) continue;
      if (connection.readyState !== WebSocket.OPEN) continue;
      try {
        connection.send(frame);
      } catch {
        // the socket closed between the check and the send
      }
    }
  }

  #presence(closing?: Connection): Presence {
    const connectedPlayerIds = new Set<string>();
    let hostConnected = false;
    for (const connection of this.getConnections()) {
      if (connection === closing || connection.readyState !== WebSocket.OPEN) continue;
      const s = connection.state as Seated | null;
      if (!s) continue;
      if (s.role === 'host') hostConnected = true;
      else connectedPlayerIds.add(s.playerId);
    }
    return { hostConnected, connectedPlayerIds };
  }

  #refuse(connection: Connection, code: Parameters<typeof errorFrame>[0], message: string): void {
    try {
      connection.send(errorFrame(code, message));
      connection.close(closeCodeFor(code), code);
    } catch {
      // already closed
    }
  }

  async #recordActivity(now: number, force = false): Promise<void> {
    this.#lastActivity = Math.max(this.#lastActivity, now);
    if (!force && !shouldRecordActivity(now, this.#lastActivityRecorded, this.#idleMs)) return;
    this.#lastActivityRecorded = now;
    await this.ctx.storage.put(ACTIVITY_KEY, now);
    await this.ctx.storage.setAlarm(alarmTimeFor(now, this.#idleMs));
  }

  /** Drops every trace of a room that does not (or no longer) exist, including the alarm. */
  async #forget(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#lastActivity = 0;
    this.#lastActivityRecorded = 0;
  }
}
