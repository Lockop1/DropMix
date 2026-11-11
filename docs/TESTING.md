# Testing

Layers (from `docs/BUILD_PROMPT.md` §16.1). Filled in as each layer lands.

| Layer | Tool | Where | Command |
|---|---|---|---|
| Unit + property | Vitest + fast-check | `packages/*/test`, `apps/web/test` | `pnpm test` |
| Repo guard | `node --test` | `scripts/guard.test.mjs` | `pnpm test` (or `pnpm test:scripts`) |
| Pack JSON Schema freshness | Vitest | `packages/pack/test/schema-file.test.ts` | `pnpm test` |
| Audio (real browser) | Vitest browser mode / Playwright, OfflineAudioContext | `packages/audio/test-browser` | tbd in 0B / 1C |
| Forge | pytest on `forge fixtures` ground truth | `tools/forge/tests` | `uv run --project tools/forge pytest` |
| E2E | Playwright, desktop Chromium + 360×640 mobile emulation (touch) | `e2e/` | `pnpm e2e -- --trace off` |
| Real devices | the user, at every checkpoint | `docs/playtests/` | — |

## Commands

Run from the repo root after `pnpm install` (which also points git at `.githooks/`).

| Command | What it runs |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` in every workspace (Turborepo, cached) |
| `pnpm lint` | `biome check .` (lint + format + import order); `pnpm lint:fix` applies safe fixes |
| `pnpm test` | Vitest in every workspace (Turborepo), then the guard tests (`node --test`) |
| `pnpm build` | every workspace's `build`; only `apps/web` produces output (`apps/web/dist`) |
| `pnpm guard` | `node scripts/guard.mjs --all`: checks every tracked file |
| `pnpm e2e -- --trace off` | Playwright: starts the web dev server on port 5173 and runs `e2e/tests` in both projects |
| `pnpm --filter @stemdeck/<name> test` | one workspace's tests (e.g. `@stemdeck/pack`) |
| `pnpm --filter @stemdeck/pack export-schema` | regenerates `packages/pack/schema/pack.schema.json` from the zod schema |

Notes:

- Library packages are consumed as TypeScript source (`exports` points at `src/index.ts`); Vite and Vitest compile them. Their `build` script is a type check, not an emit.
- `pnpm e2e` forwards its arguments to `playwright test` (e.g. `pnpm e2e -- --project mobile-360`). One project only: `--project desktop-chromium` or `--project mobile-360`.
- If a dev server is already running on port 5173, Playwright reuses it locally (never in CI).
- Turborepo telemetry is disabled in the root scripts and in CI (`TURBO_TELEMETRY_DISABLED=1`).

## Pre-commit guard

`.githooks/pre-commit` runs `node scripts/guard.mjs` on the staged version of every added or changed file. It blocks:

- audio files (`flac wav mp3 m4a m4p ogg opus aac aif aiff wma`) and `.stemdeck` packs;
- anything under `library/`;
- any file larger than 5 MB;
- the original 2017 game's name in a path or in text content (case-insensitive; binary files are skipped for content).

`pnpm install` enables the hook (`prepare` runs `git config core.hooksPath .githooks`). CI runs `pnpm guard` on every push and pull request.

## Playwright browsers

- **CI:** the `e2e` job runs `playwright install --with-deps chromium`. It runs only on pull requests that target `main`.
- **Cloud sessions:** Chromium is pre-installed under `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` is already set). Never run `playwright install` there. `@playwright/test` is pinned to `1.63.0`, which matches the pre-installed browser build (1243), so `pnpm e2e -- --trace off` works as is. If a future Playwright version cannot find its browser, set `PLAYWRIGHT_CHROMIUM_PATH` to the executable; the config passes it as `launchOptions.executablePath`. The working value is `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` (a symlink to `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`).
- **Laptop (WSL2):** run `pnpm --filter @stemdeck/e2e exec playwright install --with-deps chromium` once.

## Rules

- Tests and fixtures never contain copyrighted audio. Synthetic fixtures only, generated at test time.
- Never mark a task done with failing, skipped or deleted tests. Never weaken a test to make it pass.
- Don't run several full Playwright suites in parallel on a 16 GB machine.
