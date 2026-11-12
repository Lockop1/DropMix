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
| signalsmith-stretch | MIT | packages/audio (default stretcher, render worker) | yes | 1.3.2, pinned exactly: the worker shim depends on its internals (ADR 0006) |
| partysocket | MIT | apps/web (`/roomlab`, later RemoteRoom) | yes | 1.3.0; pulls in `event-target-polyfill` (MIT), installed but not bundled |
| qrcode-generator | MIT | apps/web (`/roomlab` QR, drawn locally) | yes | 2.0.4 |

## Web bundle — flag-gated, NOT in the default build

Loaded only by dynamic import when `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1`. With the flag unset their code is absent from `dist/` (verified in spike 0B). Personal A/B listening only; never deployed.

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|
| soundtouchjs | LGPL-2.1 | packages/audio (flagged stretcher) | only under LGPL obligations | 0.3.0. The `@soundtouchjs/*` packages were rejected: they claim MPL-2.0 for code derived from LGPL SoundTouch |
| rubberband-wasm | GPL-2.0-or-later | packages/audio (flagged stretcher) | **no** | 3.3.0; a commercial licence is sold separately by the Rubber Band authors |

## Rooms server

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|
| partyserver | ISC | apps/rooms (Durable Object adapter) | yes | 0.5.10, pinned (0.x); pulls in `nanoid` 5.1.16 (MIT) |
| zod | MIT | apps/rooms (frame validation) | yes | 4.6.7 |

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
| wrangler 4.155.0 (local `wrangler dev` and server tests; pulls in miniflare, esbuild, undici, ws, unenv, youch, blake3-wasm, path-to-regexp — all MIT) | MIT OR Apache-2.0 |
| workerd 1.20261023.1 (+ `@cloudflare/workerd-linux-64`, local Workers runtime) | Apache-2.0 |
| @cloudflare/workers-types 5.20261110.1 | MIT OR Apache-2.0 |
| sharp 0.35.5 (via miniflare) | Apache-2.0 |
| @img/sharp-libvips-linux-x64 1.3.4 (prebuilt binary via sharp; dev machine only, never shipped) | LGPL-3.0-or-later |
