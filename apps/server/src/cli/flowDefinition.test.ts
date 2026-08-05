import { AgentProfileName, BoardStepId, ProviderInstanceId } from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import {
  decodeFlowDefinition,
  FlowDefinitionDecodeError,
  FlowDefinitionUnknownProfilesError,
  type FlowDefinition,
  validateFlowDefinition,
} from "./flowDefinition.ts";

const definition = (steps: FlowDefinition["steps"], name = "Ship a feature"): FlowDefinition => ({
  name,
  steps,
});

const step = (
  name: string,
  promptTemplate: string,
  profileName = "implementer",
  id = `step-${name}`,
) => ({
  id: BoardStepId.make(id),
  name,
  promptTemplate,
  profileName: AgentProfileName.make(profileName),
  continuation: "auto" as const,
});

const agentStep = (
  name: string,
  promptTemplate: string,
  agent: { instanceId: string; model: string; reasoning?: string } = {
    instanceId: "codex",
    model: "gpt-5-codex",
  },
  id = `step-${name}`,
) => ({
  id: BoardStepId.make(id),
  name,
  promptTemplate,
  agent: {
    instanceId: ProviderInstanceId.make(agent.instanceId),
    model: agent.model,
    ...(agent.reasoning === undefined ? {} : { reasoning: agent.reasoning }),
  },
  continuation: "auto" as const,
});

it.effect(
  "decodes through the flow contracts, defaults continuation, and preserves supplied ids",
  () =>
    Effect.gen(function* () {
      let minted = 0;
      const decoded = yield* decodeFlowDefinition(
        `{
        "name": "Ship a feature",
        "steps": [
          {
            "name": "Plan",
            "profileName": "Planning",
            "promptTemplate": "Plan \${request}"
          },
          {
            "id": "kept-id",
            "name": "Implement",
            "profileName": "implementer",
            "promptTemplate": "Implement \${artifact}",
            "continuation": "manual"
          }
        ]
      }`,
        Effect.sync(() => `minted-${++minted}`),
      ).pipe(Effect.provide(NodeServices.layer));

      assert.strictEqual(decoded.steps[0]?.id, "minted-1");
      assert.strictEqual(decoded.steps[0]?.continuation, "auto");
      assert.strictEqual(decoded.steps[1]?.id, "kept-id");
      assert.strictEqual(decoded.steps[1]?.continuation, "manual");
    }),
);

it.effect("decodes canonical agent steps alongside legacy profileName steps", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeFlowDefinition(
      `{
        "name": "Ship a feature",
        "steps": [
          {
            "name": "Plan",
            "agent": {
              "instanceId": "codex",
              "model": "gpt-5-codex",
              "reasoning": "high"
            },
            "promptTemplate": "Plan \${request}"
          },
          {
            "name": "Implement",
            "profileName": "implementer",
            "promptTemplate": "Implement \${artifact}"
          }
        ]
      }`,
      Effect.succeed("minted"),
    ).pipe(Effect.provide(NodeServices.layer));

    assert.deepStrictEqual(decoded.steps[0]?.agent, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
      reasoning: "high",
    });
    assert.strictEqual(decoded.steps[0]?.profileName, undefined);
    assert.strictEqual(decoded.steps[1]?.profileName, "implementer");
    assert.strictEqual(decoded.steps[1]?.agent, undefined);
  }),
);

// Which selectors a step may carry is `BoardSnapshot`'s rule, not the CLI's;
// the CLI only has to surface the rejection against the offending step.
const ambiguousSelectorCases = [
  {
    name: "a step naming both selectors",
    step: `{"name":"Plan","agent":{"instanceId":"codex","model":"gpt-5-codex"},"profileName":"implementer","promptTemplate":"Plan"}`,
  },
  {
    name: "a step naming neither selector",
    step: `{"name":"Plan","promptTemplate":"Plan"}`,
  },
] as const;

for (const testCase of ambiguousSelectorCases) {
  it.effect(`rejects ${testCase.name}`, () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decodeFlowDefinition(
          `{"name":"Flow","steps":[${testCase.step}]}`,
          Effect.succeed("step-1"),
        ).pipe(Effect.provide(NodeServices.layer)),
      );
      assert.instanceOf(failure, FlowDefinitionDecodeError);
      assert.include(failure.message, `["steps"][0]`);
    }),
  );
}

it.effect("rejects contract violations before custom validation", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      decodeFlowDefinition(
        `{"name":"Flow","steps":[{"name":"Plan","profileName":"bad profile","promptTemplate":"Plan"}]}`,
        Effect.succeed("step-1"),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
    assert.instanceOf(failure, FlowDefinitionDecodeError);
    assert.include(failure.message, "Flow definition is invalid");
  }),
);

const invalidCases = [
  {
    name: "an empty flow",
    value: definition([]),
    errorTag: "FlowDefinitionEmptyError",
  },
  {
    name: "case-colliding step names",
    value: definition([step("Plan", "Plan"), step("plan", "Implement")]),
    errorTag: "FlowDefinitionDuplicateStepNameError",
  },
  {
    name: "duplicate step ids",
    value: definition([
      step("Plan", "Plan", "implementer", "same-id"),
      step("Implement", "Implement", "implementer", "same-id"),
    ]),
    errorTag: "FlowDefinitionDuplicateStepIdError",
  },
  {
    name: "sanitized artifact name collisions",
    value: definition([step("Plan A", "Plan"), step("Plan-A", "Implement")]),
    errorTag: "FlowDefinitionDuplicateArtifactNameError",
  },
  {
    name: "a traversal step name",
    value: definition([step("../x", "Plan")]),
    errorTag: "FlowDefinitionUnsafeStepNameError",
  },
  {
    name: "a hidden step name",
    value: definition([step(".hidden", "Plan")]),
    errorTag: "FlowDefinitionUnsafeStepNameError",
  },
  {
    name: "the previous-artifact placeholder in the first step",
    value: definition([step("Plan", "Use ${artifact}")]),
    errorTag: "FlowDefinitionFirstStepArtifactError",
  },
  {
    name: "a forward named-artifact reference",
    value: definition([step("Plan", "Use ${artifact:Implement}"), step("Implement", "Implement")]),
    errorTag: "FlowDefinitionArtifactReferenceError",
  },
  {
    name: "a named-artifact reference with the wrong case",
    value: definition([step("Plan", "Plan"), step("Implement", "Use ${artifact:plan}")]),
    errorTag: "FlowDefinitionArtifactReferenceError",
  },
] as const;

for (const testCase of invalidCases) {
  it.effect(`rejects ${testCase.name}`, () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        validateFlowDefinition({
          definition: testCase.value,
          availableProfileNames: [],
          allowUnknownProfiles: false,
        }),
      );
      assert.strictEqual(failure._tag, testCase.errorTag);
    }),
  );
}

it.effect(
  "collects distinct card parameters in first-seen order and accepts earlier artifacts",
  () =>
    Effect.gen(function* () {
      const result = yield* validateFlowDefinition({
        definition: definition([
          step("Plan", "Plan ${card_title}: ${request} ${priority}"),
          step("Implement", "Use ${artifact} and ${artifact:Plan}; answer ${request}"),
        ]),
        availableProfileNames: [],
        allowUnknownProfiles: false,
      });

      assert.deepStrictEqual(result.parameterNames, ["request", "priority"]);
      assert.deepStrictEqual(result.unknownProfileNames, []);
    }),
);

it.effect("rejects unknown profiles and lists the built-in plus configured profiles", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      validateFlowDefinition({
        definition: definition([step("Plan", "Plan", "Planning")]),
        availableProfileNames: ["reviewer"],
        allowUnknownProfiles: false,
      }),
    );

    assert.instanceOf(failure, FlowDefinitionUnknownProfilesError);
    assert.include(failure.message, "Planning");
    assert.include(failure.message, "implementer");
    assert.include(failure.message, "reviewer");
  }),
);

it.effect("never treats a canonical agent step as an unknown profile", () =>
  Effect.gen(function* () {
    const result = yield* validateFlowDefinition({
      definition: definition([
        agentStep("Plan", "Plan ${request}", {
          instanceId: "not_on_this_machine",
          model: "some-model",
          reasoning: "high",
        }),
        agentStep("Implement", "Use ${artifact}"),
      ]),
      availableProfileNames: [],
      allowUnknownProfiles: false,
    });

    assert.deepStrictEqual(result.unknownProfileNames, []);
    assert.deepStrictEqual(result.parameterNames, ["request"]);
  }),
);

it.effect("warns only about the legacy steps in a mixed flow", () =>
  Effect.gen(function* () {
    const result = yield* validateFlowDefinition({
      definition: definition([
        agentStep("Plan", "Plan ${request}"),
        step("Implement", "Use ${artifact}", "Planning"),
      ]),
      availableProfileNames: [],
      allowUnknownProfiles: true,
    });

    assert.deepStrictEqual(result.unknownProfileNames, ["Planning"]);
  }),
);

it.effect("allows unknown profiles with an explicit warning payload", () =>
  Effect.gen(function* () {
    const result = yield* validateFlowDefinition({
      definition: definition([step("Plan", "Plan", "Planning")]),
      availableProfileNames: [],
      allowUnknownProfiles: true,
    });

    assert.deepStrictEqual(result.unknownProfileNames, ["Planning"]);
  }),
);
