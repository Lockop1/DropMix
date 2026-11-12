# Subagent prompt — 1D-pack

Ready to send as-is (template: docs/BUILD_PROMPT.md §13.3). Adjust the "Environment notes" for the machine you run on.

```
Read CLAUDE.md first before doing anything.

You are working in an isolated git worktree of a pnpm monorepo (run `pnpm install` first). Other agents are working in parallel on `packages/harmony/**` and `tools/forge/**`. Use relative paths in every file you write.

Task(s):
1. Phase 1 task 1D, part 1 — `packages/pack` runtime: the `Catalog` implementation, the streaming zip importer, and the `PackStore` implementations (OPFS, IndexedDB fallback, in-memory) exactly per `packages/pack/src/contracts.ts`.
2. Phase 1 task 1D, part 2 — a `/packlab` test page in the web app plus browser tests proving import, listing, opening and deleting packs work in a real browser.

Goal:
1. `@stemdeck/pack` exports working implementations of its contracts:
   - `createCatalog(pack, source)`: implements `Catalog` over a validated `Pack` manifest and a byte source (`{ readFile(path): Promise<ArrayBuffer>; readBlob?(path, type): Promise<Blob> }`). `getStemFor(songId, role)`, `listCards(filter)` (kinds, levels, playlistId, case-insensitive search over title + artist; stable order: by artist, then title, then kind), `toEngineCatalog()` (cards keyed by cardId; `songs[songId] = { bpm: song.nativeBpm, pcs }` where pcs comes from `pcs()` in `@stemdeck/harmony` applied to the song's key — do not re-implement key math; `songRoles[songId]` = the roles that have a stem), and `toPublicMeta()` (ONLY cardId, kind, level, title, artist, playlist — nothing else, proven by a test that strict-parses the output with `publicCardMetaSchema`). Lookups are O(1) via maps built once.
   - `importPack(file, onProgress)`: reads a `.stemdeck` zip from a `Blob` WITHOUT loading the whole archive into memory (a 100-song pack can be several hundred MB and must import on a phone): use `fflate`'s streaming unzip fed from `blob.stream()`, write each entry to storage as it is decompressed, and report `ImportProgress` (`reading` → `validating` → `writing` → `done`, monotonic `fraction` 0–1). Order-independent: `pack.json` may be anywhere in the zip. Validation: full `packSchema` (shape + referential integrity); every `stems[].file` and every `songs[].art` named in the manifest must exist in the zip (`missing_file`); entries not named in the manifest are ignored and not stored; path traversal (`..`, absolute paths, backslashes) is rejected. Errors are thrown as a `PackError` class (extends Error) carrying the `PackErrorShape` fields with the right `PackErrorCode` (`not_a_zip`, `missing_manifest`, `invalid_manifest` with zod issues mapped to `{path, message}`, `unsupported_version` when `schemaVersion` is not 1, `missing_file`, `quota_exceeded` when storage throws a QuotaExceededError, `storage_unavailable`). A failed import leaves no partial pack behind. Re-importing a pack with the same `packId` replaces the old one atomically (write to a temp location, then swap).
   - Storage backends behind one small internal interface: OPFS (`navigator.storage.getDirectory()`, one directory per pack; use `createWritable` where available and fall back to a Worker with `createSyncAccessHandle` only if you can verify it is needed — Safari historically lacked `createWritable` on the main thread; document what you did and what is unverified), IndexedDB fallback (blobs keyed by pack + path), and an in-memory backend for tests and for browsers with neither. `createPackStore()` picks the best available backend and exposes which one it picked (`store.backend`). `listPacks()` returns `PackSummary` (with total stored bytes) without reading audio; `openPack(packId)` returns a `PackHandle` whose catalog reads stem audio lazily, one file at a time, from storage (`not_found` for unknown ids); `deletePack` removes everything.
   - Also export `buildPackZip(pack, files)` — a small helper (used by tests here and by later e2e tests) that builds a valid `.stemdeck` zip `Blob`/`Uint8Array` from a manifest and a map of file bytes — and `makeTestPack(options)` that generates a schema-valid synthetic manifest (N songs with all four stems, role cards with levels 1–3, optional wild cards, one playlist) with small placeholder bytes for the audio files. Keep both free of any real audio.
   - Import performance budget (docs/BUILD_PROMPT.md §16.2): a 100-song pack imports in ≤ 60 s on a laptop. Measure a synthetic 100-song pack (400 stems × about 1 MB of incompressible bytes each) through the in-memory backend in Node and through OPFS in headless Chromium, and report the times.
2. `/packlab` (owned directory `apps/web/src/routes/packlab/`) is a plain, phone-usable (360×640, touch only, no horizontal scroll) test page: a file picker for `.stemdeck` files, a "Generate test pack" button (uses `makeTestPack` + `buildPackZip`, with a song-count field), an import progress bar, the list of stored packs (name, songs, cards, size, backend) with Open and Delete buttons, and for an opened pack a summary (counts per card kind, playlists, first 20 cards, and a "Read first stem" button showing the byte length returned by `getStemAudio`). It exposes `window.__stemdeckPackLab` with async functions the Playwright test can call. `e2e/tests/packlab.spec.ts` (both projects) asserts: generate + import a 5-song pack → it appears in the list with the right counts; it survives a page reload (OPFS persistence); opening it returns the right card counts and a stem's bytes round-trip exactly; re-importing replaces rather than duplicates; importing a corrupted zip, a zip without `pack.json`, a manifest with `schemaVersion: 2`, and a manifest naming a missing audio file each show the right error code and leave the list unchanged; deleting removes it; no horizontal scroll at 360×640.

Files to inspect first:
- CLAUDE.md
- docs/BUILD_PROMPT.md §5.1 (pack storage row), §6.4 (pack format), §10.2 (what metadata may leave the device), §15 (Catalog abstraction), §16 (tests and budgets)
- docs/decisions/0002-package-dependency-direction.md, docs/decisions/0003-engine-catalog-song-facts.md, docs/decisions/0004-toolchain-choices.md
- packages/pack/src/contracts.ts, packages/pack/src/schema.ts, packages/pack/src/index.ts, packages/pack/test/**, packages/pack/package.json
- packages/engine/src/contracts.ts (CardDef, EngineCatalog, SongFacts), packages/harmony/src/contracts.ts
- apps/web/src/router.tsx, apps/web/src/routes/packlab/index.tsx, apps/web/src/routes/lab/index.tsx (an example of a lab page with a `window.__…` hook), e2e/playwright.config.ts, e2e/tests/lab.spec.ts, docs/TESTING.md

Files allowed to change:
- Task 1: `packages/pack/src/**` except `packages/pack/src/contracts.ts` and `packages/pack/src/schema.ts` (you may extend `packages/pack/src/index.ts`), `packages/pack/test/**`, `packages/pack/package.json`, `packages/pack/vitest.config.ts`, `pnpm-lock.yaml`
- Task 2: `apps/web/src/routes/packlab/**`, `apps/web/package.json` (dependencies only: `@stemdeck/pack`), `e2e/tests/packlab.spec.ts`
- Nothing else. `@stemdeck/harmony`'s `pcs()` function is being implemented by another agent right now and may not exist in your worktree: import it as `import { pcs } from '@stemdeck/harmony'`, and if it is missing, add a clearly marked temporary local shim file `packages/pack/src/_pcs-shim.ts` (the one-line formula) used ONLY until integration, and say so in your report so the orchestrator swaps it. If a contract or the schema is wrong or insufficient, do not edit it: describe the exact change you want in your report.

Constraints (use if any of these features are touched, or close proximity features are touched):
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

Environment notes: Linux cloud container, 4 cores shared with other agents, Node 22, pnpm 10, npm registry reachable. Chromium and Playwright are pre-installed (never run `playwright install`); run Playwright with `--trace off` (`pnpm e2e -- --trace off`, or a single spec with `pnpm e2e -- --trace off tests/packlab.spec.ts`). Safari/iOS cannot be tested here: say plainly what is unverified for it. Run Turborepo only through the root pnpm scripts. Do not commit and do not push; leave your changes in the working tree for the orchestrator.

Success criteria:
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` exit 0 from the repo root; paste the tail of each
- `pnpm e2e -- --trace off` passes on both projects including `packlab.spec.ts` and all existing specs; paste the summary line
- unit tests cover: catalog lookups and filters, `toEngineCatalog`, `toPublicMeta` strictness, every `PackErrorCode` path, progress monotonicity, replace-on-reimport, no partial pack after a failed import, path-traversal rejection, and a zip whose `pack.json` is the last entry
- the measured import time for the synthetic 100-song pack is reported for the in-memory backend (Node) and for OPFS (headless Chromium), with peak memory if you can measure it, and stays under 60 s here (if not, say why and what you tried)
- the default web build still contains no non-permissive code (fflate is MIT: confirm from its installed package.json)
- `pnpm guard` passes; no audio file is added; no file you wrote contains the original 2017 game's name or an absolute checkout path

After finishing:
- list every file you changed, grouped by task
- explain why each change was made
- confirm no invariants were broken
- list every dependency you added with version, license and whether it ships in the web bundle
- state any change you want made to `packages/pack/src/contracts.ts` or `schema.ts`, and whether you used the `_pcs-shim.ts`
- suggest the next smallest safe task
```
