import {
  BoardSnapshot,
  BoardStepId,
  DEFAULT_AGENT_PROFILE_NAME,
  type BoardStep,
} from "@aqqua/contracts";
import { extractBoardTemplatePlaceholders } from "@aqqua/shared/boardTemplate";
import { formatSchemaError } from "@aqqua/shared/schemaJson";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { sanitizeBoardStepName } from "../boardArtifacts.ts";

/**
 * Deliberately permissive: this layer only mints missing step ids. Which
 * selector a step is allowed to carry — canonical `agent`, legacy
 * `profileName`, never both or neither — is `BoardSnapshot`'s job, so an
 * authoring mistake is reported once, in the contract's own words.
 */
const FlowDefinitionStepSource = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  name: Schema.Unknown,
  agent: Schema.optional(Schema.Unknown),
  profileName: Schema.optional(Schema.Unknown),
  promptTemplate: Schema.Unknown,
  continuation: Schema.optional(Schema.Unknown),
});

const FlowDefinitionSource = Schema.Struct({
  name: Schema.Unknown,
  steps: Schema.Array(FlowDefinitionStepSource),
});

export type FlowDefinition = {
  readonly name: string;
  readonly steps: ReadonlyArray<BoardStep>;
};

export type ValidatedFlowDefinition = {
  readonly definition: FlowDefinition;
  readonly parameterNames: ReadonlyArray<string>;
  /** Only legacy `profileName` steps can land here; canonical steps never do. */
  readonly unknownProfileNames: ReadonlyArray<string>;
};

export class FlowDefinitionDecodeError extends Schema.TaggedErrorClass<FlowDefinitionDecodeError>()(
  "FlowDefinitionDecodeError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Flow definition is invalid: ${this.detail}`;
  }
}

export class FlowDefinitionEmptyError extends Schema.TaggedErrorClass<FlowDefinitionEmptyError>()(
  "FlowDefinitionEmptyError",
  {},
) {
  override get message(): string {
    return "A flow must contain at least one step.";
  }
}

export class FlowDefinitionDuplicateStepNameError extends Schema.TaggedErrorClass<FlowDefinitionDuplicateStepNameError>()(
  "FlowDefinitionDuplicateStepNameError",
  {
    stepName: Schema.String,
  },
) {
  override get message(): string {
    return `Flow step names must be unique ignoring case; '${this.stepName}' is repeated.`;
  }
}

export class FlowDefinitionDuplicateStepIdError extends Schema.TaggedErrorClass<FlowDefinitionDuplicateStepIdError>()(
  "FlowDefinitionDuplicateStepIdError",
  {
    stepId: Schema.String,
  },
) {
  override get message(): string {
    return `Flow step ids must be unique; '${this.stepId}' is repeated.`;
  }
}

export class FlowDefinitionUnsafeStepNameError extends Schema.TaggedErrorClass<FlowDefinitionUnsafeStepNameError>()(
  "FlowDefinitionUnsafeStepNameError",
  {
    stepName: Schema.String,
  },
) {
  override get message(): string {
    return `Flow step name '${this.stepName}' cannot be used as an artifact name.`;
  }
}

export class FlowDefinitionDuplicateArtifactNameError extends Schema.TaggedErrorClass<FlowDefinitionDuplicateArtifactNameError>()(
  "FlowDefinitionDuplicateArtifactNameError",
  {
    stepName: Schema.String,
    artifactName: Schema.String,
  },
) {
  override get message(): string {
    return (
      `Flow step name '${this.stepName}' collides with another step after artifact sanitization ` +
      `('${this.artifactName}'); step names must produce unique artifact file names.`
    );
  }
}

export class FlowDefinitionFirstStepArtifactError extends Schema.TaggedErrorClass<FlowDefinitionFirstStepArtifactError>()(
  "FlowDefinitionFirstStepArtifactError",
  {},
) {
  override get message(): string {
    return "The first flow step cannot use ${artifact} because no earlier artifact exists.";
  }
}

export class FlowDefinitionArtifactReferenceError extends Schema.TaggedErrorClass<FlowDefinitionArtifactReferenceError>()(
  "FlowDefinitionArtifactReferenceError",
  {
    stepName: Schema.String,
    referencedStepName: Schema.String,
  },
) {
  override get message(): string {
    return `Flow step '${this.stepName}' references ${"${artifact:"}${this.referencedStepName}} before that exact step name is available.`;
  }
}

export class FlowDefinitionUnknownProfilesError extends Schema.TaggedErrorClass<FlowDefinitionUnknownProfilesError>()(
  "FlowDefinitionUnknownProfilesError",
  {
    unknownProfileNames: Schema.Array(Schema.String),
    availableProfileNames: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    const unknown = this.unknownProfileNames.join(", ");
    const available = this.availableProfileNames.join(", ");
    return `Unknown legacy agent profile${this.unknownProfileNames.length === 1 ? "" : "s"}: ${unknown}. Available profiles: ${available}. Prefer a canonical 'agent' selector: {"instanceId": ..., "model": ...}.`;
  }
}

const decodeFlowDefinitionSource = Schema.decodeUnknownExit(
  Schema.fromJsonString(FlowDefinitionSource),
);
const decodeBoardSnapshot = Schema.decodeUnknownExit(BoardSnapshot);

const decodeFailureDetail = (exit: Exit.Exit<unknown, Schema.SchemaError>): string =>
  exit._tag === "Failure" ? formatSchemaError(exit.cause) : "unknown validation failure";

export const decodeFlowDefinition = Effect.fn("decodeFlowDefinition")(function* (
  contents: string,
  mintStepId: Effect.Effect<string, Error, Crypto.Crypto>,
) {
  const sourceExit = decodeFlowDefinitionSource(contents);
  if (Exit.isFailure(sourceExit)) {
    return yield* new FlowDefinitionDecodeError({
      detail: decodeFailureDetail(sourceExit),
    });
  }

  const steps = yield* Effect.forEach(sourceExit.value.steps, (step) =>
    step.id === undefined
      ? Effect.map(mintStepId, (id) => ({ ...step, id: BoardStepId.make(id) }))
      : Effect.succeed(step),
  );
  const snapshotExit = decodeBoardSnapshot({
    name: sourceExit.value.name,
    steps,
  });
  if (Exit.isFailure(snapshotExit)) {
    return yield* new FlowDefinitionDecodeError({
      detail: decodeFailureDetail(snapshotExit),
    });
  }

  return snapshotExit.value satisfies FlowDefinition;
});

export const validateFlowDefinition = Effect.fn("validateFlowDefinition")(function* (input: {
  readonly definition: FlowDefinition;
  readonly availableProfileNames: ReadonlyArray<string>;
  readonly allowUnknownProfiles: boolean;
}) {
  if (input.definition.steps.length === 0) {
    return yield* new FlowDefinitionEmptyError();
  }

  const seenStepNames = new Set<string>();
  const seenStepIds = new Set<string>();
  const seenArtifactNames = new Set<string>();
  const earlierStepNames = new Set<string>();
  const parameterNames: string[] = [];
  const seenParameterNames = new Set<string>();

  for (const [index, step] of input.definition.steps.entries()) {
    if (seenStepIds.has(step.id)) {
      return yield* new FlowDefinitionDuplicateStepIdError({ stepId: step.id });
    }
    seenStepIds.add(step.id);

    const normalizedName = step.name.toLowerCase();
    if (seenStepNames.has(normalizedName)) {
      return yield* new FlowDefinitionDuplicateStepNameError({ stepName: step.name });
    }
    seenStepNames.add(normalizedName);

    const artifactName = sanitizeBoardStepName(step.name);
    if (artifactName === null) {
      return yield* new FlowDefinitionUnsafeStepNameError({ stepName: step.name });
    }
    if (seenArtifactNames.has(artifactName)) {
      return yield* new FlowDefinitionDuplicateArtifactNameError({
        stepName: step.name,
        artifactName,
      });
    }
    seenArtifactNames.add(artifactName);

    for (const placeholder of extractBoardTemplatePlaceholders(step.promptTemplate)) {
      switch (placeholder.kind) {
        case "artifact-previous":
          if (index === 0) {
            return yield* new FlowDefinitionFirstStepArtifactError();
          }
          break;
        case "artifact-step":
          if (!earlierStepNames.has(placeholder.stepName)) {
            return yield* new FlowDefinitionArtifactReferenceError({
              stepName: step.name,
              referencedStepName: placeholder.stepName,
            });
          }
          break;
        case "parameter":
          if (!seenParameterNames.has(placeholder.name)) {
            seenParameterNames.add(placeholder.name);
            parameterNames.push(placeholder.name);
          }
          break;
        case "card-title":
          break;
      }
    }

    earlierStepNames.add(step.name);
  }

  // Canonical `agent` steps name a provider instance and model on the machine
  // that will *run* the card, which the authoring machine cannot enumerate.
  // They are structurally validated here and catalog-validated at step entry;
  // only legacy profile names are checked against local settings.
  const availableProfileNames = [
    ...new Set([...input.availableProfileNames, DEFAULT_AGENT_PROFILE_NAME]),
  ].toSorted();
  const availableProfiles = new Set(availableProfileNames);
  const unknownProfileNames = [
    ...new Set(
      input.definition.steps.flatMap((step) =>
        step.profileName !== undefined && !availableProfiles.has(step.profileName)
          ? [step.profileName as string]
          : [],
      ),
    ),
  ].toSorted();

  if (unknownProfileNames.length > 0 && !input.allowUnknownProfiles) {
    return yield* new FlowDefinitionUnknownProfilesError({
      unknownProfileNames,
      availableProfileNames,
    });
  }

  return {
    definition: input.definition,
    parameterNames,
    unknownProfileNames,
  } satisfies ValidatedFlowDefinition;
});
