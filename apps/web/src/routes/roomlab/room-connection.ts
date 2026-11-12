/**
 * One participant's connection to a room (rooms spike). Wraps partysocket (auto-reconnect) and
 * speaks the protocol: `hello` as the first frame of every (re)connection, `ping` once a second,
 * `spike.tap` for players. Every inbound frame is validated with the protocol's zod schemas and
 * dropped if it does not match. The resume token is kept in localStorage so a refresh or a
 * reconnect keeps the seat.
 */

import { type ErrorCode, PROTOCOL_VERSION } from '@stemdeck/protocol';
import {
  type SpikeClientMessage,
  type SpikeState,
  spikeServerMessageSchema,
} from '@stemdeck/protocol/spike';
import { PartySocket } from 'partysocket';
import { resolveRoomsEndpoint } from './config';
import { type RttSummary, summarize } from './stats';
import { tokens } from './storage';

export type Role = 'host' | 'player';

export type ConnStatus =
  /** Socket opening (first time). */
  | 'connecting'
  /** Socket open, hello sent, waiting for welcome. */
  | 'joining'
  | 'connected'
  /** Lost the socket; partysocket is retrying. */
  | 'reconnecting'
  /** The server refused us for good (room_not_found, room_full, not_host, …). */
  | 'refused';

export interface RoomSnapshot {
  status: ConnStatus;
  playerId: string | null;
  state: SpikeState | null;
  /** The fatal error when `status` is `refused`, else the last non-fatal one. */
  error: { code: ErrorCode; message?: string | undefined } | null;
  rtt: RttSummary;
  /** Inbound frames that failed validation and were dropped. */
  invalidFrames: number;
}

export interface RoomConnectionOptions {
  code: string;
  role: Role;
  name?: string;
  avatar?: string;
  /** Ping period in ms (default 1000). */
  pingIntervalMs?: number;
}

const FATAL: ReadonlySet<ErrorCode> = new Set([
  'room_not_found',
  'room_full',
  'not_host',
  'unsupported_version',
]);

const MAX_RTT_SAMPLES = 500;

export class RoomConnection {
  readonly code: string;
  readonly role: Role;
  readonly #name: string | undefined;
  readonly #avatar: string | undefined;
  readonly #pingIntervalMs: number;
  readonly #socket: PartySocket;
  readonly #listeners = new Set<() => void>();
  readonly #rtts: number[] = [];
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #tapCounter = 0;
  #disposed = false;
  #snapshot: RoomSnapshot = {
    status: 'connecting',
    playerId: null,
    state: null,
    error: null,
    rtt: summarize([]),
    invalidFrames: 0,
  };

  constructor(opts: RoomConnectionOptions) {
    this.code = opts.code;
    this.role = opts.role;
    this.#name = opts.name;
    this.#avatar = opts.avatar;
    this.#pingIntervalMs = Math.max(100, opts.pingIntervalMs ?? 1000);
    const endpoint = resolveRoomsEndpoint();
    this.#socket = new PartySocket({
      host: endpoint.host,
      prefix: endpoint.prefix,
      protocol: endpoint.protocol,
      party: 'room',
      room: opts.code,
      // Never queue frames while offline: hello must be the first frame on every connection.
      maxEnqueuedMessages: 0,
      minReconnectionDelay: 250,
      maxReconnectionDelay: 4000,
      // 4000–4999 means the server refused us on purpose; retrying would not help.
      shouldReconnectOnClose: (ev) => !(ev.code >= 4000 && ev.code < 5000),
    });
    this.#socket.addEventListener('open', this.#onOpen);
    this.#socket.addEventListener('message', this.#onMessage);
    this.#socket.addEventListener('close', this.#onClose);
    window.addEventListener('pagehide', this.#onPageHide);
    window.addEventListener('pageshow', this.#onPageShow);
  }

  // useSyncExternalStore
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getSnapshot = (): RoomSnapshot => this.#snapshot;

  /** Sends one tap. Returns its tapId, or `null` when not seated as a connected player. */
  tap(): string | null {
    if (this.role !== 'player' || this.#snapshot.status !== 'connected') return null;
    this.#tapCounter += 1;
    const tapId = `${Date.now().toString(36)}-${this.#tapCounter}`;
    this.#send({ t: 'spike.tap', tapId, sentAt: Date.now() });
    return tapId;
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopPing();
    this.#socket.removeEventListener('open', this.#onOpen);
    this.#socket.removeEventListener('message', this.#onMessage);
    this.#socket.removeEventListener('close', this.#onClose);
    window.removeEventListener('pagehide', this.#onPageHide);
    window.removeEventListener('pageshow', this.#onPageShow);
    this.#socket.close();
    this.#listeners.clear();
  }

  /** Close cleanly when the page goes away (refresh, tab close), so the server sees it at once. */
  #onPageHide = (): void => {
    this.#stopPing();
    this.#socket.close(1000, 'page hidden');
  };

  /** Coming back from the back/forward cache: open a fresh connection (hello + resume). */
  #onPageShow = (ev: PageTransitionEvent): void => {
    if (ev.persisted && this.#snapshot.status !== 'refused') this.#socket.reconnect();
  };

  // -------------------------------------------------------------------------------------------

  #update(patch: Partial<RoomSnapshot>): void {
    if (this.#disposed) return;
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of this.#listeners) fn();
  }

  #send(msg: SpikeClientMessage): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(msg));
  }

  #onOpen = (): void => {
    const resumeToken = tokens.get(this.code, this.role) ?? undefined;
    this.#update({ status: 'joining' });
    this.#send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      code: this.code,
      role: this.role,
      ...(this.#name !== undefined ? { name: this.#name } : {}),
      ...(this.#avatar !== undefined ? { avatar: this.#avatar } : {}),
      ...(resumeToken !== undefined ? { resumeToken } : {}),
    });
  };

  #onMessage = (ev: MessageEvent): void => {
    let json: unknown;
    try {
      json = typeof ev.data === 'string' ? JSON.parse(ev.data) : undefined;
    } catch {
      json = undefined;
    }
    const parsed = spikeServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.#update({ invalidFrames: this.#snapshot.invalidFrames + 1 });
      return;
    }
    const msg = parsed.data;
    switch (msg.t) {
      case 'welcome':
        tokens.set(this.code, this.role, msg.resumeToken);
        this.#update({ status: 'connected', playerId: msg.playerId, error: null });
        this.#startPing();
        return;
      case 'spike.state': {
        const current = this.#snapshot.state;
        // seq is monotonic; never let an older state overwrite a newer one.
        if (current && msg.seq <= current.seq) return;
        this.#update({ state: msg });
        return;
      }
      case 'pong': {
        const rtt = performance.now() - msg.time;
        if (rtt < 0 || !Number.isFinite(rtt)) return;
        this.#rtts.push(rtt);
        if (this.#rtts.length > MAX_RTT_SAMPLES) this.#rtts.shift();
        this.#update({ rtt: summarize(this.#rtts) });
        return;
      }
      case 'error':
        if (FATAL.has(msg.code)) {
          if (msg.code === 'room_not_found') tokens.clear(this.code, this.role);
          this.#stopPing();
          this.#update({ status: 'refused', error: { code: msg.code, message: msg.message } });
          return;
        }
        this.#update({ error: { code: msg.code, message: msg.message } });
        return;
      default:
        // view/ack/reject belong to the real game protocol; the spike never sends them.
        return;
    }
  };

  #onClose = (ev: CloseEvent): void => {
    this.#stopPing();
    if (this.#snapshot.status === 'refused') return;
    if (ev.code >= 4000 && ev.code < 5000) {
      // Refused without an error frame (e.g. replaced by a newer tab with the same seat).
      this.#update({
        status: 'refused',
        error: this.#snapshot.error ?? { code: 'internal', message: ev.reason || 'closed' },
      });
      return;
    }
    this.#update({ status: 'reconnecting' });
  };

  #startPing(): void {
    this.#stopPing();
    const ping = () => this.#send({ t: 'ping', time: performance.now() });
    ping();
    this.#pingTimer = setInterval(ping, this.#pingIntervalMs);
  }

  #stopPing(): void {
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }
}
