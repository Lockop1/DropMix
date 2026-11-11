# ADR 0002 — Package dependency direction and where shared types live

Status: accepted (2026-11-11)

## Context

§6.3 puts the core card/board types in `packages/engine/src/contracts.ts`. `Role` is also needed by `packages/harmony` (transposition depends on role), which must stay dependency-free, and by `packages/pack` (the pack schema contains `CardDef`).

## Decision

```
harmony  ←  engine  ←  pack  ←  audio
                 ↖  protocol
```

- `Role`, `Mode`, `Pcs` and all tunable music constants are defined in `@stemdeck/harmony`. `@stemdeck/engine` re-exports `Role`, so §6.3's "core types live in the engine contracts" still holds for consumers.
- `CardDef`, `FxSpec`, board, intent and view types are TypeScript interfaces in `@stemdeck/engine` (which has no runtime dependencies, not even zod).
- zod schemas live in `@stemdeck/pack` (pack manifest) and `@stemdeck/protocol` (room messages). Each schema is declared `satisfies z.ZodType<TheInterface>`, so a schema that drifts from its interface fails typecheck.
- `RoomClient` lives in the engine contracts because both `LocalRoom` (engine) and `RemoteRoom` (protocol/web) implement it.

## Consequences

- The engine stays pure and tiny; it can run unchanged in a Durable Object.
- zod 4 is required (`z.toJSONSchema`, `z.strictObject`, `z.iso`, `z.json`).
