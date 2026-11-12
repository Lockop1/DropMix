/**
 * Rooms Worker (task 0D spike).
 *
 *   POST /rooms                 create a room → 201 { code }
 *   GET  /rooms/:code           { code, exists }
 *   GET  /health                { ok: true }
 *   WS   /parties/room/:code    the room's WebSocket (partyserver routing; partysocket default)
 *
 * The room's Durable Object is addressed by name: `idFromName(code)`. Only codes that match
 * `ROOM_CODE_REGEX` ever reach a Durable Object.
 */

import { ROOM_CODE_REGEX } from '@stemdeck/protocol';
import { getServerByName, routePartykitRequest } from 'partyserver';
import { closeCodeFor } from './logic/close-codes';
import { errorFrame } from './logic/frames';
import { generateRoomCode } from './logic/ids';
import type { Env } from './room-server';

export { Room } from './room-server';

/** Collisions are rare (23^4 ≈ 280k codes); give up after this many tries. */
const CREATE_ATTEMPTS = 8;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

/**
 * Accepts a WebSocket in the Worker itself, sends one `error` frame and closes it. Used for codes
 * that are not live rooms, so the client gets a protocol error instead of a bare HTTP failure.
 */
function refuseSocket(code: 'room_not_found', message: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(errorFrame(code, message));
  server.close(closeCodeFor(code), code);
  return new Response(null, { status: 101, webSocket: client });
}

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const stub = await getServerByName(env.Room, code);
    if (await stub.create()) return json({ code }, 201);
  }
  return json({ error: 'no free room code, try again' }, 503);
}

async function roomExists(env: Env, code: string): Promise<Response> {
  if (!ROOM_CODE_REGEX.test(code)) return json({ error: 'invalid room code' }, 400);
  const stub = await getServerByName(env.Room, code);
  return json({ code, exists: await stub.exists() });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/health') return json({ ok: true });
    if (path === '/rooms') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return createRoom(env);
    }
    const match = /^\/rooms\/([^/]+)$/.exec(path);
    if (match) {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return roomExists(env, decodeURIComponent(match[1] ?? ''));
    }

    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect: async (_req, lobby) => {
        if (lobby.className !== 'Room' || !ROOM_CODE_REGEX.test(lobby.name)) {
          return new Response('invalid room code', { status: 404 });
        }
        const stub = await getServerByName(env.Room, lobby.name);
        if (!(await stub.exists())) return refuseSocket('room_not_found', 'no room with this code');
      },
      // The Durable Object only speaks WebSocket; HTTP goes through /rooms above.
      onBeforeRequest: () => new Response('not found', { status: 404 }),
    });
    return routed ?? json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
