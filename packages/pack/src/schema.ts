/**
 * @stemdeck/pack — zod schemas for pack schemaVersion 1 (owned by the orchestrator).
 *
 * Runtime source of truth for the pack manifest. Each schema is checked against the TypeScript
 * interface it mirrors, so the two cannot drift. `pnpm --filter @stemdeck/pack export-schema`
 * writes the JSON Schema that Forge validates against.
 */

import type { CardDef, FxAction, FxCondition, FxSpec } from '@stemdeck/engine';
import { z } from 'zod';
import type { Pack, Playlist, PublicCardMeta, Song, StemLoop } from './contracts';

const id = z.string().min(1).max(128);
const text = z.string().max(300);
const pitchClass = z.number().int().min(0).max(11);
const mode = z.enum(['major', 'minor']);
const role = z.enum(['lead', 'loop', 'beat', 'bass']);
const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const cardKind = z.enum(['lead', 'loop', 'beat', 'bass', 'wild', 'fx']);
const fxSound = z.enum(['riser', 'downlifter', 'stutter', 'siren', 'subdrop', 'stab']);

export const fxConditionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('slotEmpty') }),
  z.strictObject({ type: z.literal('playedOverRole'), role }),
  z.strictObject({ type: z.literal('controls'), roles: z.array(role).min(1).max(4) }),
  z.strictObject({ type: z.literal('sameSongPair') }),
]) satisfies z.ZodType<FxCondition>;

export const fxActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('points'),
    target: z.enum(['self', 'opponents', 'all']),
    amount: z.number().int().min(-10).max(10),
  }),
  z.strictObject({ type: z.literal('extraMove') }),
  z.strictObject({ type: z.literal('draw'), count: z.number().int().min(1).max(7) }),
  z.strictObject({ type: z.literal('reshuffleHand') }),
  z.strictObject({
    type: z.literal('clear'),
    owner: z.enum(['opponents', 'any']),
    roles: z.array(role).min(1).max(4).optional(),
    maxLevel: level.optional(),
  }),
  z.strictObject({
    type: z.literal('block'),
    roles: z.array(role).min(1).max(4),
    turns: z.number().int().min(1).max(5),
  }),
  z.strictObject({ type: z.literal('stealTop'), slot: z.literal('chosen') }),
]) satisfies z.ZodType<FxAction>;

export const fxSpecSchema = z.strictObject({
  id,
  name: z.string().min(1).max(60),
  text,
  conditions: z.array(fxConditionSchema).max(4),
  actions: z.array(fxActionSchema).min(1).max(4),
  sound: fxSound,
}) satisfies z.ZodType<FxSpec>;

export const cardDefSchema = z
  .strictObject({
    cardId: id,
    songId: id.nullable(),
    kind: cardKind,
    level,
    title: text,
    artist: text,
    playlist: id.optional(),
    fx: fxSpecSchema.optional(),
  })
  .refine((c) => (c.kind === 'fx' ? c.songId === null && c.fx !== undefined : c.songId !== null), {
    message: 'fx cards need songId null and an fx spec; song cards need a songId',
  }) satisfies z.ZodType<CardDef>;

export const publicCardMetaSchema = z.strictObject({
  cardId: id,
  kind: cardKind,
  level,
  title: text,
  artist: text,
  playlist: id.optional(),
}) satisfies z.ZodType<PublicCardMeta>;

export const songSchema = z.strictObject({
  songId: id,
  title: text,
  artist: text,
  album: text.optional(),
  year: z.number().int().min(0).max(3000).optional(),
  genre: text.optional(),
  nativeBpm: z.number().min(30).max(300),
  key: z.strictObject({
    tonic: pitchClass,
    mode,
    confidence: z.number().min(0).max(1),
  }),
  art: z
    .string()
    .regex(/^art\/[A-Za-z0-9._-]+\.webp$/)
    .optional(),
}) satisfies z.ZodType<Song>;

export const stemLoopSchema = z
  .strictObject({
    stemId: id,
    songId: id,
    role,
    file: z.string().regex(/^audio\/[A-Za-z0-9._-]+\.flac$/),
    sampleRate: z.literal(44100),
    handleSamples: z.number().int().min(0),
    loopStartSample: z.number().int().min(0),
    loopEndSample: z.number().int().min(1),
    bars: z.union([z.literal(4), z.literal(8), z.literal(16)]),
    bpm: z.number().min(30).max(300),
    pcs: pitchClass,
    mode,
    chroma: z.array(z.array(z.number().min(0).max(1)).length(12)).max(16),
    entryEvery: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    gainDb: z.number().min(-40).max(40),
    lufs: z.number().min(-100).max(10),
  })
  .refine((s) => s.loopEndSample > s.loopStartSample, {
    message: 'loopEndSample must be greater than loopStartSample',
  }) satisfies z.ZodType<StemLoop>;

export const playlistSchema = z.strictObject({
  id,
  name: z.string().min(1).max(100),
  cardIds: z.array(id),
}) satisfies z.ZodType<Playlist>;

/**
 * Shape-only schema: this is what gets exported as JSON Schema. Cross-reference rules
 * (unique ids, every card/stem pointing at a real song, …) are in `packSchema` below and are
 * re-implemented by Forge's own tests.
 */
export const packShapeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packId: id,
  name: z.string().min(1).max(100),
  createdAt: z.iso.datetime({ offset: true }),
  songs: z.array(songSchema),
  cards: z.array(cardDefSchema),
  stems: z.array(stemLoopSchema),
  playlists: z.array(playlistSchema),
}) satisfies z.ZodType<Pack>;

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }
  return [...dup];
}

/** Full validation: shape + referential integrity. Use this when importing a pack. */
export const packSchema = packShapeSchema.superRefine((pack, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  for (const d of duplicates(pack.songs.map((s) => s.songId))) {
    issue(['songs'], `duplicate songId ${d}`);
  }
  for (const d of duplicates(pack.cards.map((c) => c.cardId))) {
    issue(['cards'], `duplicate cardId ${d}`);
  }
  for (const d of duplicates(pack.stems.map((s) => s.stemId))) {
    issue(['stems'], `duplicate stemId ${d}`);
  }
  for (const d of duplicates(pack.stems.map((s) => `${s.songId}/${s.role}`))) {
    issue(['stems'], `more than one stem for song/role ${d}`);
  }
  for (const d of duplicates(pack.playlists.map((p) => p.id))) {
    issue(['playlists'], `duplicate playlist id ${d}`);
  }

  const songIds = new Set(pack.songs.map((s) => s.songId));
  const cardIds = new Set(pack.cards.map((c) => c.cardId));
  const stemRoles = new Map<string, Set<string>>();
  pack.stems.forEach((stem, i) => {
    if (!songIds.has(stem.songId)) issue(['stems', i, 'songId'], `unknown songId ${stem.songId}`);
    const roles = stemRoles.get(stem.songId) ?? new Set<string>();
    roles.add(stem.role);
    stemRoles.set(stem.songId, roles);
  });

  pack.cards.forEach((card, i) => {
    if (card.songId === null) return;
    if (!songIds.has(card.songId)) {
      issue(['cards', i, 'songId'], `unknown songId ${card.songId}`);
      return;
    }
    const roles = stemRoles.get(card.songId) ?? new Set<string>();
    if (card.kind === 'wild') {
      if (roles.size < 4) issue(['cards', i], 'a wild card needs all four stems of its song');
    } else if (card.kind !== 'fx' && !roles.has(card.kind)) {
      issue(['cards', i], `song ${card.songId} has no ${card.kind} stem`);
    }
  });

  pack.playlists.forEach((pl, i) => {
    pl.cardIds.forEach((cid, j) => {
      if (!cardIds.has(cid)) issue(['playlists', i, 'cardIds', j], `unknown cardId ${cid}`);
    });
  });
});

/** JSON Schema (draft 2020-12) for the pack manifest shape. */
export function packJsonSchema(): unknown {
  return z.toJSONSchema(packShapeSchema, { target: 'draft-2020-12' });
}
