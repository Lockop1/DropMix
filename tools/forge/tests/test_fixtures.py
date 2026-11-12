"""forge fixtures: coverage of the spec, exact sample counts, determinism, FLAC copies."""

from __future__ import annotations

import hashlib
import json
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
from typer.testing import CliRunner

from forge import fixtures
from forge.cli import app

FILES = ("mix", *fixtures.STEMS)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_catalogue_covers_the_spec() -> None:
    four = [s for s in fixtures.SONGS if s.beats_per_bar == 4]
    core = [s for s in four if s.purpose == "core"]
    assert len(core) >= 6
    assert {s.bpm for s in core} == {92, 120, 128, 150}
    assert {(s.tonic, s.mode) for s in core} == {(7, "major"), (4, "minor")}  # G major, E minor
    for bpm in (92, 120, 128, 150):
        assert {(s.tonic, s.mode) for s in core if s.bpm == bpm} == {(7, "major"), (4, "minor")}
    assert all(s.bars >= 32 for s in fixtures.SONGS)
    assert any(s.drift_pct >= 1.0 and s.beats_per_bar == 4 for s in fixtures.SONGS)
    assert any(s.beats_per_bar == 3 for s in fixtures.SONGS)
    assert len({s.seed for s in fixtures.SONGS}) == len(fixtures.SONGS)


def test_progressions_follow_the_spec() -> None:
    g = fixtures.SONGS_BY_ID["g-major-120"]
    e = fixtures.SONGS_BY_ID["e-minor-120"]
    assert [fixtures.chord_for_bar(g, b)["name"] for b in range(4)] == ["G", "D", "Em", "C"]  # I–V–vi–IV
    assert [fixtures.chord_for_bar(e, b)["name"] for b in range(4)] == ["Em", "C", "G", "D"]  # i–VI–III–VII
    assert fixtures.pcs_index(7, "major") == 7 and fixtures.pcs_index(4, "minor") == 7
    assert fixtures.pcs_index(1, "minor") == 4


def test_every_song_has_exact_wavs(fixtures_dir: Path, truth: dict) -> None:
    assert truth["sampleRate"] == 44100
    assert len(truth["songs"]) == len(fixtures.SONGS)
    for s in truth["songs"]:
        for name in FILES:
            path = fixtures_dir / s["files"][name]
            with wave.open(str(path), "rb") as w:
                assert w.getframerate() == 44100
                assert w.getnchannels() == 2
                assert w.getsampwidth() == 2
                assert w.getnframes() == s["sampleCount"], (s["songId"], name)
        if s["tempoDriftPct"] == 0:  # lead-in + exact bars + tail
            seconds = fixtures.LEAD_IN_S + s["beatCount"] * 60.0 / s["bpm"] + fixtures.TAIL_S
            assert s["sampleCount"] == round(seconds * 44100)
        else:
            assert s["sampleCount"] == fixtures.sample_count(fixtures.SONGS_BY_ID[s["songId"]])


def test_mix_is_exact_sum_of_stems(fixtures_dir: Path, truth: dict) -> None:
    for s in truth["songs"]:
        mix = fixtures.read_wav_int16(fixtures_dir / s["files"]["mix"]).astype(np.int32)
        total = sum(
            fixtures.read_wav_int16(fixtures_dir / s["files"][k]).astype(np.int32) for k in fixtures.STEMS
        )
        assert np.array_equal(mix, total), s["songId"]
        assert np.abs(mix).max() < 32767


def test_ground_truth_structure(truth: dict) -> None:
    for s in truth["songs"]:
        bpb, bars = s["beatsPerBar"], s["barCount"]
        assert s["timeSignature"] == [bpb, 4]
        assert len(s["beats"]) == bars * bpb == s["beatCount"]
        assert s["downbeats"] == s["beats"][::bpb]
        assert len(s["chords"]) == bars
        assert s["key"]["pcs"] == fixtures.pcs_index(s["key"]["tonic"], s["key"]["mode"])
        assert all(0 <= c["root"] < 12 and len(c["pitchClasses"]) == 3 for c in s["chords"])
        assert set(s["activeBars"]) == set(fixtures.STEMS)
        assert all(p % 4 == 0 for p in s["vocalPhraseStartBars"])  # phrases on 4-bar boundaries
        assert set(s["activeBars"]["vocals"]) == {
            b for p in s["vocalPhraseStartBars"] for b in range(p, p + 4)
        }
        ibi = np.diff(s["beats"])
        if s["tempoDriftPct"] == 0:
            assert np.allclose(ibi, 60.0 / s["bpm"])
        else:
            dev = (60.0 / ibi) / s["bpm"] - 1.0
            assert 0.009 < np.abs(dev).max() < 0.0105  # ±1% slow wobble
        assert s["beatSamples"] == [round(b * 44100) for b in s["beats"]]


def test_stems_are_active_where_ground_truth_says(fixtures_dir: Path, truth: dict) -> None:
    s = next(x for x in truth["songs"] if x["songId"] == "g-major-120")
    for stem in fixtures.STEMS:
        y = fixtures.read_wav_int16(fixtures_dir / s["files"][stem]).astype(float)
        for bar in range(s["barCount"]):
            a = s["downbeatSamples"][bar]
            b = a + round(60 / s["bpm"] * 44100 * 4)
            rms = np.sqrt(np.mean(y[a + 2000 : b - 2000] ** 2))
            if bar in s["activeBars"][stem]:
                assert rms > 30, (stem, bar)
            elif stem != "vocals":  # vocal release tails may spill a few ms past a phrase end
                assert rms < 1, (stem, bar)


def test_generation_is_deterministic(tmp_path: Path, fixtures_dir: Path) -> None:
    ids = ["e-minor-150", "drift-g-major-120"]
    a, b = tmp_path / "a", tmp_path / "b"
    ta = fixtures.generate(a, ids)
    tb = fixtures.generate(b, ids)
    assert ta == tb
    assert (a / "ground_truth.json").read_bytes() == (b / "ground_truth.json").read_bytes()
    for sid in ids:
        for name in FILES:
            assert sha(a / sid / f"{name}.wav") == sha(b / sid / f"{name}.wav")
            assert sha(a / sid / f"{name}.wav") == sha(fixtures_dir / sid / f"{name}.wav")


def test_flac_copies_are_lossless(tmp_path: Path) -> None:
    truth = fixtures.generate(tmp_path, ["g-major-150"], flac=True)
    s = truth["songs"][0]
    for name in FILES:
        wav = fixtures.read_wav_int16(tmp_path / s["files"][name])
        flac, sr = sf.read(str(tmp_path / s["flacFiles"][name]), dtype="int16", always_2d=True)
        assert sr == 44100
        assert flac.shape == wav.shape
        assert np.array_equal(flac, wav)


def test_cli_fixtures_writes_only_under_out(tmp_path: Path) -> None:
    out = tmp_path / "out"
    result = CliRunner().invoke(app, ["fixtures", "--out", str(out), "--only", "g-major-128"])
    assert result.exit_code == 0, result.output
    written = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file())
    assert written == sorted(["out/ground_truth.json"] + [f"out/g-major-128/{n}.wav" for n in FILES])
    gt = json.loads((out / "ground_truth.json").read_text())
    assert [s["songId"] for s in gt["songs"]] == ["g-major-128"]


def test_cli_rejects_unknown_song(tmp_path: Path) -> None:
    result = CliRunner().invoke(app, ["fixtures", "--out", str(tmp_path), "--only", "nope"])
    assert result.exit_code == 2
