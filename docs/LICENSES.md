# Licenses

Every runtime dependency and model weight, its license, where it is used, and whether it is OK for a commercial product. Dev-only tooling is listed in its own table.

Rule (see `CLAUDE.md`): the shipped web bundle stays permissive-licensed by default. GPL/AGPL/non-commercial items are allowed only in `tools/forge` or behind an explicit flag.

## Web bundle (shipped)

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|
| zod | MIT | pack, protocol | yes | 4.6.7 |
| react | MIT | apps/web, packages/ui (peer) | yes | 19.3.1 |
| react-dom | MIT | apps/web | yes | 19.3.1; pulls in `scheduler` (MIT) |
| react-router | MIT | apps/web (routing) | yes | 8.5.1; pulls in `cookie-es` (MIT), `@remix-run/route-pattern` (MIT) |
| zustand | MIT | apps/web (state) | yes | 5.1.0; installed, not used yet |
| tailwindcss | MIT | apps/web (generated CSS) | yes | 4.3.5; only the generated stylesheet ships |

## Rooms server

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|

## Forge (local tool, never shipped in the web bundle)

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|

## Model weights

| Model | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|

## Dev tooling (not shipped)

| Tool | License |
|---|---|
| pnpm 10.28.0 (package manager, not a dependency) | MIT |
| turbo 2.11.11 | MIT |
| typescript 7.0.2 (+ `@typescript/typescript-<platform>` native binary) | Apache-2.0 |
| @biomejs/biome 2.6.6 | MIT OR Apache-2.0 |
| vitest 5.1.0 | MIT |
| vite 8.3.8 (bundles rolldown, MIT) | MIT |
| @vitejs/plugin-react 6.3.0 | MIT |
| @tailwindcss/vite 4.3.5 (build plugin) | MIT |
| lightningcss 1.33.0 (via @tailwindcss/vite, build time only) | MPL-2.0 |
| tsx 4.23.15 (runs `export-schema`; pulls in esbuild, MIT) | MIT |
| @playwright/test 1.63.0 (+ playwright, playwright-core) | Apache-2.0 |
| @types/node 22.20.5, @types/react 19.3.0, @types/react-dom 19.3.0 | MIT |
