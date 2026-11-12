# ADR 0006 — Stretcher and render strategy

Status: accepted, provisional pending laptop and phone measurements from `/lab` (2026-11-12). From spike 0B. Report: `docs/spikes/audio.md`.

## Context

Every stem dropped on the board must be time-stretched to the master tempo (r in 0.8–1.25,
hard cap 0.66–1.5) and, except drums, pitch-shifted by t in −6…+5 semitones, with formant
preservation for leads. Loops must be sample-exact (bars × 4 × 60/M × sr), phase-locked to the
bar grid within ±2 ms, seamless, and the shipped web bundle must stay permissive-licensed.
Five stems play at once on a phone. Spike 0B (`docs/spikes/audio.md`) compared Signalsmith
Stretch (MIT), SoundTouch (LGPL-2.1) and Rubber Band R3 (GPL-2.0-or-later), each run offline in a
Web Worker, and a realtime AudioWorklet path, in headless Chromium on a 4-vCPU cloud container.

## Options

1. Realtime stretching on the audio thread (Signalsmith's AudioWorklet node per stem).
2. Render-on-drop in a worker pool with Signalsmith Stretch (MIT).
3. Render-on-drop with SoundTouch (LGPL; fastest, no formants, WSOLA timing jitter).
4. Render-on-drop with Rubber Band R3 (GPL; best pitch, 5–8× slower than Signalsmith).
5. Forge-side pre-rendering (pitch ladders), runtime time-stretch only.

## Decision

- **Option 2.** `Stretcher` default = `SignalsmithStretcher` (`signalsmith-stretch` 1.3.2,
  pinned), run in a pool of `min(3, cores − 1)` render workers via `createStretchClient`;
  results play as plain looping `AudioBufferSourceNode`s built with `buildSeamlessLoop` (10 ms
  handle crossfade). Alignment is done inside the backend (pre-roll seek), so output frame j
  corresponds to input frame j · inputFrames/outputFrames.
- SoundTouch and Rubber Band remain available only behind
  `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1` (dynamic import, absent from the default `dist/`),
  for personal A/B listening. They are not fallbacks for the shipped app.
- No realtime DSP on the audio thread (option 1 rejected: 16 % of a cloud core for 5 voices,
  more on phones, glitch risk).
- Pack audio stays FLAC 44.1 kHz with 1-bar handles (Chromium decode is length-exact and
  bit-exact).

Provisional parts (confirm at Checkpoint 0 from `/lab` on the user's laptop and phones):
the render-time budgets (cloud: 326–581 ms per 8-bar loop; laptop budget 400 ms, phone 1200 ms),
whether option 5 or the `cheaper` preset is needed on phones, FLAC decoding on iOS Safari, and
whether Signalsmith's few-cent pitch error is audible on real stems (if yes: resampler-based
transposition for bass/loop roles).

## Consequences

- Phase 1 (1C) builds the render pool, LRU cache and reconciler on `createStretchClient` +
  `SignalsmithStretcher` + `buildSeamlessLoop`; the entry boundary uses the measured render time
  as `renderETA`.
- 1C should crop the handle audio to a short context before rendering (≈ 15–18 % less work) and
  keep one decoded copy per stem (requests transfer their input).
- The worker shim depends on `signalsmith-stretch` internals; version bumps must re-run the
  backend tests. A first-party WASM build of the MIT library with an offline API is the clean
  long-term option.
- `docs/LICENSES.md` lists the three packages; flagged builds are personal-use only and are never
  deployed.
- `/lab` stays as the measurement tool for every checkpoint.

## Contract follow-ups

- Applied now: the alignment rule and the ratio/frame-count agreement are documented on `Stretcher` in `packages/audio/src/contracts.ts`.
- Deferred to task 1C, after the phone numbers are in: an optional `StretchRequest.quality` preset, a `wasmHeapBytes()` hook for cache budgeting, and a render range so only the loop body plus a short context is rendered.
