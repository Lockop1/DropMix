# Phases — task tracker

Status values: `todo` · `in-progress` · `review` · `done` · `blocked`.
The orchestrator updates this file after every integration. Scope for each task is in `docs/BUILD_PROMPT.md` §14.

## Phase 0 — Foundations + risk spikes

| Id | Task | Owner | Status | Links |
|---|---|---|---|---|
| 0-docs | `CLAUDE.md`, docs skeleton, Phase 0–1 contracts | orchestrator | done | ADR 0001–0003 |
| 0A | Repo scaffold: pnpm + Turborepo, Biome, Vitest, Playwright, CI, gitignore, pre-commit guards | subagent | done | ADR 0004 |
| 0B | Audio spike: `/lab`, Stretcher candidates, render timings, seam test, FLAC decode | subagent | in-progress | `docs/spikes/audio.md` |
| 0C | Forge spike: setup script, `forge doctor`, `forge fixtures`, analysis accuracy on fixtures, dependency install report | subagent | in-progress | `docs/spikes/forge.md` |
| 0D | Rooms spike: minimal Durable Object room, host code + QR, join, tap, latency, reconnect | subagent | done | `docs/spikes/rooms.md`, ADR 0007 |
| 0V | Phase 0 verifier | subagent (fresh) | todo | |
| 0P | `docs/playtests/phase-0.md` + checkpoint summary | orchestrator | todo | |

Deferred to the user's machine at Checkpoint 0 (cannot run in a cloud session — ADR 0001):

- 0B: render timings and FLAC decode on the user's phones; A/B by ear.
- 0C: separation on 3 real songs with 2 separator configs, GPU timings, the separator ADR's final pick.
- 0D: joining the test room from a phone over a quick tunnel.

## Phase 1 — MVP: solo Freestyle on one device

| Id | Task | Owner | Status | Links |
|---|---|---|---|---|
| 1A | `packages/harmony` v1 (§7.1 base, §7.2, §7.3) | — | todo | |
| 1B | `packages/engine`: board, cards, stacking, Freestyle, `LocalRoom`, intent log + replay | — | todo | |
| 1C | `packages/audio` v1: transport, worker scheduler, render pool + Stretcher, LRU cache, reconciler, graph, iOS unlock/session/wake-lock | — | todo | depends on 1A |
| 1D | `packages/pack`: schema + JSON Schema export, zip → OPFS import, catalog API, lazy decode | — | todo | |
| 1E | Forge v1: ingest → top-1 candidates → loudness → export; `overrides.yaml`; contract test | — | todo | |
| 1F | `apps/web` Solo UI: home, import, Freestyle board, library drawer, drag + tap-to-place, master controls, Remix, per-slot mix, indicators, saved mixes | — | todo | integrates 1B/1C/1D |
| 1V | Phase 1 verifier | — | todo | |
| 1P | `docs/playtests/phase-1.md` + checkpoint summary | orchestrator | todo | |

## Later phases

Phases 2–6 are listed in `docs/BUILD_PROMPT.md` §14 and get their task tables here when they start.
