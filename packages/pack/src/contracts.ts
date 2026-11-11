/**
 * @stemdeck/pack — contracts (owned by the orchestrator).
 *
 * The pack format (schemaVersion 1) and the Catalog abstraction that hides where content comes
 * from ("local pack" today; "CDN catalog" or "user collection" later).
 * Spec: docs/BUILD_PROMPT.md §6.4, §15.
 *
 * The zod schemas in ./schema.ts are the runtime source of truth and must stay assignable to the
 * interfaces below (`satisfies z.ZodType<Pack>`). The JSON Schema exported from them is what
 * Forge (Python) validates its output against.
 */

import type { CardDef, EngineCatalog, Role } from '@stemdeck/engine';
import type { EntryEvery, LoopBars, Mode, Pcs, PitchClass } from '@stemdeck/harmony';

export const PACK_SCHEMA_VERSION = 1;
/** File extension of a pack zip. */
export const PACK_EXTENSION = '.stemdeck';
/** Manifest file name inside the zip. */
export const PACK_MANIFEST = 'pack.json';

export interface Song {
  /** sha1 of the source audio. */
  songId: string;
  title: string;
  artist: string;
  album?: string;
  year?: number;
  genre?: string;
  nativeBpm: number;
  key: { tonic: PitchClass; mode: Mode; confidence: number };
  /** Path inside the zip (`art/<songId>.webp`). Host-only; never crosses the network. */
  art?: string;
}

export interface StemLoop {
  stemId: string;
  songId: string;
  role: Role;
  /** Path inside the zip (`audio/<stemId>.flac`). */
  file: string;
  sampleRate: 44100;
  /** 1 bar of pre-roll and post-roll in the file. */
  handleSamples: number;
  /** Exact loop region inside the file, in samples. loopEndSample is exclusive. */
  loopStartSample: number;
  loopEndSample: number;
  bars: LoopBars;
  /** Exact after grid-warp. */
  bpm: number;
  pcs: Pcs;
  mode: Mode;
  /** Per-bar 12-dim chroma (harmonic roles only; empty for `beat`). */
  chroma: number[][];
  /** Entry quantization in bars. Defaults: beat=1, bass=1, loop=2, lead=4. */
  entryEvery: EntryEvery;
  gainDb: number;
  lufs: number;
}

export interface Playlist {
  id: string;
  name: string;
  cardIds: string[];
}

export interface Pack {
  schemaVersion: 1;
  packId: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  songs: Song[];
  cards: CardDef[];
  stems: StemLoop[];
  playlists: Playlist[];
}

/** The only card fields that may cross the network (§3, §10.2). */
export interface PublicCardMeta {
  cardId: string;
  kind: CardDef['kind'];
  level: CardDef['level'];
  title: string;
  artist: string;
  playlist?: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CardFilter {
  kinds?: CardDef['kind'][];
  levels?: CardDef['level'][];
  playlistId?: string;
  /** Case-insensitive substring match on title and artist. */
  search?: string;
}

/**
 * Read-only view of content. The engine, UI and audio engine depend on this, never on where the
 * bytes live.
 */
export interface Catalog {
  readonly packId: string;
  readonly name: string;
  getCard(cardId: string): CardDef | undefined;
  listCards(filter?: CardFilter): CardDef[];
  getSong(songId: string): Song | undefined;
  listPlaylists(): Playlist[];
  getStem(stemId: string): StemLoop | undefined;
  /** The stem a song card sounds as for a role. Undefined when the song has no stem for that role. */
  getStemFor(songId: string, role: Role): StemLoop | undefined;
  /** Encoded audio bytes (FLAC) for a stem. Host device only. */
  getStemAudio(stemId: string): Promise<ArrayBuffer>;
  /** Album art blob for a song, if any. Host device only. */
  getArt(songId: string): Promise<Blob | undefined>;
  /** Plain-data catalog for the engine. */
  toEngineCatalog(): EngineCatalog;
  /** The metadata that may be sent to a room. */
  toPublicMeta(): PublicCardMeta[];
}

/** An opened pack: manifest + catalog. This is what the audio engine attaches. */
export interface PackHandle {
  readonly pack: Pack;
  readonly catalog: Catalog;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface PackSummary {
  packId: string;
  name: string;
  createdAt: string;
  songCount: number;
  cardCount: number;
  /** Total stored bytes. */
  bytes: number;
}

export interface ImportProgress {
  phase: 'reading' | 'validating' | 'writing' | 'done';
  /** 0–1 within the whole import. */
  fraction: number;
  /** File currently being written, if any. */
  file?: string;
}

export type PackErrorCode =
  | 'not_a_zip'
  | 'missing_manifest'
  | 'invalid_manifest'
  | 'unsupported_version'
  | 'missing_file'
  | 'storage_unavailable'
  | 'quota_exceeded'
  | 'not_found';

/** Thrown (as an Error subclass with this shape) by PackStore operations. */
export interface PackErrorShape {
  code: PackErrorCode;
  message: string;
  /** zod issues for `invalid_manifest`. */
  issues?: { path: string; message: string }[];
}

/** Imported packs live in OPFS (IndexedDB fallback). */
export interface PackStore {
  /** Unzip, validate against the schema, and store. Re-importing the same packId replaces it. */
  importPack(file: Blob, onProgress?: (p: ImportProgress) => void): Promise<PackSummary>;
  listPacks(): Promise<PackSummary[]>;
  openPack(packId: string): Promise<PackHandle>;
  deletePack(packId: string): Promise<void>;
}
