import { LIMITS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@stemdeck/protocol';
import { type FormEvent, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GLYPHS, GlyphIcon } from './glyphs';
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
import { type Profile, profile, tokens } from './storage';

const ALLOWED = new Set(ROOM_CODE_ALPHABET);

/** `/roomlab/join`: type the 4-letter code. */
export function JoinEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const valid = normalizeCode(code);
  return (
    <Screen>
      <h1 className="text-2xl font-bold">Join a room</h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) navigate(`/roomlab/join/${valid}`);
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm opacity-80">Room code</span>
          <input
            value={code}
            onChange={(e) =>
              setCode(
                [...e.target.value.toUpperCase()]
                  .filter((c) => ALLOWED.has(c))
                  .join('')
                  .slice(0, ROOM_CODE_LENGTH),
              )
            }
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABCD"
            className="min-h-14 w-full rounded-xl bg-white/10 px-4 text-center font-mono text-3xl tracking-[0.3em] uppercase"
          />
        </label>
        <button
          type="submit"
          disabled={!valid}
          className="min-h-14 rounded-xl bg-emerald-500 text-lg font-bold text-black disabled:opacity-40"
        >
          Join
        </button>
      </form>
      <Link to="/roomlab" className="underline">
        Host a room instead
      </Link>
    </Screen>
  );
}

/** `/roomlab/join/:code`: name + glyph, then one big Tap button. */
export function PlayerRoom() {
  const code = normalizeCode(useParams().code);
  // A stored token means this browser already has a seat here: rejoin straight away.
  const [joined, setJoined] = useState<Profile | 'resume' | null>(() =>
    code && tokens.get(code, 'player') ? 'resume' : null,
  );
  const check = useRoomExists(code && joined === null ? code : null);

  if (!code) {
    return (
      <Screen>
        <h1 className="text-2xl font-bold">Not a room code</h1>
        <Link to="/roomlab/join" className="underline">
          Enter a code
        </Link>
      </Screen>
    );
  }
  if (joined === null) {
    return (
      <Screen>
        <h1 className="text-2xl font-bold">
          Join room <span className="font-mono tracking-widest">{code}</span>
        </h1>
        {check === 'missing' ? (
          <div role="alert" data-testid="refused" data-code="room_not_found">
            <p>No room with this code (it may have expired).</p>
            <Link to="/roomlab/join" className="underline">
              Try another code
            </Link>
          </div>
        ) : (
          <ProfileForm onJoin={setJoined} disabled={check !== 'exists'} />
        )}
        {check === 'unreachable' && (
          <p role="alert" className="text-sm text-rose-300">
            Cannot reach the room server.
          </p>
        )}
      </Screen>
    );
  }
  return <TapPad code={code} profile={joined === 'resume' ? null : joined} />;
}

function ProfileForm({ onJoin, disabled }: { onJoin: (p: Profile) => void; disabled: boolean }) {
  const saved = profile.get();
  const [name, setName] = useState(saved?.name ?? '');
  const [avatar, setAvatar] = useState(saved?.avatar ?? GLYPHS[0]?.id ?? 'dot');
  const trimmed = name.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || disabled) return;
    const p = { name: trimmed.slice(0, LIMITS.nameMax), avatar };
    profile.set(p);
    onJoin(p);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <label className="flex flex-col gap-1">
        <span className="text-sm opacity-80">Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.nameMax}
          autoComplete="nickname"
          enterKeyHint="go"
          className="min-h-12 w-full rounded-xl bg-white/10 px-4 text-lg"
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm opacity-80">Your glyph</legend>
        <div className="grid grid-cols-4 gap-2">
          {GLYPHS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-label={g.label}
              aria-pressed={avatar === g.id}
              onClick={() => setAvatar(g.id)}
              className={`flex min-h-14 items-center justify-center rounded-xl ${
                avatar === g.id ? 'bg-white/30 ring-2 ring-white' : 'bg-white/10'
              }`}
            >
              <GlyphIcon id={g.id} size={32} />
            </button>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={!trimmed || disabled}
        className="min-h-14 rounded-xl bg-emerald-500 text-lg font-bold text-black disabled:opacity-40"
      >
        Join
      </button>
    </form>
  );
}

function TapPad({ code, profile: chosen }: { code: string; profile: Profile | null }) {
  const pingIntervalMs = pingIntervalFromUrl();
  const { connection, snapshot } = useRoomConnection({
    code,
    role: 'player',
    ...(chosen ? { name: chosen.name, avatar: chosen.avatar } : {}),
    ...(pingIntervalMs ? { pingIntervalMs } : {}),
  });
  const button = useRef<HTMLButtonElement>(null);
  const me = snapshot.state?.players.find((p) => p.playerId === snapshot.playerId);
  const canTap = snapshot.status === 'connected' && connection !== null;

  function tap() {
    const tapId = connection?.tap();
    if (!tapId) return;
    // Read by the latency test to correlate this tap with the host's update.
    if (button.current) button.current.dataset.lastTapId = tapId;
    try {
      navigator.vibrate?.(12);
    } catch {
      // vibrate is optional
    }
  }

  return (
    <Screen>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-lg font-bold tracking-widest">{code}</p>
        <StatusPill status={snapshot.status} />
      </header>
      <RefusedNotice snapshot={snapshot} />
      <div className="flex min-w-0 items-center gap-3">
        {me && <GlyphIcon id={me.avatar} size={36} />}
        <p className="min-w-0 flex-1 truncate text-xl font-semibold" data-testid="my-name">
          {me?.name ?? chosen?.name ?? ''}
        </p>
        <p className="text-right">
          <span className="block text-xs opacity-70">taps</span>
          <span className="font-mono text-3xl tabular-nums" data-testid="my-taps">
            {me?.taps ?? 0}
          </span>
        </p>
      </div>
      <button
        ref={button}
        type="button"
        onClick={tap}
        disabled={!canTap}
        data-testid="tap"
        data-player-id={snapshot.playerId ?? ''}
        className="flex min-h-[45dvh] w-full touch-manipulation items-center justify-center rounded-3xl bg-emerald-500 text-5xl font-black text-black select-none active:scale-[0.98] active:bg-emerald-400 disabled:opacity-40"
      >
        Tap
      </button>
      <PingReadout snapshot={snapshot} />
    </Screen>
  );
}
