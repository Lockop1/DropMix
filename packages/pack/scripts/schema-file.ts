/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { packJsonSchema } from '../src/schema';

/** Where the committed JSON Schema lives. Forge (Python) validates its manifests against it. */
export const PACK_SCHEMA_FILE = fileURLToPath(
  new URL('../schema/pack.schema.json', import.meta.url),
);

/** The exact text `export-schema` writes: pretty JSON with a trailing newline. */
export function packSchemaFileText(): string {
  return `${JSON.stringify(packJsonSchema(), null, 2)}\n`;
}
