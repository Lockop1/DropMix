# Spike 0D — rooms (Durable Object room server + `/roomlab`)

Status: done in the cloud build container (loopback only). The phone-over-internet numbers are
the user's to take at Checkpoint 0 (instructions below).

**Question.** Can one Cloudflare Durable Object per room, built with `partyserver` and reached
with `partysocket`, run locally without an account, keep seats across refreshes and reconnects,
and relay a player's action to the host fast enough for the Phase 3 budget (player intent → host
board update p95 ≤ 250 ms, `docs/BUILD_PROMPT.md` §16.2)?

**Answer.** Yes on everything that can be measured here. On loopback, tap → host DOM update is
p50 ≈ 9 ms, p95 ≈ 15–22 ms, max < 45 ms over 200–300 taps; ping round-trip p50 ≈ 1.5 ms.
Refresh resume and host reclaim work and are tested. `wrangler dev` runs fully offline with no
login. These loopback numbers are a **floor**, not the phone number: a phone on Wi-Fi or
cellular going through a tunnel adds its own network round trip on top.

## What was built

| Piece | Where |
|---|---|
| Worker: `POST /rooms`, `GET /rooms/:code`, `GET /health`, WebSocket routing | `apps/rooms/src/index.ts` |
| `Room` Durable Object (partyserver `Server`, hibernation on), thin adapter | `apps/rooms/src/room-server.ts` |
| Pure room logic: seats, host claim, resume tokens, capacity, tap counting, public state | `apps/rooms/src/logic/room.ts` |
| Pure frame codec (size → JSON → zod), validated outbound frames | `apps/rooms/src/logic/frames.ts` |
| Pure rate limiter (20 msg/s sliding window), ids/tokens, idle expiry, close codes | `apps/rooms/src/logic/*.ts` |
| Spike-only messages `spike.tap` / `spike.state` (deleted in Phase 3) | `packages/protocol/src/spike.ts` (`@stemdeck/protocol/spike`) |
| Host page `/roomlab` → `/roomlab/host/:code`; player pages `/roomlab/join`, `/roomlab/join/:code` | `apps/web/src/routes/roomlab/` |
| Same-origin proxy `/rooms-api` → `http://localhost:8787` (HTTP + WebSocket) | `apps/web/vite.config.ts` |
| Server unit + integration tests (workerd via wrangler's test harness) | `apps/rooms/test/` |
| Playwright: host (desktop) + players (360×640 touch) | `e2e/tests/roomlab.spec.ts` |
| Latency bench (standalone) | `e2e/bench/rooms-latency.mjs` (`pnpm --filter @stemdeck/e2e bench:rooms`) |

Protocol as implemented: the first frame must be `hello{v, code, role, name?, avatar?,
resumeToken?}`; the server answers `welcome{v, playerId, resumeToken, serverTime}` and then
broadcasts the full `spike.state{seq, players[], host, lastTap?}` to every seated socket on every
change (`seq` monotonic and persisted). `ping{time}` → `pong{time, serverTime}`. Only seated
players may send `spike.tap{tapId, sentAt}`; the server counts. Every inbound frame is checked for
size (`LIMITS.maxMessageBytes`, UTF-8 bytes → `error{too_large}`), then JSON + zod
(`error{bad_message}`; `hello` with another `v` → `error{unsupported_version}`), after the per-
connection rate limit (`error{rate_limited}` once per window, excess dropped). Valid v1 messages
the spike does not implement (`intent`, `lobby.*`, …) get `error{wrong_phase}`. Every outbound
frame is validated too, so an extra field such as a token cannot be serialized onto
`spike.state`. The client validates every inbound frame and drops invalid ones.

Fatal refusals send `error{code}` and close with a 4xxx code; the client never reconnects on
4000–4999: `4003` not_host, `4004` room_not_found, `4005` unsupported_version, `4009`
room_full, `4001` seat taken over by a newer connection with the same token.

## Environment measured on

- Cloud build container (ADR 0001), **not** the user's laptop: Linux x86_64, 4 vCPU (Intel Xeon
  @ 2.10 GHz), 15 GB RAM, Node 22.23.4, pnpm 10.28.0.
- Headless Chromium (Playwright 1.63.0, Chrome for Testing 153.0.8010.12, build 1243). Host in a
  desktop context, players in 360×640 `isMobile`/`hasTouch` contexts, all in one browser process.
- Everything on loopback: browser → Vite dev server (:5173, `/rooms-api` proxy) → `wrangler dev`
  (:8787, workerd). No TLS, no tunnel, no radio.
- **Shared machine**: other agents were building and testing at the same time (load average
  2.3–4.1 on 4 cores during the runs). Numbers are indicative, not a clean benchmark.

## Library versions and what was verified about their current APIs

| Package | Version | License | Verified (from the installed package's README/types/source, and by running it) |
|---|---|---|---|
| `partyserver` | 0.5.10 (exact pin) | ISC | `Server extends DurableObject`. Hooks `onStart`, `onConnect(conn, ctx)`, `onMessage`, `onClose`, `onError`, `onRequest`, `onAlarm`; you must **not** override `webSocketMessage`/`webSocketClose`/`alarm`. **Hibernation:** `static options = { hibernate: true }` (uses `ctx.acceptWebSocket`); per-connection state goes in the socket attachment via `connection.setState()` (README: up to 2 KB) and survives hibernation. **Addressing:** `routePartykitRequest(req, env, opts)` maps `/parties/<kebab binding>/<name>` to `env.<Binding>.idFromName(name)`; `getServerByName(ns, name)` returns a stub after an RPC that awaits `onStart()`; `this.name` comes from `ctx.id.name`. `onBeforeConnect`/`onBeforeRequest` can veto a request. partyserver writes its own `__ps_name` key into storage on first start, so "storage is empty" does **not** mean "room never created" — the room keeps an explicit `room` key, and storage of a never-created code is deleted again. Connection `id` is the client's `_pk` query parameter (client-controlled; never used for identity here). |
| `partysocket` | 1.3.0 (exact pin) | MIT | `new PartySocket({host, prefix, party, room, protocol, …ReconnectingWebSocket options})` → `${protocol}://${host}/${prefix}/${party}/${room}?_pk=<uuid>`. Auto-reconnect with backoff; `shouldReconnectOnClose(ev)` lets the client stop on 4xxx. If `protocol` is omitted it picks `ws` only for localhost/private IPs, so the client passes it explicitly from the page's scheme. Messages queued while offline are flushed **before** the `open` listeners run, which would put a frame ahead of `hello`; the client sets `maxEnqueuedMessages: 0`. Its `event-target-polyfill` dependency is only used by a separate subpath and is not in our bundle. |
| `wrangler` | 4.155.0 (exact pin, 2026-10-28) | MIT OR Apache-2.0 | `wrangler dev` is local by default (`--remote` is opt-in). `send_metrics: false` in `wrangler.jsonc` and `WRANGLER_SEND_METRICS=false` disable telemetry. `createTestHarness()` (exported from `wrangler`) runs the Worker in workerd from Node, with `getWorker().evictDurableObject(name, {webSockets: 'close' \| 'hibernate'})` and per-test `vars` — used for the eviction, hibernation and expiry tests. Also has `wrangler dev --tunnel` (Cloudflare Quick Tunnel; not used, it needs `cloudflared`). |
| `workerd` | 1.20261023.1 (via wrangler) | Apache-2.0 | Starts in this container. `compatibility_date` must not be newer than the bundled workerd (set to 2026-10-20). Its `postinstall` (binary check) is skipped by pnpm's build-script policy; the platform binary comes from the optional `@cloudflare/workerd-linux-64` package and works without it. |
| `miniflare` | 5.20261023.2-beta (via wrangler) | MIT | Local DO storage (SQLite-backed, `new_sqlite_classes`), alarms and WebSocket hibernation all behave as on the platform as far as these tests can see. Persisted under `apps/rooms/.wrangler/state/` (gitignored). |
| `@cloudflare/workers-types` | 5.20261110.1 | MIT OR Apache-2.0 | Types only (`DurableObjectNamespace<T>` gives typed RPC on the stub: `stub.create()`, `stub.exists()`). |
| `@cloudflare/vitest-pool-workers` | not added | — | 0.23.0 needs `vitest ^4.1.0`; the repo is on Vitest 5. The server is tested with plain Vitest: pure logic as functions, the Worker through `createTestHarness`. |
| `qrcode-generator` | 2.0.4 (exact pin) | MIT | `qrcode(0, 'M').addData(url).make()`, then `isDark(r, c)` per module → one SVG path. Runs locally, no network. |

**Alarms and storage.** `ctx.storage.setAlarm()` + partyserver's `onAlarm()` fire in local
workerd: with `ROOM_IDLE_EXPIRY_MS=800` an idle room was deleted (`GET /rooms/:code` →
`exists:false`, sockets get `error{room_not_found}` + close 4004) while a room kept busy by pings
survived three idle periods. The room record is written with `ctx.storage.put('room', …)` after
every change; activity (and the alarm) is recorded at most once per `min(10 s, idle/10)` to
avoid a write per ping, and the alarm is set to `lastActivity + idle + throttle` so a room never
expires early.

**A workerd quirk found here.** Closing a hibernatable socket from inside `onConnect` (before the
101 response is returned) delivers the close to the client only after ~10 s locally. Unknown
codes are therefore refused in the Worker (`onBeforeConnect` → `stub.exists()` → a Worker-side
`WebSocketPair` that sends `error{room_not_found}` and closes at once). Cost: one extra DO RPC per
WebSocket connect.

## Latency (loopback floor)

Method: the player page timestamps the tap (`performance.timeOrigin + performance.now()`) right
before its click handler sends `spike.tap`; a `MutationObserver` that the test installs in the
host page timestamps the moment the host's DOM shows that `tapId` as the last tap. Both clocks
are in the same browser on the same machine, so Playwright's own round trips are not included.
Taps round-robin over 3 players, ≥60 ms apart (well under the 20 msg/s limit). Ping is measured
by the pages themselves (`ping` every 250 ms, `pong` echoes `time`).

Bench, via the Vite proxy (the phone path), 300 taps
(`node e2e/bench/rooms-latency.mjs --taps 300`, 2026-11-12 00:09 UTC, load avg 2.3):

| Metric | p50 | p95 | max | n |
|---|---|---|---|---|
| tap → host DOM update | 8.5 ms | 14.4 ms | 31.8 ms | 300 |
| ping RTT (host) | 1.7 ms | 6.8 ms | – | 106 |
| ping RTT (player 1) | 1.6 ms | 4.2 ms | – | 103 |
| ping RTT (player 2) | 1.5 ms | 6.0 ms | – | 101 |
| ping RTT (player 3) | 1.4 ms | 4.3 ms | – | 99 |
| player reload → back in seat (same id, name, taps) | 181 ms (median) | – | 222 ms | 5 |
| host reload → room reclaimed, players listed | 213 ms (median) | – | 291 ms | 5 |

Same bench straight to `wrangler dev` (`VITE_ROOMS_URL=http://localhost:8787`, no proxy hop),
300 taps: tap → host p50 8.0 / p95 14.6 / max 38.8 ms; ping p50 1.0–1.1 / p95 5.3–7.9 ms. The
proxy adds about half a millisecond of round trip.

Playwright spec (`pnpm e2e -- --trace off`, full suite, 200 taps per project):

| Project | tap → host p50 | p95 | max | ping p50 (4 pages) | ping p95 (4 pages) |
|---|---|---|---|---|---|
| desktop-chromium | 11.7 ms | 20.1 ms | 38.4 ms | 1.1–1.4 ms | 6.0–11.9 ms |
| mobile-360 | 10.8 ms | 18.2 ms | 20.4 ms | 1.1–1.3 ms | 5.1–8.0 ms |

The spec asserts p95 ≤ 250 ms (the §16.2 budget). On loopback the server work (validate, apply,
persist, broadcast) and the host's React render dominate: a ping round trip is ≈ 1.5 ms, so
roughly 7 ms of the ≈ 9 ms median is not network (inferred, not separately timed). On a phone
the tap path is roughly *phone → server* + *server → host* one-way, i.e. about one round trip
per participant link, plus this floor.

## Reconnect and refusal results (all automated)

| Case | Result | Test |
|---|---|---|
| Player page refresh | same `playerId`, name, glyph and tap count; host shows them online again | `roomlab.spec.ts` (c); `worker.integration.test.ts` "reconnects with the resume token" |
| Host page refresh | same host `playerId`, same room code, all players and counts back | `roomlab.spec.ts` (d); integration "host reclaims with its token" |
| `/roomlab` after hosting | offers "Back to room CODE" | `roomlab.spec.ts` |
| Second would-be host | `error{not_host}`, close 4003; real host unaffected | `roomlab.spec.ts` (e); integration |
| 9th participant | `error{room_full}`, close 4009; a seated player can still resume while full | `roomlab.spec.ts` (e); integration |
| Same token in a second tab | newer socket takes the seat; older one closed with 4001 | integration |
| Never-created / expired code | `error{room_not_found}` + close 4004; `GET /rooms/:code` → `exists:false` | integration; player page checks before showing the form |
| DO evicted (in-memory state dropped, sockets closed) | room, seats, taps, `lastTap` and `seq` restored from storage on reconnect | integration "survives the Durable Object being evicted" |
| DO hibernated (sockets kept) | same sockets keep working without a new `hello`; seats come back from the socket attachment | integration "hibernation keeps sockets open" |
| Invalid JSON, off-schema, extra fields, binary, > 64 KiB, wrong version, first frame not `hello` | `bad_message` / `too_large` / `unsupported_version`; connection survives (except a bad version on `hello`) | integration + `logic.test.ts` |
| > 20 msg/s on one socket | 19 pongs (hello counted) + one `rate_limited`, rest dropped; flows again after a second | integration + `logic.test.ts` |
| Resume tokens on the wire | each page receives only its own token, only in its `welcome`; no other frame mentions a token; pages send only `hello`/`ping`/`spike.tap` | `roomlab.spec.ts` (f) on every frame of every page; integration |
| 360×640, touch only | no horizontal scroll on `/roomlab`, host screen, `/roomlab/join`, join form, tap pad, "room full" | `roomlab.spec.ts` |

## What `wrangler dev` needs from the network

Runs fully offline, no login prompt, no account. Verified by running `wrangler dev` with
`HTTPS_PROXY`/`HTTP_PROXY` pointed at a local proxy that logs and refuses every connection: it
started, served `POST /rooms` → 201, and made **no** outbound attempts. What it would contact by
default, and how this repo handles it:

| Outbound call | Default | Here |
|---|---|---|
| Telemetry to Cloudflare | on unless disabled | off: `send_metrics: false` + `WRANGLER_SEND_METRICS=false` |
| `https://workers.cloudflare.com/cf.json` (the `Request.cf` placeholder) | fetched (3 s timeout), cached 30 days; on failure it warns and falls back | skipped: `CLOUDFLARE_CF_FETCH_ENABLED=false` in the scripts |
| npm registry "update available" check for the banner | 3 s timeout, cached 1 h in the OS temp dir; harmless offline | left on (registry is reachable; set `WRANGLER_HIDE_BANNER=true` to skip) |
| Cloudflare API / login | only for `--remote`, deploy, login | never used |

It prints "Wrangler detected this dev session is running in an AI agent" plus local explorer API
URLs; that is informational, not a prompt. `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true` is set so it
never offers to install agent skills.

## Free-tier limits that matter for Phase 3

The installed packages do not document Cloudflare's plan limits, so almost all of this is
**unverified** and must be checked against Cloudflare's pricing/limits pages before Phase 3's
preview deploy (which needs the user's approval of an account anyway).

| Topic | Status | Note |
|---|---|---|
| Durable Objects on the Workers Free plan | unverified | Believed available only as SQLite-backed classes. This project already uses `new_sqlite_classes` (as partyserver's README does). |
| Requests / day (Worker + DO) | unverified | Believed to be a daily request cap on Free. Each WebSocket connect is a request; whether and how inbound WebSocket messages count toward DO requests (a ratio) needs checking — at one `ping` per second per phone it matters. |
| DO duration (GB-s) | unverified | Hibernation is what keeps idle rooms cheap, but a socket that pings every second never lets the DO hibernate. Phase 3 should consider the runtime's WebSocket auto-response for keepalive (`setWebSocketAutoResponse`, answers without waking the DO) and send JSON `ping` only when measuring. |
| DO storage writes / rows | unverified | This spike writes the room record on every change (one write per tap). Phase 3 applies an engine intent per write; fine at party scale, worth counting. |
| WebSocket message size | partly | Our own cap is 64 KiB (`LIMITS.maxMessageBytes`); the local runtime accepted the 64 KiB+ frame and our code rejected it. The platform's own cap was not checked. |
| Connection state | verified (README) | partyserver: attachment up to 2 KB per connection, up to 9 tags per connection. We store `{playerId, role}` only. |

## How the user tests from a phone (laptop, WSL2)

1. `pnpm install`
2. Terminal 1: `pnpm dev` (Vite on :5173; it proxies `/rooms-api` to the room server).
3. Terminal 2: `pnpm dev:rooms` (room server on :8787; no login, nothing to configure).
4. Terminal 3: `cloudflared tunnel --url http://localhost:5173` (a Quick Tunnel: no account;
   install `cloudflared` yourself). It prints an `https://….trycloudflare.com` URL.
5. On the laptop, open **that https URL** at `/roomlab` (not `localhost`: the QR code encodes the
   page's own origin) and press **Create room**.
6. Scan the QR code with the phone (or open `/roomlab/join` and type the code). Pick a name and a
   glyph, press **Join**, then **Tap**. The laptop highlights the tap; both screens show ping
   last/p50/p95.
7. Try: refresh the phone (same seat and count), refresh the laptop (room comes back), lock the
   phone for a minute and unlock (it reconnects and resumes), join from a second phone, open the
   host URL on the phone (refused: not the host).
8. Copy the ping p50/p95 from both screens into `docs/playtests/phase-0.md`, once on Wi-Fi and
   once on cellular.

`VITE_ROOMS_URL` overrides the room server URL (e.g. `VITE_ROOMS_URL=http://localhost:8787 pnpm
dev` to bypass the proxy). Haptics: `navigator.vibrate` works on Android Chrome; iOS Safari has
no vibrate API (the tap still works).

## What could not be measured here

- A real phone, real Wi-Fi or cellular, a real tunnel (Cloudflare's tunnel endpoints are not
  reachable from this container) — so no internet RTT, no tunnel overhead, no radio wake-up
  latency, no behaviour when iOS suspends a backgrounded tab.
- The deployed platform: DO placement relative to players, cold starts, real hibernation timing,
  plan limits and billing.
- Long sessions (only seconds-to-minutes runs here), many concurrent rooms, and room-code
  brute-force behaviour under load.
- The laptop itself (WSL2 networking, Windows firewall prompts).

## Risks

1. **Phone RTT is the budget.** Loopback leaves ~230 ms of the 250 ms p95 budget for the network.
   One tunnel hop to a laptop on home Wi-Fi is probably fine; cellular with a far-away DO
   placement may not be. Measure at Checkpoint 0 before committing Phase 3's UX (optimistic
   pending states hide most of it on the phone; the host board cannot be optimistic).
2. **Host claim race.** The first `hello{role:'host'}` claims a new room. Someone who learns a code
   between `POST /rooms` and the host's first connect could take the host seat. Fix in Phase 3:
   `POST /rooms` returns the host token (contract change below).
3. **Room-code guessing.** 23⁴ ≈ 280k codes; joins are not rate-limited per client yet, and each
   probe of an unknown code wakes a DO (its storage is deleted again). Add per-IP join limits in
   the Worker in Phase 3 (§10.3 asks for brute-force protection).
4. **Keepalive vs hibernation/billing** (see the free-tier table).
5. **partyserver is 0.x** and already deprecating fields (`lobby.party`). Pinned exactly; its
   routing and connection management are thin enough to replace with the raw hibernation API if
   it churns.
6. **Two tabs with the same token** fight for a seat (the newer one wins, the older one shows
   "Not connected"). Acceptable; Phase 3 could add an explicit `error` code for it.
7. Resume tokens are bearer secrets kept in plain text (localStorage on the client, DO storage on
   the server). Fine for a party game; hash them server-side if accounts ever exist.
8. The Vite proxy logs `ECONNRESET`/`EPIPE` when a browser drops a socket abruptly (context
   close, tab kill). Harmless noise in `pnpm e2e` output.

## Recommendation

Adopt Durable Objects via `partyserver` + `partysocket` for Phase 3 as specified, keeping this
spike's shape: pure room logic (Phase 3: the engine) behind a thin `Room` adapter, explicit
`room` record in storage written after each apply, socket attachment for the seat, Worker-side
refusal of unknown codes, validated frames in both directions, the 4xxx close-code convention,
and same-origin `/rooms-api` in development. Test the server with wrangler's `createTestHarness`
until `@cloudflare/vitest-pool-workers` supports Vitest 5. Before Phase 3: take the phone numbers
at Checkpoint 0, return the host token from `POST /rooms`, add join rate limiting, and decide the
keepalive strategy against the (to be verified) plan limits.

## Draft ADR: rooms transport

**Status:** proposed (spike 0D).

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
