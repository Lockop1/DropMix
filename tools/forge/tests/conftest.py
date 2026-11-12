"""Shared pytest fixtures: synthetic songs are generated once per session into a temp dir."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from forge import analysis, fixtures

# Backend configurations every accuracy test runs under:
#   auto     best backend that runs here (beat_this -> madmom -> librosa; essentia -> librosa)
#   fallback the pure librosa/numpy path that must work when every optional backend is missing
BACKEND_CONFIGS = {"auto": ("auto", "auto"), "fallback": ("librosa", "librosa")}


@pytest.fixture(scope="session")
def fixtures_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("fixtures")
    fixtures.generate(out)
    return out


@pytest.fixture(scope="session")
def truth(fixtures_dir: Path) -> dict:
    return json.loads((fixtures_dir / "ground_truth.json").read_text())


@pytest.fixture(scope="session")
def truth_by_id(truth: dict) -> dict[str, dict]:
    return {s["songId"]: s for s in truth["songs"]}


class AnalysisCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._cache: dict[tuple[str, str], analysis.SongAnalysis] = {}

    def get(self, config: str, song_id: str) -> analysis.SongAnalysis:
        key = (config, song_id)
        if key not in self._cache:
            beats, key_backend = BACKEND_CONFIGS[config]
            songs, _ = analysis.resolve_inputs(self.root / song_id)
            self._cache[key] = analysis.analyze_song(songs[0], beats, key_backend)
        return self._cache[key]


@pytest.fixture(scope="session")
def analyses(fixtures_dir: Path) -> AnalysisCache:
    return AnalysisCache(fixtures_dir)
