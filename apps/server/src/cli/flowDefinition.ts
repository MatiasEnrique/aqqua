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

const FlowDefinitionStepSource = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  name: Schema.Unknown,
  profileName: Schema.Unknown,
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
    return `Unknown agent profile${this.unknownProfileNames.length === 1 ? "" : "s"}: ${unknown}. Available profiles: ${available}.`;
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
  const earlierStepNames = new Set<string>();
  const parameterNames: string[] = [];
  const seenParameterNames = new Set<string>();

  for (const [index, step] of input.definition.steps.entries()) {
    const normalizedName = step.name.toLowerCase();
    if (seenStepNames.has(normalizedName)) {
      return yield* new FlowDefinitionDuplicateStepNameError({ stepName: step.name });
    }
    seenStepNames.add(normalizedName);

    if (sanitizeBoardStepName(step.name) === null) {
      return yield* new FlowDefinitionUnsafeStepNameError({ stepName: step.name });
    }

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

  const availableProfileNames = [
    ...new Set([...input.availableProfileNames, DEFAULT_AGENT_PROFILE_NAME]),
  ].toSorted();
  const availableProfiles = new Set(availableProfileNames);
  const unknownProfileNames = [
    ...new Set(
      input.definition.steps
        .map((step) => step.profileName)
        .filter((profileName) => !availableProfiles.has(profileName)),
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
