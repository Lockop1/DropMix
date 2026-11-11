# ADR 0003 — The engine's catalog carries each song's tempo and key

Status: accepted for Phase 1 (solo). **Needs the user's confirmation before Phase 3.**

## Context

The engine sets the master tempo and key when the first card lands on an empty board and when a wild is played (§7.2). To do that deterministically it must know each song's native BPM and PCS. The pure engine cannot read a pack, so it needs those facts as plain data.

In solo play this is local and uncontroversial. In rooms the engine runs in the Durable Object, so the facts would have to be uploaded by the host. The constraints list the metadata that may cross the network as "cardId, title, artist, role, level, playlist"; two numbers per song (BPM and a 0–11 key index) are not in that list, although they are neither audio nor art.

## Options

1. `EngineCatalog.songs[songId] = { bpm, pcs }`, uploaded with the catalog in rooms.
2. The host computes the master and sends it as an intent whenever a first card or a wild lands. Keeps the wire list literal, but makes the server depend on the host for a rule outcome and adds a window where the board has cards and no master.

## Decision

Option 1 for the engine contract (`SongFacts`, `EngineCatalog`). Nothing crosses a network in Phase 1.

For Phase 3, option 1 is the recommendation, flagged at the Phase 0 checkpoint so the user can veto it; if they do, option 2 is implemented behind the same engine contract by having the host's catalog upload omit `songs` and the Room DO accept a host-only `master.set`.

## Consequences

- `@stemdeck/pack` builds the `EngineCatalog` (`Catalog.toEngineCatalog()`).
- `Catalog.toPublicMeta()` returns only the literal constraint fields; song facts are a separate, explicit upload.
