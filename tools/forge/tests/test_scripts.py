"""Static checks of the laptop setup script (it is never executed in tests)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

SETUP = Path(__file__).resolve().parents[1] / "scripts" / "setup-wsl.sh"


def test_setup_script_parses() -> None:
    proc = subprocess.run(["bash", "-n", str(SETUP)], capture_output=True, text=True, check=False)
    assert proc.returncode == 0, proc.stderr


def test_every_sudo_step_is_confirmed_first() -> None:
    lines = SETUP.read_text().splitlines()
    sudo_lines = [i for i, line in enumerate(lines) if re.match(r"\s*sudo ", line)]
    assert sudo_lines, "expected the apt step"
    for i in sudo_lines:
        before = "\n".join(lines[max(0, i - 6) : i])
        assert "confirm " in before, f"sudo on line {i + 1} is not preceded by a confirm prompt"
    text = SETUP.read_text()
    assert "--yes" in text and "ASSUME_YES" in text


def test_setup_script_stays_in_allowed_locations() -> None:
    text = SETUP.read_text()
    for var in ("UV_INSTALL_DIR", "UV_PYTHON_INSTALL_DIR", "UV_CACHE_DIR"):
        assert re.search(rf'export {var}="\$STEMDECK_HOME/', text), var
    assert "UV_NO_MODIFY_PATH=1" in text  # never edits ~/.bashrc itself
    assert ">>" not in text.replace("<<", "")  # no appending to dotfiles
    assert "uv sync --project" in text and "--extra separation" in text
    assert "nvidia-smi" in text and "forge doctor" in text
