# ADR 0008 — Overnight autonomy, test songs, drop-in importer and the design brief

Status: accepted (2026-11-12). Source: the user's messages after Checkpoint 0. Details and task breakdown: `docs/HANDOFF.md`.

## Context

At Checkpoint 0 the user did not run the playtest. Instead they asked for the build to continue hands-off, on their own laptop, and added requirements that the build prompt does not contain.

## Decisions

1. **No checkpoint stops until about 6am the user's time.** Playtest docs are still written at each phase boundary; the stops in build prompt §13.7 for money, accounts, public deploys and unapproved system-level installs still apply. Phase 6 stays a hard stop.
2. **Work moves to the user's laptop.** The cloud session stops after Phase 0 plus the Phase 1 task briefs (`docs/prompts/phase-1/`). A local session continues from `docs/HANDOFF.md`.
3. **Test songs.** The user asked for the "top 50 songs from online". Commercial music is not downloaded: there is no licensed source. Instead: (a) `forge demo-pack` generates 50 original procedural songs with ground-truth stems, so the game is playable with no real music; (b) the user's own DRM-free files are ingested locally. Forge never fetches music from the internet.
4. **Drop-in importer.** Forge gets an inbox folder (`library/inbox/`) with a one-command and a watch mode, accepting audio and video containers including `.mp4`. Studio (Phase 2) adds drag-and-drop.
5. **Design brief.** Black and neon, underground-club atmosphere with a crowd, place effects, original procedural sound effects, menu transitions, layouts unlike other games, custom backgrounds and logo, a lesser-known signature typeface. Three.js and similar effects are welcome. The design-system groundwork runs in parallel with Phase 1; the full visual pass follows once the functionality is in (the user's stated order), ahead of the rest of Phase 5.

## Consequences

- Phase 0's deferred measurements (laptop render times, GPU separation, phones, listening) are done by the local session where it can, and left to the user where it cannot. The provisional parts of ADR 0005 and ADR 0006 stay provisional until then.
- UI sound effects need a small `UiSfx` contract in `packages/audio`, because UI code must not touch Web Audio nodes.
- The 3D scene is lazy-loaded on the host/solo board only, with a 2D fallback, and never loads on the phone controller route (300 KB gzipped budget).
- The demo crate is original audio, so it is not covered by the "copyrighted audio" constraint; it is still generated locally rather than committed, because the repository guard blocks all audio.
