import { CardParameters, type OrchestrationBoard, TrimmedNonEmptyString } from "@aqqua/contracts";
import { collectBoardParameterNames } from "@aqqua/shared/boardTemplate";
import { formatSchemaError } from "@aqqua/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

const FlowCardDefinition = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  parameters: CardParameters,
});

export type FlowCardDefinition = typeof FlowCardDefinition.Type;

export class FlowCardDefinitionDecodeError extends Schema.TaggedErrorClass<FlowCardDefinitionDecodeError>()(
  "FlowCardDefinitionDecodeError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Card definition is invalid: ${this.detail}`;
  }
}

export class FlowCardParameterMismatchError extends Schema.TaggedErrorClass<FlowCardParameterMismatchError>()(
  "FlowCardParameterMismatchError",
  {
    missing: Schema.Array(Schema.String),
    unknown: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    const details = [
      ...(this.missing.length === 0 ? [] : [`missing parameters: ${this.missing.join(", ")}`]),
      ...(this.unknown.length === 0 ? [] : [`unknown parameters: ${this.unknown.join(", ")}`]),
    ];
    return `Card parameters do not match the flow (${details.join("; ")}).`;
  }
}

const decodeCardDefinition = Schema.decodeUnknownExit(Schema.fromJsonString(FlowCardDefinition));

export const decodeFlowCardDefinition = Effect.fn("decodeFlowCardDefinition")(function* (
  contents: string,
) {
  const decoded = decodeCardDefinition(contents);
  if (Exit.isFailure(decoded)) {
    return yield* new FlowCardDefinitionDecodeError({
      detail: formatSchemaError(decoded.cause),
    });
  }
  return {
    title: decoded.value.title.trim(),
    parameters: Object.fromEntries(
      Object.entries(decoded.value.parameters).map(([name, value]) => [name, value.trim()]),
    ),
  } satisfies FlowCardDefinition;
});

export const validateFlowCardDefinition = Effect.fn("validateFlowCardDefinition")(function* (
  flow: OrchestrationBoard,
  definition: FlowCardDefinition,
) {
  const required = collectBoardParameterNames(flow.steps.map((step) => step.promptTemplate));
  const requiredSet = new Set(required);
  const missing = required.filter((name) => (definition.parameters[name] ?? "").trim() === "");
  const unknown = Object.keys(definition.parameters)
    .filter((name) => !requiredSet.has(name))
    .toSorted();
  if (missing.length > 0 || unknown.length > 0) {
    return yield* new FlowCardParameterMismatchError({ missing, unknown });
  }
  return definition;
});
