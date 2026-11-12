"""Separation benchmark: what can be verified without a GPU or model weights."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from typer.testing import CliRunner

from forge import bench, fixtures
from forge.cli import app

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bench_separation.py"


def test_parser_defaults() -> None:
    args = bench.build_parser().parse_args(["songs", "--config", "B", "--dry-run"])
    assert args.songs_dir == Path("songs") and args.config == ["B"] and args.dry_run


def test_dry_run_prints_plan_without_loading_models(fixtures_dir, tmp_path, capsys) -> None:
    rc = bench.main(["--fixtures", str(fixtures_dir), "--dry-run", "--out", str(tmp_path / "bench")])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Config A" in out and "Config B" in out
    assert "model_bs_roformer_ep_317_sdr_12.9755.ckpt" in out and "htdemucs_ft.yaml" in out
    assert "g-major-092" in out and "waltz-e-minor-120" not in out  # 4/4 fixtures only
    assert "audio_separator" not in sys.modules
    assert not (tmp_path / "bench").exists()


def test_cli_and_script_dry_run(fixtures_dir) -> None:
    res = CliRunner().invoke(
        app, ["bench-separation", "--fixtures", str(fixtures_dir), "--dry-run", "--limit", "1"]
    )
    assert res.exit_code == 0, res.output
    assert "Songs (1)" in res.output
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--fixtures", str(fixtures_dir), "--dry-run", "--limit", "2"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert "Songs (2)" in proc.stdout


def test_real_song_folder_plan(tmp_path, capsys) -> None:
    songs = tmp_path / "songs"
    songs.mkdir()
    for name in ("a.wav", "b.flac"):
        sf.write(str(songs / name), np.zeros((4410, 2)), 44100)
    (songs / "notes.txt").write_text("x")
    rc = bench.main([str(songs), "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0 and "Songs (2)" in out and "uses 3 real songs; found 2" in out


def test_score_song_against_fixture_stems(fixtures_dir, tmp_path) -> None:
    ref = fixtures_dir / "e-minor-120"
    est = tmp_path / "est"
    est.mkdir()
    rng = np.random.default_rng(1)
    for stem in bench.STEMS:
        y, sr = sf.read(str(ref / f"{stem}.wav"), dtype="float64", always_2d=True)
        if stem == "vocals":
            shutil.copy(ref / f"{stem}.wav", est / f"{stem}.wav")
            continue
        noise = rng.standard_normal(y.shape)
        noise *= np.sqrt(np.sum(y**2) / np.sum(noise**2)) * 10 ** (-12 / 20)  # 12 dB SDR
        sf.write(str(est / f"{stem}.wav"), y + noise, sr, subtype="FLOAT")
    scores = bench.score_song(est, ref)
    assert scores["vocals"] > 80  # identical except nothing: 16-bit copy
    for stem in ("drums", "bass", "other"):
        assert abs(scores[stem] - 12.0) < 0.05, scores


def test_markdown_tables() -> None:
    res = bench.BenchResult(device="cuda", gpu_name="Test GPU", model_load_s={"A:vocals": 3.2})
    res.stages = [
        bench.StageResult("A", "song1", "vocals", 20.0, 3000.0, []),
        bench.StageResult("A", "song1", "drums-bass-other", 25.0, 2500.0, []),
        bench.StageResult("B", "song1", "4-stem", 22.0, None, []),
    ]
    res.sdr = {"A": {"song1": {"vocals": 10.0, "drums": 9.0, "bass": 8.0, "other": 7.0}}}
    md = bench.markdown(res, [bench.Song("song1", Path("x.wav"), duration_s=180.0)])
    assert "| A | song1 | 180.0 | vocals | 20.0 | 3000 |" in md
    assert "| A | song1 | 45.0 | 15.0 |" in md  # total and seconds per minute of audio
    assert "| B | song1 | 180.0 | 4-stem | 22.0 | n/a |" in md
    assert "**10.00**" in md


def test_bench_configs_match_spec() -> None:
    a = bench.CONFIGS["A"][1]
    assert [s.model for s in a] == ["model_bs_roformer_ep_317_sdr_12.9755.ckpt", "htdemucs_ft.yaml"]
    assert a[1].input == "instrumental"
    b = bench.CONFIGS["B"][1]
    assert [s.model for s in b] == ["htdemucs_ft.yaml"]
    for _, stages in bench.CONFIGS.values():
        produced = {v for st in stages for v in st.outputs.values()}
        assert set(fixtures.STEMS) <= produced
