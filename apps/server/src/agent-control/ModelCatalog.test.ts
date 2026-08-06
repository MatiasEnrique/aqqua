import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@aqqua/contracts";
import * as Result from "effect/Result";

import {
  type AgentModelSelection,
  listAgentModels,
  resolveAgentModelSelection,
} from "./ModelCatalog.ts";

const reasoningModel = (input: {
  slug: string;
  optionId?: string;
  levels?: ReadonlyArray<string>;
  isDefault?: boolean;
}): ServerProviderModel => ({
  slug: input.slug,
  name: input.slug,
  isCustom: false,
  ...(input.isDefault ? { isDefault: true } : {}),
  capabilities: {
    optionDescriptors: [
      {
        id: input.optionId ?? "reasoningEffort",
        label: "Reasoning",
        type: "select",
        semantic: "reasoning",
        options: (input.levels ?? ["low", "high"]).map((level) => ({ id: level, label: level })),
      },
      { id: "serviceTier", label: "Service Tier", type: "select", options: [] },
    ],
  },
});

const plainModel = (slug: string, isDefault = false): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  ...(isDefault ? { isDefault: true } : {}),
  capabilities: null,
});

const provider = (input: {
  instanceId: string;
  driver: string;
  models: ReadonlyArray<ServerProviderModel>;
  displayName?: string;
  overrides?: Partial<ServerProvider>;
}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(input.instanceId),
  driver: ProviderDriverKind.make(input.driver),
  ...(input.displayName ? { displayName: input.displayName } : {}),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-05T00:00:00.000Z",
  models: input.models,
  slashCommands: [],
  skills: [],
  ...input.overrides,
});

const grok = provider({
  instanceId: "grok",
  driver: "grok",
  displayName: "Grok",
  models: [reasoningModel({ slug: "grok-build", levels: ["low", "medium", "high"] })],
});

const pi = provider({
  instanceId: "pi_work",
  driver: "pi",
  displayName: "pi",
  models: [
    plainModel("openrouter/anthropic/claude-sonnet-5"),
    reasoningModel({ slug: "anthropic/claude-sonnet-5", isDefault: true }),
  ],
});

const selection = (input: Partial<AgentModelSelection> = {}): AgentModelSelection => ({
  model: input.model ?? null,
  ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
});

const resolve = (input: {
  providers?: ReadonlyArray<ServerProvider>;
  projectDefaultModelSelection?: ModelSelection | null;
  selection?: AgentModelSelection;
}) =>
  resolveAgentModelSelection({
    providers: input.providers ?? [grok, pi],
    projectDefaultModelSelection: input.projectDefaultModelSelection ?? null,
    selection: input.selection ?? selection(),
  });

const expectSuccess = <A, E>(result: Result.Result<A, E>): A => {
  assert.ok(Result.isSuccess(result), "expected the catalog to resolve");
  return result.success;
};

const expectFailure = <A, E>(result: Result.Result<A, E>): E => {
  assert.ok(Result.isFailure(result), "expected the catalog to reject the selection");
  return result.failure;
};

const identity = (instanceId: string, model: string) => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

// ── listing ───────────────────────────────────────────────────────────

it("flattens every configured instance's models, keeping duplicate slugs distinct", () => {
  const grokTwo = provider({
    instanceId: "grok_personal",
    driver: "grok",
    models: [reasoningModel({ slug: "grok-build" })],
  });

  const rows = listAgentModels({
    providers: [grok, grokTwo],
    projectDefaultModelSelection: null,
  });

  assert.deepStrictEqual(
    rows.map((row) => `${row.instanceId}/${row.model.slug}`),
    ["grok/grok-build", "grok_personal/grok-build"],
  );
});

it("preserves exact model slugs with dots and slashes", () => {
  const rows = listAgentModels({ providers: [pi], projectDefaultModelSelection: null });

  assert.deepStrictEqual(
    rows.map((row) => row.model.slug),
    ["openrouter/anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5"],
  );
});

it("lists an unspawnable provider's models with the provider's own reason", () => {
  const broken = provider({
    instanceId: "opencode",
    driver: "opencode",
    models: [plainModel("openai/gpt-5")],
    overrides: {
      installed: false,
      status: "error",
      message: "OpenCode CLI is not installed.",
    },
  });

  const [row] = listAgentModels({ providers: [broken], projectDefaultModelSelection: null });

  assert.equal(row?.available, false);
  assert.equal(row?.unavailableReason, "OpenCode CLI is not installed.");
});

it("marks the row an unselected spawn would land on", () => {
  const rows = listAgentModels({
    providers: [grok, pi],
    projectDefaultModelSelection: identity("pi_work", "anthropic/claude-sonnet-5"),
  });

  assert.deepStrictEqual(
    rows.filter((row) => row.isProjectDefault).map((row) => row.model.slug),
    ["anthropic/claude-sonnet-5"],
  );
});

it("marks the deterministic fallback when the project has no default", () => {
  const rows = listAgentModels({
    providers: [pi, grok],
    projectDefaultModelSelection: null,
  });

  assert.deepStrictEqual(
    rows.filter((row) => row.isProjectDefault).map((row) => `${row.instanceId}/${row.model.slug}`),
    ["pi_work/anthropic/claude-sonnet-5"],
  );
});

it("reports the driver and display name each row belongs to", () => {
  const [row] = listAgentModels({ providers: [grok], projectDefaultModelSelection: null });

  assert.equal(row?.driverKind, ProviderDriverKind.make("grok"));
  assert.equal(row?.providerName, "Grok");
});

// ── resolution ────────────────────────────────────────────────────────

it("resolves an exact instance and model to a session launch", () => {
  const launch = expectSuccess(
    resolve({ selection: selection({ model: identity("pi_work", "anthropic/claude-sonnet-5") }) }),
  );

  assert.equal(launch.driverKind, ProviderDriverKind.make("pi"));
  assert.deepStrictEqual(launch.modelSelection, {
    instanceId: ProviderInstanceId.make("pi_work"),
    model: "anthropic/claude-sonnet-5",
  });
  // The PTY path cannot enforce a model or its options, so a catalog launch is
  // always hosted through a provider adapter.
  assert.equal(launch.runtime, "session");
  assert.equal(launch.runtimeMode, "full-access");
  assert.equal(launch.interactionMode, "default");
  assert.equal(launch.titlePrefix, "anthropic/claude-sonnet-5");
});

it("treats the same slug on two instances as two distinct rows, not an ambiguity", () => {
  const grokTwo = provider({
    instanceId: "grok_personal",
    driver: "grok",
    models: [reasoningModel({ slug: "grok-build" })],
  });

  const launch = expectSuccess(
    resolve({
      providers: [grok, grokTwo],
      selection: selection({ model: identity("grok_personal", "grok-build") }),
    }),
  );

  assert.equal(launch.modelSelection.instanceId, ProviderInstanceId.make("grok_personal"));
});

it("uses the project default when the caller names no model", () => {
  const launch = expectSuccess(
    resolve({ projectDefaultModelSelection: identity("grok", "grok-build") }),
  );

  assert.equal(launch.modelSelection.instanceId, ProviderInstanceId.make("grok"));
  assert.equal(launch.modelSelection.model, "grok-build");
});

it("validates the project default rather than trusting it", () => {
  const failure = expectFailure(
    resolve({ projectDefaultModelSelection: identity("grok", "grok-retired") }),
  );

  assert.equal(failure._tag, "AgentModelUnknownError");
});

it("falls back to the first spawnable provider's default model with no project default", () => {
  const launch = expectSuccess(resolve({ providers: [pi, grok] }));

  assert.equal(launch.modelSelection.instanceId, ProviderInstanceId.make("pi_work"));
  // pi's snapshot flags a default model; it wins over mere listing order.
  assert.equal(launch.modelSelection.model, "anthropic/claude-sonnet-5");
});

it("falls back to a provider's first model when none is flagged default", () => {
  const unflagged = provider({
    instanceId: "codex",
    driver: "codex",
    models: [plainModel("gpt-5.6-sol"), plainModel("gpt-5.6-terra")],
  });

  const launch = expectSuccess(resolve({ providers: [unflagged] }));

  assert.equal(launch.modelSelection.model, "gpt-5.6-sol");
});

it("skips unspawnable providers when choosing the fallback", () => {
  const disabled = provider({
    instanceId: "codex",
    driver: "codex",
    models: [plainModel("gpt-5.6-sol")],
    overrides: { enabled: false, status: "disabled" },
  });

  const launch = expectSuccess(resolve({ providers: [disabled, grok] }));

  assert.equal(launch.modelSelection.instanceId, ProviderInstanceId.make("grok"));
});

it("reports an empty catalog instead of inventing a provider", () => {
  const failure = expectFailure(resolve({ providers: [] }));

  assert.equal(failure._tag, "AgentModelCatalogEmptyError");
});

// ── rejection ─────────────────────────────────────────────────────────

it("rejects an unknown instance and says which ones exist", () => {
  const failure = expectFailure(
    resolve({ selection: selection({ model: identity("grok_typo", "grok-build") }) }),
  );

  assert.equal(failure._tag, "AgentModelInstanceUnknownError");
  assert.match(failure.message, /grok_typo/);
  assert.match(failure.message, /pi_work/);
});

it("distinguishes each way an instance can be unusable", () => {
  const cases = [
    { overrides: { enabled: false, status: "disabled" as const }, expect: /disabled/ },
    { overrides: { installed: false }, expect: /not installed/ },
    {
      overrides: {
        status: "warning" as const,
        auth: { status: "unknown" as const },
        message: "Checking Grok CLI availability...",
      },
      expect: /Checking Grok CLI availability/,
    },
    { overrides: { status: "error" as const }, expect: /error/ },
    {
      overrides: { auth: { status: "unauthenticated" as const } },
      expect: /not signed in|authenticat/,
    },
    { overrides: { availability: "unavailable" as const }, expect: /does not ship/ },
  ];

  for (const testCase of cases) {
    const failure = expectFailure(
      resolve({
        providers: [
          provider({
            instanceId: "grok",
            driver: "grok",
            models: [reasoningModel({ slug: "grok-build" })],
            overrides: testCase.overrides,
          }),
        ],
        selection: selection({ model: identity("grok", "grok-build") }),
      }),
    );

    assert.equal(failure._tag, "AgentModelInstanceUnavailableError");
    assert.match(failure.message, testCase.expect);
  }
});

it("rejects an unknown model on a known instance", () => {
  const failure = expectFailure(
    resolve({ selection: selection({ model: identity("grok", "grok-fast") }) }),
  );

  assert.equal(failure._tag, "AgentModelUnknownError");
  assert.match(failure.message, /grok-fast/);
  assert.match(failure.message, /grok-build/);
});

// ── reasoning ─────────────────────────────────────────────────────────

it("adds no option override when reasoning is omitted", () => {
  const launch = expectSuccess(
    resolve({ selection: selection({ model: identity("grok", "grok-build") }) }),
  );

  assert.equal(launch.modelSelection.options, undefined);
});

it("writes reasoning to the provider-native option id the model advertises", () => {
  const claude = provider({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    models: [
      reasoningModel({ slug: "claude-opus-5", optionId: "effort", levels: ["high", "max"] }),
    ],
  });

  const launch = expectSuccess(
    resolve({
      providers: [claude],
      selection: selection({ model: identity("claudeAgent", "claude-opus-5"), reasoning: "max" }),
    }),
  );

  assert.deepStrictEqual(launch.modelSelection.options, [{ id: "effort", value: "max" }]);
});

it("preserves generic options and replaces only the reasoning selection", () => {
  const launch = expectSuccess(
    resolve({
      selection: selection({
        model: {
          ...identity("grok", "grok-build"),
          options: [
            { id: "serviceTier", value: "priority" },
            { id: "reasoningEffort", value: "low" },
          ],
        },
        reasoning: "high",
      }),
    }),
  );

  assert.deepStrictEqual(launch.modelSelection.options, [
    { id: "serviceTier", value: "priority" },
    { id: "reasoningEffort", value: "high" },
  ]);
});

it("validates a provider-native reasoning option when the semantic field is omitted", () => {
  const failure = expectFailure(
    resolve({
      selection: selection({
        model: {
          ...identity("grok", "grok-build"),
          options: [{ id: "reasoningEffort", value: "ultra" }],
        },
      }),
    }),
  );

  assert.equal(failure._tag, "AgentModelReasoningInvalidError");
  assert.match(failure.message, /ultra/);
  assert.match(failure.message, /low, medium, high/);
});

it("preserves a valid provider-native reasoning option", () => {
  const launch = expectSuccess(
    resolve({
      selection: selection({
        model: {
          ...identity("grok", "grok-build"),
          options: [{ id: "reasoningEffort", value: "medium" }],
        },
      }),
    }),
  );

  assert.deepStrictEqual(launch.modelSelection.options, [
    { id: "reasoningEffort", value: "medium" },
  ]);
});

it("rejects an explicit reasoning level on a model that advertises no reasoning control", () => {
  const failure = expectFailure(
    resolve({
      selection: selection({
        model: identity("pi_work", "openrouter/anthropic/claude-sonnet-5"),
        reasoning: "high",
      }),
    }),
  );

  assert.equal(failure._tag, "AgentModelReasoningUnsupportedError");
});

it("rejects a reasoning level the model does not advertise, listing what it takes", () => {
  const failure = expectFailure(
    resolve({
      selection: selection({ model: identity("grok", "grok-build"), reasoning: "ultra" }),
    }),
  );

  assert.equal(failure._tag, "AgentModelReasoningInvalidError");
  assert.match(failure.message, /ultra/);
  assert.match(failure.message, /low, medium, high/);
});
