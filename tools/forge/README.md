# Forge

Forge turns your own DRM-free songs into STEMDECK card packs (`*.stemdeck`). It runs only on
your machine: songs, stems and renders never leave it.

Status: Phase 0 spike. `doctor`, `fixtures`, `analyze`, `models` and `bench-separation` work;
`ingest`, `export` and `studio` arrive in Phase 1/2. The spike report is
[`docs/spikes/forge.md`](../../docs/spikes/forge.md).

## Install

On the laptop (Ubuntu 24.04 under WSL2), from the repo root:

```bash
bash tools/forge/scripts/setup-wsl.sh        # asks before every sudo step; --yes to skip prompts
```

By hand, with `uv` and Python 3.11 available:

```bash
uv sync --project tools/forge                                        # core + dev tools
uv sync --project tools/forge --extra analysis                       # + essentia, madmom
uv sync --project tools/forge --extra analysis --extra separation    # + torch, audio-separator, beat_this
```

| Extra | Contents | Why optional |
|---|---|---|
| (core) | typer, numpy, scipy, soundfile, librosa, mutagen, pyloudnorm, pyrubberband, fastapi | light; permissive except mutagen (GPL-2.0-or-later) |
| `analysis` | essentia (AGPL-3.0), madmom from git (BSD code, CC BY-NC-SA models) | licenses; madmom builds C extensions |
| `separation` | torch (CUDA wheel, ~3 GB), audio-separator, beat_this | size; needs a GPU to be useful |

There is no `sections` extra: `allin1` does not import with any `natten` that builds for current
torch. Sections will use a librosa fallback.

## Commands

Run from the repo root.

```bash
uv run --project tools/forge forge doctor [--json]          # environment check; non-zero exit if a required check fails
uv run --project tools/forge forge fixtures --out .fixtures [--flac] [--only SONG_ID]
uv run --project tools/forge forge analyze .fixtures [--json]            # analyze + score against ground_truth.json
uv run --project tools/forge forge analyze path/to/song.flac [--json]
uv run --project tools/forge forge models list|download                  # separation model weights
uv run --project tools/forge forge bench-separation SONGS_DIR [--fixtures .fixtures] [--dry-run]
uv run --project tools/forge pytest tools/forge
uv run --project tools/forge ruff check tools/forge
```

## Where Forge writes

Only under `~/.stemdeck/` (model weights in `~/.stemdeck/models`; override the root with
`STEMDECK_HOME`), the repo's gitignored `library/`, and any `--out` you pass.

## Fixtures

`forge fixtures` synthesizes test songs from math (no samples, no downloads), byte-identical on
every run: 4/4 songs at 92/120/128/150 BPM in G major (I–V–vi–IV) and E minor (i–VI–III–VII),
two transposed key controls, one song with ±1% tempo drift and one 3/4 song. Each song has
`mix.wav` plus `drums.wav`, `bass.wav`, `other.wav`, `vocals.wav` (44.1 kHz stereo 16-bit;
`mix` is the exact sample sum of the stems), and `ground_truth.json` records beats, downbeats,
key, chords per bar, active bars per stem and sample counts.
