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

Forge runs only on the user's machine. It carries copyleft and non-commercial pieces, which is acceptable for a personal local tool and must be revisited before any public product path (Phase 6).

| Dependency | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|
| typer 0.29.1, rich 15.0.0 | MIT | core (CLI) | yes | |
| numpy 2.4.6, scipy 1.17.1 | BSD-3-Clause | core | yes | |
| soundfile 0.14.0 | BSD-3-Clause | core (WAV/FLAC IO) | yes | bundles libsndfile 1.2.2 (LGPL-2.1) |
| librosa 0.11.0 (+ numba, llvmlite, scikit-learn) | ISC / BSD | core (chroma, fallback beat + key) | yes | pulls in `soxr` 1.1.0 (LGPL-2.1+) |
| mutagen 1.48.1 | **GPL-2.0-or-later** | core (tag reading) | **no** (copyleft) | replace before a product path |
| pyloudnorm 0.2.0 | MIT | core (LUFS) | yes | |
| pyrubberband 0.4.0 | ISC | core (grid-warp, Phase 2) | wrapper yes | needs the `rubberband` CLI, which is **GPL-2.0+** (apt package on the laptop) |
| fastapi 0.162.5 (+ starlette, pydantic) | MIT / BSD-3 / MIT | core (Studio API, Phase 2) | yes | |
| essentia 2.1b6.dev1389 | **AGPL-3.0-only** | `analysis` extra (key) | **no** | librosa fallback exists |
| madmom 0.17.dev0 (git commit 27f032e) + mido | BSD-3-Clause code | `analysis` extra (beats/downbeats fallback) | code yes | its bundled models are non-commercial — see Model weights |
| torch 2.15.0 (+ NVIDIA CUDA 13 wheels, triton) | BSD-style; NVIDIA proprietary (redistributable); MIT | `separation` extra | yes (per NVIDIA EULA) | about 3 GB of wheels |
| audio-separator 0.48.0 (+ onnxruntime 1.31.1 MIT, onnx Apache-2.0) | MIT | `separation` extra | yes | |
| diffq 0.2.4 (audio-separator dependency) | **CC BY-NC 4.0** | `separation` extra | **no** | non-commercial |
| beat-this 1.1.0 (+ torchaudio, einops, rotary-embedding-torch) | MIT / BSD / MIT | `separation` extra (beats/downbeats) | yes | |
| pytest 9.2.0, ruff 0.17.4 | MIT | dev only | — | |
| allin1 1.1.0 / natten 0.21.7 | MIT | **not adopted** | — | cannot be made to work with current torch (ADR 0005) |

## Model weights

Downloaded by Forge to `~/.stemdeck/models` on the user's machine. Never committed, never shipped.

| Model | License | Used in | Commercial OK | Notes |
|---|---|---|---|---|
| BS-RoFormer `model_bs_roformer_ep_317_sdr_12.9755` (639 MB) | **none stated** | separation config A (vocals) | **no** (unknown terms) | must be replaced or cleared before a product path |
| `htdemucs_ft` (4 × 84 MB + yaml, 337 MB) | MIT (Demucs repository) | separation configs A and B | yes — verify the weights' own terms in Phase 6 | |
| beat_this `final0` checkpoint | MIT (repository; weights' terms not verified) | beats/downbeats | probably — verify in Phase 6 | could not be downloaded in the cloud session |
| madmom RNN models (29 MB, inside the package) | **CC BY-NC-SA 4.0** | beats/downbeats fallback | **no** | non-commercial |

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
