#!/usr/bin/env python3
"""Separator benchmark for the GPU laptop: configs A (RoFormer vocals + htdemucs_ft) and B (htdemucs_ft).

Same as ``uv run --project tools/forge forge bench-separation ...``. Examples (repo root):

    # 1. see the plan, nothing is loaded or written
    uv run --project tools/forge python tools/forge/scripts/bench_separation.py ~/bench-songs --dry-run
    # 2. three real songs: stems for listening under library/bench/<config>/<song>/
    uv run --project tools/forge python tools/forge/scripts/bench_separation.py ~/bench-songs
    # 3. SDR against the synthetic fixtures' true stems
    uv run --project tools/forge forge fixtures --out .fixtures
    uv run --project tools/forge python tools/forge/scripts/bench_separation.py --fixtures .fixtures

Needs: uv sync --project tools/forge --extra analysis --extra separation, and model weights
(uv run --project tools/forge forge models download).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from forge.bench import main
except ImportError:  # run without the project installed: use the source tree
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from forge.bench import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
