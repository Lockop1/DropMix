import { ROOM_CODE_REGEX } from '@stemdeck/protocol';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { resolveRoomsEndpoint } from './config';
import {
  type ConnStatus,
  RoomConnection,
  type RoomConnectionOptions,
  type RoomSnapshot,
} from './room-connection';
import { formatMs, summarize } from './stats';

const IDLE_SNAPSHOT: RoomSnapshot = {
  status: 'connecting',
  playerId: null,
  state: null,
  error: null,
  rtt: summarize([]),
  invalidFrames: 0,
};
const noSubscribe = () => () => {};
const idleSnapshot = () => IDLE_SNAPSHOT;

/** Ping period: `?ping=250` on the URL shortens it (the latency test uses this). */
export function pingIntervalFromUrl(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('ping');
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 100 ? n : undefined;
}

/** Opens a room connection for as long as the component is mounted (or `opts` is null). */
export function useRoomConnection(opts: RoomConnectionOptions | null): {
  connection: RoomConnection | null;
  snapshot: RoomSnapshot;
} {
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const code = opts?.code;
  const role = opts?.role;
  const name = opts?.name;
  const avatar = opts?.avatar;
  const pingIntervalMs = opts?.pingIntervalMs;
  useEffect(() => {
    if (!code || !role) return;
    const c = new RoomConnection({
      code,
      role,
      ...(name !== undefined ? { name } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
      ...(pingIntervalMs !== undefined ? { pingIntervalMs } : {}),
    });
    setConnection(c);
    return () => {
      c.dispose();
      setConnection(null);
    };
  }, [code, role, name, avatar, pingIntervalMs]);
  const snapshot = useSyncExternalStore(
    connection?.subscribe ?? noSubscribe,
    connection?.getSnapshot ?? idleSnapshot,
  );
  return { connection, snapshot };
}

export type RoomCheck = 'checking' | 'exists' | 'missing' | 'unreachable';

/** Asks the room server whether a code is a live room. */
export function useRoomExists(code: string | null): RoomCheck {
  const [check, setCheck] = useState<RoomCheck>('checking');
  useEffect(() => {
    if (!code) return;
    let alive = true;
    setCheck('checking');
    fetch(`${resolveRoomsEndpoint().http}/rooms/${code}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ exists?: unknown }>) : Promise.reject()))
      .then((body) => alive && setCheck(body.exists === true ? 'exists' : 'missing'))
      .catch(() => alive && setCheck('unreachable'));
    return () => {
      alive = false;
    };
  }, [code]);
  return check;
}

export function normalizeCode(raw: string | undefined): string | null {
  const code = (raw ?? '').toUpperCase();
  return ROOM_CODE_REGEX.test(code) ? code : null;
}

const STATUS_TEXT: Record<ConnStatus, string> = {
  connecting: 'Connecting…',
  joining: 'Joining…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  refused: 'Not connected',
};

const STATUS_DOT: Record<ConnStatus, string> = {
  connecting: 'bg-amber-300',
  joining: 'bg-amber-300',
  connected: 'bg-emerald-400',
  reconnecting: 'bg-amber-300',
  refused: 'bg-rose-400',
};

export function StatusPill({ status }: { status: ConnStatus }) {
  return (
    <p
      data-testid="conn-status"
      data-status={status}
      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm"
    >
      <span className={`size-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
      {STATUS_TEXT[status]}
    </p>
  );
}

export function PingReadout({ snapshot }: { snapshot: RoomSnapshot }) {
  const { last, p50, p95, n } = snapshot.rtt;
  return (
    <p
      data-testid="ping"
      data-rtt-ms={last === null ? '' : last.toFixed(2)}
      data-p50={p50 === null ? '' : p50.toFixed(2)}
      data-p95={p95 === null ? '' : p95.toFixed(2)}
      data-n={n}
      className="text-sm tabular-nums opacity-80"
    >
      Ping {formatMs(last)}
      <span className="opacity-70">
        {' '}
        · p50 {formatMs(p50)} · p95 {formatMs(p95)} · n={n}
      </span>
    </p>
  );
}

const ERROR_TEXT: Record<string, string> = {
  room_not_found: 'No room with this code (it may have expired).',
  room_full: 'This room is full.',
  not_host: 'This room already has a host on another device.',
  unsupported_version: 'This page is out of date. Reload it.',
};

export function RefusedNotice({ snapshot }: { snapshot: RoomSnapshot }) {
  if (snapshot.status !== 'refused' || !snapshot.error) return null;
  const { code, message } = snapshot.error;
  return (
    <div
      role="alert"
      data-testid="refused"
      data-code={code}
      className="rounded-lg bg-rose-500/20 p-3 text-sm"
    >
      <p className="font-semibold">{ERROR_TEXT[code] ?? message ?? code}</p>
      <Link to="/roomlab" className="underline">
        Back to the room lab
      </Link>
    </div>
  );
}

/** Full-height, single-column screen that never scrolls sideways. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-xl min-w-0 flex-1 flex-col gap-4 overflow-x-hidden p-4">
      {children}
    </section>
  );
}
