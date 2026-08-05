import {
  AgentProfileName,
  BoardId,
  BoardStepId,
  type OrchestrationBoard,
  ProjectId,
} from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  decodeFlowCardDefinition,
  FlowCardParameterMismatchError,
  validateFlowCardDefinition,
} from "./flowCardDefinition.ts";

const timestamp = "2026-08-05T12:00:00.000Z";
const flow: OrchestrationBoard = {
  id: BoardId.make("flow-1"),
  projectId: ProjectId.make("project-1"),
  name: "Ship",
  steps: [
    {
      id: BoardStepId.make("step-1"),
      name: "Plan",
      profileName: AgentProfileName.make("implementer"),
      continuation: "auto" as const,
      promptTemplate: "Plan ${request} for ${scope}",
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};

it.effect("decodes and trims a card definition", () =>
  Effect.gen(function* () {
    const definition = yield* decodeFlowCardDefinition(
      '{"title":"  Add card commands  ","parameters":{"request":" CLI support ","scope":"server"}}',
    );
    assert.deepStrictEqual(definition, {
      title: "Add card commands",
      parameters: { request: "CLI support", scope: "server" },
    });
  }),
);

it.effect("requires exactly the parameters used by the flow", () =>
  Effect.gen(function* () {
    const missing = yield* Effect.flip(
      validateFlowCardDefinition(flow, {
        title: "Add card commands",
        parameters: { request: "CLI support" },
      }),
    );
    assert.instanceOf(missing, FlowCardParameterMismatchError);
    assert.deepStrictEqual(missing.missing, ["scope"]);
    assert.deepStrictEqual(missing.unknown, []);

    const unknown = yield* Effect.flip(
      validateFlowCardDefinition(flow, {
        title: "Add card commands",
        parameters: { request: "CLI support", scope: "server", typo: "x" },
      }),
    );
    assert.instanceOf(unknown, FlowCardParameterMismatchError);
    assert.deepStrictEqual(unknown.missing, []);
    assert.deepStrictEqual(unknown.unknown, ["typo"]);
  }),
);

it.effect("accepts parameter-free flows without inventing fields", () =>
  Effect.gen(function* () {
    const validated = yield* validateFlowCardDefinition(
      { ...flow, steps: [{ ...flow.steps[0]!, promptTemplate: "Plan the card" }] },
      { title: "Run it", parameters: {} },
    );
    assert.deepStrictEqual(validated.parameters, {});
  }),
);
