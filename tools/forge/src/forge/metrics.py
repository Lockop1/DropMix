"""Evaluation metrics: beat/downbeat F-measure and source-separation SDR."""

from __future__ import annotations

import numpy as np


def f_measure(reference: np.ndarray, estimated: np.ndarray, tolerance: float = 0.07) -> float:
    """Beat-tracking F-measure (as in mir_eval.beat.f_measure): one-to-one matches within
    ``±tolerance`` seconds. Greedy nearest matching is exact here because beats are spaced
    much further apart than ``2 * tolerance``."""
    ref = np.sort(np.asarray(reference, dtype=float))
    est = np.sort(np.asarray(estimated, dtype=float))
    if len(ref) == 0 and len(est) == 0:
        return 1.0
    if len(ref) == 0 or len(est) == 0:
        return 0.0
    used = np.zeros(len(est), dtype=bool)
    hits = 0
    for r in ref:
        d = np.abs(est - r)
        d[used] = np.inf
        j = int(np.argmin(d))
        if d[j] <= tolerance:
            used[j] = True
            hits += 1
    precision = hits / len(est)
    recall = hits / len(ref)
    return 0.0 if hits == 0 else 2 * precision * recall / (precision + recall)


def sdr(reference: np.ndarray, estimate: np.ndarray, eps: float = 1e-10) -> float:
    """Signal-to-distortion ratio in dB, the global "new SDR" of the MDX/MUSDB challenges:
    ``10 log10(sum(s^2) / sum((s - s_hat)^2))``. Inputs are (samples,) or (samples, channels);
    the longer one is trimmed. Returns +inf-ish (capped at 100 dB) for a perfect estimate."""
    s = np.asarray(reference, dtype=np.float64)
    e = np.asarray(estimate, dtype=np.float64)
    if s.ndim == 1:
        s = s[:, None]
    if e.ndim == 1:
        e = e[:, None]
    if s.shape[1] != e.shape[1]:
        if e.shape[1] == 1:
            e = np.repeat(e, s.shape[1], axis=1)
        elif s.shape[1] == 1:
            s = np.repeat(s, e.shape[1], axis=1)
        else:
            raise ValueError(f"channel mismatch: {s.shape} vs {e.shape}")
    n = min(len(s), len(e))
    s, e = s[:n], e[:n]
    num = float(np.sum(s**2)) + eps
    den = float(np.sum((s - e) ** 2)) + eps
    return float(min(100.0, 10.0 * np.log10(num / den)))
