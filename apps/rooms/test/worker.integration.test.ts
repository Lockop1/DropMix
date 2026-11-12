/**
 * End-to-end tests of the Worker + Room Durable Object, running in the real workerd runtime via
 * wrangler's `createTestHarness` (no Cloudflare account, nothing leaves the machine).
 *
 * `@cloudflare/vitest-pool-workers` 0.23 needs Vitest 4 and this repo is on Vitest 5, so the
 * Worker runs as a local server and the tests talk to it over HTTP and WebSocket from Node.
 */

import { fileURLToPath } from 'node:url';
import { LIMITS, PROTOCOL_VERSION, ROOM_CODE_REGEX } from '@stemdeck/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from 'wrangler';
import { connect, type TestClient } from './ws-client';

const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));

let server: TestHarness;
let base: URL;

beforeAll(async () => {
  server = createTestHarness({ workers: [{ configPath }] });
  base = (await server.listen()).url;
}, 60_000);

afterAll(async () => {
  await server?.close();
});

async function createRoom(): Promise<string> {
  const res = await fetch(new URL('/rooms', base), { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { code: string };
  expect(body.code).toMatch(ROOM_CODE_REGEX);
  return body.code;
}

function wsUrl(code: string): string {
  const u = new URL(`/parties/room/${code}`, base);
  u.protocol = 'ws:';
  return u.toString();
}

function hello(code: string, role: 'host' | 'player', extra: Record<string, unknown> = {}) {
  return { t: 'hello', v: PROTOCOL_VERSION, code, role, ...extra };
}

async function join(
  code: string,
  role: 'host' | 'player',
  extra: Record<string, unknown> = {},
): Promise<{ client: TestClient; playerId: string; resumeToken: string }> {
  const client = await connect(wsUrl(code));
  client.send(hello(code, role, extra));
  const welcome = await client.next('welcome');
  return { client, playerId: welcome.playerId, resumeToken: welcome.resumeToken };
}

describe('HTTP', () => {
  it('POST /rooms creates a room with a 4-letter code; GET /rooms/:code reports it', async () => {
    const code = await createRoom();
    const res = await fetch(new URL(`/rooms/${code}`, base));
    expect(await res.json()).toEqual({ code, exists: true });
  });

  it('codes are unique among live rooms', async () => {
    const codes = await Promise.all(Array.from({ length: 20 }, () => createRoom()));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('a code that was never created does not exist; malformed codes are rejected', async () => {
    // Find a code that is not live (overwhelmingly likely on the first try).
    let found: string | undefined;
    for (const code of ['ZZZZ', 'YYYY', 'XXXX', 'WWWW']) {
      const res = await fetch(new URL(`/rooms/${code}`, base));
      const body = (await res.json()) as { code: string; exists: boolean };
      expect(body.code).toBe(code);
      if (!body.exists) {
        found = code;
        break;
      }
    }
    expect(found).toBeDefined();
    expect((await fetch(new URL('/rooms/abcd', base))).status).toBe(400);
    expect((await fetch(new URL('/rooms/ABIO', base))).status).toBe(400);
    expect((await fetch(new URL('/rooms', base))).status).toBe(405);
    expect((await fetch(new URL('/health', base))).status).toBe(200);
  });

  it('the Durable Object does not answer plain HTTP and bad codes never reach it', async () => {
    const code = await createRoom();
    expect((await fetch(new URL(`/parties/room/${code}`, base))).status).toBe(404);
    const bad = new URL('/parties/room/abcd', base);
    bad.protocol = 'ws:';
    await expect(connect(bad.toString())).rejects.toThrow();
  });
});

describe('WebSocket protocol', () => {
  it('refuses a room that was never created with error{room_not_found} and a close', async () => {
    const client = await connect(wsUrl('QQQQ'));
    const err = await client.next('error');
    expect(err.code).toBe('room_not_found');
    expect((await client.closed).code).toBe(4004);
  });

  it('hello → welcome; ping → pong', async () => {
    const code = await createRoom();
    const { client, playerId, resumeToken } = await join(code, 'host');
    expect(playerId).toMatch(/^h_/);
    expect(resumeToken.length).toBeGreaterThanOrEqual(22); // ≥128 bits in base64url
    expect(resumeToken).not.toContain(playerId);
    const state = await client.next('spike.state');
    expect(state.host.connected).toBe(true);
    expect(state.players).toEqual([]);
    client.send({ t: 'ping', time: 1234.5 });
    const pong = await client.next('pong');
    expect(pong.time).toBe(1234.5);
    expect(pong.serverTime).toBeGreaterThan(0);
    client.close();
  });

  it('the first frame must be hello', async () => {
    const code = await createRoom();
    const client = await connect(wsUrl(code));
    client.send({ t: 'ping', time: 1 });
    expect((await client.next('error')).code).toBe('bad_message');
    client.send({ t: 'spike.tap', tapId: 'a', sentAt: 1 });
    expect((await client.next('error')).code).toBe('bad_message');
    // Still allowed to say hello afterwards.
    client.send(hello(code, 'player', { name: 'Late' }));
    await client.next('welcome');
    client.close();
  });

  it('rejects invalid, binary, oversized and wrong-version frames', async () => {
    const code = await createRoom();
    const { client } = await join(code, 'player', { name: 'Val' });
    client.sendRaw('not json');
    expect((await client.next('error')).code).toBe('bad_message');
    client.send({ t: 'spike.tap', tapId: 'a', sentAt: 1, taps: 1000 });
    expect((await client.next('error')).code).toBe('bad_message');
    client.send({ t: 'nope' });
    expect((await client.next('error')).code).toBe('bad_message');
    client.sendRaw(new Uint8Array([1, 2, 3]).buffer);
    expect((await client.next('error')).code).toBe('bad_message');
    client.sendRaw(JSON.stringify({ t: 'ping', time: 1, pad: 'x'.repeat(LIMITS.maxMessageBytes) }));
    expect((await client.next('error')).code).toBe('too_large');
    // A valid v1 message the spike does not implement.
    client.send({ t: 'view.request' });
    expect((await client.next('error')).code).toBe('wrong_phase');
    // The connection survives all of that.
    client.send({ t: 'ping', time: 7 });
    expect((await client.next('pong')).time).toBe(7);
    client.close();

    const other = await connect(wsUrl(code));
    other.send(hello(code, 'player', { v: PROTOCOL_VERSION + 1 }));
    expect((await other.next('error')).code).toBe('unsupported_version');
    expect((await other.closed).code).toBe(4005);
  });

  it(`rate-limits at ${LIMITS.rateLimitPerSecond} messages per second and drops the excess`, async () => {
    const code = await createRoom();
    const { client } = await join(code, 'host');
    await client.next('spike.state');
    const burst = LIMITS.rateLimitPerSecond * 2;
    for (let i = 0; i < burst; i++) client.send({ t: 'ping', time: i });
    expect((await client.next('error')).code).toBe('rate_limited');
    await new Promise((r) => setTimeout(r, 300));
    const pongs = client.received.filter((m) => m.t === 'pong');
    // The hello counted towards the window too.
    expect(pongs.length).toBe(LIMITS.rateLimitPerSecond - 1);
    expect(client.received.filter((m) => m.t === 'error').length).toBe(1);
    // After the window passes, messages flow again.
    await new Promise((r) => setTimeout(r, 1000));
    client.send({ t: 'ping', time: 999 });
    expect((await client.next('pong', (p) => p.time === 999)).time).toBe(999);
    client.close();
  });
});

describe('seats, taps and resume', () => {
  it('counts taps on the server and broadcasts the full state with a monotonic seq', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const p1 = await join(code, 'player', { name: 'Ada', avatar: 'star' });
    const p2 = await join(code, 'player', { name: 'Bo' });

    p1.client.send({ t: 'spike.tap', tapId: 'tap-1', sentAt: 111 });
    const s1 = await host.client.next('spike.state', (s) => s.lastTap?.tapId === 'tap-1');
    expect(s1.players.find((p) => p.playerId === p1.playerId)).toMatchObject({
      name: 'Ada',
      avatar: 'star',
      taps: 1,
      connected: true,
    });
    expect(s1.lastTap).toMatchObject({ playerId: p1.playerId, tapId: 'tap-1', sentAt: 111 });

    p2.client.send({ t: 'spike.tap', tapId: 'tap-2', sentAt: 222 });
    p2.client.send({ t: 'spike.tap', tapId: 'tap-3', sentAt: 333 });
    const s3 = await host.client.next('spike.state', (s) => s.lastTap?.tapId === 'tap-3');
    expect(s3.seq).toBeGreaterThan(s1.seq);
    expect(s3.players.map((p) => p.taps)).toEqual([1, 2]);
    // Every client sees the same state.
    const p1view = await p1.client.next('spike.state', (s) => s.seq === s3.seq);
    expect(p1view).toEqual(s3);

    // The host cannot tap.
    host.client.send({ t: 'spike.tap', tapId: 'h', sentAt: 1 });
    expect((await host.client.next('error')).code).toBe('bad_message');

    // seq never goes backwards across all received states.
    const seqs = host.client.received.flatMap((m) => (m.t === 'spike.state' ? [m.seq] : []));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const c of [host, p1, p2]) c.client.close();
  });

  it('a player who reconnects with the resume token keeps id, name and taps', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const p = await join(code, 'player', { name: 'Cy', avatar: 'moon' });
    p.client.send({ t: 'spike.tap', tapId: 'a', sentAt: 1 });
    p.client.send({ t: 'spike.tap', tapId: 'b', sentAt: 2 });
    await host.client.next('spike.state', (s) => s.lastTap?.tapId === 'b');
    p.client.close();
    const gone = await host.client.next('spike.state', (s) => s.players[0]?.connected === false);
    expect(gone.players[0]?.taps).toBe(2);

    const back = await join(code, 'player', { name: 'Other name', resumeToken: p.resumeToken });
    expect(back.playerId).toBe(p.playerId);
    expect(back.resumeToken).toBe(p.resumeToken);
    const again = await host.client.next('spike.state', (s) => s.players[0]?.connected === true);
    expect(again.players).toEqual([
      { playerId: p.playerId, name: 'Cy', avatar: 'moon', connected: true, taps: 2 },
    ]);

    // An unknown token just takes a fresh seat.
    const fresh = await join(code, 'player', { name: 'Dee', resumeToken: 'x'.repeat(32) });
    expect(fresh.playerId).not.toBe(p.playerId);
    for (const c of [host, back, fresh]) c.client.close();
  });

  it('a second connection with the same token takes the seat over', async () => {
    const code = await createRoom();
    const p = await join(code, 'player', { name: 'Eve' });
    const twin = await join(code, 'player', { resumeToken: p.resumeToken });
    expect(twin.playerId).toBe(p.playerId);
    expect((await p.client.closed).code).toBe(4001);
    twin.client.close();
  });

  it('the first host hello claims the room; a second host is refused; the host reclaims with its token', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const intruder = await connect(wsUrl(code));
    intruder.send(hello(code, 'host'));
    expect((await intruder.next('error')).code).toBe('not_host');
    expect((await intruder.closed).code).toBe(4003);

    const wrongToken = await connect(wsUrl(code));
    wrongToken.send(hello(code, 'host', { resumeToken: 'y'.repeat(32) }));
    expect((await wrongToken.next('error')).code).toBe('not_host');

    const p = await join(code, 'player', { name: 'Fay' });
    p.client.send({ t: 'spike.tap', tapId: 'z', sentAt: 9 });
    await host.client.next('spike.state', (s) => s.lastTap?.tapId === 'z');
    host.client.close();
    await p.client.next('spike.state', (s) => !s.host.connected);

    const back = await join(code, 'host', { resumeToken: host.resumeToken });
    expect(back.playerId).toBe(host.playerId);
    const state = await back.client.next('spike.state');
    expect(state.host.connected).toBe(true);
    expect(state.players[0]).toMatchObject({ playerId: p.playerId, taps: 1 });
    expect(state.lastTap?.tapId).toBe('z');
    back.client.close();
    p.client.close();
  });

  it(`holds the host and ${LIMITS.maxPlayers - 1} players; the next join gets room_full`, async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const players = [];
    for (let i = 0; i < LIMITS.maxPlayers - 1; i++) {
      players.push(await join(code, 'player', { name: `P${i}` }));
    }
    const ninth = await connect(wsUrl(code));
    ninth.send(hello(code, 'player', { name: 'Nine' }));
    expect((await ninth.next('error')).code).toBe('room_full');
    expect((await ninth.closed).code).toBe(4009);

    // A seated player can still come back while the room is full.
    const first = players[0];
    if (!first) throw new Error('no players');
    first.client.close();
    const back = await join(code, 'player', { resumeToken: first.resumeToken });
    expect(back.playerId).toBe(first.playerId);
    for (const c of [host, back, ...players.slice(1)]) c.client.close();
  });

  it('never sends one participant another participant’s resume token', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const a = await join(code, 'player', { name: 'A' });
    const b = await join(code, 'player', { name: 'B' });
    a.client.send({ t: 'spike.tap', tapId: '1', sentAt: 1 });
    b.client.send({ t: 'spike.tap', tapId: '2', sentAt: 2 });
    await host.client.next('spike.state', (s) => s.players.every((p) => p.taps === 1));
    await a.client.next('spike.state', (s) => s.players.every((p) => p.taps === 1));
    await b.client.next('spike.state', (s) => s.players.every((p) => p.taps === 1));
    const all = [host, a, b];
    for (const me of all) {
      for (const other of all) {
        if (other === me) continue;
        for (const frame of me.client.raw) expect(frame).not.toContain(other.resumeToken);
      }
      // My own token appears only in my welcome.
      const mine = me.client.raw.filter((f) => f.includes(me.resumeToken));
      expect(mine.length).toBe(1);
      expect(JSON.parse(mine[0] ?? '{}').t).toBe('welcome');
    }
    for (const c of all) c.client.close();
  });
});

describe('durability', () => {
  it('room state survives the Durable Object being evicted (in-memory state dropped)', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const p = await join(code, 'player', { name: 'Gus' });
    for (const id of ['1', '2', '3']) p.client.send({ t: 'spike.tap', tapId: id, sentAt: 1 });
    const before = await host.client.next('spike.state', (s) => s.lastTap?.tapId === '3');

    await server.getWorker().evictDurableObject('Room', { name: code, webSockets: 'close' });
    await host.client.closed;
    await p.client.closed;

    const res = await fetch(new URL(`/rooms/${code}`, base));
    expect(await res.json()).toEqual({ code, exists: true });
    const host2 = await join(code, 'host', { resumeToken: host.resumeToken });
    expect(host2.playerId).toBe(host.playerId);
    const p2 = await join(code, 'player', { resumeToken: p.resumeToken });
    expect(p2.playerId).toBe(p.playerId);
    const after = await host2.client.next('spike.state', (s) => s.players[0]?.connected === true);
    expect(after.seq).toBeGreaterThan(before.seq);
    expect(after.players[0]).toMatchObject({ name: 'Gus', taps: 3 });
    expect(after.lastTap?.tapId).toBe('3');
    host2.client.close();
    p2.client.close();
  });

  it('hibernation keeps sockets open and seats attached', async () => {
    const code = await createRoom();
    const host = await join(code, 'host');
    const p = await join(code, 'player', { name: 'Hal' });
    p.client.send({ t: 'spike.tap', tapId: 'pre', sentAt: 1 });
    await host.client.next('spike.state', (s) => s.lastTap?.tapId === 'pre');

    await server.getWorker().evictDurableObject('Room', { name: code, webSockets: 'hibernate' });

    // Same sockets, no new hello: the seat lives in the socket attachment.
    p.client.send({ t: 'spike.tap', tapId: 'post', sentAt: 2 });
    const s = await host.client.next('spike.state', (st) => st.lastTap?.tapId === 'post');
    expect(s.players[0]).toMatchObject({ playerId: p.playerId, taps: 2, connected: true });
    expect(s.host.connected).toBe(true);
    host.client.send({ t: 'ping', time: 5 });
    expect((await host.client.next('pong')).time).toBe(5);
    host.client.close();
    p.client.close();
  });
});

describe('idle expiry', () => {
  let short: TestHarness;
  let shortBase: URL;
  const idleMs = 800;

  beforeAll(async () => {
    short = createTestHarness({
      workers: [{ configPath, vars: { ROOM_IDLE_EXPIRY_MS: String(idleMs) } }],
    });
    shortBase = (await short.listen()).url;
  }, 60_000);

  afterAll(async () => {
    await short?.close();
  });

  it('an alarm deletes the room after the idle time; activity postpones it', async () => {
    const make = async () => {
      const res = await fetch(new URL('/rooms', shortBase), { method: 'POST' });
      return ((await res.json()) as { code: string }).code;
    };
    const exists = async (code: string) =>
      ((await (await fetch(new URL(`/rooms/${code}`, shortBase))).json()) as { exists: boolean })
        .exists;

    const idle = await make();
    const busy = await make();
    const u = new URL(`/parties/room/${busy}`, shortBase);
    u.protocol = 'ws:';
    const client = await connect(u.toString());
    client.send(hello(busy, 'host'));
    await client.next('welcome');
    const keepAlive = setInterval(() => client.send({ t: 'ping', time: Date.now() }), 100);

    await new Promise((r) => setTimeout(r, idleMs * 3));
    expect(await exists(idle)).toBe(false);
    expect(await exists(busy)).toBe(true);

    clearInterval(keepAlive);
    const err = await client.next('error', (e) => e.code === 'room_not_found', idleMs * 4);
    expect(err.message).toMatch(/expired/);
    expect((await client.closed).code).toBe(4004);
    expect(await exists(busy)).toBe(false);

    // An expired code refuses new connections like a code that never existed.
    const late = await connect(u.toString());
    expect((await late.next('error')).code).toBe('room_not_found');
  }, 20_000);
});
