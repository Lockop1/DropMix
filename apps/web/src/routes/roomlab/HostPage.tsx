import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { joinUrl, resolveRoomsEndpoint } from './config';
import { GlyphIcon } from './glyphs';
import { QrCode } from './QrCode';
import {
  normalizeCode,
  PingReadout,
  pingIntervalFromUrl,
  RefusedNotice,
  Screen,
  StatusPill,
  useRoomConnection,
  useRoomExists,
} from './shared';
import { lastHostedRoom } from './storage';

/** `/roomlab`: create a room (or go back to the one this browser hosted last). */
export function HostStart() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = normalizeCode(lastHostedRoom.get() ?? undefined);
  const previousCheck = useRoomExists(previous);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${resolveRoomsEndpoint().http}/rooms`, { method: 'POST' });
      const body = (await res.json()) as { code?: unknown };
      const code = typeof body.code === 'string' ? normalizeCode(body.code) : null;
      if (!res.ok || !code) throw new Error(`room server answered ${res.status}`);
      lastHostedRoom.set(code);
      navigate(`/roomlab/host/${code}`);
    } catch (e) {
      setError(
        `Could not create a room. Is the room server running (pnpm dev:rooms)? ${
          e instanceof Error ? e.message : ''
        }`,
      );
      setBusy(false);
    }
  }

  return (
    <Screen>
      <h1 className="text-2xl font-bold">Room lab</h1>
      <p className="text-sm opacity-80">
        Rooms spike: this screen hosts, phones join with the code or the QR code and tap.
      </p>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="min-h-14 rounded-xl bg-emerald-500 px-4 text-lg font-bold text-black active:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? 'Creating…' : 'Create room'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {previous && previousCheck === 'exists' && (
        <Link
          to={`/roomlab/host/${previous}`}
          data-testid="resume-room"
          className="flex min-h-12 items-center rounded-lg bg-white/10 px-4"
        >
          Back to room {previous}
        </Link>
      )}
      <Link to="/roomlab/join" className="underline">
        Join a room instead
      </Link>
    </Screen>
  );
}

/** `/roomlab/host/:code`: the host screen. A refresh reclaims the room with the stored token. */
export function HostRoom() {
  const code = normalizeCode(useParams().code);
  const pingIntervalMs = pingIntervalFromUrl();
  const { snapshot } = useRoomConnection(
    code ? { code, role: 'host', ...(pingIntervalMs ? { pingIntervalMs } : {}) } : null,
  );
  const status = snapshot.status;
  const refusedCode = snapshot.error?.code;
  useEffect(() => {
    if (!code) return;
    if (status === 'connected') lastHostedRoom.set(code);
    if (status === 'refused' && refusedCode === 'room_not_found') lastHostedRoom.clear();
  }, [code, status, refusedCode]);
  if (!code) {
    return (
      <Screen>
        <h1 className="text-2xl font-bold">Not a room code</h1>
        <Link to="/roomlab" className="underline">
          Back to the room lab
        </Link>
      </Screen>
    );
  }
  const link = joinUrl(code);
  const state = snapshot.state;
  const lastTap = state?.lastTap;

  return (
    <Screen>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Room lab · host</h1>
        <StatusPill status={snapshot.status} />
      </header>
      <RefusedNotice snapshot={snapshot} />

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="text-center sm:text-left">
          <p className="text-xs uppercase tracking-widest opacity-70">Room code</p>
          <p
            data-testid="room-code"
            className="font-mono text-6xl font-black tracking-[0.2em] sm:text-7xl"
          >
            {code}
          </p>
          <p className="max-w-full text-xs break-all opacity-70" data-testid="join-url">
            {link}
          </p>
        </div>
        <QrCode text={link} label={`QR code to join room ${code}`} />
      </div>

      <PingReadout snapshot={snapshot} />

      <section aria-labelledby="players-heading" className="flex flex-col gap-2">
        <h2 id="players-heading" className="font-semibold">
          Players{' '}
          <span className="text-sm font-normal opacity-70">
            {state ? `${state.players.length}/7` : ''}
          </span>
        </h2>
        {state && state.players.length === 0 && (
          <p className="text-sm opacity-70">Nobody yet. Scan the code with a phone.</p>
        )}
        <ul className="flex flex-col gap-2" data-testid="players">
          {state?.players.map((p) => {
            const isLast = lastTap?.playerId === p.playerId;
            return (
              <li
                key={p.playerId}
                data-testid="player-row"
                data-player-id={p.playerId}
                data-taps={p.taps}
                data-connected={p.connected}
                data-last={isLast}
                className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 ${
                  isLast ? 'bg-emerald-500/25 ring-2 ring-emerald-400' : 'bg-white/10'
                } ${p.connected ? '' : 'opacity-50'}`}
              >
                <GlyphIcon id={p.avatar} size={28} />
                <span className="min-w-0 flex-1 truncate font-medium" data-testid="player-name">
                  {p.name}
                </span>
                {!p.connected && <span className="text-xs">offline</span>}
                <span className="font-mono text-xl tabular-nums" data-testid="player-taps">
                  {p.taps}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p
        data-testid="last-tap"
        data-tap-id={lastTap?.tapId ?? ''}
        data-player-id={lastTap?.playerId ?? ''}
        className="text-sm opacity-80"
      >
        {lastTap
          ? `Last tap: ${state?.players.find((p) => p.playerId === lastTap.playerId)?.name ?? '?'}`
          : 'No taps yet'}
      </p>
      <p className="text-xs opacity-60">
        seq {state?.seq ?? '–'} · host {state?.host.connected ? 'online' : '…'}
        {snapshot.invalidFrames > 0 ? ` · ${snapshot.invalidFrames} invalid frames dropped` : ''}
      </p>
    </Screen>
  );
}
