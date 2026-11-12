# STEMDECK

"STEMDECK" is a working codename. A music-mashup card game: each card is one stem (vocals / melodic loop / drums / bass) of a real song. Playing a card into one of 5 board slots drops that stem into a live mix, pitch-shifted to the mix's key, time-stretched to its tempo, and entering on the beat. The board state is the song.

Two halves:

- **Forge** (`tools/forge`, Python 3.11): turns the user's own DRM-free songs into card packs (`*.stemdeck`). Runs only on the user's machine.
- **Game** (TypeScript PWA, phone-first): solo Freestyle/Puzzle on one device, and Jackbox-style rooms where the host screen is the board and plays all the audio.

Scope, rules and roadmap live in `docs/BUILD_PROMPT.md` (the source of truth). Read the sections your task names before writing code.

The user's later instructions (autonomy, test songs, drop-in importer, the neon-club design brief) are in `docs/HANDOFF.md` and ADR 0008; where they differ from the build prompt, they win.

## STEMDECK constraints

```
STEMDECK constraints:
- copyrighted audio and art (song files, stems, loops, renders, album art) never leave the host device: never uploaded to any server, never sent over the room protocol, never committed to git, never bundled into a deployed build — only text metadata (cardId, title, artist, role, level, playlist) may cross the network
- never use the original 2017 game's name, logos, art, card names, or copy; all UI, art, FX cards, and text are original
- game rules live only in packages/engine as pure, deterministic functions (seeded RNG in state; no Math.random, Date.now, or I/O inside the engine); the rooms server and LocalRoom both call the same engine — never reimplement rules in UI or server code
- in rooms the server is authoritative: clients send intents only, every message is validated with packages/protocol zod schemas on both ends, and private state (hands, decks) is filtered per recipient — a player must never receive another player's hand
- the audio engine is a reconciler: UI derives a DesiredMix from board state and calls audioEngine.setDesired(); UI and game code never touch Web Audio nodes directly
- all musical timing uses AudioContext time on the transport's bar grid — never setTimeout/setInterval to start or stop audio; every start, stop, and swap is beat/bar-quantized with ≥5 ms gain fades (no clicks)
- key/tempo math lives only in packages/harmony; drums are never pitch-shifted; transpositions stay within −6…+5 semitones; stretch ratios respect the limits in docs/ARCHITECTURE.md
- nothing on the real-time audio path allocates, awaits, or blocks; heavy DSP (stretch/pitch) runs in Web Workers and produces AudioBuffers
- protocol and pack schemas are versioned; breaking changes bump the version and add a note to docs/PROTOCOL.md; contracts (packages/*/src/contracts.ts, packages/protocol, packages/pack schema) change only via the orchestrator
- phone-first: every screen works at 360×640 portrait with touch only; drag uses pointer events with a tap-to-select, tap-to-place fallback; respect safe-area insets and prevent scroll/pull-to-refresh during drags
- check the license of every new dependency and model weight before adding it; GPL/AGPL/non-commercial items are allowed only in tools/forge or behind an explicit flag, and must be listed in docs/LICENSES.md; the shipped web bundle stays permissive-licensed by default
- tests and fixtures never contain copyrighted audio — synthetic fixtures only (forge fixtures)
- no accounts, payments, paid services, public deployments, or analytics without explicit user approval
```

## Working rules for every agent

- The orchestrator owns `CLAUDE.md`, `docs/BUILD_PROMPT.md`, `docs/PHASES.md`, every `packages/*/src/contracts.ts`, the protocol schemas and the pack schema. Subagents never edit these: if one needs to change, say so in your report with the exact change you want.
- Stay inside your task's "Files allowed to change". If you need a file outside it, stop and explain why in your report.
- Never mark work done with failing, skipped or deleted tests. Never weaken a test to make it pass.
- The original game's name must not appear in any file, package name, identifier, comment or commit message. The local checkout directory happens to carry it; never copy that path into a tracked file (use relative paths).
- Never commit audio, `.stemdeck` files, anything under `library/`, or any file over 5 MB. Synthetic fixtures are generated at test time, not committed.
- Record every non-obvious choice as an ADR draft in your report; the orchestrator files it under `docs/decisions/`.
- Add every new dependency or model weight, with its license, to your report so the orchestrator can update `docs/LICENSES.md`.
- Commits use Conventional Commits (`feat(audio): …`, `test(engine): …`).
- Run Turborepo through the root scripts (`pnpm typecheck`, `pnpm test`, `pnpm build`), which disable its telemetry. `pnpm install` also opts the machine out (`turbo telemetry disable`). Never run `turbo` in a way that sends telemetry: the project allows no analytics.

## Repo map

```
CLAUDE.md
docs/
  BUILD_PROMPT.md   scope, rules, roadmap (source of truth)
  ARCHITECTURE.md   living architecture + every tunable constant
  PHASES.md         task tracker
  PROTOCOL.md       room protocol + versions
  LICENSES.md       every dependency/model + license + where used
  TESTING.md        test layers and how to run them
  decisions/        ADRs (NNNN-title.md)
  spikes/           Phase 0 spike reports
  playtests/        checkpoint test scripts
  prompts/          saved subagent prompts, ready to send
  HANDOFF.md        current state + the user's latest instructions
apps/
  web/              PWA: /, /solo, /puzzle, /host, /join/:code, /play, /lab, /settings
  rooms/            Cloudflare Worker + Room Durable Object
packages/
  harmony/          key/tempo math (pure, no deps)
  engine/           rules + modes (pure, deterministic)
  audio/            Web Audio engine, transport, render workers, reconciler
  protocol/         zod message schemas (versioned)
  pack/             pack schema (zod), JSON Schema export, zip→OPFS loader, catalog API
  ui/               shared React components (Card, Slot, Board, Hand)
tools/
  forge/            Python pipeline + Studio API (uv project)
  studio-ui/        Studio front end
e2e/                Playwright
library/            GITIGNORED: user's songs, caches, built packs
```

Package dependency direction (never import upward):

```
harmony  ←  engine  ←  pack  ←  audio
                 ↖  protocol
engine, pack, audio, protocol  ←  ui  ←  apps/web
engine, protocol               ←  apps/rooms
```

Package names are `@stemdeck/<dir>` (`@stemdeck/harmony`, `@stemdeck/web`, …).

## Commands

Run from the repo root.

| Command | What it does |
|---|---|
| `pnpm install` | install all workspaces |
| `pnpm typecheck` | `tsc --noEmit` in every package (Turborepo) |
| `pnpm lint` | Biome check (lint + format) |
| `pnpm lint:fix` | Biome check with safe fixes applied |
| `pnpm test` | Vitest tests in every package, then the guard tests |
| `pnpm build` | build every package and app |
| `pnpm --filter @stemdeck/<name> <script>` | run one package's script |
| `pnpm dev` | start the web app (Vite) |
| `pnpm dev:rooms` | start the rooms Worker locally (`wrangler dev`) |
| `pnpm e2e` | Playwright end-to-end tests (pass `-- --trace off`) |
| `uv sync --project tools/forge` | install Forge (dev group includes the `analysis` extra; add `--extra separation` on a GPU machine) |
| `uv run --project tools/forge forge <cmd>` | Forge CLI: `doctor`, `fixtures`, `analyze`, `models`, `bench-separation` now; `ingest`, `export`, `studio` in later phases |
| `uv run --project tools/forge pytest tools/forge` | Forge tests (about 4 min). Pass the path so pytest picks up Forge's own config |
| `uv run --project tools/forge ruff check tools/forge` | Forge lint |
| `node e2e/bench/lab-bench.mjs --label "<machine>"` | headless audio benchmark (same numbers as `/lab`) |

## How to run

- **Game (dev):** `pnpm install && pnpm dev`, then open the printed URL. `/lab` is the audio spike page; `/roomlab` is the rooms spike page (needs `pnpm dev:rooms`).
- **Rooms (dev):** `pnpm dev:rooms` in a second terminal.
- **Phone testing** needs HTTPS: `cloudflared tunnel --url http://localhost:5173` (no account needed) and open the printed URL on the phone.
- **Forge:** needs Python 3.11 via `uv`, ffmpeg, and (for real songs) a CUDA GPU under WSL2. `tools/forge/scripts/setup-wsl.sh` installs the prerequisites; `forge doctor` checks them.

## Environment notes

- Target dev machine: Windows 11 laptop, 16 GB RAM, everything inside WSL2 (Ubuntu 24.04). Max 3–4 concurrent subagents; never two GPU jobs at once; never several full Playwright suites in parallel.
- This repo is also built in cloud sessions with no GPU and only partial access to model-weight hosts. There, Forge code is tested against synthetic fixtures only; separation of real songs runs on the user's machine. See `docs/decisions/0001-cloud-build-environment.md`.
- In cloud sessions Chromium and Playwright are pre-installed: never run `playwright install`; if a pinned version cannot find its browser, launch with `executablePath: '/opt/pw-browsers/chromium'`.
