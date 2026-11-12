"""Separator benchmark (Phase 0 task 0C). The user runs this on the GPU laptop.

Two configurations via ``audio-separator``:
  A  RoFormer vocal model on the mix -> vocals + instrumental, then htdemucs_ft on the
     instrumental -> drums / bass / other (the spec default, docs/BUILD_PROMPT.md §12.2)
  B  htdemucs_ft 4-stem on the mix

Records wall time per song and per stage, model load time, peak GPU memory per stage, writes
stems side by side under ``library/bench/<config>/<song>/`` for listening, and, when run on
``forge fixtures`` output, SDR per stem against the true stems. Prints markdown tables.
"""

from __future__ import annotations

import argparse
import json
import resource
import shutil
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .metrics import sdr
from .models import HTDEMUCS_FT, MODELS_BY_ID, ROFORMER_VOCALS
from .paths import apply_model_env, library_dir, separator_models_dir

AUDIO_EXTS = {".wav", ".flac", ".mp3", ".ogg", ".m4a", ".aif", ".aiff"}
STEMS = ("vocals", "drums", "bass", "other")


@dataclass(frozen=True)
class Stage:
    name: str
    model: str
    model_id: str
    input: str  # "mix" or a stem produced by an earlier stage
    outputs: dict[str, str]  # audio-separator stem name -> our file name (without extension)


CONFIGS: dict[str, tuple[str, list[Stage]]] = {
    "A": (
        "RoFormer vocals, then htdemucs_ft on the instrumental (spec default)",
        [
            Stage(
                "vocals",
                ROFORMER_VOCALS,
                "roformer-vocals",
                "mix",
                {"Vocals": "vocals", "Instrumental": "instrumental"},
            ),
            Stage(
                "drums-bass-other",
                HTDEMUCS_FT,
                "htdemucs_ft",
                "instrumental",
                {"Drums": "drums", "Bass": "bass", "Other": "other", "Vocals": "residual_vocals"},
            ),
        ],
    ),
    "B": (
        "htdemucs_ft 4-stem on the mix",
        [
            Stage(
                "4-stem",
                HTDEMUCS_FT,
                "htdemucs_ft",
                "mix",
                {"Vocals": "vocals", "Drums": "drums", "Bass": "bass", "Other": "other"},
            ),
        ],
    ),
}


@dataclass
class Song:
    id: str
    path: Path
    fixture_dir: Path | None = None
    duration_s: float | None = None


@dataclass
class StageResult:
    config: str
    song: str
    stage: str
    seconds: float
    peak_gpu_mb: float | None
    outputs: list[str]


@dataclass
class BenchResult:
    device: str
    gpu_name: str | None
    model_load_s: dict[str, float] = field(default_factory=dict)
    stages: list[StageResult] = field(default_factory=list)
    sdr: dict[str, dict[str, dict[str, float]]] = field(default_factory=dict)  # config -> song -> stem -> dB
    peak_rss_mb: float = 0.0


# --------------------------------------------------------------------------- discovery


def find_songs(songs_dir: Path | None, fixtures_dir: Path | None, limit: int | None) -> list[Song]:
    songs: list[Song] = []
    if songs_dir:
        for p in sorted(Path(songs_dir).iterdir()):
            if p.suffix.lower() in AUDIO_EXTS and p.is_file():
                songs.append(Song(p.stem, p))
    elif fixtures_dir:
        truth = json.loads((Path(fixtures_dir) / "ground_truth.json").read_text())
        for s in truth["songs"]:
            if s.get("beatsPerBar", 4) != 4 or s.get("purpose") == "drift":
                continue
            d = Path(fixtures_dir) / s["songId"]
            songs.append(Song(s["songId"], d / "mix.wav", d))
    if limit:
        songs = songs[:limit]
    for s in songs:
        try:
            import soundfile as sf

            s.duration_s = round(sf.info(str(s.path)).duration, 2)
        except Exception:
            s.duration_s = None
    return songs


def gpu_info() -> tuple[str, str | None]:
    try:
        import torch
    except Exception:
        return "cpu (torch not installed)", None
    if torch.cuda.is_available():
        return "cuda", torch.cuda.get_device_name(0)
    return "cpu", None


# --------------------------------------------------------------------------- plan


def plan_text(songs: list[Song], configs: list[str], out_dir: Path, fixtures: bool) -> str:
    lines = ["# Separation benchmark plan", ""]
    lines.append(f"Songs ({len(songs)}):" + ("" if songs else " none found"))
    for s in songs:
        dur = f"{s.duration_s:.1f} s" if s.duration_s else "duration unknown"
        lines.append(f"  - {s.id}: {s.path} ({dur})" + (" [fixture: SDR scored]" if s.fixture_dir else ""))
    if not fixtures and len(songs) != 3:
        lines.append(f"  note: the Phase 0 protocol uses 3 real songs; found {len(songs)}")
    lines.append("")
    needed = set()
    for c in configs:
        desc, stages = CONFIGS[c]
        lines.append(f"Config {c}: {desc}")
        for st in stages:
            needed.add(st.model_id)
            lines.append(f"  stage {st.name}: {st.model} on {st.input} -> {', '.join(st.outputs.values())}")
        lines.append(f"  stems -> {out_dir / c / '<song>'}/{{{','.join(STEMS)}}}.wav")
    lines.append("")
    lines.append(f"Model cache: {separator_models_dir()}")
    for mid in sorted(needed):
        spec = MODELS_BY_ID[mid]
        state = "present" if spec.present() else f"MISSING (download: {spec.download_command()})"
        lines.append(f"  {mid}: {spec.filename}, ~{spec.size_mb:.0f} MB, {state}")
    nvsmi = shutil.which("nvidia-smi")
    lines.append(
        f"GPU: {'nvidia-smi found' if nvsmi else 'nvidia-smi not found: CPU only, expect minutes per song'}"
    )
    return "\n".join(lines)


# --------------------------------------------------------------------------- run


def _peak_gpu_reset() -> None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass


def _peak_gpu_mb() -> float | None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.synchronize()
            return round(torch.cuda.max_memory_allocated() / 2**20, 1)
    except Exception:
        pass
    return None


def run(songs: list[Song], configs: list[str], out_dir: Path, log=print) -> BenchResult:
    apply_model_env()
    import logging

    from audio_separator.separator import Separator

    device, gpu_name = gpu_info()
    result = BenchResult(device=device, gpu_name=gpu_name)
    models = separator_models_dir()
    models.mkdir(parents=True, exist_ok=True)
    for c in configs:
        _, stages = CONFIGS[c]
        work = {s.id: {"mix": s.path} for s in songs}
        for st in stages:
            song_dirs = {s.id: out_dir / c / s.id for s in songs}
            sep = Separator(
                log_level=logging.WARNING,
                model_file_dir=str(models),
                output_dir=str(out_dir / c),
                output_format="WAV",
                sample_rate=44100,
            )
            t0 = time.perf_counter()
            sep.load_model(model_filename=st.model)
            result.model_load_s[f"{c}:{st.name}"] = round(time.perf_counter() - t0, 2)
            for s in songs:
                song_dir = song_dirs[s.id]
                song_dir.mkdir(parents=True, exist_ok=True)
                sep.output_dir = str(song_dir)
                if getattr(sep, "model_instance", None) is not None:
                    sep.model_instance.output_dir = str(song_dir)
                _peak_gpu_reset()
                t0 = time.perf_counter()
                files = sep.separate(str(work[s.id][st.input]), custom_output_names=st.outputs)
                secs = time.perf_counter() - t0
                outs = [str(Path(f) if Path(f).is_absolute() else song_dir / Path(f).name) for f in files]
                for name in st.outputs.values():
                    work[s.id][name] = song_dir / f"{name}.wav"
                res = StageResult(c, s.id, st.name, round(secs, 2), _peak_gpu_mb(), outs)
                result.stages.append(res)
                log(
                    f"[{c}] {s.id} {st.name}: {secs:.1f} s"
                    + (f", peak GPU {res.peak_gpu_mb} MB" if res.peak_gpu_mb else "")
                )
            del sep
        for s in songs:  # htdemucs_ft's leftover vocals from the instrumental: not a deliverable
            (out_dir / c / s.id / "residual_vocals.wav").unlink(missing_ok=True)
    result.peak_rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    for c in configs:
        for s in songs:
            if s.fixture_dir:
                result.sdr.setdefault(c, {})[s.id] = score_song(out_dir / c / s.id, s.fixture_dir)
    return result


def score_song(est_dir: Path, ref_dir: Path) -> dict[str, float]:
    """SDR (dB) of each estimated stem against the fixture's true stem."""
    import soundfile as sf

    scores = {}
    for stem in STEMS:
        est = est_dir / f"{stem}.wav"
        if not est.exists():
            continue
        ref, _ = sf.read(str(ref_dir / f"{stem}.wav"), dtype="float64", always_2d=True)
        e, _ = sf.read(str(est), dtype="float64", always_2d=True)
        scores[stem] = round(sdr(ref, e), 2)
    return scores


# --------------------------------------------------------------------------- report


def markdown(result: BenchResult, songs: list[Song]) -> str:
    dur = {s.id: s.duration_s for s in songs}
    lines = [
        f"Device: {result.device}"
        + (f" ({result.gpu_name})" if result.gpu_name else "")
        + f"; process peak RSS {result.peak_rss_mb:.0f} MB",
        "",
    ]
    lines += [
        "| Config | Song | Length (s) | Stage | Wall time (s) | Peak GPU (MB) |",
        "|---|---|---|---|---|---|",
    ]
    for r in result.stages:
        gpu = f"{r.peak_gpu_mb:.0f}" if r.peak_gpu_mb is not None else "n/a"
        lines.append(
            f"| {r.config} | {r.song} | {dur.get(r.song) or '?'} | {r.stage} | {r.seconds:.1f} | {gpu} |"
        )
    lines += [
        "",
        "| Config | Song | Total wall time (s) | Seconds per minute of audio |",
        "|---|---|---|---|",
    ]
    totals: dict[tuple[str, str], float] = {}
    for r in result.stages:
        totals[(r.config, r.song)] = totals.get((r.config, r.song), 0.0) + r.seconds
    for (c, song), t in totals.items():
        d = dur.get(song)
        lines.append(
            f"| {c} | {song} | {t:.1f} | {t / d * 60:.1f} |" if d else f"| {c} | {song} | {t:.1f} | ? |"
        )
    if result.model_load_s:
        lines += ["", "Model load (s): " + ", ".join(f"{k} {v:.1f}" for k, v in result.model_load_s.items())]
    if result.sdr:
        lines += [
            "",
            "| Config | Song | " + " | ".join(f"SDR {s} (dB)" for s in STEMS) + " |",
            "|---|---|" + "---|" * len(STEMS),
        ]
        for c, per_song in result.sdr.items():
            for song, sc in per_song.items():
                lines.append(
                    f"| {c} | {song} | " + " | ".join(f"{sc.get(s, float('nan')):.2f}" for s in STEMS) + " |"
                )
            means = {s: [sc[s] for sc in per_song.values() if s in sc] for s in STEMS}
            lines.append(
                f"| {c} | **mean** | "
                + " | ".join(f"**{sum(v) / len(v):.2f}**" if v else "-" for v in means.values())
                + " |"
            )
    return "\n".join(lines)


# --------------------------------------------------------------------------- cli


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="forge bench-separation",
        description="Benchmark separator configs A and B (see docs/spikes/forge.md). Writes stems under "
        "library/bench/<config>/<song>/ for listening; scores SDR on fixtures.",
    )
    p.add_argument("songs_dir", nargs="?", type=Path, help="folder with (3) real songs to separate")
    p.add_argument(
        "--fixtures", type=Path, help="forge fixtures output: separate the 4/4 fixture mixes and score SDR"
    )
    p.add_argument(
        "--config",
        action="append",
        choices=sorted(CONFIGS),
        help="config to run (repeatable); default A and B",
    )
    p.add_argument("--out", type=Path, default=None, help="output root (default: <repo>/library/bench)")
    p.add_argument("--limit", type=int, default=None, help="only the first N songs")
    p.add_argument("--song", action="append", default=None, help="only this song id / file stem (repeatable)")
    p.add_argument("--dry-run", action="store_true", help="print the plan without loading any model")
    p.add_argument(
        "--json", type=Path, default=None, help="also write results JSON here (default: <out>/results.json)"
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.songs_dir and not args.fixtures:
        build_parser().error("give a songs folder, --fixtures DIR, or both")
    configs = args.config or ["A", "B"]
    out_dir = (args.out or library_dir() / "bench").expanduser()
    songs = find_songs(args.songs_dir, None, args.limit) if args.songs_dir else []
    if args.fixtures:
        songs += find_songs(None, args.fixtures, args.limit)
    if args.song:
        songs = [s for s in songs if s.id in set(args.song)]
    print(plan_text(songs, configs, out_dir, fixtures=bool(args.fixtures)))
    if args.dry_run:
        print("\n--dry-run: no model loaded, nothing written.")
        return 0
    if not songs:
        print("no songs to separate", file=sys.stderr)
        return 2
    try:
        import audio_separator  # noqa: F401
    except ImportError:
        print(
            "audio-separator is not installed: "
            "uv sync --project tools/forge --extra analysis --extra separation",
            file=sys.stderr,
        )
        return 2
    result = run(songs, configs, out_dir)
    md = markdown(result, songs)
    print("\n" + md)
    out_json = args.json or out_dir / "results.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({**asdict(result), "markdown": md}, indent=2, default=str))
    (out_dir / "results.md").write_text(md + "\n")
    print(f"\nresults: {out_json}")
    return 0
