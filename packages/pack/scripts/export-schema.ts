/// <reference types="node" />
/**
 * Writes the pack manifest JSON Schema (generated from the zod schema) to
 * packages/pack/schema/pack.schema.json. Run: pnpm --filter @stemdeck/pack export-schema
 * The file is committed; test/schema-file.test.ts fails when it is out of date.
 */
import { writeFileSync } from 'node:fs';
import { PACK_SCHEMA_FILE, packSchemaFileText } from './schema-file';

writeFileSync(PACK_SCHEMA_FILE, packSchemaFileText());
console.log('wrote schema/pack.schema.json');
