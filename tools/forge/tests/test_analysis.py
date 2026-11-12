"""Analysis accuracy on synthetic fixtures (docs/BUILD_PROMPT.md §16.1 thresholds).

Every accuracy test runs twice: with the best backend available here ("auto") and with the
pure librosa/numpy fallback ("fallback"). Thresholds are the spec's; never relax them.
"""

from __future__ import annotations

import numpy as np
import pytest

from forge import analysis, fixtures
from forge.metrics import f_measure

FOUR_FOUR = [s.song_id for s in fixtures.SONGS if s.beats_per_bar == 4]
NON_FOUR_FOUR = [s.song_id for s in fixtures.SONGS if s.beats_per_bar != 4]
CONFIGS = ["auto", "fallback"]
BPM_TOL = 0.5
DOWNBEAT_F_MIN = 0.9
DOWNBEAT_TOL_S = 0.07


@pytest.mark.parametrize("song_id", FOUR_FOUR)
@pytest.mark.parametrize("config", CONFIGS)
def test_bpm_within_half_bpm(config, song_id, analyses, truth_by_id) -> None:
    r = analyses.get(config, song_id)
    gt = truth_by_id[song_id]["bpm"]
    err = r.bpm - gt
    # ±0.5 BPM also rules out half/double tempo.
    assert abs(err) <= BPM_TOL, f"{song_id}: {r.bpm:.3f} vs {gt} ({r.backends['beats']})"


@pytest.mark.parametrize("song_id", FOUR_FOUR)
@pytest.mark.parametrize("config", CONFIGS)
def test_downbeat_f_measure(config, song_id, analyses, truth_by_id) -> None:
    r = analyses.get(config, song_id)
    f = f_measure(np.array(truth_by_id[song_id]["downbeats"]), np.array(r.downbeats), DOWNBEAT_TOL_S)
    assert f >= DOWNBEAT_F_MIN, (
        f"{song_id}: downbeat F {f:.3f} ({r.backends['beats']}, {r.backends['meter']})"
    )


@pytest.mark.parametrize("song_id", [s.song_id for s in fixtures.SONGS])
@pytest.mark.parametrize("config", CONFIGS)
def test_key_pcs_correct(config, song_id, analyses, truth_by_id) -> None:
    r = analyses.get(config, song_id)
    gt = truth_by_id[song_id]["key"]
    assert r.key["pcs"] == gt["pcs"], (
        f"{song_id}: {r.key['name']} (PCS {r.key['pcs']}) vs {gt['name']} ({r.backends['key']})"
    )
    assert r.key_source == "bass+other stems"


@pytest.mark.parametrize("song_id", FOUR_FOUR)
@pytest.mark.parametrize("config", CONFIGS)
def test_four_four_accepted(config, song_id, analyses) -> None:
    r = analyses.get(config, song_id)
    assert r.four_four, f"{song_id} rejected: {r.rejection}"
    assert r.rejection is None


@pytest.mark.parametrize("song_id", NON_FOUR_FOUR)
@pytest.mark.parametrize("config", CONFIGS)
def test_three_four_rejected_with_reason(config, song_id, analyses) -> None:
    r = analyses.get(config, song_id)
    assert not r.four_four
    assert r.rejection and "3 beats per bar" in r.rejection


@pytest.mark.parametrize("song_id", FOUR_FOUR)
@pytest.mark.parametrize("config", CONFIGS)
def test_bar_chroma_matches_chords(config, song_id, analyses, truth_by_id) -> None:
    """Per-bar chroma on the harmonic stems: the other stem's 3 strongest pitch classes are
    the bar's triad, and the bass stem's strongest is the chord root, on the stem's active bars."""
    r = analyses.get(config, song_id)
    gt = truth_by_id[song_id]
    assert set(r.chroma) == {"bass", "other"}
    for rows in r.chroma.values():
        arr = np.array(rows)
        assert arr.shape[1] == 12
        assert np.all((arr.max(axis=1) == 0) | np.isclose(arr.max(axis=1), 1.0))  # normalised to max 1
    other = analysis.chroma_consistency(r, gt, "other")
    bass = analysis.chroma_consistency(r, gt, "bass")
    assert other["top1InChord"] == 1.0, other
    assert other["top3IsTriad"] >= 0.9, other
    assert bass["top1IsRoot"] >= 0.9, bass


@pytest.mark.parametrize("config", CONFIGS)
def test_tempo_drift_is_measured(config, analyses) -> None:
    drift = analyses.get(config, "drift-g-major-120").tempo_drift_pct
    steady = analyses.get(config, "g-major-120").tempo_drift_pct
    assert 0.6 <= drift <= 1.4, drift
    assert steady < 0.3, steady


def test_backends_are_reported(analyses) -> None:
    r = analyses.get("auto", "g-major-092")
    assert set(r.backends) == {"beats", "meter", "key", "chroma"}
    attempts = r.attempts["beats"]
    assert attempts[-1]["ok"] and r.backends["beats"].startswith(attempts[-1]["backend"])
    assert [a["backend"] for a in attempts] == list(analysis.BEAT_BACKENDS[: len(attempts)])
    for a in attempts[:-1]:  # every skipped backend says why
        assert not a["ok"] and a["error"]
    fb = analyses.get("fallback", "g-major-092")
    assert fb.backends["beats"] == "librosa+refine" and fb.backends["key"] == "librosa"


def test_falls_back_when_optional_backends_fail(monkeypatch, fixtures_dir) -> None:
    def broken(*_a, **_k):
        raise analysis.BackendUnavailable("simulated: weights could not be downloaded")

    monkeypatch.setattr(analysis, "beats_beat_this", broken)
    monkeypatch.setattr(analysis, "beats_madmom", broken)
    monkeypatch.setattr(analysis, "key_essentia", broken)
    songs, _ = analysis.resolve_inputs(fixtures_dir / "g-major-150")
    r = analysis.analyze_song(songs[0])
    assert r.backends["beats"] == "librosa+refine"
    assert r.backends["key"] == "librosa"
    assert [a["ok"] for a in r.attempts["beats"]] == [False, False, True]
    assert "simulated" in r.attempts["beats"][0]["error"]
    assert abs(r.bpm - 150) <= BPM_TOL


def test_single_file_input_uses_mix(fixtures_dir) -> None:
    songs, truth = analysis.resolve_inputs(fixtures_dir / "e-minor-128" / "mix.wav")
    assert truth is None and songs[0].stems == {}
    r = analysis.analyze_song(songs[0], "librosa", "librosa")
    assert r.key_source == "mix" and set(r.chroma) == {"mix"}
    assert abs(r.bpm - 128) <= BPM_TOL
    assert r.key["pcs"] == 7


def test_resolve_fixture_root(fixtures_dir) -> None:
    songs, truth = analysis.resolve_inputs(fixtures_dir)
    assert [s.song_id for s in songs] == [s.song_id for s in fixtures.SONGS]
    assert truth and all(set(s.stems) == set(fixtures.STEMS) for s in songs)


def test_pcs_index() -> None:
    assert [analysis.pcs_index(t, "major") for t in range(12)] == list(range(12))
    assert analysis.pcs_index(9, "minor") == 0  # A minor -> C major
    assert analysis.pcs_index(4, "minor") == 7  # E minor -> G major
    assert analysis.pcs_index(11, "minor") == 2


def test_bpm_is_sixty_over_median_ibi() -> None:
    beats = np.cumsum(np.r_[0.0, np.full(20, 0.5), 0.9])  # one outlier gap
    assert analysis.bpm_from_beats(beats) == pytest.approx(120.0)


def test_cli_analyze_song_dir(fixtures_dir) -> None:
    import json

    from typer.testing import CliRunner

    from forge.cli import app

    runner = CliRunner()
    song = str(fixtures_dir / "waltz-e-minor-120")
    res = runner.invoke(app, ["analyze", song, "--json", "--beats", "librosa", "--key", "librosa"])
    assert res.exit_code == 0, res.output
    data = json.loads(res.output)
    assert data["results"][0]["four_four"] is False
    ev = data["evaluation"][0]
    assert ev["songId"] == "waltz-e-minor-120" and ev["meterCorrect"] and ev["pcsCorrect"]
    res = runner.invoke(app, ["analyze", song, "--beats", "librosa", "--key", "librosa"])
    assert res.exit_code == 0, res.output
    assert "accuracy vs ground_truth.json" in res.output and "not 4/4" in res.output
