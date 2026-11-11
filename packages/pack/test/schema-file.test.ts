/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PACK_SCHEMA_FILE, packSchemaFileText } from '../scripts/schema-file';

describe('schema/pack.schema.json', () => {
  it('is up to date with the zod schema (run `pnpm --filter @stemdeck/pack export-schema`)', () => {
    const committed = readFileSync(PACK_SCHEMA_FILE, 'utf8');
    expect(committed).toBe(packSchemaFileText());
  });
});
