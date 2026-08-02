import {
  type AgentProfile,
  type AgentProfileMap,
  DEFAULT_AGENT_PROFILE_DRIVER,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  agentProfileFromDraft,
  buildAgentProfileRows,
  buildProviderChoices,
  builtInImplementerDraft,
  DEFAULT_AGENT_PROFILE_DRAFT,
  deleteAgentProfile,
  describeAgentProfileModel,
  describeAgentProfileProvider,
  draftFromAgentProfile,
  driverTarget,
  findProviderChoice,
  instanceTarget,
  parseProviderChoiceValue,
  providerChoiceValue,
  pruneAgentProfileOptions,
  selectOptionDescriptorsForModel,
  setAgentProfileOption,
  summarizeAgentProfileOptions,
  toAgentProfileMap,
  upsertAgentProfile,
  validateAgentProfileName,
} from "./AgentProfilesSettings.logic";

const DRIVER_LABELS = { codex: "Codex", grok: "Grok", claudeAgent: "Claude" };

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    runtime: "session",
    target: driverTarget(DEFAULT_AGENT_PROFILE_DRIVER),
    runtimeMode: "full-access",
    interactionMode: "default",
    ...overrides,
  };
}

function asMap(record: Record<string, AgentProfile>): AgentProfileMap {
  return toAgentProfileMap(record);
}

function entry(overrides: Partial<ProviderInstanceEntry> = {}): ProviderInstanceEntry {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driverKind: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [],
    ...overrides,
  } as ProviderInstanceEntry;
}

describe("validateAgentProfileName", () => {
  it("accepts a legal name", () => {
    expect(validateAgentProfileName({ name: "grok-fast_2", existingNames: [] })).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validateAgentProfileName({ name: "  ", existingNames: [] })).toMatch(/required/);
  });

  it("rejects names that do not start with a letter", () => {
    expect(validateAgentProfileName({ name: "1grok", existingNames: [] })).toMatch(/start with/);
    expect(validateAgentProfileName({ name: "_grok", existingNames: [] })).toMatch(/start with/);
    expect(validateAgentProfileName({ name: "gr ok", existingNames: [] })).toMatch(/start with/);
    expect(validateAgentProfileName({ name: "gr.ok", existingNames: [] })).toMatch(/start with/);
  });

  it("rejects names longer than 64 characters", () => {
    expect(validateAgentProfileName({ name: `a${"b".repeat(64)}`, existingNames: [] })).toMatch(
      /64 characters/,
    );
    expect(validateAgentProfileName({ name: `a${"b".repeat(63)}`, existingNames: [] })).toBeNull();
  });

  it("rejects a duplicate name case-sensitively", () => {
    expect(validateAgentProfileName({ name: "grok", existingNames: ["grok"] })).toMatch(
      /already exists/,
    );
    expect(validateAgentProfileName({ name: "Grok", existingNames: ["grok"] })).toBeNull();
  });

  it("allows re-saving the profile being edited under its own name", () => {
    expect(
      validateAgentProfileName({ name: "grok", existingNames: ["grok"], originalName: "grok" }),
    ).toBeNull();
  });

  it("still rejects renaming onto another existing profile", () => {
    expect(
      validateAgentProfileName({ name: "cc", existingNames: ["grok", "cc"], originalName: "grok" }),
    ).toMatch(/already exists/);
  });
});

describe("upsertAgentProfile", () => {
  it("appends a new profile", () => {
    const next = upsertAgentProfile({
      map: asMap({ grok: profile() }),
      name: "cc",
      profile: profile({ target: driverTarget(ProviderDriverKind.make("claudeAgent")) }),
    });
    expect(Object.keys(next)).toEqual(["grok", "cc"]);
  });

  it("replaces a profile in place without renaming", () => {
    const next = upsertAgentProfile({
      map: asMap({ a: profile(), grok: profile(), z: profile() }),
      originalName: "grok",
      name: "grok",
      profile: profile({ titlePrefix: "gk" }),
    });
    expect(Object.keys(next)).toEqual(["a", "grok", "z"]);
    expect(next["grok" as keyof typeof next]?.titlePrefix).toBe("gk");
  });

  it("renames by dropping the old key and writing the new one in its position", () => {
    const next = upsertAgentProfile({
      map: asMap({ a: profile(), grok: profile({ titlePrefix: "gk" }), z: profile() }),
      originalName: "grok",
      name: "fable",
      profile: profile({ titlePrefix: "fb" }),
    });
    expect(Object.keys(next)).toEqual(["a", "fable", "z"]);
    expect(next["grok" as keyof typeof next]).toBeUndefined();
    expect(next["fable" as keyof typeof next]?.titlePrefix).toBe("fb");
  });

  it("does not mutate the source map", () => {
    const source = asMap({ grok: profile() });
    upsertAgentProfile({ map: source, originalName: "grok", name: "fable", profile: profile() });
    expect(Object.keys(source)).toEqual(["grok"]);
  });

  it("treats an undefined map as empty", () => {
    const next = upsertAgentProfile({ map: undefined, name: "grok", profile: profile() });
    expect(Object.keys(next)).toEqual(["grok"]);
  });
});

describe("deleteAgentProfile", () => {
  it("returns the whole map without the key", () => {
    const next = deleteAgentProfile(asMap({ a: profile(), grok: profile() }), "grok");
    expect(Object.keys(next)).toEqual(["a"]);
  });

  it("is a no-op for an unknown name", () => {
    const next = deleteAgentProfile(asMap({ a: profile() }), "nope");
    expect(Object.keys(next)).toEqual(["a"]);
  });
});

describe("agentProfileFromDraft", () => {
  it("omits model, options, and titlePrefix when nothing is chosen", () => {
    const built = agentProfileFromDraft(DEFAULT_AGENT_PROFILE_DRAFT);
    expect(built).toEqual({
      runtime: "session",
      target: { kind: "driver", driver: "codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    expect("model" in built).toBe(false);
    expect("options" in built).toBe(false);
    expect("titlePrefix" in built).toBe(false);
    expect("instanceId" in built).toBe(false);
    expect("driver" in built).toBe(false);
  });

  it("writes an instance target for a pinned instance", () => {
    const built = agentProfileFromDraft({
      ...DEFAULT_AGENT_PROFILE_DRAFT,
      provider: instanceTarget(ProviderInstanceId.make("codex_work")),
    });
    expect(built.target).toEqual({ kind: "instance", instanceId: "codex_work" });
  });

  it("writes a driver target for a driver selection", () => {
    const built = agentProfileFromDraft({
      ...DEFAULT_AGENT_PROFILE_DRAFT,
      provider: driverTarget(ProviderDriverKind.make("claudeAgent")),
    });
    expect(built.target).toEqual({ kind: "driver", driver: "claudeAgent" });
  });

  it("keeps a chosen model, options, and trimmed title prefix", () => {
    const built = agentProfileFromDraft({
      ...DEFAULT_AGENT_PROFILE_DRAFT,
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
      titlePrefix: "  impl  ",
      runtime: "terminal",
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    expect(built).toMatchObject({
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
      titlePrefix: "impl",
      runtime: "terminal",
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
  });

  it("round-trips through draftFromAgentProfile", () => {
    const original = profile({
      target: instanceTarget(ProviderInstanceId.make("codex_work")),
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
      titlePrefix: "impl",
    });
    expect(agentProfileFromDraft(draftFromAgentProfile("grok", original))).toEqual(original);
  });
});

describe("options editing", () => {
  it("sets, replaces, and clears a selection", () => {
    let options = setAgentProfileOption([], "reasoningEffort", "high");
    expect(options).toEqual([{ id: "reasoningEffort", value: "high" }]);
    options = setAgentProfileOption(options, "reasoningEffort", "low");
    expect(options).toEqual([{ id: "reasoningEffort", value: "low" }]);
    expect(setAgentProfileOption(options, "reasoningEffort", null)).toEqual([]);
    expect(setAgentProfileOption(options, "reasoningEffort", "  ")).toEqual([]);
  });

  it("prunes selections the selected model does not declare", () => {
    const pruned = pruneAgentProfileOptions(
      [
        { id: "reasoningEffort", value: "high" },
        { id: "stale", value: "x" },
      ],
      [{ id: "reasoningEffort", type: "select", label: "Reasoning", options: [] }],
    );
    expect(pruned).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });
});

describe("provider choices", () => {
  const entries = [
    entry(),
    entry({
      instanceId: ProviderInstanceId.make("codex_work"),
      displayName: "Codex Work",
      isDefault: false,
    }),
    entry({
      instanceId: ProviderInstanceId.make("grok"),
      driverKind: ProviderDriverKind.make("grok"),
      displayName: "Grok",
      models: [
        {
          slug: "grok-4",
          name: "Grok 4",
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                type: "select",
                label: "Reasoning",
                options: [{ id: "high", label: "High" }],
              },
              { id: "fastMode", type: "boolean", label: "Fast mode" },
            ],
          },
        } as never,
      ],
    }),
    entry({
      instanceId: ProviderInstanceId.make("claude"),
      driverKind: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      enabled: false,
    }),
  ];

  it("lists enabled instances then one fallback per driver, skipping disabled instances", () => {
    const choices = buildProviderChoices({ entries, driverLabels: DRIVER_LABELS });
    expect(choices.map((choice) => choice.value)).toEqual([
      "instance:codex",
      "instance:codex_work",
      "instance:grok",
      "driver:codex",
      "driver:grok",
    ]);
    expect(choices.at(-1)?.label).toBe("First enabled Grok");
  });

  it("keeps the codex fallback reachable when no codex instance is enabled", () => {
    const choices = buildProviderChoices({ entries: [], driverLabels: DRIVER_LABELS });
    expect(choices.map((choice) => choice.value)).toEqual(["driver:codex"]);
    expect(choices[0]?.models).toEqual([]);
  });

  it("round-trips selection values", () => {
    const selection = instanceTarget(ProviderInstanceId.make("codex_work"));
    expect(parseProviderChoiceValue(providerChoiceValue(selection))).toEqual(selection);
    expect(parseProviderChoiceValue("driver:codex")).toEqual({ kind: "driver", driver: "codex" });
    expect(parseProviderChoiceValue("nonsense")).toBeNull();
    expect(parseProviderChoiceValue("instance:")).toBeNull();
    expect(parseProviderChoiceValue("driver:1bad")).toBeNull();
  });

  it("returns undefined for a selection whose instance is gone", () => {
    const choices = buildProviderChoices({ entries, driverLabels: DRIVER_LABELS });
    expect(
      findProviderChoice(choices, instanceTarget(ProviderInstanceId.make("ghost"))),
    ).toBeUndefined();
  });

  it("exposes only select descriptors for the chosen model", () => {
    const choices = buildProviderChoices({ entries, driverLabels: DRIVER_LABELS });
    const grok = findProviderChoice(choices, instanceTarget(ProviderInstanceId.make("grok")))!;
    expect(selectOptionDescriptorsForModel(grok.models, "grok-4").map((d) => d.id)).toEqual([
      "reasoningEffort",
    ]);
    expect(selectOptionDescriptorsForModel(grok.models, null)).toEqual([]);
    expect(selectOptionDescriptorsForModel(grok.models, "unknown-model")).toEqual([]);
  });
});

describe("presentation", () => {
  it("synthesizes a built-in implementer row when no explicit one exists", () => {
    const rows = buildAgentProfileRows(asMap({ grok: profile(), cc: profile() }));
    expect(rows.map((row) => [row.name, row.isBuiltIn])).toEqual([
      ["implementer", true],
      ["cc", false],
      ["grok", false],
    ]);
  });

  it("shows only the built-in row when nothing is configured", () => {
    expect(buildAgentProfileRows(undefined)).toEqual([
      { name: "implementer", profile: expect.anything(), isBuiltIn: true },
    ]);
  });

  it("drops the built-in row once implementer is explicitly configured", () => {
    const rows = buildAgentProfileRows(asMap({ implementer: profile({ model: "gpt-5-codex" }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "implementer", isBuiltIn: false });
    expect(rows[0]?.profile.model).toBe("gpt-5-codex");
  });

  it("pre-fills the built-in draft as an explicit codex/session profile", () => {
    expect(builtInImplementerDraft()).toMatchObject({
      name: "implementer",
      provider: { kind: "driver", driver: "codex" },
      model: null,
      runtime: "session",
      runtimeMode: "full-access",
    });
  });

  it("describes providers by instance name, driver fallback, or missing instance", () => {
    const entries = [entry({ displayName: "Codex" })];
    expect(
      describeAgentProfileProvider({
        profile: profile({ target: instanceTarget(ProviderInstanceId.make("codex")) }),
        entries,
        driverLabels: DRIVER_LABELS,
      }),
    ).toBe("Codex");
    expect(
      describeAgentProfileProvider({
        profile: profile({ target: instanceTarget(ProviderInstanceId.make("ghost")) }),
        entries,
        driverLabels: DRIVER_LABELS,
      }),
    ).toBe("ghost (not configured)");
    expect(
      describeAgentProfileProvider({
        profile: profile({ target: driverTarget(ProviderDriverKind.make("grok")) }),
        entries,
        driverLabels: DRIVER_LABELS,
      }),
    ).toBe("First enabled Grok");
    expect(
      describeAgentProfileProvider({ profile: profile(), entries, driverLabels: DRIVER_LABELS }),
    ).toBe("First enabled Codex");
  });

  it("labels an absent model as inherited", () => {
    expect(describeAgentProfileModel(profile())).toBe("Inherits project default");
    expect(describeAgentProfileModel(profile({ model: "grok-4" }))).toBe("grok-4");
  });

  it("summarizes options through descriptor labels, falling back to raw values", () => {
    const descriptors = [
      {
        id: "reasoningEffort",
        type: "select" as const,
        label: "Reasoning",
        options: [{ id: "high", label: "High" }],
      },
    ];
    expect(
      summarizeAgentProfileOptions({
        options: [{ id: "reasoningEffort", value: "high" }],
        descriptors,
      }),
    ).toBe("Reasoning: High");
    expect(
      summarizeAgentProfileOptions({
        options: [{ id: "reasoningEffort", value: "high" }],
        descriptors: [],
      }),
    ).toBe("reasoningEffort: high");
    expect(summarizeAgentProfileOptions({ options: [], descriptors })).toBeNull();
    expect(summarizeAgentProfileOptions({ options: undefined, descriptors })).toBeNull();
  });
});
