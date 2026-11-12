# @stemdeck/rooms

Rooms backend: a Cloudflare Worker plus one `Room` Durable Object per room code, built on
[`partyserver`](https://www.npmjs.com/package/partyserver). Phase 0 (task 0D) is a spike: rooms,
seats, resume and a relayed "tap". Phase 3 replaces the tap with the engine (see
`docs/BUILD_PROMPT.md` §10 and `docs/spikes/rooms.md`).

**Local only.** There is no Cloudflare account, no route and no deploy step. Never run
`wrangler login`, `wrangler deploy` or `wrangler publish`.

## Run

```sh
pnpm dev:rooms          # from the repo root: wrangler dev on http://localhost:8787
curl -X POST localhost:8787/rooms     # → {"code":"ABCD"}
```

The scripts set `WRANGLER_SEND_METRICS=false` (no telemetry; `send_metrics: false` is also in
`wrangler.jsonc`), `CLOUDFLARE_CF_FETCH_ENABLED=false` (skip the `Request.cf` download) and
`WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`. Local Durable Object storage lives in
`.wrangler/state/` (gitignored).

## HTTP and WebSocket

| | |
|---|---|
| `POST /rooms` | create a room → `201 {code}` (4 letters from `ROOM_CODE_ALPHABET`, unique among live rooms) |
| `GET /rooms/:code` | `{code, exists}`; `400` for a malformed code |
| `GET /health` | `{ok: true}` |
| `WS /parties/room/:code` | the room socket (partyserver routing; partysocket's default URL shape) |

Frames are JSON, validated with `@stemdeck/protocol` (+ `@stemdeck/protocol/spike` for
`spike.tap` / `spike.state`). The first frame must be `hello`. Fatal refusals send `error{code}`
and close with a 4xxx code (`4003` not_host, `4004` room_not_found, `4005` unsupported_version,
`4009` room_full, `4001` seat taken over by a newer connection).

## Layout

| File | |
|---|---|
| `src/index.ts` | Worker: HTTP routes, code generation with retry, partyserver routing |
| `src/room-server.ts` | `Room` Durable Object: thin adapter (hibernation on, storage, alarm) |
| `src/logic/room.ts` | pure: seats, host claim, resume, capacity, tap counting, public state |
| `src/logic/frames.ts` | pure: size check, JSON, zod validation; validated outbound frames |
| `src/logic/rate-limit.ts` | pure: 20 msg/s sliding window per connection |
| `src/logic/ids.ts` | room codes, ≥128-bit resume tokens, player ids |
| `src/logic/expiry.ts` | idle expiry (`ROOM_IDLE_EXPIRY_MS`, default 30 min) |

## Test

`pnpm --filter @stemdeck/rooms test` runs the pure-logic unit tests and integration tests that
start the Worker in workerd through wrangler's `createTestHarness` (eviction, hibernation and a
short idle expiry included). `@cloudflare/vitest-pool-workers` is not used: its current release
needs Vitest 4 and this repo is on Vitest 5.
