# STEMDECK — Orchestrator Build Prompt (v1)

> **Human setup (Newsome):** create an empty folder *inside WSL2* (e.g. `~/code/stemdeck`), save this file there as `docs/BUILD_PROMPT.md`, open your coding agent in that folder, and send:
> `Read docs/BUILD_PROMPT.md in full and act as the orchestrator it describes. Start at §17 First actions.`
>
> "STEMDECK" is a working codename only. A real name gets picked in Phase 6.

---

## 0. TL;DR for the orchestrator

- You are the **lead engineer and orchestrator**. You plan, write the shared contracts, delegate bounded tasks to subagents, integrate their work, verify it, and keep the docs true. You do not hand off thinking you should do yourself (architecture, contracts, integration, final review).
- **Every subagent you spawn runs on Opus 5.5 with reasoning effort = high.** Set both explicitly on every spawn. Every subagent prompt uses the template in §13.3. No exceptions.
- **Build order:** Phase 0 (risk spikes) → **Phase 1 MVP: solo Freestyle on one device** → Phase 2 sound quality + curation → Phase 3 multiplayer rooms + Jam → Phase 4 full game modes → Phase 5 product hardening → Phase 6 public-release decision gate. **Every phase ends at a playtest checkpoint where you stop**, give the user a test script, and wait for feedback (§14).
- The non-negotiables are §3. They go into `CLAUDE.md` verbatim and into every subagent prompt verbatim.
- When this file is ambiguous, make the call, record it as an ADR (`docs/decisions/`), and keep moving. Stop and ask only for the things listed in §13.7.

---

## 1. What we're building

A software game inspired by the 2017 card-based music-mashup game made by Harmonix/Hasbro. **Do not use that game's name, logos, art, card names, or copy anywhere** (code, UI, docs, package names, commit messages).

**Core loop:** players hold cards. Each card is one **stem** of a real song: the vocals, a melodic loop, the drums, or the bassline. Playing a card into one of **5 board slots** drops that stem into a live, continuously playing mix. The stem is automatically pitch-shifted to the mix's key, time-stretched to the mix's tempo, and enters exactly on the beat. **The board state is the song.** Game modes add competitive and co-op rules on top.

**Two halves:**
1. **Forge** (local tool, Python): turns the user's own DRM-free song files into **card packs**. It does stem separation, beat/key analysis, loop selection and export. It runs only on the user's machine.
2. **Game** (TypeScript PWA, phone-first, also laptop):
   - **Solo, single device:** Freestyle (MVP) and Puzzle.
   - **Multiplayer rooms, Jackbox-style:** the **host screen is the board and plays all the audio**. Players join from their phones with a room code or QR, hold their hands of cards on the phone, and play cards onto the host's board. Modes: Jam (multiplayer freestyle), Clash (competitive), Party (co-op).

**Personal-use phase:** copyrighted audio never leaves the host device (§3). Phones receive only text metadata. Public release is a separate, gated decision (Phase 6).

**Platforms:** iOS Safari and Android Chrome (primary), plus desktop Chrome, Edge, Safari and Firefox. The host can be a laptop, a TV-connected laptop, or a phone.

---

## 2. Glossary (use these terms consistently in code and docs)

| Term | Meaning |
|---|---|
| **Stem** | One isolated part of a song (vocals / drums / bass / other), produced by AI source separation |
| **Role** | Card part type: `lead` (vocals), `loop` (melodic "other" stem), `beat` (drums), `bass` |
| **Loop** | A stem trimmed to an exact whole number of bars (4/8/16) that repeats seamlessly |
| **Bar / beat / downbeat** | 4/4 time only: 4 beats per bar; the downbeat is beat 1 of a bar |
| **Phrase** | 4 bars. The default boundary for big musical changes |
| **BPM** | Beats per minute (tempo) |
| **Pitch class (pc)** | A note name as an integer 0–11 (C=0, C#=1 … B=11) |
| **PCS index** | A key's 7-note set, identified by its relative-major tonic (0–11). C major and A minor both have PCS 0 |
| **Relative major/minor** | Keys sharing the same notes (C major ↔ A minor). Mixing them needs no mode conversion |
| **Transposition** | Pitch shift in semitones (−6…+5 here) |
| **Time-stretch** | Change tempo without changing pitch |
| **Formant preservation** | A pitch-shift option that keeps voices from sounding like chipmunks |
| **Grid-warp** | Forge step that makes a loop's beats perfectly evenly spaced (removes human tempo drift) |
| **LUFS** | Loudness measure used for level-matching stems |
| **OPFS** | Origin Private File System, the browser storage where imported packs live |
| **DO** | Cloudflare Durable Object, one stateful server instance per room |
| **ADR** | Architecture Decision Record (`docs/decisions/NNNN-title.md`) |

---

## 3. STEMDECK constraints (invariants)

Copy this block **verbatim** into `CLAUDE.md` under the heading "STEMDECK constraints", and verbatim into the Constraints section of every subagent prompt.

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

---

## 4. Environment & kickoff

### 4.1 Known environment (verify, don't assume)
- Dev machine: **Windows 11** laptop (ASUS ROG Zephyrus G16, Intel Core Ultra 9 285H, **16 GB RAM**, likely an NVIDIA RTX GPU). Detect the GPU with `nvidia-smi`.
- **Run everything inside WSL2 (Ubuntu 24.04)**, with the repo on the WSL filesystem (`~/code/stemdeck`) for fast file IO. Reason: the Python audio stack (Essentia, madmom, allin1/natten) is unreliable or unavailable natively on Windows, and CUDA works in WSL2. Write an ADR confirming this after `forge doctor` passes.
- 16 GB RAM: **max 3–4 concurrent subagents**, never two GPU jobs at once, and don't run multiple full Playwright suites in parallel.
- Phone testing: the host-on-phone flow needs **HTTPS** (secure context for AudioWorklet, OPFS and Wake Lock). Use a Cloudflare quick tunnel (`cloudflared tunnel --url`, no account needed) during development, and Cloudflare Pages preview deploys from Phase 3.

### 4.2 Kickoff questions
Ask once, in a single message, and only these:
1. Which phones will you test on (iPhone model + iOS version, Android model)?
2. Where is your music folder, and can you put ~20 DRM-free songs in it to start (FLAC/WAV/MP3/non-DRM M4A)? A mix of genres and tempos is ideal.
3. OK to install WSL2/Ubuntu, CUDA-on-WSL, ffmpeg, and ~10 GB of separation/analysis models?
4. OK to create a free Cloudflare account at Phase 3 (needed for rooms over the internet)? Quick tunnels before that need no account.
5. Create a private GitHub repo with `gh`? (Yes means CI runs on GitHub Actions.)
6. Autonomy: stop at every checkpoint (default), or keep going through Phase 2 unless blocked?

Detect everything else (OS, GPU, Node/Python versions, disk space) yourself. While you wait for answers, do only non-destructive work (§17).

---

## 5. Architecture & tech stack (decided; deviations require an ADR)

### 5.1 Decisions

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere except Forge (Python 3.11) | Shared types across client, server and engine |
| Monorepo | pnpm workspaces + Turborepo | Fast and simple; per-package test caching |
| Web app | **Vite + React 19 + React Router**, Zustand, Tailwind CSS v4, Motion (animation), `vite-plugin-pwa` | Pure client app; no SSR needed. Next.js adds nothing here |
| Drag & drop | Custom pointer-events drag + tap-to-place | HTML5 DnD is unreliable on mobile |
| Rooms backend | **Cloudflare Workers + Durable Objects**, one DO per room, via `partyserver` (server) + `partysocket` (client). Verify current APIs in the docs before use | A stateful room actor that runs the authoritative engine, with WebSocket hibernation, alarms for timers and a generous free tier. Supabase Realtime can't host authoritative game logic. Add Supabase later only for accounts/collections (Phase 6) |
| Hosting | Cloudflare Pages (web) + Workers (rooms) | One platform, HTTPS, preview deploys |
| Validation | zod (protocol + pack manifest); JSON Schema exported from zod for Python | One source of truth for schemas |
| Pack storage (client) | OPFS (IndexedDB fallback), `fflate` for zip | Large binary storage without a server |
| Stretch/pitch DSP | **Decided by Phase 0 spike** behind a `Stretcher` interface. Candidate default: **Signalsmith Stretch** (MIT, WASM). Fallbacks: SoundTouch (LGPL), rubberband-wasm (GPL → personal only, flagged) | License-clean path to a product |
| Audio format in packs | **FLAC 44.1 kHz** (sample-exact, no encoder priming offsets) with 1-bar handles. Verify decode on iOS Safari in Phase 0 | Gapless, sample-accurate loops |
| Forge | Python 3.11 + `uv`, Typer CLI, FastAPI (Studio server), `audio-separator` (RoFormer/Demucs models), `beat_this` (beats/downbeats; madmom fallback), Essentia (key), librosa (chroma, utilities), `allin1` (sections; optional — brittle install), pyrubberband (offline grid-warp + pitch ladders), pyloudnorm, mutagen, ffmpeg | Best available open tools; local only |
| Studio UI | Small Vite + React app in `tools/studio-ui`, built and served by `forge studio` at `http://localhost:8765`; waveform via wavesurfer.js | Studio needs local files and the Python API, so it lives with Forge |
| Tests | Vitest, fast-check (property tests), Vitest browser mode or Playwright for audio tests, Playwright multi-context e2e with mobile emulation, pytest | See §16 |
| Lint/format | Biome | One fast tool |
| CI | GitHub Actions: typecheck, lint, unit/property tests, build. e2e on PRs to `main` | |

### 5.2 Repo layout
```
stemdeck/
  CLAUDE.md
  docs/
    BUILD_PROMPT.md        ← this file (source of truth for scope)
    ARCHITECTURE.md        ← living architecture + tunable constants
    PHASES.md              ← task tracker (status per task)
    PROTOCOL.md            ← room protocol + versions
    LICENSES.md            ← every dependency/model + license + where used
    TESTING.md
    decisions/NNNN-*.md    ← ADRs
    spikes/*.md
    playtests/phase-N.md
  apps/
    web/                   ← PWA: /, /solo, /puzzle, /host, /join/:code, /play, /lab, /settings
    rooms/                 ← Cloudflare Worker + Room Durable Object
  packages/
    harmony/               ← key/tempo math (pure)
    engine/                ← rules + modes (pure, deterministic)
    audio/                 ← Web Audio engine, transport, render workers, reconciler
    protocol/              ← zod message schemas (versioned)
    pack/                  ← pack schema (zod), JSON Schema export, zip→OPFS loader, catalog API
    ui/                    ← shared React components (Card, Slot, Board, Hand)
  tools/
    forge/                 ← Python pipeline + Studio API (uv project)
    studio-ui/             ← Studio front end
  e2e/                     ← Playwright
  library/                 ← GITIGNORED: user's songs, caches, built packs
```

### 5.3 Runtime topology
- **Solo:** `apps/web` + `LocalRoom` (the engine runs in the browser) + audio engine. Works offline once the app and pack are loaded.
- **Rooms:** host browser ⇄ Room DO ⇄ player phones. The DO runs the engine. The host renders the board and **reconciles audio from the public board state**. Phones render their hands and a mini-board. **Only the host plays audio**, so there is no cross-device audio sync problem.
- `LocalRoom` and `RemoteRoom` implement the same `RoomClient` interface, so all UI works unchanged in both:
```ts
interface RoomClient {
  readonly self: { playerId: PlayerId; isHost: boolean };
  getView(): ClientView;                         // public state + my private state
  subscribe(fn: (view: ClientView, events: GameEvent[]) => void): () => void;
  send(intent: Intent): Promise<IntentResult>;   // resolves on ack/reject
}
```

---

## 6. Domain model

### 6.1 Roles, colors, shapes (accessible by design)
| Role | Stem | Color | Shape glyph |
|---|---|---|---|
| `lead` | vocals | yellow | triangle |
| `loop` | other (melodic) | red | circle |
| `beat` | drums | blue | square |
| `bass` | bass | green | diamond |
| `wild` | all four stems of one song | multicolor | star |
| `fx` | original procedural sound + rule effect | monochrome | bolt |

Always pair color with shape: red and green are hard to tell apart for many players.

### 6.2 Board (config-driven, defaults below)
| Slot | Accepts |
|---|---|
| S1 | bass, beat |
| S2 | beat |
| S3 | beat, loop |
| S4 | loop |
| S5 | loop, lead |

- Cards **stack**. Only the top card sounds. A slot reads its top card only. Recommended stack limit: 10.
- **Wild** on a dual slot plays the role that's currently missing from the mix; if neither is missing, it plays the slot's first listed role. Playing a wild **resets master tempo + key** to that song's native values (tempo folded into range, §7.2).
- **FX** can go on any slot. It covers that slot with an original procedural sound and triggers its rule effect (in Clash and Party).
- **Levels 1–3.** Stacking rule in game modes: you may play onto an empty slot, or onto a top card whose level is ≤ the new card's level. Levels also set mix prominence: default gain L1 −5 dB, L2 −2.5 dB, L3 0 dB (tunable).

### 6.3 Core types (put in `packages/engine/src/contracts.ts`; the orchestrator owns this file)
```ts
type Role = 'lead' | 'loop' | 'beat' | 'bass';
type CardKind = Role | 'wild' | 'fx';
type Level = 1 | 2 | 3;
interface CardDef { cardId: string; songId: string | null; kind: CardKind; level: Level;
  title: string; artist: string; playlist?: string; fx?: FxSpec; }
interface CardInstance { instanceId: string; cardId: string; ownerId: PlayerId | null; }
interface SlotState { index: 0|1|2|3|4; accepts: Role[]; stack: CardInstance[];
  activeRole: Role | null; blocks: { roles: Role[]; untilTurn: number }[]; }
interface MasterState { bpm: number; pcs: number /*0-11*/;
  setBy: { reason: 'first' | 'wild' | 'remix' | 'manual'; cardId?: string }; }
interface BoardState { slots: SlotState[]; master: MasterState | null; }
```

### 6.4 Pack format (`packages/pack`; versioned `schemaVersion: 1`)
A pack is a zip (`*.stemdeck`) containing `pack.json`, `audio/*.flac`, and `art/*.webp` (host-only):
```ts
interface Pack { schemaVersion: 1; packId: string; name: string; createdAt: string;
  songs: Song[]; cards: CardDef[]; stems: StemLoop[]; playlists: { id: string; name: string; cardIds: string[] }[]; }
interface Song { songId: string /*sha1 of source audio*/; title: string; artist: string; album?: string;
  year?: number; genre?: string; nativeBpm: number; key: { tonic: number; mode: 'major'|'minor'; confidence: number };
  art?: string; }
interface StemLoop { stemId: string; songId: string; role: Role; file: string; sampleRate: 44100;
  handleSamples: number;           // 1 bar of pre-roll and post-roll in the file
  loopStartSample: number; loopEndSample: number;   // exact loop region inside the file
  bars: 4 | 8 | 16; bpm: number;   // exact after grid-warp
  pcs: number; mode: 'major'|'minor';
  chroma: number[][];              // per-bar 12-dim chroma (harmonic roles only)
  entryEvery: 1 | 2 | 4;           // bars; defaults beat=1, bass=1, loop=2, lead=4
  gainDb: number; lufs: number; }
```
A card references stems by `songId` + role. A wild references all four. A contract test validates real Forge output against the zod schema (via the exported JSON Schema).

---

## 7. Music math (`packages/harmony`, pure + exhaustively tested)

### 7.1 Key
- `pcs(key) = mode === 'major' ? tonic : (tonic + 3) % 12`. This automatically maps relative minor ↔ major, so there's **never any mode conversion of audio**.
- Base transposition for a stem to the master: `d = (master.pcs − stem.pcs) mod 12`, mapped into −6…+5 (if `d > 5`, `d −= 12`). Tie at ±6: prefer **downward** for `lead`.
- **Drums are never pitch-shifted.** `lead` uses formant preservation. `bass` and `loop` don't.
- **Harmony v2 (Phase 2): chroma-fit.** For candidate `t ∈ [−6, +5]`:
  `score(t) = 1.0·keyFit(t) + 0.8·corr(rotate(stem.chroma, t), anchorChroma) − 0.05·|t|`
  where `keyFit = 1` for the exact PCS match, `0.6` for a fifth away (±7 ≡ ∓5, shares 6 of 7 notes), else 0. `anchorChroma` is the bass loop's per-bar chroma if a bass is in the mix, otherwise a Krumhansl major-key template at the master PCS. Pick the max. Expose the score so Freestyle can show a "clash" warning.
- Vocal shift soft limit `|t| ≤ 4`. Past that, still play it, but flag `strained`.

### 7.2 Tempo
- Global tempo range **[90, 157] BPM**. Fold a song's native BPM by ×2 or ÷2 into range (store the multiplier as `feel`).
- For a stem at master BPM `M`, choose a fold `f ∈ {½, 1, 2}` minimizing `|log(M / (native·f))|`. Stretch ratio `r = M / (native·f)`.
- Soft limits: `lead` 0.85–1.18, others 0.80–1.25. Hard cap 0.66–1.5. Past the hard cap, use the next fold.
- **Tempo/key authority:** the first card onto an empty board sets the master (`reason:'first'`). A wild resets it (`'wild'`). The Remix button randomizes it in Freestyle (BPM uniform in [95, 140], random PCS). Freestyle also allows manual changes.

### 7.3 Time grid
- 4/4 only. Global 16-bar cycle. Loops are 4/8/16 bars and are **phase-locked** to the cycle: `offsetBars = globalBar mod loop.bars`.
- A card may enter only at a bar where `globalBar mod entryEvery === 0` **and** its render is ready (§8.3).

---

## 8. Audio engine (`packages/audio`)

### 8.1 API (contract owned by the orchestrator)
```ts
interface AudioEngine {
  unlock(): Promise<void>;                 // call from a user gesture
  attachPack(pack: PackHandle): void;      // lazy decode on demand
  setDesired(mix: DesiredMix): void;       // declarative; idempotent
  on(e: 'cueing' | 'entered' | 'left' | 'strained' | 'underrun' | 'stateChange', cb: (p: any) => void): () => void;
  transport: { bpm(): number; barAt(ctxTime: number): number; nextBoundary(everyBars: number): number };
  exportMixWav?(bars: number): Promise<Blob>;   // Phase 2, personal use
}
interface DesiredMix { master: { bpm: number; pcs: number } | null;
  slots: ({ slot: number; stemId: string; role: Role; levelGainDb: number; userGainDb: number; muted: boolean } | { slot: number; fxSound: FxSoundPresetId } | null)[];
  oneShots: { id: string; fxSound: FxSoundPresetId }[]; }
```
A pure `deriveDesiredMix(board, pack, harmonyOpts)` lives in `packages/audio/src/derive.ts` and is unit-tested. The host UI calls it on every board change.

### 8.2 Transport & scheduler
- Lookahead scheduler pattern: the timer runs in a **Worker** (25 ms tick, so it isn't throttled on the main thread) and schedules everything ≥150 ms ahead on AudioContext time.
- The bar grid is anchored by `anchorCtxTime` + BPM. Master tempo changes re-anchor so the bar count is continuous.

### 8.3 Render-on-drop (default strategy; Phase 0 confirms)
- When a desired stem appears, a **render worker pool** (size `min(3, cores−1)`) takes the decoded loop (with handles), applies stretch ratio `r` + transposition `t` (formant for lead) with the chosen `Stretcher`, and outputs **exactly** `bars × 4 × 60/M × sampleRate` samples, plus a 10 ms seam crossfade built from the handle audio. The result plays as a plain looping `AudioBufferSourceNode`, with **zero real-time DSP cost**.
- Entry time = the first valid boundary (§7.3) ≥ `now + renderETA + 100 ms`. If that's more than 2 bars away, emit `cueing` (the UI shows a pulsing slot).
- Cache: LRU keyed `stemId|bpm.toFixed(2)|t|formant`. Byte budget 256 MB desktop, 128 MB mobile (tunable).
- **Master change** (wild, Remix, manual): re-render all active stems in the background. When they're all ready, swap everything at the next **phrase** boundary, preceded by a 1-bar transition (master high-pass sweep + riser one-shot). Old loops keep playing until the swap.
- Fallback if phones can't render an 8-bar stereo loop in ≤1.2 s: Forge pre-renders a **pitch ladder** (12 transpositions), so runtime only time-stretches.

### 8.4 Graph & mix
`source → slotGain(level + user, 10 ms ramps) → roleEQ (high-pass ~120 Hz for every non-bass role) → roleBus`. When `leadBus` is active, it ducks `loopBus` by −2 dB. Then `master: DynamicsCompressor (glue) → second compressor as limiter → Analyser → destination`. Per-role analysers drive the slot glow visuals.
- Swaps: new source `start(t, offset)` with a 10 ms fade-in; old source fades out over 10 ms at `t` and stops at `t + 0.03`.

### 8.5 FX sounds
Original, **procedural** Web Audio presets (no samples): noise riser, downlifter, stutter gate, siren synth, sub drop, tonal stab pattern transposed to the master PCS. Each preset can also run as a subtle 1-bar slot loop while an FX card is on top.

### 8.6 Mobile realities (must handle)
- Unlock the AudioContext on the first tap (play a silent buffer + `resume()`). Handle iOS `interrupted` state and `visibilitychange`.
- Where supported, set `navigator.audioSession.type = 'playback'` so the iOS silent switch doesn't mute the game (feature-detect; verify).
- Wake Lock on the host screen. Warn the host if the tab is hidden (iOS suspends audio).
- Use `dvh` units, safe-area insets, `overscroll-behavior: none` and `touch-action: none` on drag surfaces.
- Output-latency compensation for visuals: `ctx.outputLatency` + a user calibration offset (Bluetooth speakers add delay).

---

## 9. Rules engine (`packages/engine`)

```ts
interface GameMode<S, Cfg> {
  id: 'freestyle' | 'jam' | 'clash' | 'party' | 'puzzle';
  setup(cfg: Cfg, players: PlayerSeat[], seed: number): S;
  validate(s: S, actor: PlayerId, intent: Intent): { ok: true } | { ok: false; code: RejectCode; message: string };
  apply(s: S, actor: PlayerId, intent: Intent, ctx: { now: number }): { state: S; events: GameEvent[] };
  tick(s: S, ctx: { now: number }): { state: S; events: GameEvent[] };  // timers
  publicView(s: S): PublicView;
  privateView(s: S, player: PlayerId): PrivateView;
  isOver(s: S): boolean;
}
```
- The seeded RNG (e.g. xoshiro128**) lives **in state**. Replaying an intent log reproduces the exact state (tested).
- Shared modules: board legality, stacking, deck building/validation, dealing, scoring helpers, the FX interpreter.
- Property tests (fast-check) at minimum: a card instance is never in two places; hand sizes respect limits; scores follow the rules; legal moves never throw; replay determinism; private views never contain other players' hands.

---

## 10. Rooms (`apps/rooms` + `RemoteRoom` in `packages/protocol`/`apps/web`)

### 10.1 Lifecycle
- The host opens `/host`, picks a pack (from OPFS), and creates a room. The server returns a **4-letter code** (no I/O/0/1-like letters). The host screen shows the code + QR for `https://<app>/join/CODE`.
- Players join with a name + avatar glyph. A `resumeToken` is stored in localStorage so a refresh or rejoin keeps the same seat. The host has a host token and can reclaim the room after a refresh; the audio engine simply re-reconciles from the snapshot.
- Phases: `lobby → playing → results → lobby`. The room expires after 30 min idle (DO alarm). Capacity: host + up to 7 players (Clash max 4 players).
- **Host also playing:** a toggle shows a hand dock (bottom sheet) on the host screen. The host can also just join from a second device.

### 10.2 Catalog handshake (personal phase)
- The host uploads the pack's **public metadata only** (`cardId, kind, level, title, artist, playlist`), chunked if large. Never audio or art.
- Phones render generated card art (deterministic pattern from `cardId`) + text. Album art shows on the host only.
- **Deck sourcing in the lobby:** each player chooses (a) a playlist deck, (b) a balanced random deal (role quotas), or (c) a custom deck built on the phone from the host catalog, validated by the mode's deck rules. Design for a future where players own collections: `Collection = cardId[]`, and the lobby checks the host has every card (missing cards are excluded with a notice).

### 10.3 Protocol v1 (zod, `packages/protocol`; document in `docs/PROTOCOL.md`)
- Client→server: `hello{v, code, role, name?, avatar?, resumeToken?}`, `host.catalog{packId, cards[]}`, `lobby.settings{mode, cfg}` (host only), `lobby.deck{source, cardIds?}`, `lobby.ready`, `lobby.start` (host only), `intent{intentId, type, payload}`, `ping{t}`.
- Server→client: `welcome{playerId, resumeToken, serverTime}`, `view{seq, public, private?}` (**v1 sends the full filtered view on every change** — small and robust; add patches only if measured), `ack{intentId}`, `reject{intentId, code, message}`, `pong{t, serverTime}`, `error{code}`.
- Intents are idempotent by `intentId`. `seq` is monotonic; on a gap, the client requests a fresh view.
- Rate limit: 20 msgs/s per connection. Validate the size of every field. Room-code brute-force protection on join.
- Timers (turn timers, Party requests) use DO **alarms** → `engine.tick`.
- State is persisted to DO storage after each apply, so it survives hibernation.

### 10.4 Phone controller UX
- Hand as a fanned row; a mini-board at the top mirrors the host's top cards (role colors/shapes, levels, owner rings).
- Drag a card up onto a slot target (invalid targets dim while dragging), or tap a card and then tap a slot. The intent is sent optimistically ("pending" shimmer). On reject, the card springs back with a short reason toast. `navigator.vibrate` where supported.
- The active player's controls (Remix wheel spin, end turn) appear only on the phone whose turn it is.
- Phase 4 nicety: a beat pulse on phones, synced via server time offset + the host's transport anchor.

### 10.5 Host board UX
Landscape-first big board (works in portrait on phone hosts): 5 slots with stacks and glow, master BPM/key, scoreboard and turn banner (Clash), request lane + timers + hype meter (Party), room code/QR always visible in the lobby (collapsible in game), keyboard shortcuts on laptop (1–5 select slot, space = Remix, F = fullscreen board).

---

## 11. Game modes (rules are data-driven; every number below is a tunable default in `ARCHITECTURE.md`)

### 11.1 Freestyle (solo, single device): **the MVP**
- No score. Library drawer (search, filter by role/level/playlist). Drag any card to a slot. A "respect slot roles" toggle (default on) can be turned off so anything goes anywhere.
- Controls: master BPM slider (re-render + phrase swap), key picker, per-slot volume/mute, the **Remix button** (randomize BPM + key), clear board.
- **Saved mixes** = a recipe (`packId`, master, timeline of `{bar, slot, cardId, action}`) stored in IndexedDB. Replay. Export to WAV (Phase 2, personal use).

### 11.2 Jam (rooms, multiplayer freestyle)
- Everyone holds a hand of 7 dealt from the host catalog and refills on play. Anyone can play at any time; there's a per-player cooldown of 1 bar. The host controls master/Remix. No score. "Who played what" badges on the board.

### 11.3 Clash (rooms, competitive, 1v1 / 1v2 / 2v2)
- **Deck rules:** solo deck ≥30 cards, total level ≤80, ≤2 copies per card; wild/FX count as 4 toward the total. Team members bring 15 cards / ≤40 each.
- **Hands:** solo starts with 5, draws 2 after each turn, hand limit 7. Team members start with 3, draw 1, limit 5. Reshuffle the discard pile when the deck runs out.
- **Turn:** 2 moves (in teams, 1 move per teammate). Each move is **play a card** or **spin the Remix wheel**. Optional turn timer 15/30/60 s (DO alarm → auto-pass).
- **Legality:** the role must be in `slot.accepts` (wild/FX: any slot); the card's level ≥ the top card's level; the same `cardId` must not currently be face-up on the board; the slot must not be blocked for that role.
- **Scoring:** +1 per valid play. +1 **missing-role bonus** (after the first full round) when the board has no top card of that role before your play. +1 **full-mix bonus** when your side controls all 5 top cards (once until control is lost). First to 21 (15/21/31 configurable) wins at the end of an action. Scores floor at 0.
- **Remix wheel** (12 segments, default `[L1,L1,L1,L2,L2,L2,L3,L3,X,MISS,MISS,MISS]`): clears the opponents' top cards of the rolled level (X = all of them), −1 point to the owner per cleared card, and underlying cards become top (control passes to their owners). If opponents have no cards on the board, a spin has a 1/12 chance of +1.
- **FX cards:** see §11.6.

### 11.4 Party (rooms, co-op, 1–8 players)
- The team shares a draw pile (from chosen playlists). Hands of 5, refill on play.
- **Requests** appear in a lane on the host screen; any player can fulfil one from their phone, and the first valid play wins. Types (weighted by difficulty and progress): role; level; role+level; specific slot; two-card combo within the timer; same-song pair; "Remix now". **The generator must guarantee each request is satisfiable** from the team's current hands + board legality.
- **Timer per request:** Easy 15 s / Normal 10 s / Hard 7 s. Points = `100 + 100 × remainingFraction`, × streak multiplier `min(2, 1 + 0.1·streak)`.
- A **strike** for a timeout or a wrong play; 3 strikes ends the game (Easy: 5). The game also ends after 20 requests with a "last call" bonus.
- **Hype meter:** +1 per fill, +2 if filled under 3 s, reset on a strike. At 8 → **Encore**: 30 s of double points with faster requests and a musical lift (master high-shelf + FX).
- Local high scores per pack + difficulty.

### 11.5 Puzzle (solo, single device; also playable in a room by one player)
- 5 rows of request tiles, one row per slot, max 6 tiles per row. Each tile asks for a role or a level.
- Playing a card in slot *k* clears the **contiguous block at the head of row k** whose tiles match the card (role or level). Points = `10 × blockSize²`.
- After each action, a new tile spawns in a random row. Spawning into a full row = **overflow**: the row is wiped and you lose 1 action.
- 30 actions per game. Remix wheel spin (costs an action) clears tiles of the rolled level across all rows. FX cards clear all *single* (unconnected) tiles in a chosen row. Local leaderboard.

### 11.6 FX system (Clash/Party rules; sound everywhere)
A small DSL interpreted by the engine:
```ts
type FxCondition = { type: 'slotEmpty' } | { type: 'playedOverRole'; role: Role } | { type: 'controls'; roles: Role[] } | { type: 'sameSongPair' };
type FxAction =
  | { type: 'points'; target: 'self' | 'opponents' | 'all'; amount: number }
  | { type: 'extraMove' } | { type: 'draw'; count: number } | { type: 'reshuffleHand' }
  | { type: 'clear'; owner: 'opponents' | 'any'; roles?: Role[]; maxLevel?: Level }
  | { type: 'block'; roles: Role[]; turns: number } | { type: 'stealTop'; slot: 'chosen' };
interface FxSpec { id: string; name: string; text: string; conditions: FxCondition[]; actions: FxAction[]; sound: FxSoundPresetId; }
```
Ship **12 original FX cards**. Examples (names and wording are ours): *Needle Drop* (+1 if played on an empty slot), *Crate Dig* (draw 2), *Mute Switch* (block `lead` for 1 turn), *Low Cut* (clear opponents' `bass` and `beat` cards of level ≤2), *Feedback Loop* (extra move), *Mic Grab* (steal the top card of a chosen slot), *Sidechain* (+2 if you control both a `beat` and a `bass`), *Tape Stop* (clear any one slot), *Air Horn* (+1 to you, −1 to each opponent), *Reverse Cymbal* (reshuffle your hand and draw to limit), *Pitch Bend* (+1 per `loop` you control), *Hard Reset* (clear all top cards of level 1). Balance them with the Phase 4 self-play sim.

---

## 12. Forge + Studio (`tools/forge`, `tools/studio-ui`)

### 12.1 CLI
- `forge doctor`: checks GPU/CUDA, ffmpeg, model downloads, disk space, and that the Python deps import.
- `forge fixtures`: generates **synthetic test songs with ground-truth stems** (click/drum tracks at 92/120/128/150 BPM; I–V–vi–IV in G major; i–VI–III–VII in E minor; synth basslines; formant-synth "vocals"), plus a ground-truth JSON. Used by both the Python and TS tests.
- `forge ingest <dir> --pack <name>`: idempotent; caches by audio hash in `~/.stemdeck/cache`.
- `forge studio`: FastAPI + built Studio UI at `http://localhost:8765`.
- `forge export <pack> [--playlist X] --out <file>.stemdeck` (playlist sub-packs for phone hosts).
- Writes only under `~/.stemdeck/` and the repo's gitignored `library/`.

### 12.2 Pipeline per song
1. **Validate + decode:** accept FLAC/WAV/MP3/OGG/non-DRM M4A; reject DRM'd files (e.g. `.m4p`) with a clear message. Read tags (mutagen). Decode to 44.1 kHz stereo float WAV (ffmpeg).
2. **Separate:** vocals with a RoFormer vocal model; the instrumental through `htdemucs_ft` for drums/bass/other. Both via `audio-separator`. Phase 0 benchmarks alternatives by ear on 3 real songs + by SDR on fixtures, then picks via ADR. GPU required for good throughput; warn on CPU.
3. **Analyze:** beats/downbeats (`beat_this`, madmom fallback); BPM = median inter-beat interval. **Reject non-4/4 songs** with a reason. Key via Essentia KeyExtractor on bass+other (vote `edma` vs `bgate` profiles) with confidence. Sections via `allin1` if it installs cleanly, otherwise a librosa recurrence/novelty fallback that finds repeated, high-energy "hook" sections. Per-bar chroma (`chroma_cqt`, beat-synchronous, averaged per bar) on harmonic stems.
4. **Candidates:** per role, the top 3 windows of 8 bars (4/16 also allowed) starting on downbeats, preferring chorus/hook sections. Filters: stem active in ≥75% of bars; no silence gaps >1 beat for `beat`/`bass`; seam score (RMS + spectral continuity across the loop boundary); `lead` windows start at phrase starts.
5. **Grid-warp:** piecewise time-map stretch (pyrubberband `timemap_stretch`) so the loop's beats are perfectly even at its nominal BPM (rounded to 0.01).
6. **Loudness:** measure LUFS (pyloudnorm) and store `gainDb` toward the per-role targets (tunable). Don't bake in heavy processing.
7. **Level suggestion:** heuristic from loudness, density and hook-section membership. Studio can override.
8. **Export:** FLAC with 1-bar handles before and after, manifest per §6.4, art → 512 px webp. Validate against the exported JSON Schema.

Phase 1 ships steps 1–4 (top-1 auto-pick) + 6 + 8, plus an `overrides.yaml` per pack for fixing BPM/key/loop start by hand. Grid-warp and Studio arrive in Phase 2.

### 12.3 Studio (Phase 2)
Song list → per role, 3 candidates with waveforms. Loop-audition each candidate at native tempo **and** at a test master tempo/key. Nudge the start by ±1 bar and pick length 4/8/16. Override BPM (tap, ×2, ÷2) and key (dropdown + audition against a reference drone). Set level, enable a wild card (requires all 4 stems approved), assign playlists, approve → export.

Detection *will* be wrong sometimes (half/double tempo, relative-key confusion). Studio exists to make fixing that take seconds.

---

## 13. Orchestration protocol

### 13.1 How you work
1. **Contract-first.** Before fanning out a phase, write or extend the contracts yourself (`contracts.ts` per package, protocol schemas, pack schema) with doc comments, plus stub implementations so dependents can build against them.
2. **Fan out** independent tasks to subagents in parallel (max 3–4 at once on this machine). Use **isolated git worktrees** for parallel code-writing subagents and run them in the background. Give each task **disjoint file ownership**.
3. **Integrate** yourself: review each diff against "Files allowed to change", run the full test suite, resolve conflicts, merge, commit.
4. **Verify** at the end of every phase with a fresh **verifier subagent** (Opus 5.5, high) that didn't write the code. It reads the phase's acceptance criteria, runs everything, tries to break it, and reports pass/fail per criterion with evidence. Fix every failure before the checkpoint.
5. **Report** at the checkpoint (§14) and wait.

### 13.2 Spawning rules
- Every spawn: model **Opus 5.5**, reasoning effort **high**, prompt in the §13.3 template.
- Subagents start cold. List the exact sections of this file (`docs/BUILD_PROMPT.md §8.3`) and the contract files under "Files to inspect first", and put the essential numbers directly in the Task/Goal.
- One subagent = one or two focused tasks. Never blend multiple fixes into one task description.
- If a subagent proposes changing a file outside its allowed list, it must explain why in its report. You decide; never auto-accept.
- Subagents must not edit contracts, CLAUDE.md, BUILD_PROMPT.md or PHASES.md. They propose; you change.

### 13.3 Subagent prompt template (use exactly this shape)
```
Read CLAUDE.md first before doing anything.

Task(s):
1. [one focused task]
2. [a second focused task, if any — listed separately, never blended]

Goal:
[what done looks like in plain english, per task]

Files to inspect first:
- CLAUDE.md
- docs/BUILD_PROMPT.md §[relevant sections]
- [contract files and existing code relevant to these tasks]

Files allowed to change:
- [explicit list or directory globs, grouped by task]

Constraints (use if any of these features are touched, or close proximity features are touched):
- [the full STEMDECK constraints block from §3, copied verbatim]

Success criteria:
- [specific, testable statements, including the exact test commands that must pass]

After finishing:
- list every file you changed, grouped by task
- explain why each change was made
- confirm no invariants were broken
- suggest the next smallest safe task
```

### 13.4 Worked example (Phase 1, task 1A)
```
Read CLAUDE.md first before doing anything.

Task(s):
1. Implement packages/harmony v1: pcs(), transpositionFor(), tempoFold(), stretchRatio(), entryBoundary().
2. Write exhaustive unit + property tests for those functions.

Goal:
1. Given a stem's key/BPM/role and the master BPM/PCS, the package returns the semitone shift (−6…+5, ties downward for lead, always 0 for beat), the tempo fold (½/1/2) and stretch ratio that minimize |log r| within the limits, the "strained" flag, and the next legal entry bar for an entryEvery value — exactly per BUILD_PROMPT §7.
2. Tests cover every key pair (12×12×2 modes), relative major/minor equivalence, fold edge cases at 90 and 157 BPM, hard-cap fallbacks, and drums never shifting.

Files to inspect first:
- CLAUDE.md
- docs/BUILD_PROMPT.md §2, §7
- packages/harmony/src/contracts.ts

Files allowed to change:
- packages/harmony/src/** (except contracts.ts)
- packages/harmony/test/**
- packages/harmony/package.json (dev deps only: fast-check)

Constraints (use if any of these features are touched, or close proximity features are touched):
- [full STEMDECK constraints block, verbatim]

Success criteria:
- `pnpm --filter @stemdeck/harmony test` passes with ≥95% line coverage
- `pnpm --filter @stemdeck/harmony typecheck` and `pnpm lint` pass
- no runtime dependencies added
- C major stem → A minor master returns shift 0; E minor stem → G major master returns 0; beat role always returns 0

After finishing:
- list every file you changed, grouped by task
- explain why each change was made
- confirm no invariants were broken
- suggest the next smallest safe task
```

### 13.5 Docs you keep current
- `docs/PHASES.md`: every task with id (e.g. `1C`), owner (subagent run), status (`todo/in-progress/review/done/blocked`), and links to commits/ADRs. Update it after every integration.
- `docs/decisions/`: an ADR for every non-obvious choice (context, options, decision, consequences).
- `docs/ARCHITECTURE.md`: diagrams (mermaid), data flow, and **all tunable constants** in one table.
- `docs/LICENSES.md`: every dependency **and model weight** with license, where it's used, and whether it's OK for a commercial product (flag non-commercial weights such as CC BY-NC).

### 13.6 Git
Conventional commits. One commit per integrated task. Branch per phase (`phase-1`), merged to `main` at the checkpoint and tagged `phase-N`. Never force-push. Never commit anything under `library/`, any audio, or any `.stemdeck` file. Add pre-commit checks that block audio extensions and files over 5 MB.

### 13.7 Stop and ask the user only when
- you reach a phase checkpoint (unless the user granted autonomy);
- an action costs money, creates an account, deploys publicly, adds auth/payments/analytics, or installs system-level software not already approved;
- a decision is irreversible and could reasonably go either way;
- a task is blocked after two genuine attempts. Write a blocker note (what you tried, evidence, 2–3 options with your recommendation) instead of quietly cutting scope.

Never mark a task done with failing, skipped or deleted tests. Never weaken a test to make it pass.

---

## 14. Roadmap & playtest checkpoints

Each phase lists its workstreams (parallelizable unless an arrow says otherwise), then acceptance criteria, then the checkpoint. At every checkpoint, write `docs/playtests/phase-N.md` containing: exact commands to run, URLs (local + tunnel/preview), a numbered list of things to try on **phone and laptop**, what to listen for, known issues, and a short feedback template (rate 1–5 + free text per item). Then send the user a ≤15-line summary: what's playable, how to start it, what you decided that they might want to veto, and what's next. **Wait for feedback.** Turn the feedback into tasks before starting the next phase.

### Phase 0 — Foundations + risk spikes
- **0A** Repo scaffold, Turborepo, Biome, Vitest, Playwright, CI, gitignore + pre-commit audio guard, docs skeleton. (You write CLAUDE.md and the initial contracts.)
- **0B** Audio spike → `/lab` route: load synthetic fixtures (and a local file via file picker). Compare Stretcher candidates (realtime AudioWorklet vs render-on-drop worker; Signalsmith vs SoundTouch vs rubberband-wasm). Measure render time for 8- and 16-bar stereo loops at r=0.8/1.25 and t=±5 on laptop **and** the user's phones; CPU with 5 concurrent loops; seam click test; FLAC `decodeAudioData` on iOS Safari + Android Chrome. Output `docs/spikes/audio.md` + ADR.
- **0C** Forge spike: WSL2 setup script, `forge doctor`, `forge fixtures`. Separation + analysis on 3 of the user's songs with 2 separator configs. Timings; analysis accuracy on fixtures. Report on which deps install cleanly (`allin1` especially). ADR.
- **0D** Rooms spike: minimal DO room (`wrangler dev`) + quick tunnel. Host page shows code + QR; a phone joins, taps a button, the host shows it; measure round-trip latency; test reconnect after refresh.
- **Accept:** all spikes documented with numbers; a stretcher and separator chosen via ADR; CI green.
- **Checkpoint 0:** the user opens `/lab` on phone + laptop and A/B's stretcher outputs by ear, confirms Forge runs on their machine, and joins the test room from a phone.

### Phase 1 — **MVP: solo Freestyle on one device**
- **1A** `packages/harmony` v1 (§7.1 base, §7.2, §7.3). *(Example prompt in §13.4.)*
- **1B** `packages/engine`: board, cards, stacking, Freestyle mode, `LocalRoom`, intent log + replay.
- **1C** `packages/audio` v1: transport, worker scheduler, render pool + chosen Stretcher, LRU cache, reconciler, graph (§8.1–8.4), iOS unlock/session/wake-lock (§8.6). *(Depends on 1A contracts.)*
- **1D** `packages/pack`: zod schema + JSON Schema export, zip → OPFS import with progress, catalog API, lazy decode.
- **1E** Forge v1: ingest → auto top-1 candidates → loudness → export pack; `overrides.yaml`; contract test vs the JSON Schema.
- **1F** `apps/web` Solo UI: home, pack import, Freestyle board (5 slots, stacks, levels, role colors + shapes), library drawer, drag + tap-to-place, master display + BPM slider + key picker, Remix button, per-slot volume/mute, cueing/strained indicators, saved mixes. Layouts: phone portrait, phone landscape, desktop. *(Starts against stubs; integrates once 1B/1C/1D land.)*
- **Accept:** a pack of ≥20 songs imports on laptop and phone; every dropped card enters on a legal boundary, in key and in tempo; stacking/level/wild/Remix behave per spec; no audible clicks at seams or swaps; 5 active slots on the user's phone with no dropouts for 10 minutes; all unit/property tests green; the verifier passes.
- **Checkpoint 1:** the user runs Forge on ~20 songs, imports the pack on phone + laptop, and plays Freestyle for 20 minutes. Feedback on fun, sound and UI.

### Phase 2 — Make it sound good + curation
- **2A** Studio (§12.3) + Forge API endpoints.
- **2B** Harmony v2 (chroma-fit, fifths, vocal limits) + the "clash" warning in Freestyle.
- **2C** Audio polish: master-change transitions, role EQ/ducking/limiter tuning, seam crossfades, latency calibration, visualizer, WAV export of a mix.
- **2D** Forge v2: grid-warp, better candidates (hook detection), level heuristic, playlist sub-pack export.
- **Accept:** blind listening test. The app generates 20 random legal 4-card mixes from the user's pack; the user rates each 1–5. **Target median ≥3.5** (record the results in the playtest doc). Studio fixes a wrong BPM/key in under 30 s.
- **Checkpoint 2:** the user curates ~50 songs in Studio and repeats the listening test.

### Phase 3 — Rooms + Jam
- **3A** `apps/rooms`: Room DO running the engine, persistence, alarms, per-recipient filtering, rate limits, reconnection, expiry.
- **3B** `packages/protocol` v1 + `RemoteRoom` client (same `RoomClient` interface as `LocalRoom`).
- **3C** Host screen: create room, code + QR, lobby (players, mode, settings), catalog handshake, the in-game board reconciling audio from the public view, host-also-plays dock.
- **3D** Phone controller: join flow, name/avatar, hand, mini-board, drag/tap-to-slot, optimistic pending + reject toasts, haptics, resume.
- **3E** Jam rules + deck sourcing (playlist decks, balanced random deals).
- **3F** e2e: Playwright with a host (desktop) + 3 players (iPhone/Pixel emulation) against `wrangler dev`. Assert board sync, the reconnect flow, and **that no player ever receives another player's hand** (inspect WebSocket frames). Preview deploy (after the user approves the Cloudflare account).
- **Accept:** a 4-device Jam for 15 minutes with phones on cellular, a host refresh recovers state, p95 intent→host-board ≤250 ms, the verifier passes.
- **Checkpoint 3:** the user plays Jam with friends twice: laptop as host, then phone as host.

### Phase 4 — Game modes
- **4A** Clash (incl. teams, turn timer, Remix wheel, scoring) + results screen.
- **4B** FX system: DSL interpreter + 12 original FX cards + procedural FX sounds.
- **4C** Party (request generator with satisfiability guarantee, timers via alarms, strikes, hype/Encore, difficulty, local high scores).
- **4D** Puzzle (solo local + room).
- **4E** Phone deck builder + deck validation; 60-second interactive tutorials per mode.
- **4F** Balance sim: random-legal + greedy bots, 10k self-play Clash games. Report first-player win rate (target 45–55%), median game length (target 8–14 min equivalent), and FX card pick/impact rates. Tune the defaults; record them in ARCHITECTURE.md.
- **Accept:** every mode is playable end-to-end in rooms; property tests cover each mode; sim targets met or deviations justified in an ADR.
- **Checkpoint 4:** a game night: Clash 2v2, Party with 4+, Puzzle solo.

### Phase 5 — Product hardening (still private)
PWA install + offline solo; performance audits against §16.2; accessibility (shapes + colors, reduced motion, screen-reader labels, large-text mode); a visual design pass with a coherent design system; onboarding; settings; saved-mix gallery; room load test (50 concurrent rooms, simulated); security review (input validation, rate limits, code brute force, protocol fuzzing); an opt-in, self-hosted error log (no third-party analytics without approval).
**Checkpoint 5:** the user does a cold-start test on a fresh phone, from install through first game.

### Phase 6 — Public-release decision gate (**STOP for a user decision**)
Write `docs/PRODUCT_PATHS.md` with researched, sourced options and tradeoffs. Don't build any of them yet:
- **A. Bring-your-own-music:** each host runs Forge locally. Assess packaging Forge as a desktop companion (Tauri/Electron shell + Python sidecar) vs in-browser separation (ONNX/WebGPU models), plus the legal posture.
- **B. Licensed/original catalog:** royalty-free or commissioned stems, indie-artist partnerships/revenue share, the cost of master + publishing licenses for real hits.
- **C. Hybrid.**
- Plus: a license audit from LICENSES.md (replace non-commercial model weights and GPL pieces), trademark check + naming shortlist, an accounts/collections design (Supabase auth + collections), monetization options (packs, cosmetic card art, subscription), and a launch plan.
Nothing goes public until the user picks a path.

---

## 15. Product-track notes to respect from day one
- Keep content behind the `Catalog` abstraction (`getCard`, `getStemAudio`, `listCards`) so the source can later be "local pack", "CDN catalog" or "user collection" without touching the engine or UI.
- Keep the web bundle permissive-licensed (§3), so shipping later doesn't need a rewrite.
- Card art on phones is generated and original, so it's reusable in a product.

---

## 16. Testing, budgets, definition of done

### 16.1 Test layers
- **Unit + property** (Vitest + fast-check): harmony, engine (every mode), derive.ts, protocol schemas, pack schema.
- **Audio** (in a real browser via Vitest browser mode/Playwright): OfflineAudioContext renders using synthetic fixtures. Two click loops at different native tempos must align within ±2 ms after the engine; no sample discontinuity at seams above the threshold; fades present on every start/stop; entry boundaries respected.
- **Forge** (pytest): on `forge fixtures` ground truth: BPM within ±0.5, downbeat F-measure ≥0.9, key PCS correct on all fixtures, loop sample counts exact, manifest validates.
- **E2E** (Playwright): solo Freestyle smoke on desktop + mobile emulation; rooms multi-context (§14 3F); the privacy assertion on WebSocket frames.
- **Real-device checks** at every checkpoint, on the user's phones.

### 16.2 Budgets
| Metric | Budget |
|---|---|
| Render 8-bar stereo loop (stretch + pitch) | ≤400 ms laptop, ≤1200 ms user's phone (else pitch-ladder fallback) |
| Audio dropouts, 5 slots + FX, 10 min | 0 on the user's phone |
| Player intent → host board update (p95) | ≤250 ms |
| Player controller route JS | ≤300 KB gzipped |
| Host decoded/rendered audio memory | ≤256 MB desktop, ≤128 MB mobile |
| Import 100-song pack on laptop | ≤60 s |
| Forge per song on GPU (separate + analyze + export) | ≤90 s |

### 16.3 Definition of done (per task)
Code + tests written; `typecheck`, `lint`, `test` green; acceptance criteria evidenced (command output, measurements, or screenshots); docs/ADRs updated; PHASES.md updated; committed. Per phase: the verifier passes and the playtest doc is written.

---

## 17. First actions
1. Read this entire file. Then detect the environment (§4.1) and ask the kickoff questions (§4.2) in one message.
2. While waiting: `git init`, create the repo layout (§5.2) with empty packages, write `CLAUDE.md` (project summary, the §3 constraints verbatim, commands, repo map, "how to run"), create `docs/PHASES.md` listing every Phase 0–1 task, and draft the Phase 0–1 contracts (`packages/*/src/contracts.ts`, pack schema, `RoomClient`). Nothing that installs system software or touches the user's music.
3. After the answers: launch Phase 0 workstreams 0A–0D (0A first or in parallel with careful file ownership; 0C needs the WSL/CUDA approval).
4. Integrate, run the verifier, write `docs/playtests/phase-0.md`, and stop at Checkpoint 0.
