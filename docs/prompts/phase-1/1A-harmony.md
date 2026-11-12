# Subagent prompt — 1A-harmony

Ready to send as-is (template: docs/BUILD_PROMPT.md §13.3). Adjust the "Environment notes" for the machine you run on.

```
Read CLAUDE.md first before doing anything.

You are working in an isolated git worktree of a pnpm monorepo (run `pnpm install` first). Other agents are working in parallel on `packages/pack/**` and `tools/forge/**`. Use relative paths in every file you write.

Task(s):
1. Implement packages/harmony v1: every function of the `HarmonyApi` interface in `packages/harmony/src/contracts.ts` — `pcs`, `transpositionFor`, `foldTempo`, `stretchFor`, `fitStem`, `entryBoundary`, `loopOffsetBars`, `barSeconds`, `loopFrames`, `clampBpm` — as named exports of the package (pure functions, no runtime dependencies), plus an exported `harmony: HarmonyApi` object bundling them.
2. Write exhaustive unit + property tests (Vitest + fast-check) for those functions.

Goal:
1. Given a stem's key/BPM/role and the master BPM/PCS, the package returns exactly what docs/BUILD_PROMPT.md §7.1 (base rules only — the Phase 2 chroma-fit is out of scope), §7.2 and §7.3 specify, using the constants already defined in the contracts file (never re-declare a number):
   - `pcs(key)`: `mode === 'major' ? tonic : (tonic + 3) % 12`.
   - `transpositionFor`: d = (masterPcs − stemPcs) mod 12 mapped into −6…+5 (if d > 5, d −= 12); the ±6 tie resolves to −6 for every role; `beat` always returns `{semitones: 0, formant: false, strained: false}`; `formant` is true only for `lead` with a non-zero shift; `strained` is true only for a `lead` with |semitones| > `LEAD_SOFT_SHIFT_LIMIT`.
   - `foldTempo(nativeBpm)`: exactly the rule in the contract's doc comment (power-of-two multiple with the smallest log-distance to `TEMPO_RANGE`, ties to the smaller multiplier, result clamped into the range). E.g. 60 → {bpm 120, feel 2}; 180 → {bpm 90, feel 0.5}; 85 → {bpm 90, feel 1}; 200 → {bpm 100, feel 0.5}; 157 → {157, 1}; 90 → {90, 1}.
   - `stretchFor`: fold f ∈ {0.5, 1, 2} minimizing |log(M / (native·f))|; ratio r = M / (native·f); if the best fold's ratio is outside `STRETCH_LIMITS.hard`, use the next-best fold whose ratio is inside; if none is inside, return the closest with `outOfRange: true`; `strained` when r is outside the role's soft limits (inclusive bounds are not strained; compare with a small epsilon so exact boundary values such as 0.85 are not flagged by float noise).
   - `fitStem`: both, with `strained = transposition.strained || stretch.strained`.
   - `entryBoundary({fromBar, entryEvery})`: the first integer bar b ≥ fromBar with b mod entryEvery === 0 (fromBar may be fractional or exactly on a boundary; negative fromBar must also work).
   - `loopOffsetBars(globalBar, loopBars)`: non-negative modulo, fractional globalBar allowed.
   - `barSeconds(bpm) = 4·60/bpm`; `loopFrames = round(bars·4·60/bpm·sampleRate)`; `clampBpm` clamps into `TEMPO_RANGE`.
   - Invalid numeric input (NaN, ±Infinity, bpm ≤ 0, non-integer or out-of-range pitch classes) throws a `RangeError` with a clear message; document this in the function doc comments.
2. Tests cover: every key pair (12 × 12 tonics × 2 × 2 modes) for `pcs` + `transpositionFor` including relative major/minor equivalence (C major stem → A minor master = 0; E minor stem → G major master = 0); every role; the ±6 tie; drums never shifting (property over all inputs); results always within `TRANSPOSE_RANGE` and congruent mod 12 to the PCS difference (property); `foldTempo` edge cases at 90 and 157, the unfoldable gap (78.5–90 → clamp), very slow and very fast tempos, and the invariant that the result is always inside `TEMPO_RANGE` (property); `stretchFor` fold choice, hard-cap fallbacks, `outOfRange`, soft-limit boundaries per role, and the invariant that ratio · native · fold = master (property); `entryBoundary` and `loopOffsetBars` properties; `loopFrames` exactness examples (e.g. 8 bars at 120 BPM at 44100 Hz = 705600); invalid-input throwing.

Files to inspect first:
- CLAUDE.md
- docs/BUILD_PROMPT.md §2, §7
- packages/harmony/src/contracts.ts, packages/harmony/src/index.ts, packages/harmony/package.json, packages/harmony/test/contracts.test.ts

Files allowed to change:
- Task 1: `packages/harmony/src/**` except `packages/harmony/src/contracts.ts` (you may extend `packages/harmony/src/index.ts`)
- Task 2: `packages/harmony/test/**`, `packages/harmony/package.json` (dev dependencies only: fast-check, @vitest/coverage-v8), `packages/harmony/vitest.config.ts`, `pnpm-lock.yaml`
- Nothing else. If the contract is ambiguous or wrong, do not edit it: implement the most literal reading and describe the exact change you want in your report.

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

Environment notes: Node 22, pnpm 10, npm registry reachable. Do not commit and do not push; leave your changes in the working tree for the orchestrator. Run Turborepo only through the root pnpm scripts.

Success criteria:
- `pnpm --filter @stemdeck/harmony test` passes, with ≥95% line coverage of `packages/harmony/src` excluding `contracts.ts` (show the coverage summary)
- `pnpm --filter @stemdeck/harmony typecheck` and `pnpm lint` pass
- no runtime dependencies added to `packages/harmony/package.json`
- C major stem → A minor master returns shift 0; E minor stem → G major master returns 0; `beat` role always returns 0; a compile-time check exists that the exported `harmony` object satisfies `HarmonyApi`

After finishing:
- list every file you changed, grouped by task
- explain why each change was made
- confirm no invariants were broken
- list every dependency you added with version and license
- suggest the next smallest safe task
```
