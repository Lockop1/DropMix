# Spike 0B — stretcher backends, render-on-drop and FLAC

Status: measured in the cloud build container only. **Every number in this file was taken on the
cloud container (Linux x86_64, 4 vCPU, 15 GB RAM, no GPU, headless Chromium), not on the user's
laptop or phones.** The machine was shared with other agents; the load average is recorded next to
each run. Laptop and phone numbers come from `/lab` at Checkpoint 0 (see "What is still to be
measured").

Spec: `docs/BUILD_PROMPT.md` §5.1 (stretch/pitch row, audio format row), §7, §8.3, §8.6, §14 (0B),
§16.1–16.2.

## TL;DR

- **All three candidates work offline inside a Web Worker** and return exactly `outputFrames`
  frames, deterministically (bit-identical repeat renders).
- **Signalsmith Stretch (MIT) is the provisional choice.** Onsets land within **0.51 ms** of the
  grid (target ±2 ms), formants are preserved on request, seams are clean, it is the only
  permissive candidate, and it ships in the default bundle (worker 45.8 KB gzip).
  Weak spot: pitch-shifted partials are off by **+2.6…+5.9 cents** on a 440 Hz sine (up to 9
  cents on a 73 Hz bass fundamental). SoundTouch and Rubber Band are exact (< 0.1 cent).
- **Render time on this container (single worker, cloud vCPU):** Signalsmith 8-bar stereo loop
  **326–581 ms** (r = 1 … r = 0.8; output 20–25 s), 16 bars 658–1056 ms. That is ≈ 43× realtime
  and is proportional to output length. The §16.2 laptop budget (≤ 400 ms) is met at r = 1, borderline at r = 1.25
  (352–431 ms across runs) and missed by ≈ 45–55 % at r = 0.8 here; run-to-run variation is about ±15 %; the phone budget (≤ 1200 ms) is plausible but unmeasured.
- SoundTouch (LGPL) is 5–7× faster than Signalsmith but WSOLA timing jitter is **±11–17 ms** at
  t = 0 (fails ±2 ms) and it has no formant mode. Rubber Band R3 (GPL) has the best pitch and
  good timing (≤ 1.7 ms) but takes **2.4–4.5 s** per 8-bar loop (way over budget).
- **Render-on-drop beats realtime stretching:** 5 plain looping buffers cost 0.1 % of a core;
  5 Signalsmith AudioWorklet nodes cost **16 %** of a core here (more on phones), with real glitch
  risk on the audio thread.
- **FLAC:** an in-browser encoder (VERBATIM subframes) produces streams that Chromium decodes with
  **exact length and bit-exact samples** (3 s and 30 s; 30 s decodes in 77 ms). iOS Safari is
  untested.
- License gate verified: with the flag off, no LGPL/GPL code is in `apps/web/dist/`.

## What was built

- `packages/audio/src/stretch/` — three `Stretcher` backends, a render worker, a pool client and a
  license gate:
  - `signalsmith.ts` (MIT, statically reachable, the default),
  - `soundtouch.ts` (LGPL-2.1) and `rubberband.ts` (GPL-2.0-or-later), reachable **only** through
    the dynamic `import()` in `registry.ts` behind `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1`,
  - `render.worker.ts` + `worker-host.ts` (one queue per worker, results transferred, never
    copied), `client.ts` (`createStretchClient`: one promise per render, pool of N, least-busy
    dispatch, input transferred by default), `create-worker.ts`,
  - `realtime.ts`: Signalsmith's own AudioWorklet node looping a buffer (the realtime comparison).
- `packages/audio/src/seam.ts` — the §8.3 seam builder: the last 10 ms of the body are crossfaded
  into the end of the pre-handle, so `loop[L−1] → loop[0]` replays the render's own continuous
  audio across the downbeat.
- `packages/audio/src/signals/` — synthetic loops with 1-bar handles at 44.1 kHz: `click` (one
  click per beat, sample-exact onsets), `drums` (kick/snare/hats), `pad` (Cmaj7), `bass` (one note
  per beat), `vowel` (pulse train through /a/ formant band-passes 700/1220/2600 Hz), `sine`.
- `packages/audio/src/analysis/` — onset detector, dominant-frequency (pitch), harmonic spectral
  envelope + formant-shift estimate, seam discontinuity, exact-length/determinism checks.
- `packages/audio/src/flac/encoder.ts` — a minimal FLAC encoder (STREAMINFO, fixed-blocksize
  frames, VERBATIM subframes, CRC-8 headers, CRC-16 frames).
- `packages/audio/src/bench/` — the quality suite, the render-time suite, the realtime-load
  measurement, the FLAC decode test and the markdown tables.
- `/lab` (`apps/web/src/routes/lab/`) — phone page: Enable audio, device panel, Run benchmark +
  Copy results as markdown, A/B by ear (synthetic or local file, bar-quantised switching with
  10 ms fades), 5-loop stress toggle, FLAC test. `window.__stemdeckLab.runAll()` is the
  programmatic hook.
- `e2e/bench/lab-bench.mjs` — drives `/lab` in headless Chromium and prints JSON + markdown.
- `e2e/tests/lab.spec.ts` — short benchmark on both e2e projects (exact length, onsets ±2 ms,
  FLAC exact), A/B by touch, no horizontal scroll at 360×640.

### How each backend is run offline in a Worker

| backend | how it runs offline | alignment |
| --- | --- | --- |
| Signalsmith | The npm package only ships an AudioWorklet node; its WASM factory is reachable only inside its processor class. The worker evaluates the module with `AudioWorkletProcessor`/`registerProcessor` stubbed (and removed again), so the package registers its processor class with us; constructing it instantiates the WASM, whose C API (`seek`/`process`/`flush`) we drive with exact frame counts. | Pre-roll `seek()` of `inputLatency + outputLatency·rate` frames makes output frame j ≙ input frame j·rate; then `process()` in 4096-frame blocks and `flush(outputLatency)`. Exact length by construction. |
| SoundTouch | Pure JS, interleaved stereo: push input in 8192-frame chunks, `process()`, drain, flush with silence. | soundtouchjs's WSOLA has a tempo-dependent mean drift (−S·(1−tempo)/(2·tempo), S = sequence − overlap) which is subtracted; the ± half-sawtooth jitter is inherent and is what the onset metric shows. |
| Rubber Band | C API in WASM (`rubberband-wasm`), offline mode (`study` + `process`), R3 "finer" engine, `ChannelsTogether`, `PitchHighQuality`, `FormantPreserved` on request. | Offline mode compensates its own start delay; output is cut/zero-padded to exactly `outputFrames`. |

## Candidates

Licenses read from each installed package's `package.json` and LICENSE file.

| backend | npm package | version | license (package.json → LICENSE) | default bundle | offline in a Worker | formant | WASM / code size (raw → gzip) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Signalsmith Stretch | `signalsmith-stretch` (official release by the author) | 1.3.2 | `MIT` (no LICENSE file in the tarball; README: "official release") | yes | yes | yes (`setFormantSemitones(0, compensate)`) | WASM 64.5 KB → 28.2 KB; shipped as base64 inside a 114 KB JS file → 47.7 KB gzip. The default render worker is 104.6 KB → 45.8 KB gzip |
| SoundTouch | `soundtouchjs` | 0.3.0 | `LGPL-2.1` → LGPL 2.1 text | **no — flag** | yes | no | pure JS, 25.1 KB → 5.8 KB |
| Rubber Band | `rubberband-wasm` | 3.3.0 | `GPLv2` → GPL v2 text (Rubber Band itself is GPL-2.0-or-later, commercial licence sold separately) | **no — flag** | yes | yes (`OptionFormantPreserved`) | WASM 265 KB → 116 KB + 11 KB JS glue → 2.3 KB |

Packages looked at and not used: `@soundtouchjs/core` 2.1.1 / `@soundtouchjs/audio-worklet`
(published as MPL-2.0, but derived from LGPL SoundTouch — the relicensing is questionable and
MPL is not on the permissive list either), `rubberband-web` (GPL, realtime worklet only),
`@echogarden/rubberband-wasm` (GPL-2.0-only, same library), `signalsmith-stretch-js` and
`@alexgorbatchev/signalsmith-stretch` (third-party repackagings of the same MIT library; the
official package was preferred for provenance).

### License gate — verified

With the flag unset:

```
$ pnpm --filter @stemdeck/web build
$ grep -rlE "rb_new|wasm_malloc|RubberBandOption|FifoSampleBuffer|seekBestOverlapPosition|Parviainen|GNU (Lesser )?General Public" apps/web/dist/
$ echo $?
1                       # no match: no SoundTouch or Rubber Band code in dist/
$ ls apps/web/dist/assets | grep -c wasm
0
```

The only mentions of "soundtouch"/"rubberband" left in `dist/` are the labels in the registry's
metadata table (strings such as `label: "SoundTouch"`), which the device panel prints. With
`VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1` the same grep matches the render worker and the build
emits `rubberband-*.wasm` (265 KB); `/lab` then lists and loads all three backends (that is how
the tables below were produced).

## Results (cloud container, headless Chromium)

Produced with `node e2e/bench/lab-bench.mjs --nonpermissive --label "…" --json …` (full run,
14 min, all three backends; then a Signalsmith-only render-time rerun with
`--backends signalsmith --no-quality --no-realtime --no-flac`). The tables are pasted verbatim
from the script's markdown output.

Machine load: the full run started with load average 2.3 and the machine otherwise idle; from
about 2 minutes in (during the Signalsmith render-time cases) another agent's Python job used
≈2.3 of the 4 cores until the end (load average 5–6.7). The Signalsmith rerun started at load
2.3 and again overlapped a ≈2.2-core job after ~20 s. Single-worker numbers agree between the
two runs within ≈10 %; the **pool** columns are inflated by the contention (3 workers + a
2-core neighbour on 4 cores) and should be read as an upper bound.

### Environment

Measured on: **cloud container: Linux x86_64, 4 vCPU, 15 GB, headless Chromium (machine shared with other agents)** (2026-11-12T00:41:05.504Z)

| field | value |
| --- | --- |
| user agent | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36 |
| hardwareConcurrency | 4 |
| deviceMemory (GB) | 16 |
| AudioContext sampleRate | 44100 |
| baseLatency (ms) | 10.0 |
| outputLatency (ms) | 32.0 |
| features | AudioWorklet yes, OfflineAudioContext yes, Module Worker yes, WebAssembly yes, OPFS yes, Wake Lock yes, audioSession no, renderCapacity no, playbackStats yes, crossOriginIsolated no |

### Candidates

| backend | package | license | default bundle | offline in worker | formant | init (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Signalsmith Stretch | signalsmith-stretch@1.3.2 | MIT | yes | yes | yes | 16 |
| SoundTouch | soundtouchjs@0.3.0 | LGPL-2.1 | no (flag) | yes | no | 11 |
| Rubber Band (R3) | rubberband-wasm@3.3.0 | GPL-2.0-or-later | no (flag) | yes | yes | 18 |

### Render time

Median of 5 runs after 1 warm-up; pool = 3 workers, batch = 3 renders submitted at once.

| backend | bars | r | t | out (s) | 1 worker median (ms) | min–max | DSP median (ms) | pool batch (ms) | pool per render (ms) | × realtime | WASM heap (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signalsmith | 8 | 0.80 | -5 | 25.0 | 538 | 527–574 | 537 | 593 | 590 | 46.5 | 1.7 |
| signalsmith | 8 | 0.80 | +5 | 25.0 | 557 | 535–588 | 556 | 624 | 576 | 44.9 | 1.7 |
| signalsmith | 8 | 1.25 | -5 | 16.0 | 357 | 332–361 | 357 | 354 | 352 | 44.8 | 1.7 |
| signalsmith | 8 | 1.25 | +5 | 16.0 | 352 | 340–381 | 351 | 368 | 354 | 45.5 | 1.7 |
| signalsmith | 8 | 1.00 | 0 | 20.0 | 326 | 322–340 | 326 | 370 | 351 | 61.3 | 1.7 |
| signalsmith | 16 | 0.80 | -5 | 45.0 | 958 | 947–1066 | 957 | 1012 | 982 | 47.0 | 1.7 |
| signalsmith | 16 | 0.80 | +5 | 45.0 | 1041 | 1021–1060 | 1039 | 1398 | 1198 | 43.2 | 1.7 |
| signalsmith | 16 | 1.25 | -5 | 28.8 | 663 | 637–694 | 662 | 977 | 731 | 43.4 | 1.7 |
| signalsmith | 16 | 1.25 | +5 | 28.8 | 664 | 654–803 | 663 | 971 | 915 | 43.4 | 1.7 |
| signalsmith | 16 | 1.00 | 0 | 36.0 | 658 | 646–685 | 656 | 937 | 854 | 54.7 | 1.7 |
| soundtouch | 8 | 0.80 | -5 | 25.0 | 76 | 64–77 | 71 | 132 | 117 | 329.8 | — |
| soundtouch | 8 | 0.80 | +5 | 25.0 | 95 | 79–102 | 93 | 145 | 116 | 262.9 | — |
| soundtouch | 8 | 1.25 | -5 | 16.0 | 49 | 48–56 | 49 | 66 | 58 | 327.2 | — |
| soundtouch | 8 | 1.25 | +5 | 16.0 | 48 | 46–53 | 47 | 78 | 66 | 335.4 | — |
| soundtouch | 8 | 1.00 | 0 | 20.0 | 58 | 54–65 | 57 | 97 | 80 | 346.0 | — |
| soundtouch | 16 | 0.80 | -5 | 45.0 | 123 | 116–125 | 122 | 148 | 131 | 366.7 | — |
| soundtouch | 16 | 0.80 | +5 | 45.0 | 144 | 135–191 | 143 | 247 | 235 | 313.4 | — |
| soundtouch | 16 | 1.25 | -5 | 28.8 | 93 | 91–94 | 92 | 155 | 141 | 309.0 | — |
| soundtouch | 16 | 1.25 | +5 | 28.8 | 95 | 91–101 | 94 | 179 | 121 | 303.8 | — |
| soundtouch | 16 | 1.00 | 0 | 36.0 | 98 | 93–102 | 98 | 171 | 144 | 366.6 | — |
| rubberband | 8 | 0.80 | -5 | 25.0 | 2994 | 2887–3205 | 2991 | 4377 | 4003 | 8.3 | — |
| rubberband | 8 | 0.80 | +5 | 25.0 | 4462 | 4386–4671 | 4459 | 6387 | 6120 | 5.6 | — |
| rubberband | 8 | 1.25 | -5 | 16.0 | 2466 | 2415–2537 | 2465 | 3819 | 3555 | 6.5 | — |
| rubberband | 8 | 1.25 | +5 | 16.0 | 3314 | 3140–3412 | 3313 | 4965 | 4460 | 4.8 | — |
| rubberband | 8 | 1.00 | 0 | 20.0 | 2378 | 2306–2472 | 2377 | 3625 | 3309 | 8.4 | — |
| rubberband | 16 | 0.80 | -5 | 45.0 | 5797 | 5716–6040 | 5791 | 8342 | 7649 | 7.8 | — |
| rubberband | 16 | 0.80 | +5 | 45.0 | 8458 | 7992–9423 | 8458 | 11521 | 11056 | 5.3 | — |
| rubberband | 16 | 1.25 | -5 | 28.8 | 4472 | 4309–4595 | 4470 | 6496 | 6142 | 6.4 | — |
| rubberband | 16 | 1.25 | +5 | 28.8 | 5788 | 5571–5894 | 5787 | 8400 | 8101 | 5.0 | — |
| rubberband | 16 | 1.00 | 0 | 36.0 | 4277 | 4216–4956 | 4275 | 6263 | 6015 | 8.4 | — |

| backend | longest main-thread task (ms) | max event-loop gap (ms) | peak main JS heap (MB) |
| --- | --- | --- | --- |
| signalsmith | 120 | 26.3 | 73.1 |
| soundtouch | 127 | 20.6 | 73.1 |
| rubberband | <50 (none) | 44.9 | 73.1 |

### Quality

| backend | renders | exact length | deterministic |
| --- | --- | --- | --- |
| signalsmith | 20 | 20/20 | yes |
| soundtouch | 18 | 18/18 | yes |
| rubberband | 20 | 20/20 | yes |

**Onset timing** (click loop, every body beat vs the ideal grid; target ±2 ms)

| backend | r | t | onsets | max abs error (ms) | mean abs error (ms) | missing |
| --- | --- | --- | --- | --- | --- | --- |
| signalsmith | 0.80 | 0 | 16 | 0.51 | 0.19 | 0 |
| signalsmith | 1.25 | 0 | 16 | 0.27 | 0.09 | 0 |
| signalsmith | 0.80 | -5 | 16 | 0.14 | 0.06 | 0 |
| signalsmith | 1.25 | 5 | 16 | 0.07 | 0.04 | 0 |
| soundtouch | 0.80 | 0 | 16 | 16.83 | 7.07 | 0 |
| soundtouch | 1.25 | 0 | 16 | 11.21 | 5.72 | 0 |
| soundtouch | 0.80 | -5 | 16 | 3.22 | 1.69 | 0 |
| soundtouch | 1.25 | 5 | 16 | 2.86 | 1.32 | 0 |
| rubberband | 0.80 | 0 | 16 | 1.70 | 1.17 | 0 |
| rubberband | 1.25 | 0 | 16 | 0.64 | 0.32 | 0 |
| rubberband | 0.80 | -5 | 16 | 0.89 | 0.46 | 0 |
| rubberband | 1.25 | 5 | 16 | 1.58 | 1.14 | 0 |

**Pitch** (440 Hz sine; dominant frequency over 1 s of the body)

| backend | r | t | expected (Hz) | measured (Hz) | error (cents) |
| --- | --- | --- | --- | --- | --- |
| signalsmith | 0.80 | -5 | 329.63 | 330.76 | 5.94 |
| signalsmith | 0.80 | 0 | 440.00 | 440.00 | 0.00 |
| signalsmith | 0.80 | 5 | 587.33 | 588.53 | 3.52 |
| signalsmith | 1.25 | -5 | 329.63 | 330.51 | 4.60 |
| signalsmith | 1.25 | 0 | 440.00 | 440.00 | 0.00 |
| signalsmith | 1.25 | 5 | 587.33 | 588.20 | 2.56 |
| soundtouch | 0.80 | -5 | 329.63 | 329.63 | 0.00 |
| soundtouch | 0.80 | 0 | 440.00 | 440.01 | 0.02 |
| soundtouch | 0.80 | 5 | 587.33 | 587.31 | -0.06 |
| soundtouch | 1.25 | -5 | 329.63 | 329.64 | 0.04 |
| soundtouch | 1.25 | 0 | 440.00 | 439.99 | -0.05 |
| soundtouch | 1.25 | 5 | 587.33 | 587.32 | -0.02 |
| rubberband | 0.80 | -5 | 329.63 | 329.63 | 0.00 |
| rubberband | 0.80 | 0 | 440.00 | 440.00 | 0.00 |
| rubberband | 0.80 | 5 | 587.33 | 587.33 | 0.00 |
| rubberband | 1.25 | -5 | 329.63 | 329.63 | 0.00 |
| rubberband | 1.25 | 0 | 440.00 | 440.00 | 0.00 |
| rubberband | 1.25 | 5 | 587.33 | 587.33 | 0.00 |

**Seam** (|x[0] − x[L−1]| / RMS sample step; ≈1 = like any other step)

| backend | signal | r | t | 10 ms handle crossfade | plain cut |
| --- | --- | --- | --- | --- | --- |
| signalsmith | pad | 0.80 | -5 | 1.21 | 2.37 |
| signalsmith | pad | 1.25 | 5 | 1.08 | 12.50 |
| signalsmith | bass | 0.80 | -5 | 0.25 | 1.85 |
| signalsmith | bass | 1.25 | 5 | 0.86 | 54.16 |
| soundtouch | pad | 0.80 | -5 | 0.99 | 12.73 |
| soundtouch | pad | 1.25 | 5 | 0.53 | 10.87 |
| soundtouch | bass | 0.80 | -5 | 0.54 | 21.03 |
| soundtouch | bass | 1.25 | 5 | 0.37 | 106.93 |
| rubberband | pad | 0.80 | -5 | 0.34 | 16.96 |
| rubberband | pad | 1.25 | 5 | 1.84 | 8.14 |
| rubberband | bass | 0.80 | -5 | 1.18 | 17.57 |
| rubberband | bass | 1.25 | 5 | 0.76 | 64.91 |

**Formant** (vowel /a/, r = 1; envelope shift: 0 = formants kept, ≈t = moved with pitch; dry peaks 697 / 1261 / 2652 Hz)

| backend | t | formant requested | formantApplied | envelope shift (st) | envelope peaks (Hz) |
| --- | --- | --- | --- | --- | --- |
| signalsmith | -5 | no | no | -5.00 | 526 / 945 / 1987 |
| signalsmith | -5 | yes | yes | -0.40 | 526 / 945 / 1261 |
| signalsmith | 5 | no | no | 5.00 | 938 / 1683 / 3540 |
| signalsmith | 5 | yes | yes | 0.05 | 931 / 1683 / 2614 |
| soundtouch | -5 | no | no | -5.00 | 522 / 945 / 1987 |
| soundtouch | 5 | no | no | 5.00 | 931 / 1683 / 3540 |
| rubberband | -5 | no | no | -5.00 | 522 / 945 / 1987 |
| rubberband | -5 | yes | yes | -0.40 | 526 / 945 / 1365 |
| rubberband | 5 | no | no | 5.00 | 931 / 1683 / 3540 |
| rubberband | 5 | yes | yes | -0.20 | 562 / 931 / 1683 |

### Realtime vs render-on-drop

| mode | voices | audio (s) | offline render (ms) | load (share of one core) | output RMS |
| --- | --- | --- | --- | --- | --- |
| render-on-drop (plain looping buffers) | 5 | 20 | 29 | 0.001 | 0.0587 |
| realtime stretch (AudioWorklet) | 5 | 20 | 3211 | 0.161 | 0.0569 |

| mode | voices | seconds | source | avg load | peak load | underrun ratio | underruns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| plain | 5 | 10 | playbackStats | — | — | — | 0 |
| stretch | 5 | 10 | playbackStats | — | — | — | 0 |

### FLAC decode

| test | audio (s) | bytes | decoded | expected frames | decoded frames | exact length | max error (LSB) | bit-exact | int16→float | encode (ms) | decode (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 s stereo 16-bit | 3.00 | 530066 | yes | 132423 | 132423 | yes | 0.001 | yes | asymmetric | 49 | 12.1 |
| 30 s stereo 16-bit | 30.00 | 5295972 | yes | 1323123 | 1323123 | yes | 0.001 | yes | asymmetric | 324 | 77.0 |

### Render time — Signalsmith rerun

Median of 5 runs after 1 warm-up; pool = 3 workers, batch = 3 renders submitted at once.

| backend | bars | r | t | out (s) | 1 worker median (ms) | min–max | DSP median (ms) | pool batch (ms) | pool per render (ms) | × realtime | WASM heap (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| signalsmith | 8 | 0.80 | -5 | 25.0 | 578 | 570–643 | 577 | 608 | 584 | 43.3 | 1.7 |
| signalsmith | 8 | 0.80 | +5 | 25.0 | 581 | 571–597 | 581 | 920 | 758 | 43.0 | 1.7 |
| signalsmith | 8 | 1.25 | -5 | 16.0 | 402 | 369–458 | 399 | 591 | 540 | 39.8 | 1.7 |
| signalsmith | 8 | 1.25 | +5 | 16.0 | 409 | 365–467 | 409 | 613 | 519 | 39.1 | 1.7 |
| signalsmith | 8 | 1.00 | 0 | 20.0 | 353 | 342–360 | 352 | 571 | 483 | 56.7 | 1.7 |
| signalsmith | 16 | 0.80 | -5 | 45.0 | 1054 | 1041–1096 | 1048 | 1606 | 1193 | 42.7 | 1.7 |
| signalsmith | 16 | 0.80 | +5 | 45.0 | 1056 | 1024–1115 | 1056 | 1693 | 1575 | 42.6 | 1.7 |
| signalsmith | 16 | 1.25 | -5 | 28.8 | 685 | 660–750 | 684 | 935 | 820 | 42.1 | 1.7 |
| signalsmith | 16 | 1.25 | +5 | 28.8 | 672 | 660–682 | 671 | 1075 | 925 | 42.9 | 1.7 |
| signalsmith | 16 | 1.00 | 0 | 36.0 | 682 | 664–720 | 682 | 990 | 795 | 52.8 | 1.7 |

| backend | longest main-thread task (ms) | max event-loop gap (ms) | peak main JS heap (MB) |
| --- | --- | --- | --- |
| signalsmith | <50 (none) | 16.1 | 23.4 |

## Reading the results

**Length and determinism.** 58/58 renders had exactly `outputFrames` frames; every backend
produced bit-identical output for repeated renders and across instances (unit-tested in Node as
well: `packages/audio/test/stretchers.test.ts`).

**Onset timing** (click loop, every body beat measured against the ideal fractional grid
position, detector bias calibrated on the dry signal):

- Signalsmith: max 0.51 ms, mean ≤ 0.19 ms. The alignment is exact by construction (pre-roll
  `seek`); the residual is transient smearing by the 120 ms STFT.
- Rubber Band: max 1.70 ms (r = 0.8), within target but with a ≈ 1.2 ms mean lag at r = 0.8.
- SoundTouch: max 16.8 ms at r = 0.8 / t = 0 and 11.2 ms at r = 1.25 even after removing the mean
  WSOLA drift; inherent to WSOLA with ≈ 110 ms sequences (content plays at speed 1 inside each
  sequence and snaps back at the next). Pitch-shifted cases are smaller (≈ 3 ms) because the
  stretch stage then runs closer to tempo 1. **Fails the ±2 ms target**: two click loops would
  audibly flam.

**Pitch.** Signalsmith: +2.6 … +5.9 cents for a 440 Hz sine at t = ±5 (0.00 at t = 0, so the
time-stretch alone is exact). A Node-side check with a 110 Hz sawtooth (20 harmonics, r = 1)
gave partial errors of +0.2 … +2.7 cents at t = +5 and −9.3 cents (fundamental, 73 Hz) …
+3.5 cents at t = −5: the shifted spectrum is very slightly inharmonic, worst at low
frequencies. The `cheaper` preset is worse (up to 30 cents at 110 Hz). SoundTouch and Rubber
Band: < 0.1 cent. For context, real recordings deviate from A440 by ±10–20 cents and Forge does
not fine-tune yet, so a few cents are below the source-material spread; a bass line one 9-cent
step off another bass would beat slowly. Mitigation if listening confirms it: for `bass` (and
`loop`, which need no formant handling) stretch with Signalsmith at t = 0 and do the
transposition with a band-limited resampler (exact by construction); keep Signalsmith's
pitch-shift for `lead` where formant preservation matters.

**Seams.** With the 10 ms crossfade from the handle audio, the boundary step is 0.25–1.84× the
typical sample step (i.e. like any other step); a plain cut of the same render is 1.9–107×. The
crossfade works for every backend; it does not depend on the stretcher.

**Formants.** With formant preservation on, Signalsmith's envelope moves by 0.05 st (t = +5) and
−0.40 st (t = −5); Rubber Band by −0.20 / −0.40 st. With it off, both (and SoundTouch) move by
exactly t, as expected. `formantApplied` is reported truthfully (SoundTouch always false). The
"envelope peaks" column is a coarse peak pick on a harmonic-sampled envelope; the shift estimate
is the robust number.

**Render time.** Cost is proportional to output length (≈ 23 µs of one cloud vCPU per stereo
output frame for Signalsmith, ≈ 43× realtime, flat across t). Two cheap Phase 1 savings:
render only the body plus a short context (≈ 250 ms) instead of two full handle bars (saves
≈ 15–18 % for 8 bars), and keep 8-bar loops the norm (16-bar loops take ≈ 2×). Pool of 3: with
an idle machine three renders should finish in roughly one render's time on ≥ 4 cores; here the
batch took 1.0–1.6× a single render because another agent was using 2+ cores. WASM heap of one
Signalsmith instance: 1.7 MB. Main-thread blocking during renders: no long task ≥ 50 ms in the
idle-start rerun (max event-loop gap 16 ms); the 120 ms long task in the first run coincided with
the CPU contention and was not reproduced.

**Realtime vs render-on-drop.** Rendering 20 s of 5 voices in an OfflineAudioContext: plain
looping buffers 29 ms (0.1 % of a core), 5 Signalsmith worklet nodes 3211 ms (16 % of a core,
on one audio thread). The output RMS confirms both actually produced sound. On a phone that is
likely 30–50 % of the audio thread for 5 stems before any mixing/FX, with no headroom for GC or
thermal throttling; render-on-drop moves all of it off the audio thread and makes the live cost
independent of the stretcher. Headless Chromium has `AudioContext.playbackStats` (0 underruns in
both live 10 s tests) but not `renderCapacity`; the headless audio sink is not a real device,
so these live numbers say nothing about phones.

**FLAC.** Chromium decodes the in-browser-encoded streams with exactly the encoded frame count
(no priming or padding offset, last block short on purpose) and every sample rounds back to its
16-bit value (Chromium maps int16 → float asymmetrically: ÷32767 for positive, ÷32768 for
negative values — worth knowing for any bit-exact test). 30 s of stereo decodes in 77 ms here.
The same stream round-trips sample-exact through `ffmpeg` with CRC checking (unit test).

## What is still to be measured (user's laptop and phones)

None of the following can be measured in the cloud container. At Checkpoint 0:

1. Start the app with all backends: `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1 pnpm dev`
   (personal use; leave the variable unset for anything shared), and a quick tunnel for phones:
   `cloudflared tunnel --url http://localhost:5173`.
2. On the **laptop** (Chrome) and on **each phone** (iOS Safari, Android Chrome), open `/lab`:
   1. tap **Enable audio**;
   2. choose **Full**, tap **Run benchmark**, keep the screen on until 100 % (a phone may take
      10–20 min because of Rubber Band; choose Quick first if in doubt);
   3. tap **Copy results as markdown** and paste into `docs/playtests/phase-0.md` under the
      device's name;
   4. **A/B by ear**: Render variants for `drums`, `pad`, `bass` and `vowel` at e.g. 96 and 150
      BPM and ±5 st (formant on for `vowel`), and once with a local song file (decoded on the
      phone, never uploaded). Listen for smearing, phasiness, flams and clicks at the loop seam;
   5. **5 loops stress**: Play 5 loops for a few minutes in each mode and note dropouts (by ear,
      and the underrun readout where the browser offers one);
   6. **FLAC decode** (already in the benchmark): note success, exact length and bit-exactness.
3. Specifically on iOS Safari: whether the silent switch mutes `/lab` (audioSession support),
   whether AudioWorklet and module workers work, decode of FLAC, and render time vs the 1200 ms
   budget.

## Risks

- **iOS Safari is completely untested** (no Apple device or WebKit build is available here):
  FLAC `decodeAudioData` support and exactness, module Workers with dynamic `import()`, the
  Blob-URL AudioWorklet that `signalsmith-stretch` builds for the realtime path, WASM speed,
  `navigator.audioSession` (feature-detected, never verified), the silent-switch behaviour,
  `interrupted` state handling and suspension when the tab is hidden. All of this is a
  Checkpoint 0 item.
- **Phone render time is unknown.** Extrapolating a 2–3× slower phone core puts Signalsmith's
  8-bar r = 0.8 render at ≈ 1.2–1.8 s, i.e. at or over the 1200 ms budget. If the phone numbers
  miss, the §8.3 pitch-ladder fallback halves nothing (stretch is still needed) — the useful
  levers are cropping the handles, shorter loops at slow masters, the `cheaper` preset (≈ 35 %
  faster in Node, but worse pitch accuracy), or pre-rendered tempo ladders.
- **Signalsmith pitch error** (a few cents, more at low frequencies) — see above. Needs an
  ear test with real stems; resampling-based transposition for bass/loop is the fallback.
- **The Signalsmith worker shim depends on the package's internals** (it relies on the module
  registering a processor class whose constructor instantiates the WASM and exposes
  `wasmModule`). Pin the exact version (done: `1.3.2`) and keep the backend's unit tests; a
  version bump must re-run them. Longer term, a small first-party WASM build of the MIT C++
  library with an offline API would remove the shim.
- **Main-thread copies:** a request transfers its input (zero copy) but the caller still needs
  the decoded source for the next render; Phase 1 should keep one decoded copy per stem and send
  `slice()`s (one memcpy per render) or decode once per worker.
- **Licensing:** SoundTouch (LGPL) and Rubber Band (GPL) must stay behind the flag; a flagged
  build is personal-use only and must never be deployed. `@soundtouchjs/*` (MPL-2.0 claim) was
  not used because its relicensing from the LGPL original is unclear.
- **Measurement caveats here:** shared machine (another agent's 2+ core job overlapped most of
  the render-time runs), headless audio sink (live underrun numbers are not meaningful), cloud
  vCPU not comparable to the user's laptop.

## Recommendation

Against §16.2 (8-bar stereo loop ≤ 400 ms laptop, ≤ 1200 ms phone, else the pitch-ladder
fallback of §8.3):

1. **Use Signalsmith Stretch (MIT) as the only default backend, with render-on-drop in a worker
   pool.** It is the only candidate that is permissive, accurate in time (±0.5 ms), supports
   formants, and is within reach of the budgets. Ship SoundTouch and Rubber Band only behind
   `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1` for personal A/B; neither is a fallback for the
   shipped build (SoundTouch fails timing, Rubber Band fails speed by 6–11×).
2. **Do not use realtime stretching** in Phase 1. Keep `realtime.ts` only as a lab comparison.
3. **Laptop budget:** on this cloud vCPU Signalsmith takes 326–353 ms at r = 1, 352–409 ms at r = 1.25 and
   ≈ 580 ms at r = 0.8. Implement the handle crop (render body + ≈ 250 ms context) in 1C and
   re-measure; the user's laptop core is likely faster than a shared cloud vCPU. Decide on the
   laptop number, not this one.
4. **Phone budget:** unknown until the user runs `/lab`. If the 8-bar r = 0.8 render exceeds
   1200 ms on the user's phone, apply in this order: handle crop → `cheaper` preset for non-lead
   roles on phones → Forge-side pitch ladder (§8.3). Record the outcome in the final ADR.
5. **FLAC 44.1 kHz** stays the pack format (Chromium: exact length, bit-exact); confirm on iOS
   Safari at Checkpoint 0 before Phase 1 (1D) relies on it. If Safari fails, the fallback is WAV
   in the pack (larger) — decide then.
6. Use `buildSeamlessLoop` (10 ms handle crossfade) for every render; it is backend-independent.

## Draft ADR: stretcher and render strategy

Status: proposed (provisional pending laptop and phone measurements from `/lab`).

### Context

Every stem dropped on the board must be time-stretched to the master tempo (r in 0.8–1.25,
hard cap 0.66–1.5) and, except drums, pitch-shifted by t in −6…+5 semitones, with formant
preservation for leads. Loops must be sample-exact (bars × 4 × 60/M × sr), phase-locked to the
bar grid within ±2 ms, seamless, and the shipped web bundle must stay permissive-licensed.
Five stems play at once on a phone. Spike 0B (`docs/spikes/audio.md`) compared Signalsmith
Stretch (MIT), SoundTouch (LGPL-2.1) and Rubber Band R3 (GPL-2.0-or-later), each run offline in a
Web Worker, and a realtime AudioWorklet path, in headless Chromium on a 4-vCPU cloud container.

### Options

1. Realtime stretching on the audio thread (Signalsmith's AudioWorklet node per stem).
2. Render-on-drop in a worker pool with Signalsmith Stretch (MIT).
3. Render-on-drop with SoundTouch (LGPL; fastest, no formants, WSOLA timing jitter).
4. Render-on-drop with Rubber Band R3 (GPL; best pitch, 5–8× slower than Signalsmith).
5. Forge-side pre-rendering (pitch ladders), runtime time-stretch only.

### Decision

- **Option 2.** `Stretcher` default = `SignalsmithStretcher` (`signalsmith-stretch` 1.3.2,
  pinned), run in a pool of `min(3, cores − 1)` render workers via `createStretchClient`;
  results play as plain looping `AudioBufferSourceNode`s built with `buildSeamlessLoop` (10 ms
  handle crossfade). Alignment is done inside the backend (pre-roll seek), so output frame j
  corresponds to input frame j · inputFrames/outputFrames.
- SoundTouch and Rubber Band remain available only behind
  `VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1` (dynamic import, absent from the default `dist/`),
  for personal A/B listening. They are not fallbacks for the shipped app.
- No realtime DSP on the audio thread (option 1 rejected: 16 % of a cloud core for 5 voices,
  more on phones, glitch risk).
- Pack audio stays FLAC 44.1 kHz with 1-bar handles (Chromium decode is length-exact and
  bit-exact).

Provisional parts (confirm at Checkpoint 0 from `/lab` on the user's laptop and phones):
the render-time budgets (cloud: 326–581 ms per 8-bar loop; laptop budget 400 ms, phone 1200 ms),
whether option 5 or the `cheaper` preset is needed on phones, FLAC decoding on iOS Safari, and
whether Signalsmith's few-cent pitch error is audible on real stems (if yes: resampler-based
transposition for bass/loop roles).

### Consequences

- Phase 1 (1C) builds the render pool, LRU cache and reconciler on `createStretchClient` +
  `SignalsmithStretcher` + `buildSeamlessLoop`; the entry boundary uses the measured render time
  as `renderETA`.
- 1C should crop the handle audio to a short context before rendering (≈ 15–18 % less work) and
  keep one decoded copy per stem (requests transfer their input).
- The worker shim depends on `signalsmith-stretch` internals; version bumps must re-run the
  backend tests. A first-party WASM build of the MIT library with an offline API is the clean
  long-term option.
- `docs/LICENSES.md` lists the three packages; flagged builds are personal-use only and are never
  deployed.
- `/lab` stays as the measurement tool for every checkpoint.
