"""Separation / analysis model weights: where they live, whether they are present, how to get them.

Nothing here downloads at import time. ``download`` is the only function that touches the network.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .paths import apply_model_env, separator_models_dir, torch_home

# audio-separator model filenames (its own default vocal model, and Demucs v4 fine-tuned).
ROFORMER_VOCALS = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
HTDEMUCS_FT = "htdemucs_ft.yaml"
HTDEMUCS_FT_SIGS = ("f7e0c4bc", "d12395a8", "92cfc3b6", "04573f0d")


@dataclass(frozen=True)
class ModelSpec:
    id: str
    purpose: str
    backend: str  # audio-separator | beat_this
    filename: str
    size_mb: float  # measured download size (see docs/spikes/forge.md)
    license: str
    source: str

    def files(self) -> list[Path]:
        if self.backend == "beat_this":
            return [torch_home() / "hub" / "checkpoints" / "beat_this-final0.ckpt"]
        d = separator_models_dir()
        if self.filename == HTDEMUCS_FT:
            return [d / HTDEMUCS_FT, *[_sig_file(d, s) for s in HTDEMUCS_FT_SIGS]]
        return [d / self.filename, d / self.filename.replace(".ckpt", ".yaml")]

    def present(self) -> bool:
        return all(p.exists() for p in self.files())

    def download_command(self) -> str:
        return f"uv run --project tools/forge forge models download {self.id}"


def _sig_file(d: Path, sig: str) -> Path:
    matches = sorted(d.glob(f"{sig}-*.th")) if d.exists() else []
    return matches[0] if matches else d / f"{sig}-*.th"


MODELS: tuple[ModelSpec, ...] = (
    ModelSpec(
        "roformer-vocals",
        "vocals (config A, stage 1)",
        "audio-separator",
        ROFORMER_VOCALS,
        639.3,
        "no license stated by the uploader (UVR community model): treat as personal use only",
        "GitHub release TRvlvr/model_repo (via audio-separator)",
    ),
    ModelSpec(
        "htdemucs_ft",
        "drums/bass/other (config A stage 2; config B)",
        "audio-separator",
        HTDEMUCS_FT,
        336.6,
        "MIT (Demucs repository license; weights published by Meta with the code)",
        "4 checkpoints + yaml, fetched by audio-separator (GitHub release mirror)",
    ),
    ModelSpec(
        "beat_this-final0",
        "beats + downbeats",
        "beat_this",
        "final0",
        0.0,
        "MIT (beat_this repository); trained on public beat datasets",
        "cloud.cp.jku.at (CPJKU Nextcloud), cached in TORCH_HOME",
    ),
)
MODELS_BY_ID = {m.id: m for m in MODELS}


def download(model_id: str) -> list[Path]:
    """Fetch one model's files into ``~/.stemdeck/models``. Needs the ``separation`` extra."""
    spec = MODELS_BY_ID[model_id]
    apply_model_env()
    if spec.backend == "beat_this":
        from beat_this.inference import load_checkpoint

        load_checkpoint("final0", device="cpu")
        return spec.files()
    from audio_separator.separator import Separator

    d = separator_models_dir()
    d.mkdir(parents=True, exist_ok=True)
    sep = Separator(model_file_dir=str(d), output_dir=str(d / "_unused"), info_only=True)
    sep.download_model_files(spec.filename)
    return spec.files()


def describe(spec: ModelSpec) -> str:
    missing = [p.name for p in spec.files() if not p.exists()]
    if not missing:
        return "present"
    return "missing: " + ", ".join(re.sub(r"\*", "…", m) for m in missing)
