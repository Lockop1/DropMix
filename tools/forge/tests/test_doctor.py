from __future__ import annotations

import json
import shutil
from collections import namedtuple

from typer.testing import CliRunner

from forge import doctor
from forge.cli import app


def by_id(checks):
    return {c.id: c for c in checks}


def test_required_checks_pass_here() -> None:
    checks = by_id(doctor.run_checks())
    assert checks["python"].status == doctor.OK and checks["python"].required
    assert checks["ffmpeg"].status == doctor.OK and checks["ffmpeg"].required
    for _mod, dist in doctor.CORE_DEPS:
        assert checks[f"dep:{dist}"].status == doctor.OK, checks[f"dep:{dist}"]
    # A missing GPU is a warning, never a failure.
    assert checks["gpu"].status in (doctor.OK, doctor.WARN) and not checks["gpu"].required
    if checks["gpu"].status == doctor.WARN:
        assert "CPU only: separation will be slow" in checks["gpu"].hint


def test_cli_exit_zero_and_json(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("STEMDECK_HOME", str(tmp_path / "home"))
    runner = CliRunner()
    res = runner.invoke(app, ["doctor"])
    assert res.exit_code == 0, res.output
    assert "Python 3.11" in res.output and "ffmpeg" in res.output
    res = runner.invoke(app, ["doctor", "--json"])
    assert res.exit_code == 0
    data = json.loads(res.output)
    assert data["ok"] is True
    assert {"id", "group", "name", "status", "required", "detail", "hint"} <= set(data["checks"][0])
    assert not (tmp_path / "home").exists()  # doctor only reads


def test_failing_required_check_exits_non_zero(monkeypatch) -> None:
    real_which = shutil.which
    monkeypatch.setattr(doctor.shutil, "which", lambda name: None if name == "ffmpeg" else real_which(name))
    res = CliRunner().invoke(app, ["doctor", "--json"])
    assert res.exit_code == 1
    data = json.loads(res.output)
    assert data["ok"] is False
    assert by_id([doctor.Check(**c) for c in data["checks"]])["ffmpeg"].status == doctor.FAIL


def test_warnings_do_not_fail(monkeypatch, tmp_path) -> None:
    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(doctor.shutil, "disk_usage", lambda _p: usage(100e9, 95e9, 5e9))
    monkeypatch.setenv("STEMDECK_HOME", str(tmp_path / "nowhere"))
    checks = by_id(doctor.run_checks())
    assert checks["disk"].status == doctor.WARN
    for mid in ("roformer-vocals", "htdemucs_ft", "beat_this-final0"):
        c = checks[f"model:{mid}"]
        assert c.status == doctor.WARN and "missing" in c.detail
        assert c.hint == f"uv run --project tools/forge forge models download {mid}"
    assert doctor.report(list(checks.values()))["ok"] is True


def test_optional_extras_reported_not_installed(monkeypatch) -> None:
    real = doctor.md.version

    def fake_version(dist):
        if dist in ("torch", "audio-separator", "beat-this", "onnxruntime", "allin1", "natten"):
            raise doctor.md.PackageNotFoundError(dist)
        return real(dist)

    monkeypatch.setattr(doctor.md, "version", fake_version)
    checks = by_id(doctor.check_optional_deps())
    for dist in ("torch", "audio-separator", "beat-this", "allin1"):
        assert checks[f"opt:{dist}"].status == doctor.INFO
        assert checks[f"opt:{dist}"].detail == "not installed"
        assert not checks[f"opt:{dist}"].required


def test_model_present_detection(monkeypatch, tmp_path) -> None:
    from forge import models

    monkeypatch.setenv("STEMDECK_HOME", str(tmp_path))
    d = tmp_path / "models" / "audio-separator"
    d.mkdir(parents=True)
    spec = models.MODELS_BY_ID["htdemucs_ft"]
    assert not spec.present()
    (d / "htdemucs_ft.yaml").write_text("models: []\n")
    for sig in models.HTDEMUCS_FT_SIGS:
        (d / f"{sig}-00000000.th").write_bytes(b"")
    assert spec.present()
