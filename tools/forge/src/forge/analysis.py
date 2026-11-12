"""Song analysis: beats, downbeats, BPM, the 4/4 check, key and per-bar chroma.

docs/BUILD_PROMPT.md §12.2 step 3. Each backend sits behind one small function and every
optional backend has a pure librosa/numpy fallback, so analysis still runs when a package is
missing or its model weights cannot be downloaded. Results record which backend produced them
and why the better ones were skipped.

Backends, in preference order:
  beats/downbeats  beat_this (torch, weights downloaded at first use) -> madmom -> librosa
  key              essentia KeyExtractor (edma vs bgate vote) -> librosa chroma + profiles
  chroma           librosa chroma_cqt, beat-synchronous, averaged per bar

Every beat backend's output goes through ``refine_beats`` (snap to the nearest onset peak on
a 1.45 ms grid) because all of them quantize beat times to frames (beat_this 20 ms, madmom
10 ms, librosa 5.8 ms), which alone would put BPM = 60 / median IBI off by up to ~2 BPM.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import traceback
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

SR = 44100  # analysis input rate (beat_this / madmom expect 44.1 kHz or resample themselves)
SR_LOW = 22050  # librosa feature rate
CHROMA_HOP = 512
AUDIO_EXTS = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aif", ".aiff", ".opus"}
STEM_NAMES = ("drums", "bass", "other", "vocals")
KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_NOTE_TO_PC = {
    "C": 0,
    "B#": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "Fb": 4,
    "E#": 5,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
    "Cb": 11,
}

BEAT_BACKENDS = ("beat_this", "madmom", "librosa")
KEY_BACKENDS = ("essentia", "librosa")


class BackendUnavailable(RuntimeError):
    """A backend could not run (not installed, weights missing, ...)."""


def pcs_index(tonic: int, mode: str) -> int:
    """PCS index = relative-major tonic (docs/BUILD_PROMPT.md §7.1)."""
    return tonic % 12 if mode == "major" else (tonic + 3) % 12


# --------------------------------------------------------------------------- data


@dataclass
class Attempt:
    backend: str
    ok: bool
    seconds: float
    error: str | None = None


@dataclass
class BeatTrack:
    beats: np.ndarray
    downbeats: np.ndarray
    backend: str
    beats_per_bar: int | None
    meter_scores: dict[str, float] = field(default_factory=dict)
    refined: bool = False
    attempts: list[Attempt] = field(default_factory=list)


@dataclass
class KeyEstimate:
    tonic: int
    mode: str
    confidence: float
    backend: str
    details: dict = field(default_factory=dict)
    attempts: list[Attempt] = field(default_factory=list)

    @property
    def pcs(self) -> int:
        return pcs_index(self.tonic, self.mode)

    @property
    def name(self) -> str:
        return f"{KEY_NAMES[self.tonic]} {self.mode}"


@dataclass
class SongAnalysis:
    song_id: str
    source: str
    duration_s: float
    bpm: float
    beats: list[float]
    downbeats: list[float]
    bar_count: int
    beats_per_bar: int | None
    four_four: bool
    rejection: str | None
    tempo_drift_pct: float
    key: dict
    key_source: str
    chroma: dict[str, list[list[float]]]
    backends: dict[str, str]
    attempts: dict[str, list[dict]]
    timings_s: dict[str, float]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SongInput:
    song_id: str
    mix: Path
    stems: dict[str, Path] = field(default_factory=dict)


# --------------------------------------------------------------------------- audio io


def load_audio(path: Path, sr: int = SR, mono: bool = True) -> np.ndarray:
    """Decode to float32 at ``sr``. WAV/FLAC/AIFF/OGG via soundfile, anything else via ffmpeg."""
    path = Path(path)
    try:
        import soundfile as sf

        data, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception:
        data, file_sr = _ffmpeg_decode(path), SR
    y = data.mean(axis=1) if mono else data.T
    if file_sr != sr:
        import librosa

        y = librosa.resample(y, orig_sr=file_sr, target_sr=sr, res_type="soxr_hq")
    return np.ascontiguousarray(y, dtype=np.float32)


def _ffmpeg_decode(path: Path) -> np.ndarray:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError(f"cannot decode {path.name}: soundfile failed and ffmpeg is not on PATH")
    out = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype="<f4").reshape(-1, 2)


def mix_stems(paths: Sequence[Path], sr: int) -> np.ndarray:
    ys = [load_audio(p, sr) for p in paths]
    n = min(len(y) for y in ys)
    return np.sum([y[:n] for y in ys], axis=0).astype(np.float32)


# --------------------------------------------------------------------------- inputs


def resolve_inputs(path: Path) -> tuple[list[SongInput], dict | None]:
    """Accepts an audio file, a song folder (mix.wav + stems), a fixtures root with
    ground_truth.json, or a folder of audio files."""
    path = Path(path)
    if path.is_file():
        return [SongInput(path.stem, path)], None
    if not path.is_dir():
        raise FileNotFoundError(path)
    gt_file = path / "ground_truth.json"
    if gt_file.exists():
        truth = json.loads(gt_file.read_text())
        songs = [_song_dir_input(path / s["songId"]) for s in truth["songs"]]
        return songs, truth
    if (path / "mix.wav").exists() or (path / "mix.flac").exists():
        parent_gt = path.parent / "ground_truth.json"
        truth = None
        if parent_gt.exists():
            full = json.loads(parent_gt.read_text())
            match = [s for s in full["songs"] if s["songId"] == path.name]
            truth = {**full, "songs": match} if match else None
        return [_song_dir_input(path)], truth
    files = sorted(p for p in path.iterdir() if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        raise FileNotFoundError(f"no audio files in {path}")
    return [SongInput(p.stem, p) for p in files], None


def _song_dir_input(d: Path) -> SongInput:
    mix = d / "mix.wav" if (d / "mix.wav").exists() else d / "mix.flac"
    stems = {}
    for s in STEM_NAMES:
        for ext in (".wav", ".flac"):
            if (d / f"{s}{ext}").exists():
                stems[s] = d / f"{s}{ext}"
                break
    return SongInput(d.name, mix, stems)


# --------------------------------------------------------------------------- backend runner


def _run_chain(chain: Sequence[tuple[str, Callable[[], object]]]) -> tuple[str, object, list[Attempt]]:
    attempts: list[Attempt] = []
    for name, fn in chain:
        t0 = time.perf_counter()
        try:
            result = fn()
        except Exception as exc:  # any backend failure falls through to the next one
            msg = f"{type(exc).__name__}: {exc}".strip()
            if not isinstance(exc, BackendUnavailable | ImportError | ModuleNotFoundError):
                msg += " | " + traceback.format_exc(limit=2).splitlines()[-1]
            attempts.append(Attempt(name, False, round(time.perf_counter() - t0, 3), msg[:600]))
            continue
        attempts.append(Attempt(name, True, round(time.perf_counter() - t0, 3)))
        return name, result, attempts
    raise RuntimeError("every backend failed: " + "; ".join(f"{a.backend}: {a.error}" for a in attempts))


def _order(prefer: str, names: Sequence[str]) -> list[str]:
    if prefer in ("auto", "", None):
        return list(names)
    if prefer not in names:
        raise ValueError(f"unknown backend {prefer!r}; choose from {', '.join(names)}")
    return [prefer]


# --------------------------------------------------------------------------- beats


def beats_beat_this(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """beat_this (CPJKU). Downloads checkpoint ``final0`` into TORCH_HOME on first use."""
    from .paths import apply_model_env

    apply_model_env()
    try:
        import torch
        from beat_this.inference import Audio2Beats
    except Exception as exc:
        raise BackendUnavailable(f"beat_this not importable ({type(exc).__name__}: {exc})") from exc
    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        model = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
    except Exception as exc:
        cause = exc.__cause__ or exc.__context__
        detail = f"{exc}" + (f" (cause: {type(cause).__name__}: {cause})" if cause else "")
        raise BackendUnavailable(f"beat_this checkpoint unavailable: {detail}") from exc
    beats, downbeats = model(y.astype(np.float32), sr)
    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)


def beats_madmom(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray, int]:
    """madmom RNN downbeat activations + DBN decoding over 3/4 and 4/4."""
    try:
        from madmom.audio.signal import Signal
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
    except Exception as exc:
        raise BackendUnavailable(f"madmom not importable ({type(exc).__name__}: {exc})") from exc
    if sr != 44100:
        raise ValueError("madmom backend expects 44.1 kHz input")
    act = RNNDownBeatProcessor()(Signal(y.astype(np.float32), sample_rate=sr, num_channels=1))
    res = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
    beats = res[:, 0].astype(float)
    pos = res[:, 1].astype(int)
    downbeats = beats[pos == 1]
    bpb = int(np.bincount(_bar_lengths(beats, downbeats)).argmax()) if len(downbeats) > 2 else int(pos.max())
    return beats, downbeats, bpb


def beats_librosa(y: np.ndarray, sr: int) -> np.ndarray:
    import librosa

    y_low = librosa.resample(y, orig_sr=sr, target_sr=SR_LOW, res_type="soxr_hq") if sr != SR_LOW else y
    hop = 256
    env = librosa.onset.onset_strength(y=y_low, sr=SR_LOW, hop_length=hop, aggregate=np.median)
    _, frames = librosa.beat.beat_track(
        onset_envelope=env, sr=SR_LOW, hop_length=hop, start_bpm=120.0, tightness=100, trim=True
    )
    return librosa.frames_to_time(frames, sr=SR_LOW, hop_length=hop)


def refine_beats(y: np.ndarray, sr: int, beats: np.ndarray, window_s: float = 0.03) -> np.ndarray:
    """Snap each beat to the strongest onset within ±window on a fine (64-sample) grid with
    parabolic interpolation. Beats with no clear onset nearby keep their original time."""
    import librosa

    if len(beats) == 0:
        return beats
    hop = 64
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop, n_fft=1024, n_mels=64, lag=1, max_size=1)
    w = round(window_s * sr / hop)
    floor = np.percentile(env, 75)
    out = beats.astype(float).copy()
    for i, b in enumerate(beats):
        c = round(b * sr / hop)
        lo, hi = max(1, c - w), min(len(env) - 1, c + w + 1)
        if hi - lo < 3:
            continue
        j = lo + int(np.argmax(env[lo:hi]))
        if env[j] <= floor or j in (lo, hi - 1):
            continue
        a, m, z = env[j - 1], env[j], env[j + 1]
        denom = a - 2 * m + z
        delta = 0.5 * (a - z) / denom if denom != 0 else 0.0
        out[i] = (j + float(np.clip(delta, -0.5, 0.5))) * hop / sr
    return out


def _bar_lengths(beats: np.ndarray, downbeats: np.ndarray) -> np.ndarray:
    """Number of beats between consecutive downbeats."""
    idx = np.searchsorted(beats, downbeats - 1e-3)
    return np.diff(idx).astype(int)


def meter_from_accents(
    y_mix: np.ndarray,
    sr: int,
    beats: np.ndarray,
    y_harm: np.ndarray | None = None,
) -> tuple[np.ndarray, int, dict[str, float]]:
    """Downbeats + beats-per-bar without a trained model.

    Per beat, an accent feature = z(low-band onset strength, i.e. kick) + z(harmonic change
    across the beat, from beat-synchronous chroma). For meter m in {3, 4} and phase p, fold the
    feature by m; the meter whose best phase stands out most from its other phases wins and
    that phase gives the downbeats."""
    import librosa

    hop = 256
    y_low = librosa.resample(y_mix, orig_sr=sr, target_sr=SR_LOW, res_type="soxr_hq")
    mel = librosa.feature.melspectrogram(y=y_low, sr=SR_LOW, hop_length=hop, n_fft=2048, n_mels=64, fmax=8000)
    mel_db = librosa.power_to_db(mel)
    low_bins = librosa.mel_frequencies(n_mels=64, fmax=8000) < 160.0
    low_env = librosa.onset.onset_strength(S=mel_db[low_bins], sr=SR_LOW, hop_length=hop)
    frames = librosa.time_to_frames(beats, sr=SR_LOW, hop_length=hop)
    win = 3
    kick = np.array([low_env[max(0, f - win) : f + win + 1].max(initial=0.0) for f in frames])

    yh = (
        y_low
        if y_harm is None
        else librosa.resample(y_harm, orig_sr=sr, target_sr=SR_LOW, res_type="soxr_hq")
    )
    chroma = librosa.feature.chroma_cqt(y=yh, sr=SR_LOW, hop_length=CHROMA_HOP)
    bf = librosa.time_to_frames(beats, sr=SR_LOW, hop_length=CHROMA_HOP)
    seg = librosa.util.sync(chroma, bf, aggregate=np.mean)[:, 1:]  # seg[:, i] = beat i -> i+1
    seg = seg / (np.linalg.norm(seg, axis=0, keepdims=True) + 1e-9)
    n = len(beats)
    change = np.zeros(n)
    for i in range(2, n - 1):
        before = seg[:, i - 2 : i].mean(axis=1)
        after = seg[:, i : i + 2].mean(axis=1)
        change[i] = 1.0 - float(before @ after / (np.linalg.norm(before) * np.linalg.norm(after) + 1e-9))

    def z(x: np.ndarray) -> np.ndarray:
        return (x - x.mean()) / (x.std() + 1e-9)

    feat = z(kick) + z(change)
    scores: dict[str, float] = {}
    best: tuple[float, int, int] = (-np.inf, 4, 0)
    for m in (3, 4):
        means = np.array([feat[p::m].mean() for p in range(m)])
        p = int(np.argmax(means))
        contrast = float(means[p] - np.delete(means, p).mean())
        scores[f"{m}/4"] = round(contrast, 3)
        if contrast > best[0]:
            best = (contrast, m, p)
    _, m, p = best
    return beats[p::m], m, scores


def track_beats(
    y: np.ndarray,
    sr: int,
    prefer: str = "auto",
    y_harm: np.ndarray | None = None,
) -> BeatTrack:
    chain: list[tuple[str, Callable[[], object]]] = []
    for name in _order(prefer, BEAT_BACKENDS):
        if name == "beat_this":
            chain.append((name, lambda: beats_beat_this(y, sr)))
        elif name == "madmom":
            chain.append((name, lambda: beats_madmom(y, sr)))
        else:
            chain.append((name, lambda: beats_librosa(y, sr)))
    backend, result, attempts = _run_chain(chain)

    meter_scores: dict[str, float] = {}
    if backend == "librosa":
        raw = np.asarray(result)
        beats = refine_beats(y, sr, raw)
        downbeats, bpb, meter_scores = meter_from_accents(y, sr, beats, y_harm)
    else:
        if backend == "madmom":
            raw, raw_down, bpb = result  # type: ignore[misc]
        else:
            raw, raw_down = result  # type: ignore[misc]
            lengths = _bar_lengths(raw, raw_down)
            bpb = int(np.bincount(lengths).argmax()) if len(lengths) else None
        beats = refine_beats(y, sr, raw)
        # Map each downbeat to its nearest (refined) beat.
        idx = np.unique([int(np.argmin(np.abs(raw - d))) for d in raw_down]).astype(int)
        downbeats = beats[idx]
        if bpb:
            lengths = _bar_lengths(beats, downbeats)
            meter_scores["barsWithModalLength"] = round(
                float(np.mean(lengths == bpb)) if len(lengths) else 0.0, 3
            )
    return BeatTrack(beats, downbeats, backend, bpb, meter_scores, True, attempts)


def bpm_from_beats(beats: np.ndarray) -> float:
    """BPM = 60 / median inter-beat interval (docs/BUILD_PROMPT.md §12.2)."""
    if len(beats) < 2:
        return 0.0
    return float(60.0 / np.median(np.diff(beats)))


def tempo_drift_pct(beats: np.ndarray) -> float:
    """Half the 5–95 percentile spread of the local tempo (8-beat running median), in % of BPM."""
    ibi = np.diff(beats)
    if len(ibi) < 16:
        return 0.0
    k = 8
    local = np.array([np.median(ibi[i : i + k]) for i in range(len(ibi) - k + 1)])
    bpm_local = 60.0 / local
    lo, hi = np.percentile(bpm_local, [5, 95])
    return float((hi - lo) / 2 / (60.0 / np.median(ibi)) * 100)


def check_four_four(track: BeatTrack) -> tuple[bool, str | None]:
    if len(track.beats) < 16 or len(track.downbeats) < 4:
        return False, f"too few beats/downbeats found ({len(track.beats)}/{len(track.downbeats)})"
    if track.beats_per_bar != 4:
        return False, (
            f"not 4/4: {track.backend} found {track.beats_per_bar} beats per bar"
            + (f" (meter scores {track.meter_scores})" if track.meter_scores else "")
        )
    lengths = _bar_lengths(track.beats, track.downbeats)
    regular = float(np.mean(lengths == 4)) if len(lengths) else 0.0
    if regular < 0.8:
        return False, f"irregular bars: only {regular:.0%} of bars have 4 beats"
    return True, None


# --------------------------------------------------------------------------- key

# Krumhansl–Kessler probe-tone profiles (C major / C minor).
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_essentia(y: np.ndarray, sr: int) -> tuple[int, str, float, dict]:
    """Essentia KeyExtractor with the ``edma`` and ``bgate`` profiles. If both agree, done;
    otherwise the stronger one wins and the confidence is halved (relative-key agreement,
    same PCS, keeps the full confidence)."""
    try:
        import essentia

        essentia.log.infoActive = False
        essentia.log.warningActive = False
        import essentia.standard as es
    except Exception as exc:
        raise BackendUnavailable(f"essentia not importable ({type(exc).__name__}: {exc})") from exc
    votes = {}
    for profile in ("edma", "bgate"):
        k, scale, strength = es.KeyExtractor(profileType=profile, sampleRate=float(sr))(y.astype(np.float32))
        votes[profile] = {"tonic": _NOTE_TO_PC[k], "mode": scale, "strength": round(float(strength), 4)}
    a, b = votes["edma"], votes["bgate"]
    win = a if a["strength"] >= b["strength"] else b
    same_key = (a["tonic"], a["mode"]) == (b["tonic"], b["mode"])
    same_pcs = pcs_index(a["tonic"], a["mode"]) == pcs_index(b["tonic"], b["mode"])
    conf = (a["strength"] + b["strength"]) / 2 if same_pcs else win["strength"] * 0.5
    return (
        win["tonic"],
        win["mode"],
        round(float(conf), 4),
        {"votes": votes, "agree": same_key, "agreePcs": same_pcs},
    )


def key_librosa(y: np.ndarray, sr: int) -> tuple[int, str, float, dict]:
    """Mean chroma_cqt correlated with Krumhansl–Kessler profiles over 24 keys."""
    import librosa

    y_low = librosa.resample(y, orig_sr=sr, target_sr=SR_LOW, res_type="soxr_hq") if sr != SR_LOW else y
    chroma = librosa.feature.chroma_cqt(y=y_low, sr=SR_LOW, hop_length=2048).mean(axis=1)
    scores = []
    for mode, prof in (("major", KK_MAJOR), ("minor", KK_MINOR)):
        for tonic in range(12):
            scores.append((float(np.corrcoef(np.roll(prof, tonic), chroma)[0, 1]), tonic, mode))
    scores.sort(reverse=True)
    best = scores[0]
    other_pcs = next(s for s in scores[1:] if pcs_index(s[1], s[2]) != pcs_index(best[1], best[2]))
    conf = max(0.0, min(1.0, best[0])) * min(1.0, (best[0] - other_pcs[0]) * 5)
    return (
        best[1],
        best[2],
        round(conf, 4),
        {"correlation": round(best[0], 4), "runnerUpOtherPcs": round(other_pcs[0], 4)},
    )


def estimate_key(y: np.ndarray, sr: int, prefer: str = "auto") -> KeyEstimate:
    chain: list[tuple[str, Callable[[], object]]] = []
    for name in _order(prefer, KEY_BACKENDS):
        fn = key_essentia if name == "essentia" else key_librosa
        chain.append((name, lambda fn=fn: fn(y, sr)))
    backend, (tonic, mode, conf, details), attempts = _run_chain(chain)  # type: ignore[misc]
    return KeyEstimate(tonic, mode, conf, backend, details, attempts)


# --------------------------------------------------------------------------- chroma


def bar_chroma(y: np.ndarray, sr: int, beats: np.ndarray, downbeats: np.ndarray) -> np.ndarray:
    """Beat-synchronous chroma_cqt averaged per bar, each bar normalised to max 1. Shape (bars, 12)."""
    import librosa

    if len(downbeats) == 0:
        return np.zeros((0, 12))
    y_low = librosa.resample(y, orig_sr=sr, target_sr=SR_LOW, res_type="soxr_hq") if sr != SR_LOW else y
    chroma = librosa.feature.chroma_cqt(y=y_low, sr=SR_LOW, hop_length=CHROMA_HOP)
    bf = librosa.time_to_frames(beats, sr=SR_LOW, hop_length=CHROMA_HOP)
    seg = librosa.util.sync(chroma, bf, aggregate=np.mean)[:, 1:]  # seg[:, i] covers beat i -> i+1
    starts = np.searchsorted(beats, downbeats - 1e-3)
    ends = np.append(starts[1:], len(beats))
    bars = []
    for s, e in zip(starts, ends, strict=True):
        v = seg[:, s:e].mean(axis=1) if e > s else np.zeros(12)
        peak = v.max()
        bars.append(v / peak if peak > 0 else v)
    return np.array(bars)


# --------------------------------------------------------------------------- top level


def analyze_song(song: SongInput, beats_backend: str = "auto", key_backend: str = "auto") -> SongAnalysis:
    timings: dict[str, float] = {}
    t0 = time.perf_counter()
    y = load_audio(song.mix, SR)
    harmonic = [song.stems[s] for s in ("bass", "other") if s in song.stems]
    y_harm = mix_stems(harmonic, SR) if len(harmonic) == 2 else None
    timings["load"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    track = track_beats(y, SR, beats_backend, y_harm)
    timings["beats"] = time.perf_counter() - t0
    ok, reason = check_four_four(track)

    t0 = time.perf_counter()
    key = estimate_key(y_harm if y_harm is not None else y, SR, key_backend)
    timings["key"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    # Per-bar chroma per harmonic stem (what a pack stores per StemLoop), else on the mix.
    sources = {s: song.stems[s] for s in ("bass", "other") if s in song.stems}
    chroma: dict[str, np.ndarray] = {}
    if sources:
        for name, p in sources.items():
            chroma[name] = bar_chroma(load_audio(p, SR), SR, track.beats, track.downbeats)
    else:
        chroma["mix"] = bar_chroma(y, SR, track.beats, track.downbeats)
    timings["chroma"] = time.perf_counter() - t0
    timings["total"] = sum(timings.values())

    return SongAnalysis(
        song_id=song.song_id,
        source=str(song.mix.name if song.stems else song.mix),
        duration_s=round(len(y) / SR, 3),
        bpm=round(bpm_from_beats(track.beats), 3),
        beats=[round(float(b), 5) for b in track.beats],
        downbeats=[round(float(b), 5) for b in track.downbeats],
        bar_count=len(track.downbeats),
        beats_per_bar=track.beats_per_bar,
        four_four=ok,
        rejection=reason,
        tempo_drift_pct=round(tempo_drift_pct(track.beats), 3),
        key={
            "tonic": key.tonic,
            "mode": key.mode,
            "pcs": key.pcs,
            "name": key.name,
            "confidence": key.confidence,
            "details": key.details,
        },
        key_source="bass+other stems" if y_harm is not None else "mix",
        chroma={k: [[round(float(v), 4) for v in row] for row in c] for k, c in chroma.items()},
        backends={
            "beats": track.backend + "+refine",
            "meter": track.backend if track.backend != "librosa" else "accent-folding",
            "key": key.backend,
            "chroma": "librosa.chroma_cqt",
        },
        attempts={"beats": [asdict(a) for a in track.attempts], "key": [asdict(a) for a in key.attempts]},
        timings_s={k: round(v, 3) for k, v in timings.items()},
    )


# --------------------------------------------------------------------------- evaluation


def chroma_consistency(result: SongAnalysis, truth: dict, source: str, tol: float = 0.07) -> dict:
    """Per-bar chroma vs the ground-truth chord, over the bars where ``source`` is active.

    A ground-truth bar with no detected downbeat within ``tol`` counts as a miss.
    ``top1InChord``: strongest pitch class is a chord tone. ``top1IsRoot``: it is the root
    (the expectation for a bass line). ``top3IsTriad``: the 3 strongest are exactly the triad."""
    rows = result.chroma.get(source, [])
    down = np.array(result.downbeats[: len(rows)])
    bars = truth["activeBars"].get(source, list(range(truth["barCount"])))
    top1 = root = triad = 0
    for bar in bars:
        if len(down) == 0:
            break
        i = int(np.argmin(np.abs(down - truth["downbeats"][bar])))
        if abs(down[i] - truth["downbeats"][bar]) > tol:
            continue
        chord = truth["chords"][bar]
        order = list(np.argsort(np.array(rows[i]))[::-1])
        top1 += int(order[0] in chord["pitchClasses"])
        root += int(order[0] == chord["root"])
        triad += int(set(order[:3]) == set(chord["pitchClasses"]))
    n = len(bars)
    return {
        "bars": n,
        "top1InChord": round(top1 / n, 4) if n else 0.0,
        "top1IsRoot": round(root / n, 4) if n else 0.0,
        "top3IsTriad": round(triad / n, 4) if n else 0.0,
    }


def evaluate(result: SongAnalysis, truth: dict) -> dict:
    """Score one analysis against a fixture's ground truth."""
    from .metrics import f_measure

    gt_bpm = truth["bpm"]
    four_four_truth = truth["beatsPerBar"] == 4
    chroma_eval = {name: chroma_consistency(result, truth, name) for name in result.chroma}
    return {
        "songId": result.song_id,
        "purpose": truth.get("purpose"),
        "bpmTruth": gt_bpm,
        "bpm": result.bpm,
        "bpmError": round(result.bpm - gt_bpm, 3),
        "beatF": round(f_measure(np.array(truth["beats"]), np.array(result.beats)), 4),
        "downbeatF": round(f_measure(np.array(truth["downbeats"]), np.array(result.downbeats)), 4),
        "barCount": result.bar_count,
        "barCountTruth": truth["barCount"],
        "fourFourTruth": four_four_truth,
        "fourFour": result.four_four,
        "meterCorrect": result.four_four == four_four_truth,
        "rejection": result.rejection,
        "keyTruth": truth["key"]["name"],
        "key": result.key["name"],
        "pcsTruth": truth["key"]["pcs"],
        "pcs": result.key["pcs"],
        "pcsCorrect": result.key["pcs"] == truth["key"]["pcs"],
        "keyExact": (result.key["tonic"], result.key["mode"])
        == (truth["key"]["tonic"], truth["key"]["mode"]),
        "keyConfidence": result.key["confidence"],
        "chroma": chroma_eval,
        "tempoDriftPct": result.tempo_drift_pct,
        "tempoDriftTruthPct": truth.get("tempoDriftPct", 0.0),
        "backends": result.backends,
        "seconds": result.timings_s.get("total"),
    }
