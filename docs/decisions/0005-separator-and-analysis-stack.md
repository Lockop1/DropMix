# ADR 0005 — Separator and analysis stack for Forge

Status: accepted for analysis; **separator provisional** until the user runs the by-ear benchmark on real songs at Checkpoint 0 (2026-11-12). From spike 0C. Report: `docs/spikes/forge.md`.

## Context

Forge must split the user's songs into vocals/drums/bass/other and analyze tempo, downbeats,
meter, key and per-bar chroma (docs/BUILD_PROMPT.md §12.2). The spec names audio-separator
(RoFormer + Demucs), beat_this (madmom fallback), Essentia and librosa, and allin1 if it
installs. Phase 0 had to establish what installs on Python 3.11 / Linux and how accurate the
analysis is. This spike ran in a cloud container without a GPU or real songs (ADR 0001), so
separation quality and GPU timings could not be judged here.

## Options

Separation:
- A. RoFormer vocal model (`model_bs_roformer_ep_317_sdr_12.9755`) on the mix, then `htdemucs_ft`
  on the instrumental for drums/bass/other (spec default; two passes).
- B. `htdemucs_ft` 4-stem on the mix (one pass, smaller download).

Beats/downbeats: beat_this; madmom (git); librosa beat tracker + accent folding.
Key: Essentia KeyExtractor (edma vs bgate); librosa chroma + Krumhansl–Kessler.
Sections: allin1; librosa recurrence/novelty.

## Decision

- Separation: **config A, provisionally**, run through audio-separator 0.48 on torch. Confirm or
  change after the user runs `bench_separation.py` on 3 real songs at Checkpoint 0 and listens;
  record the result in this ADR.
- Beats/downbeats: beat_this → madmom (git pin) → librosa, each behind one function, all followed
  by onset refinement; BPM = 60 / median IBI; reject non-4/4 with a reason.
- Key: Essentia (edma/bgate vote) → librosa fallback, on bass+other stems.
- Chroma: librosa `chroma_cqt`, beat-synchronous, averaged per bar, per harmonic stem.
- Sections: no allin1; librosa fallback in Phase 2.
- Packaging: core / `analysis` / `separation` extras as above; no `sections` extra.

## Consequences

- Every analysis result names its backend, and analysis keeps working without torch or weights.
- Forge carries non-commercial and copyleft pieces (madmom models, diffq, Essentia, mutagen,
  rubberband, unlicensed RoFormer weights). Acceptable for a personal local tool; listed in
  `docs/LICENSES.md`; must be replaced before any public product path (Phase 6).
- Config A runs two models and cost about 7× config B on CPU here (RoFormer dominates); if its
  GPU time per song exceeds the §16.2 budget or the user prefers B by ear, switch to B (one
  config flag in the pipeline).
- Fixture SDR checks drums/bass only; the synthetic vocal is not separated as vocals by either
  model, so the vocal decision is by ear.
- `uv sync` needs GitHub (madmom) and, with `separation`, about 6 GB of disk for torch.
