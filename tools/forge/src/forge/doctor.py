"""``forge doctor``: is this machine ready to run Forge?

Exit status is non-zero only when a REQUIRED check fails (Python 3.11, ffmpeg, core imports).
GPU, disk space, model weights and optional extras are warnings or information.
"""

from __future__ import annotations

import importlib
import importlib.metadata as md
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from . import __version__
from .models import MODELS, describe
from .paths import library_dir, separator_models_dir, stemdeck_home

OK, WARN, FAIL, INFO = "ok", "warn", "fail", "info"
MIN_FREE_GB = 15.0

# (import name, distribution name)
CORE_DEPS = [
    ("typer", "typer"),
    ("numpy", "numpy"),
    ("scipy", "scipy"),
    ("soundfile", "soundfile"),
    ("librosa", "librosa"),
    ("mutagen", "mutagen"),
    ("pyloudnorm", "pyloudnorm"),
    ("pyrubberband", "pyrubberband"),
    ("fastapi", "fastapi"),
]
OPTIONAL_DEPS = [
    ("analysis", "essentia", "essentia"),
    ("analysis", "madmom", "madmom"),
    ("separation", "torch", "torch"),
    ("separation", "audio_separator", "audio-separator"),
    ("separation", "beat_this", "beat-this"),
    ("separation", "onnxruntime", "onnxruntime"),
    ("sections (not offered: see docs/spikes/forge.md)", "allin1", "allin1"),
    ("sections (not offered: see docs/spikes/forge.md)", "natten", "natten"),
]
EXTRA_HINT = {
    "analysis": "uv sync --project tools/forge --extra analysis",
    "separation": "uv sync --project tools/forge --extra analysis --extra separation",
}


@dataclass
class Check:
    id: str
    group: str
    name: str
    status: str
    required: bool
    detail: str
    hint: str = ""


def _run(cmd: list[str], timeout: float = 15.0) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, str(exc)


def check_python() -> Check:
    v = sys.version_info
    ok = (v.major, v.minor) == (3, 11)
    return Check(
        "python",
        "system",
        "Python 3.11",
        OK if ok else FAIL,
        True,
        f"{platform.python_version()} ({sys.executable})",
        "" if ok else "Forge needs Python 3.11.x: run tools/forge/scripts/setup-wsl.sh",
    )


def check_ffmpeg() -> Check:
    exe = shutil.which("ffmpeg")
    if not exe:
        return Check(
            "ffmpeg", "system", "ffmpeg", FAIL, True, "not found on PATH", "sudo apt-get install ffmpeg"
        )
    rc, out = _run([exe, "-hide_banner", "-version"])
    m = re.search(r"ffmpeg version (\S+)", out)
    if rc != 0 or not m:
        return Check(
            "ffmpeg", "system", "ffmpeg", FAIL, True, f"{exe} did not run: {out[:200]}", "reinstall ffmpeg"
        )
    return Check("ffmpeg", "system", "ffmpeg", OK, True, f"{m.group(1)} ({exe})")


def check_rubberband() -> Check:
    exe = shutil.which("rubberband")
    if not exe:
        return Check(
            "rubberband",
            "system",
            "rubberband CLI (grid-warp, Phase 2)",
            WARN,
            False,
            "not found on PATH",
            "sudo apt-get install rubberband-cli",
        )
    rc, out = _run([exe, "--version"])
    return Check(
        "rubberband",
        "system",
        "rubberband CLI (grid-warp, Phase 2)",
        OK,
        False,
        (out.splitlines() or ["?"])[-1] if rc == 0 else f"{exe} (version unknown)",
    )


def check_gpu() -> list[Check]:
    checks = []
    exe = shutil.which("nvidia-smi") or (
        "/usr/lib/wsl/lib/nvidia-smi" if Path("/usr/lib/wsl/lib/nvidia-smi").exists() else None
    )
    hint = (
        "CPU only: separation will be slow. WSL2: install the current NVIDIA Windows driver (no Linux "
        "driver inside WSL), then `wsl --update` and `wsl --shutdown` in PowerShell"
    )
    if not exe:
        checks.append(
            Check("gpu", "gpu", "NVIDIA GPU (nvidia-smi)", WARN, False, "nvidia-smi not found", hint)
        )
    else:
        rc, out = _run([exe, "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"])
        if rc != 0:
            checks.append(
                Check(
                    "gpu",
                    "gpu",
                    "NVIDIA GPU (nvidia-smi)",
                    WARN,
                    False,
                    f"nvidia-smi failed: {out[:200]}",
                    hint,
                )
            )
        else:
            _, full = _run([exe])
            cuda = re.search(r"CUDA Version:\s*([\d.]+)", full)
            checks.append(
                Check(
                    "gpu",
                    "gpu",
                    "NVIDIA GPU (nvidia-smi)",
                    OK,
                    False,
                    f"{out.splitlines()[0]}; driver CUDA {cuda.group(1) if cuda else '?'}",
                )
            )
    try:
        dist = md.version("torch")
    except md.PackageNotFoundError:
        checks.append(
            Check(
                "torch_cuda",
                "gpu",
                "torch CUDA",
                INFO,
                False,
                "torch not installed (separation extra)",
                EXTRA_HINT["separation"],
            )
        )
        return checks
    try:
        torch = importlib.import_module("torch")
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            checks.append(
                Check(
                    "torch_cuda",
                    "gpu",
                    "torch CUDA",
                    OK,
                    False,
                    f"torch {dist}, CUDA {torch.version.cuda}, device {name}",
                )
            )
        else:
            checks.append(
                Check(
                    "torch_cuda",
                    "gpu",
                    "torch CUDA",
                    WARN,
                    False,
                    f"torch {dist} (CUDA build {torch.version.cuda}) sees no GPU: CPU only",
                    hint,
                )
            )
    except Exception as exc:
        checks.append(
            Check(
                "torch_cuda",
                "gpu",
                "torch CUDA",
                WARN,
                False,
                f"torch {dist} failed to import: {exc}",
                "reinstall the separation extra",
            )
        )
    return checks


def check_disk() -> Check:
    home = stemdeck_home()
    probe = home
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    free_gb = shutil.disk_usage(probe).free / 1e9
    status = OK if free_gb >= MIN_FREE_GB else WARN
    return Check(
        "disk",
        "system",
        f"free disk under {home}",
        status,
        False,
        f"{free_gb:.1f} GB free (checked at {probe})",
        "" if status == OK else f"Forge needs about {MIN_FREE_GB:.0f} GB for models, stems and caches",
    )


def _version(dist: str, module: object) -> str:
    try:
        return md.version(dist)
    except md.PackageNotFoundError:
        return str(getattr(module, "__version__", "?"))


def check_core_deps() -> list[Check]:
    out = []
    for mod, dist in CORE_DEPS:
        try:
            m = importlib.import_module(mod)
            detail = _version(dist, m)
            if mod == "soundfile":
                detail += f" (libsndfile {getattr(m, '__libsndfile_version__', '?')})"
            out.append(Check(f"dep:{dist}", "core", dist, OK, True, detail))
        except Exception as exc:
            out.append(
                Check(
                    f"dep:{dist}",
                    "core",
                    dist,
                    FAIL,
                    True,
                    f"import failed: {type(exc).__name__}: {exc}",
                    "uv sync --project tools/forge",
                )
            )
    return out


def check_optional_deps() -> list[Check]:
    out = []
    for extra, mod, dist in OPTIONAL_DEPS:
        try:
            md.version(dist)
        except md.PackageNotFoundError:
            out.append(
                Check(f"opt:{dist}", extra, dist, INFO, False, "not installed", EXTRA_HINT.get(extra, ""))
            )
            continue
        try:
            m = importlib.import_module(mod)
            out.append(Check(f"opt:{dist}", extra, dist, OK, False, _version(dist, m)))
        except Exception as exc:
            out.append(
                Check(
                    f"opt:{dist}",
                    extra,
                    dist,
                    WARN,
                    False,
                    f"installed but import failed: {type(exc).__name__}: {str(exc)[:200]}",
                )
            )
    return out


def check_models() -> list[Check]:
    out = []
    for spec in MODELS:
        present = spec.present()
        out.append(
            Check(
                f"model:{spec.id}",
                "models",
                f"{spec.id} ({spec.purpose})",
                OK if present else WARN,
                False,
                describe(spec) + ("" if present else f" in {spec.files()[0].parent}"),
                "" if present else spec.download_command(),
            )
        )
    return out


def run_checks() -> list[Check]:
    checks = [check_python(), check_ffmpeg(), check_rubberband(), check_disk()]
    checks += check_gpu()
    checks += check_core_deps()
    checks += check_optional_deps()
    checks += check_models()
    return checks


def report(checks: list[Check]) -> dict:
    required_ok = all(c.status != FAIL for c in checks if c.required)
    return {
        "forgeVersion": __version__,
        "ok": required_ok,
        "summary": {s: sum(1 for c in checks if c.status == s) for s in (OK, WARN, FAIL, INFO)},
        "platform": {
            "system": platform.platform(),
            "machine": platform.machine(),
            "wsl": "microsoft" in platform.release().lower(),
        },
        "paths": {
            "stemdeckHome": str(stemdeck_home()),
            "separatorModels": str(separator_models_dir()),
            "library": str(library_dir()),
        },
        "checks": [asdict(c) for c in checks],
    }
