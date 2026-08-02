import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in aqqua project file, resolved at the workspace root. */
export const AQQUA_PROJECT_FILE_NAME = "aqqua.json";

/** Public URL of the published JSON Schema for {@link AqquaProjectFile}. */
export const AQQUA_PROJECT_FILE_SCHEMA_URL = "https://aqqua.codes/schema/aqqua.json";

const AQQUA_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const AQQUA_PROJECT_FILE_MAX_SCRIPTS = 50;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const AqquaProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the aqqua scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in an aqqua terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into aqqua.",
});
export type AqquaProjectFileScript = typeof AqquaProjectFileScript.Type;

export const AqquaProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${AQQUA_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before aqqua\'s built-in icon locations.',
      },
      AQQUA_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(AqquaProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in aqqua.",
      })
      .check(Schema.isMaxLength(AQQUA_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "aqqua project file",
  description:
    "Checked-in project configuration for aqqua (aqqua.json at the repository root). See https://aqqua.codes for documentation.",
});
export type AqquaProjectFile = typeof AqquaProjectFile.Type;
