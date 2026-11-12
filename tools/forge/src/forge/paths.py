"""Where Forge is allowed to write.

Forge writes only under ``~/.stemdeck/`` (override with ``STEMDECK_HOME``) and the repo's
gitignored ``library/`` folder, plus any ``--out`` path the user passes explicitly.
"""

from __future__ import annotations

import os
from pathlib import Path


def stemdeck_home() -> Path:
    """Forge's private data folder (caches, model weights). Not created here."""
    return Path(os.environ.get("STEMDECK_HOME", "~/.stemdeck")).expanduser()


def models_dir() -> Path:
    return stemdeck_home() / "models"


def separator_models_dir() -> Path:
    """Model cache passed to audio-separator as ``model_file_dir``."""
    return models_dir() / "audio-separator"


def torch_home() -> Path:
    """TORCH_HOME for beat_this checkpoints (torch hub cache)."""
    return models_dir() / "torch"


def hf_home() -> Path:
    """HF_HOME for allin1 weights (Hugging Face cache)."""
    return models_dir() / "huggingface"


def forge_project_dir() -> Path:
    """``tools/forge`` (this file is ``tools/forge/src/forge/paths.py``)."""
    return Path(__file__).resolve().parents[2]


def repo_root() -> Path | None:
    """The monorepo root, if Forge runs from a checkout (editable install)."""
    candidate = forge_project_dir().parents[1]
    if (candidate / "CLAUDE.md").exists() and (candidate / "tools" / "forge").is_dir():
        return candidate
    return None


def library_dir() -> Path:
    """The repo's gitignored ``library/`` folder (falls back to ``~/.stemdeck/library``)."""
    root = repo_root()
    return (root / "library") if root else (stemdeck_home() / "library")


def model_env() -> dict[str, str]:
    """Environment variables that keep third-party model caches inside ``~/.stemdeck``."""
    return {"TORCH_HOME": str(torch_home()), "HF_HOME": str(hf_home())}


def apply_model_env() -> None:
    """Point torch hub / Hugging Face caches into ``~/.stemdeck/models`` unless already set."""
    for key, value in model_env().items():
        os.environ.setdefault(key, value)
