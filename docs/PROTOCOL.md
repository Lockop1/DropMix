# Room protocol

Schemas: `packages/protocol/src/contracts.ts` (zod, the source of truth). This file explains them and records version changes.

## Version 1 — draft

Status: **draft until Phase 3 (task 3B)**. Phase 0 exercises `hello`, `welcome`, `ping`, `pong` only.

Transport: one WebSocket per participant to the room's Durable Object. Every frame is a JSON object with a `t` discriminator, validated on both ends. Frames over 64 KiB are rejected.

Only text metadata crosses the network. Audio and art never do.

### Client → server

| `t` | Fields | Who |
|---|---|---|
| `hello` | `v`, `code`, `role`, `name?`, `avatar?`, `resumeToken?` | anyone, first frame |
| `host.catalog` | `packId`, `chunk`, `chunks`, `cards[]` (public card metadata) | host |
| `lobby.settings` | `mode`, `cfg` | host |
| `lobby.deck` | `source`, `playlistId?`, `cardIds?` | player |
| `lobby.ready` | `ready` | player |
| `lobby.start` | — | host |
| `intent` | `intentId`, `intent` (an engine `Intent`) | anyone seated |
| `view.request` | — | anyone seated (after a `seq` gap) |
| `ping` | `time` | anyone, after `hello` |

### Server → client

| `t` | Fields |
|---|---|
| `welcome` | `v`, `playerId`, `resumeToken`, `serverTime` |
| `view` | `seq`, `public`, `private?` — the full filtered view on every change |
| `ack` | `intentId` |
| `reject` | `intentId`, `code`, `message` |
| `pong` | `time` (echo), `serverTime` |
| `error` | `code`, `message?` |

### Rules

- Intents are idempotent by `intentId`.
- `seq` is monotonic per room. On a gap the client sends `view.request`.
- `private` is only ever the recipient's own seat.
- 20 messages per second per connection; excess gets `error{rate_limited}`.

### Differences from the build prompt's sketch (§10.3)

- The discriminator field is `t`, so `ping`/`pong` carry `time` instead of `t`.
- `intent` wraps the engine intent as `intent: { type, … }` rather than `type` + `payload`.
- `view.request` is added to make "on a gap, the client requests a fresh view" explicit.
- `host.catalog` carries `chunk`/`chunks` for chunked uploads.

## Transport details established by the rooms spike (0D)

- HTTP: `POST /rooms` → `{ code }` creates a room; `GET /rooms/:code` → whether it exists. WebSocket path: `/parties/room/:code`. In development the web app proxies all of it under `/rooms-api`.
- A WebSocket to a code that was never created gets `error{room_not_found}` and a close.
- Close codes 4000–4999 mean "do not reconnect": 4000 `hello` names a different room than the socket's, 4001 replaced by a newer connection for the same seat, 4003 not host, 4004 room not found, 4005 unsupported version, 4009 room full.
- `rate_limited` is sent at most once per window; excess frames are dropped.
- A frame before `hello` gets `bad_message`. A valid v1 message the server does not implement yet gets `wrong_phase`.
- `ping.time` is the client's own clock, echoed back unchanged; `serverTime` is the server's.
- Spike-only messages (`spike.tap`, `spike.state`) live in `packages/protocol/src/spike.ts` and are not part of v1. The file is deleted in Phase 3.

## Planned for the v1 freeze (Phase 3, task 3B)

Accepted from the spike's findings; not yet in the schemas:

1. **Close the host-claim race.** Today the first `hello{role:'host'}` claims a new room, so someone who learns the code before the host connects could take the host seat. `POST /rooms` will return `{ code, hostToken }` and the host's first `hello` must carry that token as `resumeToken`.
2. **Error codes** `not_player` (a host or unseated socket sent a player-only message) and `replaced` (sent before a 4001 close).
3. **Limits** `helloTimeoutMs` (close sockets that never say `hello`) and a per-IP join rate limit against room-code guessing (§10.3).

## Change log

| Version | Date | Change |
|---|---|---|
| 1 (draft) | 2026-11-11 | Initial draft. |
