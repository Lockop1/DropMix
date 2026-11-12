from __future__ import annotations

import numpy as np
import pytest

from forge.metrics import f_measure, sdr


def test_f_measure_perfect_and_empty() -> None:
    ref = np.arange(10) * 0.5
    assert f_measure(ref, ref) == 1.0
    assert f_measure(ref, np.array([])) == 0.0
    assert f_measure(np.array([]), np.array([])) == 1.0


def test_f_measure_tolerance_and_one_to_one() -> None:
    ref = np.arange(10) * 0.5
    assert f_measure(ref, ref + 0.069) == 1.0
    assert f_measure(ref, ref + 0.071) == 0.0
    # Two estimates near one reference count once: P = 10/11, R = 1.
    est = np.sort(np.r_[ref, 0.01])
    assert f_measure(ref, est) == pytest.approx(2 * (10 / 11) / (10 / 11 + 1))
    # Half the beats missing: P = 1, R = 0.5.
    assert f_measure(ref, ref[::2]) == pytest.approx(2 / 3)


def test_sdr_known_snr() -> None:
    rng = np.random.default_rng(0)
    s = np.sin(2 * np.pi * 220 * np.arange(44100 * 4) / 44100)[:, None].repeat(2, axis=1)
    noise = rng.standard_normal(s.shape)
    noise *= np.sqrt(np.sum(s**2) / np.sum(noise**2)) * 10 ** (-20 / 20)
    assert sdr(s, s + noise) == pytest.approx(20.0, abs=0.01)
    assert sdr(s, 0.5 * s) == pytest.approx(10 * np.log10(4), abs=1e-6)
    assert sdr(s, s) == 100.0
    assert sdr(s, np.zeros_like(s)) == pytest.approx(0.0, abs=1e-6)


def test_sdr_trims_length_and_broadcasts_mono() -> None:
    s = np.ones((1000, 2))
    est = np.ones(1200) * 0.9
    assert sdr(s, est) == pytest.approx(20.0, abs=1e-6)
    with pytest.raises(ValueError):
        sdr(np.ones((10, 2)), np.ones((10, 3)))
