# ADR 0001 — Building in a cloud session instead of WSL2

Status: accepted (2026-11-11)

## Context

`docs/BUILD_PROMPT.md` §4.1 assumes the orchestrator runs inside WSL2 on the user's Windows laptop, with an NVIDIA GPU, the user's music folder and the user's phones on the same network. The first build session instead runs in an ephemeral cloud container:

- Linux x86_64, 4 cores, 15 GB RAM, about 30 GB free disk, no GPU.
- Node 22, pnpm 10, uv, ffmpeg 6.1 and headless Chromium are present.
- The npm registry and PyPI are reachable. Model-weight hosts (Hugging Face, GitHub release assets, Meta's CDN) and Cloudflare's API and tunnel endpoints are not.
- The user's songs and phones are not reachable.
- The session may push only to its designated branch.

## Options

1. Stop and ask the user to rerun the prompt on the laptop.
2. Build everything that does not need the laptop here, and move the laptop-only steps to the checkpoints.

## Decision

Option 2.

- The TypeScript game (harmony, engine, audio, pack, protocol, UI, rooms via local `wrangler dev`) is built and tested here in full. Browser audio tests and e2e run in headless Chromium.
- Forge code is written and tested here against synthetic fixtures on CPU. Anything that needs model weights or real songs (separation quality, GPU timings, the by-ear separator choice) is scripted and documented here, then run by the user at the checkpoint. `tools/forge/scripts/setup-wsl.sh` and `forge doctor` are the entry points on the laptop.
- Phone measurements (render time, FLAC decode on iOS Safari and Android Chrome, dropout tests) are taken by the user from `/lab` at the checkpoint; `/lab` shows the numbers on screen so they can be copied into the playtest doc.
- Git: every commit goes to the session's designated branch. The `phase-N` branch-per-phase flow, merges to `main` and `phase-N` tags from §13.6 are left to the user (or to a later session that is allowed to push them). Phase boundaries are marked by a `chore(phase-N): checkpoint` commit.
- The WSL2 confirmation ADR that §4.1 asks for is written after `forge doctor` passes on the laptop.

## Consequences

- Phase 0 acceptance ("a separator chosen via ADR") can only be met provisionally here: ADR 0005 records the default from the spec and the benchmark the user runs to confirm or change it.
- Numbers in the spike reports are labelled with the machine they were measured on. Cloud-container numbers are not laptop numbers.
- The hosted repository's name is the user's to change. The project's own files never contain the original game's name (see the constraints in `CLAUDE.md`).
