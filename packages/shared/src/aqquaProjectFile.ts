import * as Schema from "effect/Schema";

import { AqquaProjectFile, AQQUA_PROJECT_FILE_SCHEMA_URL } from "@aqqua/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `aqqua.json` file contents (lenient JSONC string) and the
 * decoded {@link AqquaProjectFile}.
 */
export const AqquaProjectFileFromJson = fromLenientJson(AqquaProjectFile);

/**
 * Build the publishable JSON Schema document for `aqqua.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link AQQUA_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildAqquaProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(AqquaProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: AQQUA_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
