# Spike 0C: Forge (analysis accuracy, dependency installs, separator benchmark)

Status: done in the cloud container; the separator choice is **provisional** until the user runs
the GPU benchmark and listens (see "What could not be measured here").

Question: can we analyze songs accurately, and which dependencies install cleanly?

Short answer:

- **Analysis: yes, on synthetic fixtures.** With the best backends that run here (madmom from
  git for beats/downbeats, Essentia for key) and with the pure librosa fallback, every 4/4
  fixture has BPM within ±0.10 of the truth (±0.16 on the ±1% drift fixture; spec: ±0.5),
  downbeat F-measure 0.985 (madmom) / 1.000 (librosa) (spec: ≥0.9), the correct key PCS on all
  12 fixtures (spec: all), per-bar chroma that matches the chord on every active bar, and the
  3/4 fixture is rejected with a reason. beat_this, the preferred beat backend, could not be
  measured: it installs, but its checkpoint host is blocked here.
- **Installs:** the core (librosa, soundfile, typer, fastapi, mutagen, pyloudnorm,
  pyrubberband) and Essentia install cleanly from wheels in seconds. madmom's PyPI release is
  dead on Python 3.11; its git `main` builds and works. torch is the CUDA 13 build on PyPI (about
  3 GB of wheels) and the CPU index is unreachable here. audio-separator and beat_this install
  cleanly on top of torch. **allin1 does not work** with any natten that builds for current
  torch, so there is no `sections` extra; sections will use a librosa fallback.
- **Separator:** provisional decision = the spec default (config A: RoFormer vocals, then
  `htdemucs_ft` on the instrumental), pending the user's by-ear benchmark on 3 real songs. Both
  configs ran end to end here on CPU on one fixture: drums and bass separate well (SDR 12–18 dB),
  but neither separator recognises the math-only formant "vocal" (vocals SDR ≈ 0 dB, it lands
  in `other`), so fixture SDR cannot rank A vs B on vocals: that needs ears and real songs.

## Environment measured on

| | |
|---|---|
| Machine | cloud container (not the user's laptop; ADR 0001), Linux x86_64, Intel Xeon @ 2.10 GHz, 4 cores, 15 GB RAM, no GPU |
| Python | 3.11.18 (`/usr/bin/python3.11`), uv 0.11.32, ffmpeg 6.1.1 |
| Network | PyPI and git over the proxy: reachable. GitHub release assets: reachable (so audio-separator weights downloaded). Hugging Face, `download.pytorch.org`, `dl.fbaipublicfiles.com`, `cloud.cp.jku.at`: blocked (proxy 403) |
| Not available | GPU, `rubberband` CLI, real songs |
| Date | 2026-11-11/12 |

All numbers below are from this machine unless labelled otherwise. Cloud-container numbers are
not laptop numbers.

## Dependency install report

Each package was installed into a fresh throwaway venv (Python 3.11, `uv pip install`, empty
uv cache unless noted) and import-checked; the heavy ones were then exercised at runtime.
Times are wall time including download.

| Package | Version | Installs cleanly on 3.11 / Linux x86_64 with uv? | Install time | Pin / workaround | License | Model weights | Extra |
|---|---|---|---|---|---|---|---|
| librosa | 0.11.0 | yes (wheels; pulls numba 0.68.1, llvmlite 0.50, scipy 1.17.1, scikit-learn 1.9.1) | 6.8 s | none | ISC | none | core |
| soundfile | 0.14.0 | yes (bundles libsndfile 1.2.2) | 0.1 s | none | BSD-3-Clause (libsndfile LGPL-2.1) | none | core |
| typer | 0.29.1 | yes (with rich 15.0) | 0.9 s | none | MIT | none | core |
| fastapi | 0.162.5 | yes (starlette 1.10, pydantic 2.14) | 0.2 s | none | MIT | none | core |
| mutagen | 1.48.1 | yes (pure Python) | 1.1 s | none | **GPL-2.0-or-later** | none | core |
| pyloudnorm | 0.2.0 | yes | 0.3 s | none | MIT | none | core |
| pyrubberband | 0.4.0 | yes; needs the `rubberband` CLI at runtime (not on this machine; `rubberband-cli` apt package on the laptop) | 0.3 s | none | ISC (rubberband CLI: GPL-2.0-or-later) | none | core |
| essentia | 2.1b6.dev1389 | yes (13.1 MB manylinux wheel); `KeyExtractor` works | 1.2 s | none | **AGPL-3.0-only** | none for KeyExtractor | `analysis` |
| madmom | PyPI 0.16.1: **no**. git `main` 0.17.dev0: yes | PyPI: build fails (`ModuleNotFoundError: No module named 'Cython'`, undeclared build dep); with Cython and no build isolation it builds but `import madmom` fails (`ImportError: cannot import name 'MutableSequence' from 'collections'`; with numpy 2 / setuptools ≥81 also `No module named 'pkg_resources'`). git `main` builds and `RNNDownBeatProcessor()` loads | git build 34 s | `madmom @ git+https://github.com/CPJKU/madmom@27f032e8947204902c675e5e341a3faf5dc86dae` via `[tool.uv.sources]`; needs a C compiler and git | code BSD-3-Clause; **bundled models CC BY-NC-SA 4.0 (non-commercial)** | 29 MB of RNN models inside the package | `analysis` |
| torch | 2.15.0+cu132 | yes, but the PyPI wheel is the CUDA 13.2 build: 539 MB torch + ~2.4 GB of `nvidia-*` / `cuda-*` / triton wheels. Without them `import torch` fails (`OSError: libcudart.so.13: cannot open shared object file` → `ValueError: libcublasLt.so.*[0-9] not found in the system path`). The CPU-only index `download.pytorch.org/whl/cpu` is unreachable from here. With the full CUDA set it imports and runs on CPU (`cuda.is_available() == False`) | torch alone 13.7 s; the CUDA wheels came from a warm cache | laptop: needs an NVIDIA Windows driver new enough for CUDA 13 (R580+); a CPU-only machine should use the CPU index | BSD-3-Clause-style (multi-license); NVIDIA runtime wheels: NVIDIA proprietary (redistributable) | none | `separation` |
| audio-separator | 0.48.0 (`[cpu]` extra) | yes on top of torch (onnxruntime 1.31.1, onnx-weekly, onnx2torch, diffq 0.2.4 built from sdist) | 10.9 s | use `[cpu]`: it only selects onnxruntime (used by MDX-Net models). The RoFormer and Demucs models run on torch and still use CUDA. `[gpu]` would add onnxruntime-gpu (CUDA 12) beside torch's CUDA 13 | MIT; dependency **diffq is CC BY-NC 4.0** | RoFormer `model_bs_roformer_ep_317_sdr_12.9755.ckpt` 639.3 MB (+yaml) and `htdemucs_ft` 4 × 84.1 MB = 336.6 MB (+yaml), fetched by audio-separator from GitHub releases: **downloaded fine here** (28 s and 14 s) | `separation` |
| beat_this | 1.1.0 (`beat-this` on PyPI) | yes (torchaudio 2.11.1, einops, rotary-embedding-torch, soxr) | 0.5 s on top of torch | none; note audio-separator pins rotary-embedding-torch <0.7, so 0.6.5 is resolved (untested with beat_this, no weights) | MIT | checkpoint `final0` from `cloud.cp.jku.at` into `TORCH_HOME`: **blocked here**: `urllib.error.URLError: <urlopen error Tunnel connection failed: 403 Forbidden>` → `ValueError: ('Could not load the checkpoint given the provided name', 'final0')`. Size not measured | `separation` |
| allin1 | 1.1.0 | installs (199 s cold: demucs 4.1, hydra, matplotlib, huggingface-hub …) but **does not import**: `ModuleNotFoundError: No module named 'madmom'` (undeclared on Linux); with madmom from git: `ImportError: cannot import name 'natten1dav' from 'natten.functional'` | 199 s | none found: allin1 needs natten's pre-0.18 API, and `natten<0.18` fails to build against torch 2.15 (`cmake --build … returned non-zero exit status 2`, 20 s). Prebuilt old natten wheels exist only off-PyPI for old torch/CUDA pairs | MIT | Hugging Face `taejunkim/allinone` (blocked here; not measured) | **not offered** |
| natten | 0.21.7 | sdist only; builds in 39.5 s, but without its compiled kernels (`HAS_LIBNATTEN False`), and its API no longer has what allin1 imports | 39.5 s | — | MIT | none | **not offered** |

Disk: the core + analysis + dev environment (`tools/forge/.venv`) is 567 MB. The full
separation stack (torch CUDA + audio-separator + beat_this + allin1 attempt) was a 6.05 GB venv.

Packaging decisions in `tools/forge/pyproject.toml`:

- **core**: typer, rich, numpy, scipy, soundfile, librosa, mutagen, pyloudnorm, pyrubberband,
  fastapi. No torch, no weights.
- **`analysis`**: essentia, madmom (git pin). The dev group includes this extra so the tests
  always exercise the best non-torch backends.
- **`separation`**: torch, audio-separator[cpu], beat-this.
- No `sections` extra (allin1 broken). `forge doctor` still reports allin1/natten as "not installed".
- `[tool.uv] environments` limits the lock to Linux x86_64; `python-downloads = "manual"`.

## Analysis accuracy on fixtures

`forge fixtures` writes 12 synthetic songs: 8 core 4/4 songs (92, 120, 128, 150 BPM × G major
I–V–vi–IV and E minor i–VI–III–VII), 2 transposed controls (Bb major, C# minor, so a detector
that always answers PCS 7 fails), a 4/4 song with a ±1% slow tempo wobble, and a 3/4 song.
32 bars each, 44.1 kHz stereo 16-bit, `mix.wav` is the exact sample sum of the four stems.

Pipeline (`forge/analysis.py`): beats/downbeats from the backend chain, then every beat is
snapped to the strongest onset within ±30 ms on a 64-sample grid (`refine_beats`; all backends
quantize beats to 5.8–20 ms frames, which alone would cost up to ~2 BPM at 150 BPM);
BPM = 60 / median IBI; 4/4 check; key on bass+other; per-bar chroma per harmonic stem.

**Best backends available here** (`forge analyze <fixtures>`: beat_this unavailable → madmom for beats/downbeats/meter, Essentia for key):

| Fixture | Truth | BPM | BPM err | Beat F | Downbeat F | Bars | 4/4 check | Key found (PCS) | PCS | Exact key | Chroma other triad | Chroma bass root | Drift % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| g-major-092 | 92 BPM, G major (PCS 7) | 92.012 | +0.012 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.06 |
| e-minor-092 | 92 BPM, E minor (PCS 7) | 92.004 | +0.004 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.05 |
| g-major-120 | 120 BPM, G major (PCS 7) | 119.988 | -0.012 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.10 |
| e-minor-120 | 120 BPM, E minor (PCS 7) | 119.991 | -0.009 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.09 |
| g-major-128 | 128 BPM, G major (PCS 7) | 127.991 | -0.009 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.11 |
| e-minor-128 | 128 BPM, E minor (PCS 7) | 127.975 | -0.025 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.11 |
| g-major-150 | 150 BPM, G major (PCS 7) | 149.945 | -0.055 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.12 |
| e-minor-150 | 150 BPM, E minor (PCS 7) | 149.982 | -0.018 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.12 |
| ctrl-bb-major-128 | 128 BPM, Bb major (PCS 10) | 127.980 | -0.020 | 0.996 | 0.985 | 33/32 | accepted | Bb major (10) | correct | yes | 1.00 | 1.00 | 0.14 |
| ctrl-cs-minor-092 | 92 BPM, C# minor (PCS 4) | 92.006 | +0.006 | 0.996 | 0.985 | 33/32 | accepted | E major (4) | correct | relative | 1.00 | 1.00 | 0.06 |
| drift-g-major-120 | 120 BPM, G major (PCS 7) | 119.873 | -0.127 | 0.996 | 0.985 | 33/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.93 |
| waltz-e-minor-120 | 120 BPM, E minor (PCS 7) | 120.041 | +0.041 | 0.995 | 0.985 | 33/32 | **rejected**: madmom found 3 beats per bar | G major (7) | correct | relative | 1.00 | 0.00 | 0.13 |

**Pure fallback** (`forge analyze <fixtures> --beats librosa --key librosa`):

| Fixture | Truth | BPM | BPM err | Beat F | Downbeat F | Bars | 4/4 check | Key found (PCS) | PCS | Exact key | Chroma other triad | Chroma bass root | Drift % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| g-major-092 | 92 BPM, G major (PCS 7) | 92.007 | +0.007 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.08 |
| e-minor-092 | 92 BPM, E minor (PCS 7) | 92.000 | +0.000 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.07 |
| g-major-120 | 120 BPM, G major (PCS 7) | 119.996 | -0.004 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.12 |
| e-minor-120 | 120 BPM, E minor (PCS 7) | 119.986 | -0.014 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.09 |
| g-major-128 | 128 BPM, G major (PCS 7) | 127.966 | -0.034 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.15 |
| e-minor-128 | 128 BPM, E minor (PCS 7) | 127.963 | -0.037 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.14 |
| g-major-150 | 150 BPM, G major (PCS 7) | 149.903 | -0.097 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.12 |
| e-minor-150 | 150 BPM, E minor (PCS 7) | 149.982 | -0.018 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | relative | 1.00 | 1.00 | 0.15 |
| ctrl-bb-major-128 | 128 BPM, Bb major (PCS 10) | 127.933 | -0.067 | 1.000 | 1.000 | 32/32 | accepted | Bb major (10) | correct | yes | 1.00 | 1.00 | 0.12 |
| ctrl-cs-minor-092 | 92 BPM, C# minor (PCS 4) | 91.996 | -0.004 | 1.000 | 1.000 | 32/32 | accepted | E major (4) | correct | relative | 1.00 | 1.00 | 0.08 |
| drift-g-major-120 | 120 BPM, G major (PCS 7) | 119.847 | -0.153 | 1.000 | 1.000 | 32/32 | accepted | G major (7) | correct | yes | 1.00 | 1.00 | 0.93 |
| waltz-e-minor-120 | 120 BPM, E minor (PCS 7) | 120.035 | +0.035 | 0.979 | 0.984 | 31/32 | **rejected**: librosa found 3 beats per bar | G major (7) | correct | relative | 0.97 | 0.04 | 0.09 |

Columns: BPM error vs truth; beat and downbeat F-measure at ±70 ms; bars found / true bars; key
found and its PCS; "Exact key" is tonic+mode (informational: G major and E minor share PCS 7 and
the fixtures' chord sets are identical, so tonic/mode is ambiguous by design); "Chroma other
triad" = share of active bars whose 3 strongest pitch classes in the `other` stem are exactly
the bar's triad; "Chroma bass root" = share of active bars whose strongest pitch class in the
`bass` stem is the chord root; "Drift %" = half the 5–95 percentile spread of the local
(8-beat) tempo.

Notes:

- madmom's DBN adds one beat (and one downbeat) in the 1 s tail after the last bar on every
  fixture (33/32 bars), which is why its F-measures are 0.996/0.985 rather than 1.0. Phase 1
  should drop beats after the last onset.
- The librosa fallback's meter/downbeat step folds a per-beat accent (low-band onset + chroma
  change across the beat) by 3 and 4 and picks the stronger contrast. It is a heuristic; it is
  exact on these fixtures and untested on real music.
- The waltz's "bass root" score is low by construction (its bass plays the root once and the
  fifth twice per bar); it is a negative fixture and only its rejection is tested.
- The same thresholds are asserted in `tools/forge/tests/test_analysis.py` for both backend
  configurations, per fixture. `uv run --project tools/forge pytest`: **153 passed, 0 skipped,
  0 failed** (3 min 22 s on this machine).
- E minor fixtures come out as "G major" and C# minor as "E major": relative-key answers with
  the right PCS, which is all the game uses (§7.1).

### Analysis time per song on this CPU

Wall time per song, cloud CPU (4 cores), single process. The first song includes warm-up (numba JIT, model load). Whole set: 13.2 min of audio analyzed in 100 s with madmom + Essentia and 32 s with the librosa fallback.

madmom + Essentia:

| Fixture | Audio (s) | Load | Beats + downbeats | Key | Chroma | Total (s) |
|---|---|---|---|---|---|---|
| g-major-092 | 85.0 | 0.3 | 10.9 | 0.8 | 1.0 | 13.0 |
| e-minor-092 | 85.0 | 0.3 | 8.7 | 0.1 | 1.0 | 10.1 |
| g-major-120 | 65.5 | 0.2 | 6.9 | 0.1 | 0.8 | 8.0 |
| e-minor-120 | 65.5 | 0.2 | 7.4 | 0.1 | 0.8 | 8.5 |
| g-major-128 | 61.5 | 0.2 | 6.7 | 0.1 | 0.7 | 7.7 |
| e-minor-128 | 61.5 | 0.2 | 6.6 | 0.1 | 0.7 | 7.6 |
| g-major-150 | 52.7 | 0.2 | 5.7 | 0.1 | 0.6 | 6.5 |
| e-minor-150 | 52.7 | 0.2 | 5.6 | 0.1 | 0.6 | 6.4 |
| ctrl-bb-major-128 | 61.5 | 0.2 | 6.6 | 0.1 | 0.7 | 7.5 |
| ctrl-cs-minor-092 | 85.0 | 0.3 | 9.2 | 0.1 | 1.0 | 10.5 |
| drift-g-major-120 | 65.5 | 0.2 | 6.9 | 0.1 | 0.7 | 7.9 |
| waltz-e-minor-120 | 49.5 | 0.2 | 5.4 | 0.1 | 0.6 | 6.2 |

librosa fallback:

| Fixture | Audio (s) | Load | Beats + downbeats | Key | Chroma | Total (s) |
|---|---|---|---|---|---|---|
| g-major-092 | 85.0 | 0.3 | 4.4 | 0.3 | 1.1 | 6.0 |
| e-minor-092 | 85.0 | 0.3 | 1.5 | 0.3 | 1.0 | 3.1 |
| g-major-120 | 65.5 | 0.2 | 1.1 | 0.2 | 0.7 | 2.3 |
| e-minor-120 | 65.5 | 0.2 | 1.1 | 0.2 | 0.7 | 2.3 |
| g-major-128 | 61.5 | 0.2 | 1.1 | 0.2 | 0.7 | 2.1 |
| e-minor-128 | 61.5 | 0.2 | 1.2 | 0.2 | 0.7 | 2.2 |
| g-major-150 | 52.7 | 0.2 | 0.9 | 0.2 | 0.6 | 1.9 |
| e-minor-150 | 52.7 | 0.2 | 1.0 | 0.2 | 0.7 | 2.0 |
| ctrl-bb-major-128 | 61.5 | 0.2 | 1.2 | 0.2 | 0.8 | 2.3 |
| ctrl-cs-minor-092 | 85.0 | 0.3 | 1.4 | 0.3 | 1.0 | 3.0 |
| drift-g-major-120 | 65.5 | 0.2 | 1.2 | 0.2 | 0.8 | 2.4 |
| waltz-e-minor-120 | 49.5 | 0.2 | 0.9 | 0.2 | 0.6 | 1.8 |

## Separation on this CPU (fixtures, SDR)

The audio-separator weights did download here, so both configs were run end to end on CPU on
one fixture (`g-major-150`, 52.7 s) with `forge bench-separation --fixtures <dir> --song
g-major-150`. This verifies the benchmark code path end to end; the times are CPU times and
say nothing about the laptop GPU. Final fixtures (the version committed):

| Config | Stage | Model | Wall time (s) | s per minute of audio |
|---|---|---|---|---|
| A | vocals | BS-RoFormer ep_317 on the mix | 859.0 | 978 |
| A | drums/bass/other | htdemucs_ft on the instrumental | 150.0 | 171 |
| A | total | | 1009.0 | 1149 |
| B | 4-stem | htdemucs_ft on the mix | 149.1 | 170 |

Model load: 2.0 s (RoFormer), 0.3 s (htdemucs_ft). Process peak RSS 2.7 GB. Peak GPU memory:
n/a on CPU (the code path that reads it is untested).

SDR (dB) against the fixture's true stems:

| Config | vocals | drums | bass | other |
|---|---|---|---|---|
| A | 0.04 | 14.43 | 11.81 | −1.16 |
| B | 0.12 | 14.42 | 11.80 | −0.73 |

(An earlier run on the first version of the vocal synth gave A 0.01 / 18.12 / 12.16 / −0.64 and
B 0.01 / 18.08 / 12.22 / −0.66, with config A's RoFormer stage at 1421 s while the CPU was shared
with another agent's browser tests.)

**Finding: the synthetic "vocals" are not heard as vocals.** Both separators put the
formant-synth voice into `other` (the estimated vocal stem sits at −58 to −67 dBFS, near
silence; the `other` estimate correlates 0.68 with the true vocal). Drums and bass separate well
(SDR 12–18 dB). I tried making the voice more voice-like, testing each variant with
htdemucs_ft on a 16-bar excerpt: legato phrases with portamento, delayed vibrato, jitter,
shimmer and breath noise; formants that glide between vowels; two syllables per beat; "s"/"t"
consonant onsets; Klatt-style cascade instead of parallel formants; a lower register; faster
jitter. None moved the vocal SDR off 0 dB, and BS-RoFormer returned exact silence for the
improved voice too. The fixtures keep the improved (phrase-level) voice because it is closer to
singing, but **fixture SDR is meaningful for drums and bass only**; vocals vs other must be
judged by ear on real songs. This is a limit of a math-only vocal, which the constraints
require (no recorded or downloaded audio in fixtures).

## What could not be measured here, and how the user measures it

All commands run from the repo root on the laptop, after `bash tools/forge/scripts/setup-wsl.sh`.

| What | Why not here | Command on the laptop |
|---|---|---|
| beat_this accuracy (the preferred beat backend) | checkpoint host `cloud.cp.jku.at` blocked | `uv run --project tools/forge forge models download beat_this-final0` then `uv run --project tools/forge forge fixtures --out .fixtures && uv run --project tools/forge forge analyze .fixtures --beats beat_this`. The pytest suite also picks beat_this automatically once it loads: `uv run --project tools/forge pytest` |
| GPU separation time per song and per stage, peak GPU memory | no GPU | `uv run --project tools/forge python tools/forge/scripts/bench_separation.py ~/bench-songs --dry-run` (check the plan), then without `--dry-run`. Put 3 of your own songs in `~/bench-songs`. Paste the printed tables into `docs/playtests/phase-0.md` |
| By-ear separator choice (A vs B) | no real songs, no ears | listen to `library/bench/A/<song>/` vs `library/bench/B/<song>/` (vocals, drums, bass, other). Listen for: vocal bleed in `other`, hi-hat smearing in `drums`, bass leaking into `other`, artifacts in vocal tails |
| SDR per stem on all fixtures with the GPU | CPU too slow for the full set (about 17 min per 52 s fixture for config A here) | `uv run --project tools/forge forge fixtures --out .fixtures && uv run --project tools/forge python tools/forge/scripts/bench_separation.py --fixtures .fixtures` |
| Forge per-song budget (≤90 s on GPU, §16.2) | no GPU | the benchmark's "Total wall time" plus `forge analyze` time per song |
| Analysis on real songs | no real songs | `uv run --project tools/forge forge analyze ~/bench-songs` and compare BPM/key with what you know of the songs |
| `setup-wsl.sh` end to end | must not install system packages here | `bash tools/forge/scripts/setup-wsl.sh`; it asks before `sudo`, and ends with `forge doctor` |
| torch CUDA on the user's driver | no GPU | `forge doctor` row "torch CUDA" |
| `rubberband` CLI (Phase 2 grid-warp) | not installed here | `forge doctor` row "rubberband CLI" |

Only `--dry-run`, argument parsing, discovery, the markdown report, the SDR function, and (on
CPU, one fixture) the full run were verified here. GPU memory reporting
(`torch.cuda.max_memory_allocated`) is **untested**.

## Risks

1. **Synthetic fixtures are easy.** Clean onsets, one chord per bar, no swing, no tempo
   changes beyond the drift fixture. Real songs will show half/double tempo and fifth-related key
   errors; PCS hides relative-key confusion but not those. Studio overrides (Phase 2) and
   `overrides.yaml` (Phase 1) are the safety net; the user's real-song check above is the first
   evidence.
2. **BPM precision depends on `refine_beats`.** On soft-onset material the snap may not fire,
   leaving frame-quantized beats (beat_this: 20 ms frames → up to ~2 BPM error at 150 BPM via the
   median IBI). Phase 1 should also fit a straight line through the beat grid and flag songs where
   the two disagree.
3. **torch on PyPI is the CUDA 13 build.** It needs a recent Windows driver on the laptop; an old
   driver means CPU-only separation. `forge doctor` and `setup-wsl.sh` say so.
4. **Licenses (fine for a personal local tool, blockers for a product):** Essentia AGPL-3.0,
   madmom models CC BY-NC-SA 4.0, diffq CC BY-NC 4.0 (audio-separator dependency), mutagen GPL-2.0+,
   rubberband GPL-2.0+, and the RoFormer weights have no stated license. All stay in
   `tools/forge`; none reach the web bundle. Phase 6 must replace them for any public path.
5. **Weight hosting.** beat_this weights live on a university Nextcloud and allin1 on Hugging
   Face; audio-separator models on GitHub releases. Forge caches everything under
   `~/.stemdeck/models` so one successful download is enough.
6. **madmom from git** makes `uv sync` need GitHub and a compiler. Pinned to a commit.
7. **allin1 is out.** Section/hook detection falls back to librosa recurrence/novelty
   (Phase 2), which is weaker.
8. **Fixture SDR cannot judge vocals.** The math-only vocal is routed to `other` by both
   separators, so A vs B on fixtures differs only in noise (drums/bass SDR are equal within
   0.05 dB). The decision rests on listening to real songs.
9. **Config A is about 7× slower than B on CPU** (RoFormer dominates: 859 s vs 149 s for 52.7 s
   of audio). On the GPU the ratio decides whether A fits the ≤90 s per-song budget (§16.2).

## Recommendation

- Keep the analysis module as is for Phase 1 (1E): beat_this → madmom → librosa for beats and
  downbeats (with `refine_beats` always on), Essentia edma/bgate vote → librosa
  Krumhansl–Kessler for key on bass+other, librosa `chroma_cqt` per harmonic stem per bar.
- Drop allin1 from the plan; write the librosa section fallback in Phase 2.
- Ship the `analysis` extra by default in `setup-wsl.sh` (it is what the tests run against).
- Separator: use config A (spec default) provisionally; the user confirms or switches to B
  after listening at Checkpoint 0, and checks A's GPU time per song against the 90 s budget.
- Use fixture SDR only as a drums/bass regression check, not to choose a separator.

## Draft ADR: separator and analysis stack

Status: proposed (provisional for the separator until the user's by-ear benchmark).

### Context

Forge must split the user's songs into vocals/drums/bass/other and analyze tempo, downbeats,
meter, key and per-bar chroma (docs/BUILD_PROMPT.md §12.2). The spec names audio-separator
(RoFormer + Demucs), beat_this (madmom fallback), Essentia and librosa, and allin1 if it
installs. Phase 0 had to establish what installs on Python 3.11 / Linux and how accurate the
analysis is. This spike ran in a cloud container without a GPU or real songs (ADR 0001), so
separation quality and GPU timings could not be judged here.

### Options

Separation:
- A. RoFormer vocal model (`model_bs_roformer_ep_317_sdr_12.9755`) on the mix, then `htdemucs_ft`
  on the instrumental for drums/bass/other (spec default; two passes).
- B. `htdemucs_ft` 4-stem on the mix (one pass, smaller download).

Beats/downbeats: beat_this; madmom (git); librosa beat tracker + accent folding.
Key: Essentia KeyExtractor (edma vs bgate); librosa chroma + Krumhansl–Kessler.
Sections: allin1; librosa recurrence/novelty.

### Decision

- Separation: **config A, provisionally**, run through audio-separator 0.48 on torch. Confirm or
  change after the user runs `bench_separation.py` on 3 real songs at Checkpoint 0 and listens;
  record the result in this ADR.
- Beats/downbeats: beat_this → madmom (git pin) → librosa, each behind one function, all followed
  by onset refinement; BPM = 60 / median IBI; reject non-4/4 with a reason.
- Key: Essentia (edma/bgate vote) → librosa fallback, on bass+other stems.
- Chroma: librosa `chroma_cqt`, beat-synchronous, averaged per bar, per harmonic stem.
- Sections: no allin1; librosa fallback in Phase 2.
- Packaging: core / `analysis` / `separation` extras as above; no `sections` extra.

### Consequences

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
