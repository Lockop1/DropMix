# Handoff — cloud session → local session (2026-11-12)

You are taking over as **lead engineer and orchestrator** for STEMDECK on the user's own laptop. The previous orchestrator ran in a cloud container with no GPU, no phones and none of the user's music. It finished Phase 0 and had just started Phase 1 when the user asked to move the work to their machine.

Read, in this order, before doing anything else:

1. `CLAUDE.md` — project summary, the constraints (non-negotiable), commands.
2. `docs/BUILD_PROMPT.md` — the full spec and the orchestration protocol you follow (§13). It is the source of truth for scope.
3. This file — where things stand and what the user has asked for since the spec was written. Where this file and the build prompt disagree, **this file wins**, because it records the user's later instructions.
4. `docs/PHASES.md`, `docs/decisions/0001`–`0008`, `docs/playtests/phase-0.md`.

## 1. Standing instructions from the user (newer than the build prompt)

Quoted or closely paraphrased from the user's messages:

- **Autonomy:** "Do as much as you can. Don't stop at any more checkpoints until about 6am" (their local time; they are worried about running out of credits, so spend subagent effort where it moves the build forward). "Anything that you actually need me to do, and cannot do on your own whatsoever, nor can work around — let me know then. I want this to be as hands-off for me as possible." So: do not stop at phase checkpoints. Still write each `docs/playtests/phase-N.md` so they can test later. Still stop for the things in build prompt §13.7 that involve money, accounts, public deploys, or system-level installs they have not approved.
- **Subagents:** every subagent runs on **Opus 5.5 at high reasoning effort**, using the §13.3 template with the constraints block verbatim.
- **Songs to test with:** the user asked to "pull top 50 songs from online". **Do not download commercial music from the internet** — there is no licensed source for it, and it is the one part of their request the previous orchestrator declined. What to do instead:
  1. Build `forge demo-pack`: 50 original, procedurally generated songs with ground-truth stems (brief in `docs/prompts/phase-1/1E-forge.md`). This makes the game fully playable with no real music, no GPU and no model weights.
  2. Use the user's own DRM-free files. Ask them once where their music folder is; if they point you at it, ingest from there. Their files never leave the machine and never go into git.
- **Drop-in importer:** "add something that will let me just drop in mp4 files (or whatever is easiest to break into different song parts) so I can add songs in the future." Build the inbox flow described in `docs/prompts/phase-1/1E-forge.md`: drop files into `library/inbox/` (audio or video containers, including `.mp4`), run one command or leave `forge inbox --watch` running, get an updated `.stemdeck` pack. Add root scripts (`pnpm demo`, `pnpm crate`, `pnpm crate:watch`) so it is one command. Tell the user how to reach the inbox folder from Windows Explorer (`\\wsl$\…`). In Phase 2 the Studio UI should accept drag-and-drop of files too.
- **Order of work:** "After you get all the functionality down, make the app as vibrant and visually pleasing as possible." Functionality first; the design pass after — but the design-system groundwork (section 5) is file-disjoint from the engine and audio work, so it can run as a parallel workstream from the start.
- **Look and feel** (the user's brief — section 5 turns it into tasks): black and neon; the vibe of an underground music club (not literally a club screen, but dark neon, a sense of a crowd, people there); place effects when a card lands; sound effects; menu transitions; menus and layouts that do not look like any other game; custom backgrounds and logo; a lesser-known font as the signature typeface. "Cool effects are highly encouraged. If you want to add any cool Three.js in there or whatever, add any of those effects."

## 2. State of the repository

Branch: `claude/blissful-goodall-iipuw4` (everything is pushed; CI is green). There is no `main` yet. The previous session could push only to that branch; on the laptop, follow build prompt §13.6 if the user's git access allows it (create `main` from this branch, then `phase-1` etc.), otherwise keep working on this branch. Never force-push.

Done and verified (Phase 0):

| Piece | Where | Notes |
|---|---|---|
| Monorepo scaffold, CI, commit guard | root, `.github/`, `scripts/guard.mjs`, `.githooks/` | pnpm + Turborepo, Biome, Vitest, Playwright. The guard blocks audio, `.stemdeck`, `library/`, files over 5 MiB and the original game's name (files and commit messages) |
| Contracts for Phase 0–1 | `packages/*/src/contracts.ts`, `packages/pack/src/schema.ts` | You own these now. Subagents never edit them |
| Audio spike | `packages/audio/src/**`, `/lab`, `docs/spikes/audio.md`, ADR 0006 | Stretcher backends (Signalsmith default; SoundTouch/Rubber Band flag-gated), render worker pool client, seam builder, signal generators, metrics, in-browser FLAC encoder. These are meant to be kept and built on |
| Forge spike | `tools/forge/**`, `docs/spikes/forge.md`, ADR 0005 | `doctor`, `fixtures` (12 synthetic songs with ground truth), `analyze`, `models`, `bench-separation`, `scripts/setup-wsl.sh` |
| Rooms spike | `apps/rooms/**`, `/roomlab`, `packages/protocol/src/spike.ts`, `docs/spikes/rooms.md`, ADR 0007 | Durable Object room via `partyserver`, local `wrangler dev` only. Spike messages are deleted in Phase 3 |
| Verifier | — | A fresh verifier passed all eight Phase 0 criteria; its follow-ups are in `docs/PHASES.md` |

Not started (only placeholders exist): harmony functions, the engine, the audio engine proper (transport, scheduler, reconciler, graph), the pack loader, Forge ingest/export, every real game screen.

In flight when the handoff happened: tasks **1A** (harmony), **1D** (pack loader + `/packlab`) and **1E** (Forge pipeline + inbox + demo crate) had been launched minutes earlier and were stopped with nothing worth keeping. Their complete, ready-to-send prompts are saved in `docs/prompts/phase-1/`. Re-send them as they are, after changing each prompt's "Environment notes" to describe the laptop.

## 3. First actions on the laptop

1. **Detect the environment** (build prompt §4.1): confirm you are inside WSL2 Ubuntu with the repo on the WSL filesystem; `nvidia-smi`; Node ≥ 22.22, pnpm 10, `uv`, ffmpeg; free disk. If the session was opened on the Windows side instead, say so to the user before installing anything.
2. `pnpm install`, then `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and `pnpm e2e -- --trace off`. All should pass. Playwright needs a browser on the laptop (`pnpm --filter @stemdeck/e2e exec playwright install chromium`) — the "never run playwright install" notes in the docs apply to cloud sessions only.
3. **One message to the user**, asking only what you cannot find out yourself: (a) OK to run `tools/forge/scripts/setup-wsl.sh` — it uses `sudo apt-get` and downloads about 10 GB of Python wheels and model weights; (b) where their music folder is; (c) which phones they have (model + OS version). Keep working on everything else while you wait.
4. **Run the Checkpoint 0 measurements you can do without them** and record them in `docs/playtests/phase-0.md`: `node e2e/bench/lab-bench.mjs --label "laptop"` (render times against the 400 ms budget); after setup, `forge doctor`, the Forge test suite, and `bench_separation.py` on three songs from their folder (GPU timings, peak memory). Update ADR 0005/0006 and `docs/spikes/*.md` with the laptop numbers; write the WSL2 confirmation ADR that build prompt §4.1 asks for.
5. **Launch Phase 1** (section 4).

## 4. Plan of record

Wave order the previous orchestrator had settled on (max 3–4 subagents at once on 16 GB; never two GPU jobs at once):

1. **Now, in parallel:** 1A harmony · 1D pack · 1E Forge v1 + inbox + demo crate (prompts saved) · DS-1 design system groundwork (section 5).
2. **When 1A lands:** 1B engine (board, stacking, Freestyle, `LocalRoom`, intent log + replay) and 1C audio engine (transport, worker scheduler, render pool on the existing `createStretchClient`, LRU cache, reconciler, graph, iOS unlock/session/wake-lock). Fold in the carried items `1C-a`, `1C-b`, `1C-c` from `docs/PHASES.md`.
3. **When 1B, 1C, 1D and DS-1 land:** 1F Solo UI — home, pack import, Freestyle board, library drawer, drag + tap-to-place, master controls, Remix, per-slot mix, cueing/strained indicators, saved mixes — built with the design-system components. An e2e test generates the demo crate (or a fixture pack) at test time, imports it and plays cards.
4. Phase 1 verifier → `docs/playtests/phase-1.md` → **keep going** (no checkpoint stop): Phase 2 (Studio with drag-and-drop ingest, harmony v2, audio polish, Forge v2), Phase 3 (rooms + Jam), Phase 4 (Clash, Party, Puzzle, FX), then the full design pass (DS-2) across every screen, then Phase 5 hardening. Phase 6 stays a hard stop.

Contract work you owe before each fan-out (build prompt §13.1): the Phase 1 contracts exist. Before 1C/1F add a small `UiSfx` contract to `packages/audio/src/contracts.ts` (section 5), and before Phase 3 apply the planned protocol changes listed in `docs/PROTOCOL.md`.

Open decisions the user has not answered (proceed on the recommendation; list them again in every playtest doc):

- ADR 0003: in rooms the server learns each song's BPM and key. Recommendation: allow it.
- ADR 0005: separator A (RoFormer + Demucs) vs B (Demucs alone). Decide from the laptop benchmark: if A exceeds 90 s per song on their GPU, switch to B; otherwise keep A until the user listens.
- ADR 0006: Signalsmith's few-cent pitch error. You cannot hear it either; leave it open for the user, and keep the resampler-based transposition as the ready fix.
- The hosted repository's name is the original game's name. Only the user can rename it.

## 5. Design brief → workstreams

The user wants the game to look like nothing else: **black and neon, underground music club, a crowd in the room, alive with motion and sound.** Everything must be original (no assets, names or layouts from the original 2017 game or any other game), permissive-licensed, phone-first (360×640, touch), and must respect `prefers-reduced-motion` and low-power devices. Effects never run on, block or steal time from the audio path.

**DS-1 — design system groundwork (parallel with wave 1; owns `packages/ui/**` and `apps/web/src/routes/styleguide/**`)**

- Theme tokens (CSS custom properties + Tailwind v4 theme): near-black base, 4 role neons that keep the spec's role colors (lead yellow, loop red/magenta, beat blue/cyan, bass green) plus an accent, glow/bloom recipes, grain, scanline and haze layers. Always pair color with the role's shape glyph (triangle, circle, square, diamond, star, bolt).
- Typography: one **lesser-known display typeface** as the signature (self-hosted via an `@fontsource/*` package or files in the repo; SIL OFL or similar; verify the license from the installed package and list it in `docs/LICENSES.md`), plus a legible companion for small text. Shortlist a few candidates on the `/styleguide` page and pick the most distinctive one that stays readable at 360 px.
- Logo: an original SVG wordmark and a compact glyph for the working codename (animated draw-on/flicker variant for the splash). The codename is temporary, so keep the mark easy to re-letter.
- Components with real states: Card (per role, levels 1–3, generated deterministic card art from `cardId` — also what phones show in rooms), Slot (empty / armed / cueing pulse / playing glow / strained / blocked), Board, Hand, buttons, sheets, toasts, the Remix control.
- Motion primitives with Motion (add it now): page/menu transitions, card pick-up/drag/drop springs, the "place" effect (a neon shockwave + particles in the role color, synced to the entry bar via the audio engine's `entered` event, not to the tap).
- `/styleguide` shows all of it and has Playwright screenshots at 360×640 and desktop.

**DS-2 — full visual pass (after the functionality is in)**

- **The room:** a custom background scene for the board — a dark club space with a crowd silhouette that moves with the music. Drive it from the audio engine's per-role levels and the transport's beat (`roleLevel()`, `transport`), never from timers. **Three.js (MIT) is welcome here**: e.g. a low-poly crowd or light rig, volumetric-style beams, lasers that fire on card entries, a reactive floor grid. Load it lazily, only on the host/solo board, with a 2D CSS/canvas fallback when WebGL is missing, the device is weak, the battery is low or reduced motion is on. It must not push the phone controller route over its 300 KB gzipped budget (the controller does not load it at all).
- **Unique layouts:** the menu should not be a list of buttons. Ideas the previous orchestrator liked: the home screen as a club's back-wall of flyers/posters (each mode is a poster), the library as a record crate you flip through, settings as a mixer channel strip, the lobby as a guest list at the door. Pick a concept and carry it through consistently.
- **Sound design:** original, procedural UI sounds (no samples): card pick-up, hover/arm, drop "thunk" that resolves into the place effect on the bar, reject buzz, menu whoosh, Remix spin-up and drop. They live in `packages/audio` behind a small `UiSfx` contract you add (`play(id)`, master volume, mute; routed to their own bus so they never touch the music limiter's gain staging more than intended), because UI code must not touch Web Audio nodes. They must be quiet under the music and switchable off.
- **Transitions:** screen-to-screen wipes that feel like lights cutting between rooms; the Remix as a full-board moment (lights sweep, crowd reacts, the swap lands on the phrase boundary — the audio engine already defines that 1-bar transition).
- Every screen re-checked at 360×640 portrait, phone landscape and desktop; contrast checked; reduced-motion variant; screenshots in the playtest doc.

Write the DS-1 and DS-2 subagent prompts yourself with the §13.3 template; give each a disjoint file list.

## 6. Things only the user can do

Tell them once, clearly, and keep working:

- Approve the `sudo` steps and the ~10 GB of downloads in `tools/forge/scripts/setup-wsl.sh`.
- Point you at their music folder (or drop files into `library/inbox/`).
- Listen: stretcher quality and tuning, separator A vs B, and later the mixes themselves.
- Use their phones: open the tunnel URL, tap "Run benchmark" on `/lab`, scan the room QR code. You can start the dev server, the room server and `cloudflared` (installing `cloudflared` is a system-level install: ask first).
- Rename the hosted repository; create accounts (Cloudflare at Phase 3); anything that costs money.

## 7. Rules that tripped people up

- The original game's name must never be written — not in files, identifiers, commit messages or subagent prompts. The checkout directory and the hosted repository carry it; use relative paths.
- Never commit audio, `.stemdeck` files or anything under `library/`. The demo crate is generated locally, not committed.
- Never mark a task done with failing, skipped or deleted tests; never weaken a test to make it pass.
- Run Turborepo through the root pnpm scripts (telemetry is disabled there).
- Record every non-obvious choice as an ADR; keep `docs/PHASES.md`, `docs/ARCHITECTURE.md` (tunables) and `docs/LICENSES.md` true after every integration.
- At the end of every phase, a fresh verifier subagent that did not write the code checks it and tries to break it.
