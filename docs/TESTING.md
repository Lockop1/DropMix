# Testing

Layers (from `docs/BUILD_PROMPT.md` §16.1). Filled in as each layer lands.

| Layer | Tool | Where | Command |
|---|---|---|---|
| Unit + property | Vitest + fast-check | `packages/*/test` | `pnpm test` |
| Audio (real browser) | Vitest browser mode / Playwright, OfflineAudioContext | `packages/audio/test-browser` | tbd in 0B / 1C |
| Forge | pytest on `forge fixtures` ground truth | `tools/forge/tests` | `uv run --project tools/forge pytest` |
| E2E | Playwright, desktop + mobile emulation | `e2e/` | `pnpm e2e -- --trace off` |
| Real devices | the user, at every checkpoint | `docs/playtests/` | — |

Rules:

- Tests and fixtures never contain copyrighted audio. Synthetic fixtures only, generated at test time.
- Never mark a task done with failing, skipped or deleted tests. Never weaken a test to make it pass.
- Don't run several full Playwright suites in parallel on a 16 GB machine.
