# ADR 0004 — Toolchain choices made by the scaffold (task 0A)

Status: accepted (2026-11-11)

## Decisions

1. **Workspaces are consumed as TypeScript source.** Each package's `exports` points at `./src/index.ts`; Vite and Vitest compile it. Library `build` is `tsc --noEmit`; only `apps/web` emits files. No per-package build step, no stale `dist/`.
2. **TypeScript 7 (native compiler)**, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`. Nothing depends on the TypeScript JS API. Fallback: `^6` with no config change.
3. **Biome** is the only linter/formatter. Its Markdown formatter is off (it would rewrite the docs), and the generated `packages/pack/schema/pack.schema.json` is ignored so the "schema file is up to date" test stays byte-exact.
4. **`@playwright/test` is pinned to an exact version** matching the Chromium build pre-installed in cloud sessions. `PLAYWRIGHT_CHROMIUM_PATH` overrides the executable. CI installs its own browser.
5. **`pnpm e2e` goes through `e2e/run.mjs`**, which drops the literal `--` that nested pnpm scripts pass through; without it Playwright silently ignored every flag after `--`.
6. **Repository guard** (`scripts/guard.mjs`, run by `.githooks/pre-commit` and by CI as `pnpm guard`): blocks audio extensions, `.stemdeck`, anything under the root `library/`, files over 5 MiB, and the original game's name in paths or text. The name is assembled at runtime so the repository never contains it.
7. **Turborepo telemetry is disabled** in scripts and CI ("no analytics").
8. **Routes are one directory each** under `apps/web/src/routes/<name>/`, lazy-loaded from `src/router.tsx`, so a task can own a route directory without touching the router.

## Consequences

- `engines.node` is `>=22`; react-router 8 itself wants `>=22.22`. Use a current Node 22.
- GitHub Action major versions in `.github/workflows/ci.yml` were not verifiable from the build session (no API access); the first CI run confirms them.
