# Playtest — Checkpoint 0 (foundations + risk spikes)

Phase 0 built the scaffold and three spikes. Nothing here is the game yet: you are checking that the three risky pieces work **on your machine and your phones**, because the build session had no GPU, no phones and none of your music (ADR 0001).

What you are deciding at this checkpoint:

1. Does the default stretcher (Signalsmith) sound good enough, and is it fast enough on your phones?
2. Does Forge install and run on your laptop, and which separator sounds better on your songs?
3. Can a phone join a room on your laptop and tap with low lag?

Budget about 60–90 minutes. Parts A, B and C are independent; do them in any order.

## Setup (once)

Everything runs inside WSL2 (Ubuntu 24.04), with the repo on the WSL filesystem.

```bash
# 1. Get the code
git clone <your repo URL> ~/code/stemdeck && cd ~/code/stemdeck
git checkout claude/blissful-goodall-iipuw4

# 2. JavaScript side (needs Node 22.22+ and pnpm 10)
corepack enable && pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build    # all should pass

# 3. A tunnel so phones get HTTPS (no account needed)
#    Install cloudflared first, from Cloudflare's own downloads page (it is a single binary)
cloudflared tunnel --url http://localhost:5173              # prints an https://….trycloudflare.com URL
```

Keep the tunnel URL handy; below it is written `https://TUNNEL`.

## Part A — Audio: `/lab` (laptop + each phone)

```bash
VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1 pnpm dev
```

The variable adds the two non-permissive stretchers (SoundTouch, Rubber Band) for comparison. It is for your own listening only; never set it for anything you share.

URLs: laptop `http://localhost:5173/lab` · phones `https://TUNNEL/lab`

On the **laptop (Chrome)**, the **iPhone (Safari)** and the **Android phone (Chrome)**:

1. Tap **Enable audio**. On the iPhone, flip the silent switch on and check whether you still hear sound.
2. Read the device panel. Note anything shown as unsupported.
3. Choose **Quick**, tap **Run benchmark**, wait for 100%. Then choose **Full** and run again with the screen kept on (a phone can take 10–20 minutes, mostly Rubber Band).
4. Tap **Copy results as markdown** and paste it into the matching section at the bottom of this file.
5. **A/B by ear.** Render `drums`, `pad`, `bass` and `vowel` at about 96 BPM and 150 BPM, at −5 and +5 semitones (formant on for `vowel`). Switch between Original, Signalsmith, SoundTouch and Rubber Band.
6. **A/B with a real song.** Pick a local song file with the file picker (it is decoded on the device and never uploaded) and repeat step 5.
7. **5 loops stress.** Turn it on and let it run for 3 minutes.
8. Check the **FLAC decode** rows in the benchmark: success, exact length, bit-exact.

What to listen for:

- Drums: flams or doubled hits, smeared transients, a click once per loop at the seam.
- Pad and bass: wobbling or "underwater" phasiness; whether held notes sound **out of tune** on Signalsmith compared with Rubber Band (the spike measured Signalsmith 3–6 cents off at ±5 semitones, up to 9 on low notes).
- Vowel / vocals: chipmunk or giant-voice effect with formant off, and whether formant on fixes it.
- Stress test: any dropout, crackle or stutter.

The numbers that matter (budgets from the build prompt §16.2):

| Device | 8-bar stereo render, Signalsmith | Budget | Pass? |
|---|---|---|---|
| Laptop | | ≤ 400 ms | |
| iPhone | | ≤ 1200 ms | |
| Android | | ≤ 1200 ms | |

If a phone misses 1200 ms, Phase 1 uses the fallback the spec already names: Forge pre-renders the pitch variants, and the phone only time-stretches.

## Part B — Forge on your laptop

```bash
bash tools/forge/scripts/setup-wsl.sh        # read it first; it lists what it installs and asks before every sudo step
uv run --project tools/forge forge doctor
```

1. Paste the `forge doctor` table below. The rows that matter: Python 3.11, ffmpeg, `nvidia-smi`, torch CUDA, model weights.
2. Run the tests: `uv run --project tools/forge pytest tools/forge` (about 4 minutes; should end with `passed` and no failures).
3. Generate the synthetic test songs and analyze them:
   ```bash
   uv run --project tools/forge forge fixtures --out .fixtures
   uv run --project tools/forge forge analyze .fixtures
   ```
   Every 4/4 song should show BPM within 0.5 of its name and the right key. The 3/4 song should be rejected.
4. Put **3 of your own songs** (different genres) in `~/bench-songs`, then:
   ```bash
   uv run --project tools/forge forge analyze ~/bench-songs
   uv run --project tools/forge python tools/forge/scripts/bench_separation.py ~/bench-songs --dry-run
   uv run --project tools/forge python tools/forge/scripts/bench_separation.py ~/bench-songs
   ```
   The first real run downloads about 1 GB of model weights into `~/.stemdeck/models`. Paste the printed timing table below.
5. **Listen.** Compare `library/bench/A/<song>/` (RoFormer vocals + Demucs for the rest — the default) with `library/bench/B/<song>/` (Demucs alone, one pass, faster).

What to listen for: vocals bleeding into `other`, smeared hi-hats in `drums`, bass leaking into `other`, watery artifacts on vocal tails. Also check that `forge analyze` got your songs' BPM right (watch for half or double tempo) and the key plausible.

Budget: separate + analyze + export ≤ 90 s per song on the GPU.

## Part C — Rooms: `/roomlab` (laptop + phone)

Three terminals:

```bash
pnpm dev            # web app on :5173 (proxies /rooms-api to the room server)
pnpm dev:rooms      # room server on :8787 — local only, no account, no login
cloudflared tunnel --url http://localhost:5173
```

1. On the laptop open **`https://TUNNEL/roomlab`** (the tunnel URL, not localhost: the QR code encodes the page's own address). Press **Create room**.
2. Scan the QR code with a phone, or open `https://TUNNEL/roomlab/join` and type the code. Pick a name and a glyph, press **Join**, then **Tap** a few dozen times.
3. Watch the laptop: each tap should highlight immediately. Note the ping p50/p95 on both screens.
4. Refresh the phone. You should keep the same seat and tap count.
5. Refresh the laptop. The room should come back with the same players.
6. Lock the phone for a minute, unlock it, tap again.
7. Join from a second phone. Then switch the first phone from Wi-Fi to cellular and tap again; note the ping.
8. On a phone, open the host URL (`https://TUNNEL/roomlab/host/CODE`). It should be refused.

Budget: player action → host screen p95 ≤ 250 ms. On loopback in the build session it was p95 10–20 ms, which is a floor, not what a phone over the internet will see.

## Known issues and limits

- Every number in `docs/spikes/*.md` was measured on a 4-core cloud container, shared with other jobs. Treat them as indicative.
- iOS Safari is completely untested: audio unlock, the silent switch, FLAC decode, module workers and render time are all open until you run Part A on the iPhone.
- Signalsmith on the cloud container met the 400 ms laptop budget at normal and faster tempos and missed it by about 45% at the slowest stretch (0.8×). Phase 1 plans to render less handle audio (about 15–18% less work); your laptop number decides whether more is needed.
- Signalsmith's pitch is a few cents off after shifting. If you can hear it, Phase 1 transposes bass and loop stems with a resampler instead.
- Neither separator recognises the synthetic "vocal" in the test songs as a voice, so the fixtures only check drum and bass separation. The vocal decision rests on your ears in Part B.
- `beat_this` (the preferred beat tracker) could not download its checkpoint in the build session; the tests there ran on the madmom and librosa fallbacks. On your laptop the tests pick `beat_this` up automatically once it has downloaded.
- `allin1` (song sections) cannot be installed with current PyTorch. Sections will use a librosa fallback in Phase 2.
- Rooms: whoever sends the first host `hello` for a new code becomes the host. A fix is planned for Phase 3 (the create call returns a host token). Irrelevant for local testing.
- `/lab` and `/roomlab` are throwaway spike pages with plain styling. The real UI starts in Phase 1.
- CI is green on GitHub for the checkpoint commit: the main job (guard, typecheck, lint, tests, build) and the Forge job (ruff, pytest). The Playwright e2e job only runs on pull requests to `main`, so it has run locally (18 tests pass) but never on GitHub.
- A fresh verifier checked Phase 0 from a clean install: all eight acceptance criteria passed and its attacks on the room server, the license gate and the stretcher contract held. Its follow-ups are listed in `docs/PHASES.md`.

## Decisions you may want to veto

1. **Stretcher: Signalsmith (MIT), render-on-drop in workers, no realtime stretching** (ADR 0006). The alternatives sound different and cannot ship in a product (LGPL/GPL).
2. **Separator: RoFormer vocals + Demucs for the rest**, provisional until you listen (ADR 0005). Demucs alone is about 7× faster on CPU.
3. **Forge uses non-commercial and copyleft pieces** (madmom models, Essentia, mutagen, diffq, an unlicensed RoFormer checkpoint). Fine for personal use on your machine; all must be replaced or cleared before any public release (`docs/LICENSES.md`).
4. **Rooms: Cloudflare Durable Objects via `partyserver`** (ADR 0007), as the build prompt proposed.
5. **In rooms, the server would learn each song's BPM and key** so it can set the mix tempo (ADR 0003). Your constraint lists only cardId/title/artist/role/level/playlist as allowed over the network. BPM and key are numbers, not audio, but this is your call before Phase 3.
6. **Git flow:** the build session can push only to its own branch, so there is no `phase-0` branch, `main` merge or tag (ADR 0001). Merge or tag as you prefer.
7. **The repository's hosted name** is the original game's name, which your constraints forbid inside the project. Nothing in the code, docs or commits uses it; renaming the repository is yours to do.

## Feedback

Rate 1–5 (5 = great) and add a line of notes.

| # | Item | Rating | Notes |
|---|---|---|---|
| A1 | Signalsmith sound quality on drums | | |
| A2 | Signalsmith sound quality on pad/bass (tuning!) | | |
| A3 | Signalsmith on vocals with formant on | | |
| A4 | Signalsmith vs Rubber Band: how big is the gap? | | |
| A5 | Loop seams (any clicks?) | | |
| A6 | 5-loop stress on each phone (dropouts?) | | |
| B1 | Forge setup script: did it just work? | | |
| B2 | Separation quality, config A | | |
| B3 | Separation quality, config B | | |
| B4 | BPM/key detection on your 3 songs | | |
| C1 | Joining by QR | | |
| C2 | Tap lag on Wi-Fi | | |
| C3 | Tap lag on cellular | | |
| C4 | Refresh / lock-screen recovery | | |

Anything else:

## Results (paste here)

### Kickoff answers

1. Phones (models + OS versions):
2. Music folder path:
3. OK to install WSL2 packages, CUDA and ~10 GB of models (yes/no):
4. OK to create a free Cloudflare account at Phase 3 (yes/no):
5. Autonomy — stop at every checkpoint, or run through Phase 2 unless blocked:

### `/lab` — laptop

### `/lab` — iPhone

### `/lab` — Android

### `forge doctor`

### Separation benchmark

### `/roomlab` ping (Wi-Fi / cellular)
