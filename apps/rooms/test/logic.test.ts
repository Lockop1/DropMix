import { LIMITS, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_REGEX } from '@stemdeck/protocol';
import { spikeStateSchema } from '@stemdeck/protocol/spike';
import { describe, expect, it } from 'vitest';
import { closeCodeFor } from '../src/logic/close-codes';
import {
  activityThrottleMs,
  alarmTimeFor,
  decideOnAlarm,
  resolveIdleExpiryMs,
  shouldRecordActivity,
} from '../src/logic/expiry';
import {
  decodeClientFrame,
  encodeServerFrame,
  errorFrame,
  utf8ByteLength,
} from '../src/logic/frames';
import {
  generatePlayerId,
  generateRoomCode,
  generateToken,
  type RandomBytes,
  TOKEN_BYTES,
  tokensEqual,
} from '../src/logic/ids';
import { RateLimiter } from '../src/logic/rate-limit';
import {
  applyHello,
  applyTap,
  bumpSeq,
  MAX_PLAYER_SEATS,
  newRoom,
  parseRoomRecord,
  type RoomRecord,
  toSpikeState,
} from '../src/logic/room';

/** Deterministic byte source for tests: a counter. */
function counterBytes(start = 0): RandomBytes {
  let i = start;
  return (n) => Uint8Array.from({ length: n }, () => i++ & 0xff);
}

function seated(room: RoomRecord, count: number): RoomRecord {
  let r = room;
  for (let i = 0; i < count; i++) {
    const out = applyHello(r, { code: r.code, role: 'player', name: `P${i}` });
    if (!out.ok) throw new Error(out.code);
    r = out.room;
  }
  return r;
}

describe('ids', () => {
  it('room codes use only the protocol alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(ROOM_CODE_REGEX);
    }
  });

  it('room codes are unbiased: bytes past the last full alphabet cycle are rejected', () => {
    // 253..255 are rejected (23 * 11 = 253); 0 → 'A', 22 → 'Z'.
    const bytes = [253, 254, 255, 0, 22, 253, 1, 2];
    const random: RandomBytes = (n) => Uint8Array.from(bytes.splice(0, n));
    expect(generateRoomCode(random)).toBe(
      `${ROOM_CODE_ALPHABET[0]}${ROOM_CODE_ALPHABET[22]}${ROOM_CODE_ALPHABET[1]}${ROOM_CODE_ALPHABET[2]}`,
    );
  });

  it('tokens have at least 128 bits and are independent of player ids', () => {
    expect(TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(tokens.size).toBe(1000);
    expect(generatePlayerId('host')).toMatch(/^h_[0-9a-f]{16}$/);
    expect(generatePlayerId('player')).toMatch(/^p_[0-9a-f]{16}$/);
  });

  it('tokensEqual compares exactly', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abc', 'abd')).toBe(false);
    expect(tokensEqual('abc', 'abcd')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('accepts the limit per sliding second, drops the rest, notifies once per window', () => {
    const rl = new RateLimiter(3, 1000);
    expect([0, 10, 20].map((t) => rl.take(t))).toEqual(['ok', 'ok', 'ok']);
    expect(rl.take(30)).toBe('drop_and_notify');
    expect(rl.take(40)).toBe('drop');
    expect(rl.take(999)).toBe('drop');
    // The first accepted message (t=0) leaves the window at t=1000.
    expect(rl.take(1000)).toBe('ok');
    expect(rl.take(1001)).toBe('drop');
    // t=10 leaves at 1010, t=20 at 1020: the window slides, it does not reset.
    expect(rl.take(1015)).toBe('ok');
    expect(rl.take(1019)).toBe('drop');
    expect(rl.take(1020)).toBe('ok');
    // A second notice only once a full window has passed since the first (t=30).
    expect(rl.take(1029)).toBe('drop');
    expect(rl.take(1030)).toBe('drop_and_notify');
    expect(rl.take(1031)).toBe('drop');
  });

  it('defaults to the protocol limit', () => {
    const rl = new RateLimiter();
    const results = Array.from({ length: LIMITS.rateLimitPerSecond + 1 }, (_, i) => rl.take(i));
    expect(results.filter((r) => r === 'ok').length).toBe(LIMITS.rateLimitPerSecond);
    expect(results.at(-1)).toBe('drop_and_notify');
  });
});

describe('frames', () => {
  const hello = { t: 'hello', v: PROTOCOL_VERSION, code: 'ABCD', role: 'player', name: 'Ada' };

  it('decodes valid frames', () => {
    const out = decodeClientFrame(JSON.stringify(hello));
    expect(out).toEqual({ ok: true, msg: hello });
    expect(decodeClientFrame('{"t":"spike.tap","tapId":"a","sentAt":1}').ok).toBe(true);
  });

  it('rejects oversized, binary, non-JSON and off-schema frames', () => {
    const big = JSON.stringify({ ...hello, pad: 'x'.repeat(LIMITS.maxMessageBytes) });
    expect(decodeClientFrame(big)).toMatchObject({ ok: false, code: 'too_large' });
    expect(decodeClientFrame(new Uint8Array(LIMITS.maxMessageBytes + 1))).toMatchObject({
      ok: false,
      code: 'too_large',
    });
    expect(decodeClientFrame(new Uint8Array(4).buffer)).toMatchObject({ code: 'bad_message' });
    expect(decodeClientFrame('{oops')).toMatchObject({ code: 'bad_message' });
    expect(decodeClientFrame('[]')).toMatchObject({ code: 'bad_message' });
    expect(decodeClientFrame(JSON.stringify({ ...hello, extra: 1 }))).toMatchObject({
      code: 'bad_message',
    });
    expect(decodeClientFrame(JSON.stringify({ ...hello, code: 'ABIO' }))).toMatchObject({
      code: 'bad_message',
    });
    expect(decodeClientFrame(JSON.stringify({ ...hello, name: 'x'.repeat(21) }))).toMatchObject({
      code: 'bad_message',
    });
    expect(decodeClientFrame(JSON.stringify({ ...hello, v: 2 }))).toMatchObject({
      code: 'unsupported_version',
    });
  });

  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('🎵')).toBe(4);
    // A frame of multi-byte characters just over the limit in bytes, under it in UTF-16 units.
    const s = '€'.repeat(Math.floor(LIMITS.maxMessageBytes / 3) + 1);
    expect(s.length).toBeLessThan(LIMITS.maxMessageBytes);
    expect(decodeClientFrame(s)).toMatchObject({ code: 'too_large' });
  });

  it('validates outbound frames too', () => {
    expect(errorFrame('room_full')).toBe('{"t":"error","code":"room_full"}');
    expect(() =>
      encodeServerFrame({
        t: 'spike.state',
        seq: 0,
        host: { connected: false },
        // @ts-expect-error a token on a player entry must never be serializable
        players: [{ playerId: 'p', name: 'n', avatar: 'a', connected: true, taps: 0, token: 'x' }],
      }),
    ).toThrow();
  });
});

describe('room logic', () => {
  const now = 1_000;

  it('the first host hello claims the host seat; later ones need the token', () => {
    const room = newRoom('ABCD', now);
    const first = applyHello(room, { code: 'ABCD', role: 'host' }, counterBytes());
    if (!first.ok) throw new Error(first.code);
    expect(first.seat.role).toBe('host');
    expect(first.resumed).toBe(false);
    expect(first.room.host?.token).toBe(first.seat.resumeToken);

    const again = applyHello(first.room, { code: 'ABCD', role: 'host' });
    expect(again).toMatchObject({ ok: false, code: 'not_host' });
    const wrong = applyHello(first.room, {
      code: 'ABCD',
      role: 'host',
      resumeToken: 'z'.repeat(32),
    });
    expect(wrong).toMatchObject({ ok: false, code: 'not_host' });
    const back = applyHello(first.room, {
      code: 'ABCD',
      role: 'host',
      resumeToken: first.seat.resumeToken,
    });
    expect(back).toMatchObject({
      ok: true,
      resumed: true,
      seat: { playerId: first.seat.playerId },
    });
  });

  it('players get seats up to capacity; a resumed seat keeps its id, name and taps', () => {
    let room = newRoom('ABCD', now);
    const p = applyHello(room, { code: 'ABCD', role: 'player', name: 'Ada', avatar: 'star' });
    if (!p.ok) throw new Error(p.code);
    room = p.room;
    const t = applyTap(room, p.seat.playerId, { tapId: 'x', sentAt: 5 }, 6);
    if (!t.ok) throw new Error(t.code);
    room = t.room;

    const back = applyHello(room, {
      code: 'ABCD',
      role: 'player',
      name: 'Renamed',
      resumeToken: p.seat.resumeToken,
    });
    if (!back.ok) throw new Error(back.code);
    expect(back.resumed).toBe(true);
    expect(back.seat.playerId).toBe(p.seat.playerId);
    expect(back.room.players).toEqual([
      {
        playerId: p.seat.playerId,
        token: p.seat.resumeToken,
        name: 'Ada',
        avatar: 'star',
        taps: 1,
      },
    ]);

    room = seated(room, MAX_PLAYER_SEATS - 1);
    expect(room.players.length).toBe(MAX_PLAYER_SEATS);
    expect(MAX_PLAYER_SEATS + 1).toBe(LIMITS.maxPlayers);
    expect(applyHello(room, { code: 'ABCD', role: 'player', name: 'Late' })).toMatchObject({
      ok: false,
      code: 'room_full',
    });
    // Resume still works when full.
    expect(
      applyHello(room, { code: 'ABCD', role: 'player', resumeToken: p.seat.resumeToken }),
    ).toMatchObject({ ok: true, resumed: true });
    // The host seat is separate from the player seats.
    expect(applyHello(room, { code: 'ABCD', role: 'host' })).toMatchObject({ ok: true });
  });

  it('defaults name and avatar; refuses a hello for another room', () => {
    const out = applyHello(newRoom('ABCD', now), { code: 'ABCD', role: 'player' });
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.room.players[0]).toMatchObject({ name: 'Player 1', avatar: 'dot' });
    expect(applyHello(newRoom('ABCD', now), { code: 'WXYZ', role: 'player' })).toMatchObject({
      ok: false,
      code: 'bad_message',
    });
  });

  it('only seated players can tap; the server counts', () => {
    let room = seated(newRoom('ABCD', now), 2);
    const [a, b] = room.players;
    if (!a || !b) throw new Error('seats');
    for (let i = 0; i < 3; i++) {
      const t = applyTap(room, a.playerId, { tapId: `a${i}`, sentAt: i }, 100 + i);
      if (!t.ok) throw new Error(t.code);
      room = t.room;
    }
    expect(room.players.map((p) => p.taps)).toEqual([3, 0]);
    expect(room.lastTap).toEqual({ playerId: a.playerId, tapId: 'a2', sentAt: 2, serverTime: 102 });
    expect(applyTap(room, 'h_unknown', { tapId: 'q', sentAt: 0 }, 0)).toMatchObject({
      ok: false,
      code: 'bad_message',
    });
  });

  it('the public state never contains a token and validates against the spike schema', () => {
    let room = newRoom('ABCD', now);
    const h = applyHello(room, { code: 'ABCD', role: 'host' });
    if (!h.ok) throw new Error(h.code);
    room = seated(h.room, 3);
    room = bumpSeq(bumpSeq(room));
    const [first] = room.players;
    if (!first) throw new Error('seats');
    const state = toSpikeState(room, {
      hostConnected: true,
      connectedPlayerIds: new Set([first.playerId]),
    });
    expect(spikeStateSchema.parse(state)).toEqual(state);
    expect(state.seq).toBe(2);
    expect(state.players.map((p) => p.connected)).toEqual([true, false, false]);
    const text = JSON.stringify(state);
    expect(text).not.toContain(room.host?.token ?? '?');
    for (const p of room.players) expect(text).not.toContain(p.token);
    expect(text).not.toMatch(/token/i);
  });

  it('stored records round-trip and corrupt ones are dropped', () => {
    const room = seated(newRoom('ABCD', now), 2);
    expect(parseRoomRecord(structuredClone(room))).toEqual(room);
    expect(parseRoomRecord(undefined)).toBeNull();
    expect(parseRoomRecord({ ...room, v: 2 })).toBeNull();
    expect(parseRoomRecord({ ...room, code: 'lolo' })).toBeNull();
  });
});

describe('expiry', () => {
  it('resolves the idle time from the env var, defaulting to the protocol limit', () => {
    expect(resolveIdleExpiryMs(undefined)).toBe(LIMITS.idleExpiryMs);
    expect(resolveIdleExpiryMs('')).toBe(LIMITS.idleExpiryMs);
    expect(resolveIdleExpiryMs('abc')).toBe(LIMITS.idleExpiryMs);
    expect(resolveIdleExpiryMs('-5')).toBe(LIMITS.idleExpiryMs);
    expect(resolveIdleExpiryMs('2500')).toBe(2500);
    expect(resolveIdleExpiryMs('5')).toBe(100);
  });

  it('records activity at most once per throttle window and never expires early', () => {
    const idle = LIMITS.idleExpiryMs;
    const throttle = activityThrottleMs(idle);
    expect(throttle).toBe(10_000);
    expect(shouldRecordActivity(5_000, 0, idle)).toBe(false);
    expect(shouldRecordActivity(10_000, 0, idle)).toBe(true);
    expect(alarmTimeFor(0, idle)).toBe(idle + throttle);

    expect(decideOnAlarm(idle - 1, 0, idle)).toEqual({
      expire: false,
      nextAlarmAt: alarmTimeFor(0, idle),
    });
    expect(decideOnAlarm(idle, 0, idle)).toEqual({ expire: true });
    // Activity after the alarm was scheduled pushes it out.
    expect(decideOnAlarm(idle + throttle, 15_000, idle)).toEqual({
      expire: false,
      nextAlarmAt: alarmTimeFor(15_000, idle),
    });
  });
});

describe('close codes', () => {
  it('fatal errors close in the 4000 range', () => {
    for (const code of [
      'not_host',
      'room_full',
      'room_not_found',
      'unsupported_version',
    ] as const) {
      const c = closeCodeFor(code);
      expect(c).toBeGreaterThanOrEqual(4000);
      expect(c).toBeLessThan(5000);
    }
  });
});
