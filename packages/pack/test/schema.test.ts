import { describe, expect, it } from 'vitest';
import {
  PACK_EXTENSION,
  PACK_MANIFEST,
  PACK_SCHEMA_VERSION,
  packJsonSchema,
  packSchema,
  packShapeSchema,
} from '../src';
import { minimalPack } from './fixtures';

describe('pack schema', () => {
  it('constants', () => {
    expect(PACK_SCHEMA_VERSION).toBe(1);
    expect(PACK_EXTENSION).toBe('.stemdeck');
    expect(PACK_MANIFEST).toBe('pack.json');
  });

  it('accepts a minimal valid manifest', () => {
    expect(packShapeSchema.safeParse(minimalPack()).success).toBe(true);
    expect(packSchema.safeParse(minimalPack()).success).toBe(true);
  });

  it('rejects a manifest with schemaVersion 2', () => {
    const result = packShapeSchema.safeParse({ ...minimalPack(), schemaVersion: 2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['schemaVersion']);
  });

  it('rejects a card that points at an unknown song (referential check)', () => {
    const pack = minimalPack();
    const [card] = pack.cards;
    if (!card) throw new Error('fixture has a card');
    pack.cards = [{ ...card, songId: 'missing' }];
    expect(packShapeSchema.safeParse(pack).success).toBe(true);
    expect(packSchema.safeParse(pack).success).toBe(false);
  });

  it('packJsonSchema() returns a draft 2020-12 object schema', () => {
    const schema = packJsonSchema() as Record<string, unknown>;
    expect(schema.type).toBe('object');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'packId', 'songs', 'cards', 'stems']),
    );
  });
});
