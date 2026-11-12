# ADR 0007 — Rooms transport: Durable Objects via partyserver

Status: accepted (2026-11-12), from spike 0D. Report: `docs/spikes/rooms.md`.

**Context.** Rooms need an authoritative, stateful server per room that runs the engine, keeps
seats across refreshes and reconnects, expires idle rooms, and relays intents to the host fast
enough for p95 ≤ 250 ms. The build environment has no Cloudflare account; development must work
offline, and phones must reach a laptop through one tunnel URL. §5.1 names Cloudflare Workers +
Durable Objects via `partyserver`/`partysocket`, to be verified.

**Options.**
1. Durable Objects with `partyserver` (server) + `partysocket` (client).
2. Durable Objects with the raw WebSocket hibernation API (`ctx.acceptWebSocket`, attachments)
   and a hand-written reconnecting client.
3. A hosted pub/sub (e.g. Supabase Realtime): cannot run authoritative game logic.
4. A self-hosted Node WebSocket server on the laptop: no hosting story for Phase 5+, and no
   hibernation/alarms.

**Decision.** Option 1, pinned exactly (`partyserver` 0.5.10, `partysocket` 1.3.0, `wrangler`
4.155.0). One `Room` DO per 4-letter code, addressed with `idFromName(code)` through
`routePartykitRequest` (`/parties/room/:code`) and `getServerByName` (HTTP create/exists RPC).
Hibernation on; seat in the socket attachment; room record in DO storage after every change;
idle expiry by alarm. Room logic stays in pure modules; the DO is an adapter. Unknown codes are
refused in the Worker. Fatal errors close with 4000–4999 and the client does not reconnect on
them. In development the web app proxies `/rooms-api` to `wrangler dev`, so one origin serves
pages, HTTP and WebSockets.

**Consequences.**
- Local development and tests need no account or network (`send_metrics: false`,
  `CLOUDFLARE_CF_FETCH_ENABLED=false`); the server is tested in real workerd through
  `createTestHarness`, including eviction and hibernation.
- `compatibility_date` is tied to the bundled workerd; bumping wrangler is a deliberate change.
- partyserver is 0.x: upgrades get read and tested, and option 2 stays a cheap fallback because
  the room logic does not depend on it.
- Deploying (Phase 3F preview) needs the user's Cloudflare account approval and a check of plan
  limits (request counts, keepalive cost, storage writes), recorded as unverified here.
