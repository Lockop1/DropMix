"""Synthetic test songs with ground-truth stems (docs/BUILD_PROMPT.md §12.1).

Everything here is generated from math with fixed seeds: no samples, no downloaded audio.
Output is byte-identical across runs on the same platform/numpy build.

Per song: four stems (drums, bass, other, vocals) and their exact sum (mix), all 44.1 kHz
stereo 16-bit PCM WAV. ``mix`` is the sample-exact integer sum of the four stems, so
separator SDR can be scored against true references.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import wave
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import signal

SR = 44100
LEAD_IN_S = 0.5  # silence before the first downbeat
TAIL_S = 1.0  # decay room after the last bar
FIXTURES_VERSION = 1
STEMS = ("drums", "bass", "other", "vocals")
MIX_PEAK = 0.89  # about -1 dBFS for the mix; stems share one gain so mix == sum(stems)

KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

# (semitones above tonic, quality, roman numeral)
PROGRESSIONS: dict[str, list[tuple[int, str, str]]] = {
    "major": [(0, "maj", "I"), (7, "maj", "V"), (9, "min", "vi"), (5, "maj", "IV")],
    "minor": [(0, "min", "i"), (8, "maj", "VI"), (3, "maj", "III"), (10, "maj", "VII")],
}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}

# Vowel formants (Hz) after Peterson & Barney, with relative gains and bandwidths.
VOWELS: dict[str, tuple[float, float, float]] = {
    "a": (730.0, 1090.0, 2440.0),
    "e": (530.0, 1840.0, 2480.0),
    "i": (270.0, 2290.0, 3010.0),
    "o": (570.0, 840.0, 2410.0),
    "u": (300.0, 870.0, 2240.0),
}
FORMANT_GAINS = (1.0, 0.5, 0.25)
FORMANT_BW = (90.0, 110.0, 150.0)
# Vocal synth settings: MIDI range, jitter (semitones, control rate Hz), consonant odds
# (P("s"), P("s" or "t")) per syllable. Changing them changes every fixture's bytes.
VOICE: dict = {"range": (60, 77), "jitter": (0.08, 25.0), "consonants": (0.3, 0.6)}


def pcs_index(tonic: int, mode: str) -> int:
    """PCS index = relative-major tonic (docs/BUILD_PROMPT.md §7.1)."""
    return tonic % 12 if mode == "major" else (tonic + 3) % 12


def key_name(tonic: int, mode: str) -> str:
    return f"{KEY_NAMES[tonic % 12]} {mode}"


@dataclass(frozen=True)
class SongSpec:
    song_id: str
    title: str
    bpm: float
    tonic: int
    mode: str
    seed: int
    bars: int = 32
    beats_per_bar: int = 4
    drift_pct: float = 0.0  # peak tempo deviation, percent (slow sinusoidal wobble)
    drift_period_bars: int = 8
    purpose: str = "core"  # core | control | drift | non-4/4

    @property
    def total_beats(self) -> int:
        return self.bars * self.beats_per_bar

    @property
    def pcs(self) -> int:
        return pcs_index(self.tonic, self.mode)


G, E, BB, CS = 7, 4, 10, 1
SONGS: tuple[SongSpec, ...] = (
    SongSpec("g-major-092", "Synthetic G major 92", 92, G, "major", seed=9201),
    SongSpec("e-minor-092", "Synthetic E minor 92", 92, E, "minor", seed=9202),
    SongSpec("g-major-120", "Synthetic G major 120", 120, G, "major", seed=12001),
    SongSpec("e-minor-120", "Synthetic E minor 120", 120, E, "minor", seed=12002),
    SongSpec("g-major-128", "Synthetic G major 128", 128, G, "major", seed=12801),
    SongSpec("e-minor-128", "Synthetic E minor 128", 128, E, "minor", seed=12802),
    SongSpec("g-major-150", "Synthetic G major 150", 150, G, "major", seed=15001),
    SongSpec("e-minor-150", "Synthetic E minor 150", 150, E, "minor", seed=15002),
    # Transposed controls: same progressions in other keys, so a detector that always
    # answers PCS 7 (G major == E minor) cannot pass.
    SongSpec("ctrl-bb-major-128", "Control Bb major 128", 128, BB, "major", seed=12803, purpose="control"),
    SongSpec("ctrl-cs-minor-092", "Control C# minor 92", 92, CS, "minor", seed=9203, purpose="control"),
    # Negative tests.
    SongSpec(
        "drift-g-major-120",
        "Drifting G major 120 (±1%)",
        120,
        G,
        "major",
        seed=12009,
        drift_pct=1.0,
        drift_period_bars=8,
        purpose="drift",
    ),
    SongSpec(
        "waltz-e-minor-120",
        "Waltz E minor 120 (3/4)",
        120,
        E,
        "minor",
        seed=12010,
        beats_per_bar=3,
        purpose="non-4/4",
    ),
)
SONGS_BY_ID = {s.song_id: s for s in SONGS}


# --------------------------------------------------------------------------- timing


def beat_time(spec: SongSpec, b: float | np.ndarray) -> np.ndarray:
    """Seconds at (fractional) beat ``b``. With drift, the local beat period is
    ``T * (1 + a * sin(2*pi*b/P))``, integrated in closed form."""
    period = 60.0 / spec.bpm
    b = np.asarray(b, dtype=np.float64)
    if spec.drift_pct == 0.0:
        return LEAD_IN_S + period * b
    a = spec.drift_pct / 100.0
    p = float(spec.drift_period_bars * spec.beats_per_bar)
    return LEAD_IN_S + period * (b + a * p / (2 * math.pi) * (1.0 - np.cos(2 * math.pi * b / p)))


def sample_count(spec: SongSpec) -> int:
    return round((float(beat_time(spec, spec.total_beats)) + TAIL_S) * SR)


# --------------------------------------------------------------------------- synthesis


def midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def in_range(pc: int, low: int) -> int:
    """MIDI note of pitch class ``pc`` in ``[low, low + 12)``."""
    return low + ((pc - low) % 12)


def chord_for_bar(spec: SongSpec, bar: int) -> dict:
    offset, quality, roman = PROGRESSIONS[spec.mode][bar % 4]
    root = (spec.tonic + offset) % 12
    third = 4 if quality == "maj" else 3
    pcs = [root, (root + third) % 12, (root + 7) % 12]
    name = KEY_NAMES[root] + ("" if quality == "maj" else "m")
    return {"bar": bar, "name": name, "roman": roman, "root": root, "quality": quality, "pitchClasses": pcs}


def additive(freq: np.ndarray | float, n: int, harmonics: Iterable[tuple[int, float]]) -> np.ndarray:
    """Band-limited additive oscillator. ``freq`` may be a per-sample array (vibrato)."""
    if np.isscalar(freq):
        phase = 2 * np.pi * float(freq) * np.arange(n) / SR
        f_max = float(freq)
    else:
        f = np.asarray(freq, dtype=np.float64)
        phase = 2 * np.pi * np.cumsum(f) / SR
        f_max = float(f.max())
    out = np.zeros(n)
    for k, amp in harmonics:
        if k * f_max < 0.45 * SR:
            out += amp * np.sin(k * phase)
    return out


def env_ar(n: int, attack_s: float, release_s: float, decay_tau: float | None = None) -> np.ndarray:
    """Attack / (optional exponential decay) / release envelope over ``n`` samples."""
    t = np.arange(n) / SR
    env = np.ones(n)
    if decay_tau:
        env *= np.exp(-t / decay_tau)
    a = max(1, round(attack_s * SR))
    r = max(1, round(release_s * SR))
    env[: min(a, n)] *= np.linspace(0.0, 1.0, min(a, n), endpoint=False)
    if r < n:
        env[n - r :] *= np.linspace(1.0, 0.0, r)
    return env


class Track:
    def __init__(self, n: int) -> None:
        self.buf = np.zeros((n, 2))
        self.n = n

    def add(self, start_s: float, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0) -> None:
        i0 = round(start_s * SR)
        if i0 >= self.n:
            return
        seg = sig[: self.n - i0]
        # Constant-power pan normalised so pan=0 gives unity on both channels.
        angle = (pan + 1.0) * math.pi / 4.0
        gl, gr = math.cos(angle) * math.sqrt(2.0), math.sin(angle) * math.sqrt(2.0)
        self.buf[i0 : i0 + len(seg), 0] += gain * gl * seg
        self.buf[i0 : i0 + len(seg), 1] += gain * gr * seg


class Synth:
    """Instrument voices for one song (owns the song's seeded RNG)."""

    def __init__(self, seed: int) -> None:
        self.rng = np.random.default_rng(seed)
        self.sos_snare = signal.butter(2, [1200, 7000], btype="bandpass", fs=SR, output="sos")
        self.sos_hat = signal.butter(4, 7000, btype="highpass", fs=SR, output="sos")
        self.sos_crash = signal.butter(2, 3500, btype="highpass", fs=SR, output="sos")
        self.sos_breath = signal.butter(2, 1500, btype="highpass", fs=SR, output="sos")
        self.sos_fric = signal.butter(2, [3500, 9000], btype="bandpass", fs=SR, output="sos")

    def noise(self, n: int) -> np.ndarray:
        return self.rng.standard_normal(n)

    def kick(self) -> np.ndarray:
        n = round(0.35 * SR)
        t = np.arange(n) / SR
        f = 48.0 + 120.0 * np.exp(-t / 0.035)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)
        click = self.noise(n) * np.exp(-t / 0.002) * 0.3
        return (body + click) * env_ar(n, 0.0005, 0.01)

    def snare(self) -> np.ndarray:
        n = round(0.22 * SR)
        t = np.arange(n) / SR
        rattle = signal.sosfilt(self.sos_snare, self.noise(n)) * np.exp(-t / 0.055)
        tone = np.sin(2 * np.pi * 185.0 * t) * np.exp(-t / 0.035) * 0.6
        return (rattle * 1.6 + tone) * env_ar(n, 0.0005, 0.01)

    def hat(self) -> np.ndarray:
        n = round(0.07 * SR)
        t = np.arange(n) / SR
        return signal.sosfilt(self.sos_hat, self.noise(n)) * np.exp(-t / 0.014) * env_ar(n, 0.0003, 0.005)

    def crash(self) -> np.ndarray:
        n = round(1.4 * SR)
        t = np.arange(n) / SR
        return signal.sosfilt(self.sos_crash, self.noise(n)) * np.exp(-t / 0.4) * env_ar(n, 0.001, 0.05)

    @staticmethod
    def bass_note(midi: int, dur_s: float) -> np.ndarray:
        n = max(1, round(dur_s * SR))
        harm = [(k, 1.0 / k) for k in range(1, 9)]
        return additive(midi_hz(midi), n, harm) * env_ar(n, 0.004, 0.015, decay_tau=0.35)

    @staticmethod
    def pad_note(midi: int, dur_s: float) -> np.ndarray:
        n = max(1, round(dur_s * SR))
        f = midi_hz(midi)
        harm = [(k, 1.0 / k**1.3) for k in range(1, 6)]
        sig = additive(f, n, harm) + additive(f * 1.0035, n, harm)
        return sig * 0.5 * env_ar(n, 0.08, 0.12)

    @staticmethod
    def pluck(midi: int, dur_s: float) -> np.ndarray:
        n = max(1, round(dur_s * SR))
        harm = [(k, 1.0 / k**1.5) for k in range(1, 5)]
        return additive(midi_hz(midi), n, harm) * env_ar(n, 0.002, 0.02, decay_tau=0.16)

    def slow_noise(self, n: int, rate_hz: float) -> np.ndarray:
        """Smooth random contour (unit variance-ish), ``rate_hz`` control points per second."""
        k = max(2, int(n / SR * rate_hz) + 2)
        pts = self.rng.standard_normal(k)
        return np.interp(np.arange(n), np.linspace(0, n - 1, k), pts)

    def sing_phrase(self, notes: list[tuple[float, float, int, str, str]]) -> tuple[float, np.ndarray]:
        """Formant synth for one legato phrase.

        Source: band-limited glottal-pulse spectrum (~1/k after lip radiation) on a continuous
        f0 contour with portamento, delayed vibrato, jitter and shimmer, plus breath noise
        gated by the glottal cycle. Filter: 3 parallel vowel-formant band-passes whose centre
        frequencies glide between the notes' vowels. Optional fricative onsets ("s"/"sh").
        ``notes`` = (start_s, end_s, midi, vowel, consonant). Returns (start_s, signal)."""
        t0 = notes[0][0] - 0.06
        t1 = notes[-1][1] + 0.15
        n = round((t1 - t0) * SR)
        idx = np.arange(n)
        # Pitch: stepwise targets smoothed by a ~35 ms one-pole glide, starting with a scoop.
        target = np.full(n, float(notes[0][2]) - 1.0)
        since = np.zeros(n)
        vowel_at = np.full(n, notes[0][3], dtype=object)
        amp = np.zeros(n)
        for s, e, m, v, _ in notes:
            a, b = round((s - t0) * SR), round((e - t0) * SR)
            target[a:] = m
            since[a:] = (idx[a:] - a) / SR
            vowel_at[a:] = v
            env = np.ones(b - a)
            dip = min(len(env), round(0.03 * SR))
            env[:dip] = np.linspace(0.55, 1.0, dip)  # re-articulation between legato notes
            amp[a:b] = env
        release = round(0.12 * SR)
        end = round((notes[-1][1] - t0) * SR)
        amp[end : end + release] = np.linspace(1.0, 0.0, min(release, n - end))
        attack = round(0.05 * SR)
        a0 = round(0.06 * SR)
        amp[a0 : a0 + attack] *= np.linspace(0.0, 1.0, attack)
        midi = signal.lfilter(
            [1 - np.exp(-1 / (0.035 * SR))],
            [1, -np.exp(-1 / (0.035 * SR))],
            target,
            zi=[target[0] * np.exp(-1 / (0.035 * SR))],
        )[0]
        vib = (
            np.clip((since - 0.18) / 0.25, 0.0, 1.0)
            * 0.45
            * np.sin(2 * np.pi * np.cumsum(5.3 + 0.4 * self.slow_noise(n, 2.0)) / SR)
        )
        jitter = VOICE["jitter"][0] * self.slow_noise(n, VOICE["jitter"][1])  # semitones
        f0 = 440.0 * 2.0 ** ((midi + vib + jitter - 69.0) / 12.0)
        phase = 2 * np.pi * np.cumsum(f0) / SR
        source = np.zeros(n)
        for k in range(1, int(7000.0 / f0.min()) + 1):
            alive = k * f0 < 0.45 * SR
            source += np.where(alive, np.sin(k * phase) / k, 0.0)
        breath = signal.sosfilt(self.sos_breath, self.noise(n)) * 0.06 * (0.6 + 0.4 * np.cos(phase))
        shimmer = 1.0 + 0.06 * self.slow_noise(n, 12.0)
        excitation = (source + breath) * amp * shimmer
        # Time-varying formants: block-wise biquads, centres glide (~60 ms) between vowels.
        block = 256
        n_blocks = (n + block - 1) // block
        centres = np.array([VOWELS[vowel_at[min(i * block, n - 1)]] for i in range(n_blocks)])
        glide = np.exp(-block / (0.06 * SR))
        centres = signal.lfilter([1 - glide], [1, -glide], centres, axis=0, zi=centres[:1] * glide)[0]
        segs = [slice(i * block, min(n, (i + 1) * block)) for i in range(n_blocks)]
        out = np.zeros(n)
        for j, (gain, bw) in enumerate(zip(FORMANT_GAINS, FORMANT_BW, strict=True)):
            zi = np.zeros(2)
            for i, seg in enumerate(segs):
                b, a = signal.iirpeak(centres[i, j], centres[i, j] / bw, fs=SR)
                y, zi = signal.lfilter(b, a, excitation[seg], zi=zi)
                out[seg] += gain * y
        # Consonant onsets: "s" = fricative hiss over a voicing gap; "t" = closure then burst.
        for s, _e, _m, _v, consonant in notes:
            on = round((s - t0) * SR)
            if consonant == "s":
                length = round(0.07 * SR)
                seg = slice(max(0, on - length // 2), min(n, on + length // 2))
                hiss = signal.sosfilt(self.sos_fric, self.noise(seg.stop - seg.start))
                win = np.hanning(seg.stop - seg.start)
                out[seg] = out[seg] * (1 - 0.85 * win) + hiss * win * 0.5
            elif consonant == "t":
                closure = round(0.035 * SR)
                seg = slice(max(0, on - closure), on)
                out[seg] *= np.linspace(1.0, 0.05, seg.stop - seg.start)
                burst_n = round(0.012 * SR)
                burst = signal.sosfilt(self.sos_fric, self.noise(burst_n)) * np.exp(
                    -np.arange(burst_n) / (0.004 * SR)
                )
                out[on : on + burst_n] += burst[: max(0, min(burst_n, n - on))] * 0.6
        return t0, out


# --------------------------------------------------------------------------- arrangement


def phrase_starts(spec: SongSpec) -> list[int]:
    """Vocal phrases: 4 bars each, always starting on a 4-bar boundary."""
    return [p for p in (8, 12, 20, 24, 28) if p + 4 <= spec.bars]


def render_song(spec: SongSpec) -> tuple[dict[str, np.ndarray], dict]:
    """Render float stems (n, 2) and the ground-truth record for one song."""
    n = sample_count(spec)
    syn = Synth(spec.seed)
    bpb = spec.beats_per_bar
    tracks = {s: Track(n) for s in STEMS}
    active: dict[str, set[int]] = {s: set() for s in STEMS}

    def t(b: float) -> float:
        return float(beat_time(spec, b))

    chords = [chord_for_bar(spec, bar) for bar in range(spec.bars)]
    kick, snare, hat, crash = syn.kick, syn.snare, syn.hat, syn.crash

    # ---- drums: accented downbeat, crash on phrase starts
    for bar in range(spec.bars):
        b0 = bar * bpb
        active["drums"].add(bar)
        if bar % 4 == 0:
            tracks["drums"].add(t(b0), crash(), gain=0.3, pan=-0.2)
        if bpb == 4:
            tracks["drums"].add(t(b0), kick(), gain=1.0)
            tracks["drums"].add(t(b0 + 2), kick(), gain=0.7)
            tracks["drums"].add(t(b0 + 1), snare(), gain=0.55)
            tracks["drums"].add(t(b0 + 3), snare(), gain=0.55)
            for e in range(8):
                tracks["drums"].add(t(b0 + e / 2), hat(), gain=0.16 if e % 2 == 0 else 0.11, pan=0.3)
        else:  # 3/4 "oom-pah-pah"
            tracks["drums"].add(t(b0), kick(), gain=1.0)
            tracks["drums"].add(t(b0 + 1), snare(), gain=0.35)
            tracks["drums"].add(t(b0 + 2), snare(), gain=0.35)
            for e in range(6):
                tracks["drums"].add(t(b0 + e / 2), hat(), gain=0.14 if e % 2 == 0 else 0.09, pan=0.3)

    # ---- bass: follows chord roots from bar 4
    for bar in range(4, spec.bars):
        b0 = bar * bpb
        ch = chords[bar]
        root = in_range(ch["root"], 36)
        fifth = root + 7
        active["bass"].add(bar)
        if bpb == 4:
            for e in range(8):
                note = root if e not in (5, 7) else (fifth if e == 5 else root + 12)
                dur = t(b0 + (e + 1) / 2) - t(b0 + e / 2) - 0.012
                tracks["bass"].add(t(b0 + e / 2), syn.bass_note(note, dur), gain=0.5 if e % 2 == 0 else 0.38)
        else:
            tracks["bass"].add(t(b0), syn.bass_note(root, t(b0 + 1) - t(b0) - 0.012), gain=0.55)
            for k in (1, 2):
                dur = t(b0 + k + 1) - t(b0 + k) - 0.012
                tracks["bass"].add(t(b0 + k), syn.bass_note(fifth, dur), gain=0.35)

    # ---- other: chord pads every bar + arpeggio from bar 8
    for bar in range(spec.bars):
        b0 = bar * bpb
        ch = chords[bar]
        active["other"].add(bar)
        dur = t(b0 + bpb) - t(b0)
        for pc in ch["pitchClasses"]:
            tracks["other"].add(t(b0), syn.pad_note(in_range(pc, 55), dur), gain=0.17)
        if bar >= 8:
            tones = sorted(in_range(pc, 67) for pc in ch["pitchClasses"])
            pattern = [0, 1, 2, 1] if bpb == 4 else [0, 1, 2]
            for e in range(bpb * 2):
                note = tones[pattern[e % len(pattern)]] + (12 if e % 4 == 2 and bpb == 4 else 0)
                d = t(b0 + (e + 1) / 2) - t(b0 + e / 2)
                tracks["other"].add(t(b0 + e / 2), syn.pluck(note, d * 1.6), gain=0.14, pan=0.35 * (-1) ** e)

    # ---- vocals: in-key melody, phrases on 4-bar boundaries
    scale = [(spec.tonic + iv) % 12 for iv in SCALES[spec.mode]]
    scale_notes = sorted(m for m in range(*VOICE["range"]) if m % 12 in scale)
    vowels = list(VOWELS)
    prev = in_range(spec.tonic, VOICE["range"][0] + 2)
    for p in phrase_starts(spec):
        phrase: list[tuple[float, float, int, str, str]] = []
        for bar in range(p, p + 4):
            active["vocals"].add(bar)
            ch = chords[bar]
            chord_notes = [m for m in scale_notes if m % 12 in ch["pitchClasses"]]
            b0 = bar * bpb
            last_bar = bar == p + 3
            beats = [0] if last_bar else list(range(bpb))
            for k in beats:
                strong = k == 0 or (bpb == 4 and k == 2)
                pool = chord_notes if strong else scale_notes
                near = [m for m in pool if abs(m - prev) <= 4] or pool
                note = int(near[int(syn.rng.integers(len(near)))])
                if last_bar:  # phrase ends on a held chord tone
                    note = min(chord_notes, key=lambda m: abs(m - prev))
                length = 2 if last_bar else 1
                # Two syllables per sung beat (speech-like ~4-6 syllables/s), each with its own
                # vowel and often a consonant onset; the held phrase end is one syllable.
                halves = [(0.0, float(length))] if last_bar else [(0.0, 0.5), (0.5, 1.0)]
                for h0, h1 in halves:
                    vowel = vowels[int(syn.rng.integers(len(vowels)))]
                    c = syn.rng.random()
                    p_s, p_t = VOICE["consonants"]
                    consonant = ("s" if c < p_s else "t" if c < p_t else "") if phrase else ""
                    phrase.append((t(b0 + k + h0), t(b0 + k + h1) - 0.02, note, vowel, consonant))
                prev = note
        start, sung = syn.sing_phrase(phrase)
        tracks["vocals"].add(start, sung, gain=0.75)

    stems = {s: tracks[s].buf for s in STEMS}
    beats = beat_time(spec, np.arange(spec.total_beats))
    downbeats = beats[::bpb]
    gt = {
        "songId": spec.song_id,
        "title": spec.title,
        "purpose": spec.purpose,
        "bpm": float(spec.bpm),
        "timeSignature": [bpb, 4],
        "beatsPerBar": bpb,
        "key": {
            "tonic": spec.tonic,
            "mode": spec.mode,
            "pcs": spec.pcs,
            "name": key_name(spec.tonic, spec.mode),
        },
        "tempoDriftPct": spec.drift_pct,
        "leadInSeconds": LEAD_IN_S,
        "barCount": spec.bars,
        "beatCount": spec.total_beats,
        "beats": [float(x) for x in beats],
        "beatSamples": [round(float(x) * SR) for x in beats],
        "downbeats": [float(x) for x in downbeats],
        "downbeatSamples": [round(float(x) * SR) for x in downbeats],
        "chords": chords,
        "activeBars": {s: sorted(active[s]) for s in STEMS},
        "vocalPhraseStartBars": phrase_starts(spec),
        "sampleRate": SR,
        "sampleCount": n,
        "channels": 2,
        "bitDepth": 16,
        "seed": spec.seed,
        "files": {name: f"{spec.song_id}/{name}.wav" for name in ("mix", *STEMS)},
    }
    return stems, gt


def quantize(stems: dict[str, np.ndarray]) -> tuple[dict[str, np.ndarray], np.ndarray]:
    """One shared gain for all stems (mix peak -1 dBFS), 16-bit stems, mix = exact int sum."""
    mix_f = sum(stems.values())
    peak = float(np.max(np.abs(mix_f)))
    g = MIX_PEAK / peak if peak > 0 else 1.0
    q = {s: np.round(x * g * 32767.0).astype(np.int32) for s, x in stems.items()}
    mix = sum(q.values())
    if np.max(np.abs(mix)) > 32767 or any(np.max(np.abs(v)) > 32767 for v in q.values()):
        raise RuntimeError("fixture clipped; lower MIX_PEAK")
    return {s: v.astype(np.int16) for s, v in q.items()}, mix.astype(np.int16)


def write_wav(path: Path, data: np.ndarray) -> None:
    """Deterministic 16-bit PCM WAV (stdlib ``wave``: no timestamps, no extra chunks)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(data.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.ascontiguousarray(data, dtype="<i2").tobytes())


def read_wav_int16(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        ch = w.getnchannels()
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").reshape(-1, ch)


def to_flac(wav: Path) -> Path:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("--flac needs ffmpeg on PATH")
    out = wav.with_suffix(".flac")
    subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-y",
            "-i",
            str(wav),
            "-map_metadata",
            "-1",
            "-fflags",
            "+bitexact",
            "-flags:a",
            "+bitexact",
            "-c:a",
            "flac",
            str(out),
        ],
        check=True,
    )
    return out


def generate_song(spec: SongSpec, out_dir: Path, flac: bool = False) -> dict:
    stems_f, gt = render_song(spec)
    stems, mix = quantize(stems_f)
    song_dir = out_dir / spec.song_id
    write_wav(song_dir / "mix.wav", mix)
    for s in STEMS:
        write_wav(song_dir / f"{s}.wav", stems[s])
    if flac:
        for name in ("mix", *STEMS):
            to_flac(song_dir / f"{name}.wav")
        gt["flacFiles"] = {name: f"{spec.song_id}/{name}.flac" for name in ("mix", *STEMS)}
    return gt


def generate(out_dir: Path, song_ids: Iterable[str] | None = None, flac: bool = False) -> dict:
    """Write ``<out>/<songId>/{mix,drums,bass,other,vocals}.wav`` and ``<out>/ground_truth.json``."""
    out_dir = Path(out_dir)
    ids = list(song_ids) if song_ids else [s.song_id for s in SONGS]
    unknown = [i for i in ids if i not in SONGS_BY_ID]
    if unknown:
        raise KeyError(f"unknown fixture song id(s): {', '.join(unknown)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    songs = [generate_song(SONGS_BY_ID[i], out_dir, flac=flac) for i in ids]
    truth = {
        "generator": "forge fixtures",
        "fixturesVersion": FIXTURES_VERSION,
        "sampleRate": SR,
        "stems": list(STEMS),
        "notes": "Synthetic audio generated from math (no samples). "
        "mix.wav == drums+bass+other+vocals exactly.",
        "songs": songs,
    }
    (out_dir / "ground_truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    return truth
