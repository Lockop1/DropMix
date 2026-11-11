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
| `ping` | `time` | anyone |

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

## Change log

| Version | Date | Change |
|---|---|---|
| 1 (draft) | 2026-11-11 | Initial draft. |
