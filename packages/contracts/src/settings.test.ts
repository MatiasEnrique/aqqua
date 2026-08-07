import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  AgentProfile,
  AgentProfileName,
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_AGENT_PROFILE_DRIVER,
  DEFAULT_SERVER_SETTINGS,
  PiSettings,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeAgentProfile = Schema.decodeUnknownSync(AgentProfile);
const encodeAgentProfile = Schema.encodeSync(AgentProfile);
const decodePiSettings = Schema.decodeUnknownSync(PiSettings);

describe("ClientSettings word wrap", () => {
  it("defaults word wrap on", () => {
    expect(decodeClientSettings({}).wordWrap).toBe(true);
  });

  it("ignores obsolete wrapping preferences", () => {
    const decoded = decodeClientSettings({
      chatWordWrap: false,
      diffWordWrap: false,
    });

    expect(decoded.wordWrap).toBe(true);
    expect(decoded).not.toHaveProperty("chatWordWrap");
    expect(decoded).not.toHaveProperty("diffWordWrap");
  });
});

describe("ClientSettings glass opacity", () => {
  it("defaults to a readable translucent surface", () => {
    expect(decodeClientSettings({}).glassOpacity).toBe(80);
  });

  it.each([39, 101, 72.5])("rejects an invalid glass opacity: %s", (value) => {
    expect(() => decodeClientSettings({ glassOpacity: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ glassOpacity: value })).toThrow();
  });

  it.each([40, 75, 100])("accepts a glass opacity within the supported range: %s", (value) => {
    expect(decodeClientSettings({ glassOpacity: value }).glassOpacity).toBe(value);
    expect(decodeClientSettingsPatch({ glassOpacity: value }).glassOpacity).toBe(value);
  });
});

describe("ClientSettings environment identification", () => {
  it("defaults to the pill and still decodes the legacy artwork value", () => {
    expect(decodeClientSettings({}).environmentIdentificationMode).toBe("pill");

    // "artwork" is no longer offered, but previously persisted settings carry
    // it and must still decode rather than throw.
    for (const mode of ["artwork", "pill", "none"] as const) {
      expect(
        decodeClientSettingsPatch({ environmentIdentificationMode: mode })
          .environmentIdentificationMode,
      ).toBe(mode);
    }
  });

  it("rejects unsupported presentation modes", () => {
    expect(() => decodeClientSettings({ environmentIdentificationMode: "badge" })).toThrow();
    expect(() => decodeClientSettingsPatch({ environmentIdentificationMode: "badge" })).toThrow();
  });
});

describe("ClientSettings sidebar", () => {
  it("defaults to a three-day auto-settle threshold", () => {
    expect(decodeClientSettings({}).sidebarAutoSettleAfterDays).toBe(3);
  });

  it("allows auto-settle by inactivity to be disabled", () => {
    expect(
      decodeClientSettings({ sidebarAutoSettleAfterDays: null }).sidebarAutoSettleAfterDays,
    ).toBeNull();
  });

  it.each([-1, 0, 91])("rejects an auto-settle threshold outside 1..90: %s", (value) => {
    expect(() => decodeClientSettings({ sidebarAutoSettleAfterDays: value })).toThrow();
    expect(() => decodeClientSettingsPatch({ sidebarAutoSettleAfterDays: value })).toThrow();
  });
});

describe("ServerSettings.providerInstances (slice-2 invariant)", () => {
  it("defaults to an empty record so legacy configs without the key still decode", () => {
    expect(DEFAULT_SERVER_SETTINGS.providerInstances).toEqual({});
  });

  it("decodes a fully empty config (legacy on-disk shape) without complaint", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.providerInstances).toEqual({});
    // Legacy `providers` struct is still hydrated with its per-driver defaults
    // so existing call sites keep working through the migration.
    expect(decoded.providers.codex.enabled).toBe(true);
  });

  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeServerSettings({
      providerInstances: {
        codex_personal: {
          driver: "codex",
          displayName: "Codex (personal)",
          config: { homePath: "~/.codex_personal" },
        },
        codex_work: {
          driver: "codex",
          config: { homePath: "~/.codex_work" },
        },
        ollama_local: {
          driver: "ollama",
          displayName: "Ollama (local)",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const personalId = ProviderInstanceId.make("codex_personal");
    const workId = ProviderInstanceId.make("codex_work");
    const ollamaId = ProviderInstanceId.make("ollama_local");

    expect(decoded.providerInstances[personalId]?.driver).toBe("codex");
    expect(decoded.providerInstances[workId]?.config).toEqual({ homePath: "~/.codex_work" });
    // Critical: a config naming a driver this build does not know about
    // (`ollama` is not in `ProviderDriverKind`) must round-trip without loss.
    // The runtime handles "driver not installed" — the schema must not.
    expect(decoded.providerInstances[ollamaId]?.driver).toBe("ollama");
    expect(decoded.providerInstances[ollamaId]?.config).toEqual({
      endpoint: "http://localhost:11434",
    });
  });

  it("rejects instance keys that violate the slug pattern", () => {
    expect(() =>
      decodeServerSettings({
        providerInstances: { "1bad": { driver: "codex" } },
      }),
    ).toThrow();
  });
});

describe("PiSettings", () => {
  it("decodes provider defaults", () => {
    expect(decodePiSettings({})).toEqual({
      enabled: true,
      binaryPath: "pi",
      homePath: "",
      trustProjectFiles: false,
      customModels: [],
    });

    expect(decodeServerSettings({}).providers.pi).toEqual(decodePiSettings({}));
  });

  it("decodes partial provider patches", () => {
    const patch = decodeServerSettingsPatch({
      providers: {
        pi: {
          binaryPath: "  /opt/homebrew/bin/pi  ",
          homePath: "  ~/.pi/agent  ",
          trustProjectFiles: true,
          customModels: ["openrouter/anthropic/claude-sonnet-5"],
        },
      },
    });

    expect(patch.providers?.pi).toEqual({
      binaryPath: "/opt/homebrew/bin/pi",
      homePath: "~/.pi/agent",
      trustProjectFiles: true,
      customModels: ["openrouter/anthropic/claude-sonnet-5"],
    });
  });
});

describe("ServerSettings worktree defaults", () => {
  it("defaults start-from-origin on for legacy configs", () => {
    expect(decodeServerSettings({}).newWorktreesStartFromOrigin).toBe(true);
    expect(decodeServerSettings({}).autoSettleOnMergedChangeRequest).toBe(true);
  });

  it("accepts start-from-origin updates", () => {
    expect(
      decodeServerSettingsPatch({ newWorktreesStartFromOrigin: false }).newWorktreesStartFromOrigin,
    ).toBe(false);
    expect(
      decodeServerSettingsPatch({ autoSettleOnMergedChangeRequest: false })
        .autoSettleOnMergedChangeRequest,
    ).toBe(false);
  });
});

describe("ServerSettings.sourceControlWritingStyle", () => {
  it("defaults all style settings for legacy configs", () => {
    const settings = decodeServerSettings({});

    expect(settings.sourceControlWritingStyle).toEqual({
      mode: "repo_conventions",
      customInstructions: "",
      followChangeRequestTemplates: true,
    });
    expect(settings.sourceControlWriterModelSelection).toBeNull();
  });

  it("trims partial style updates", () => {
    const patch = decodeServerSettingsPatch({
      sourceControlWritingStyle: {
        mode: "custom",
        customInstructions: "  Prefer concise wording.  ",
      },
    });

    expect(patch.sourceControlWritingStyle).toEqual({
      mode: "custom",
      customInstructions: "Prefer concise wording.",
    });
  });
});

describe("ServerSettingsPatch.providerInstances", () => {
  it("treats providerInstances as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.providerInstances).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      providerInstances: {
        codex_personal: { driver: "codex", config: { homePath: "~/.codex" } },
      },
    });
    expect(replacement.providerInstances).toBeDefined();
    expect(replacement.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
  });

  it("preserves a fork-defined driver entry through patch decoding", () => {
    const patch = decodeServerSettingsPatch({
      providerInstances: {
        ollama_local: {
          driver: "ollama",
          config: { endpoint: "http://localhost:11434" },
        },
      },
    });
    const ollamaId = ProviderInstanceId.make("ollama_local");
    expect(patch.providerInstances?.[ollamaId]?.driver).toBe("ollama");
  });
});

describe("ServerSettingsPatch.agentProfiles", () => {
  it("treats agentProfiles as an optional whole-map replacement", () => {
    const patch = decodeServerSettingsPatch({});
    expect(patch.agentProfiles).toBeUndefined();

    const replacement = decodeServerSettingsPatch({
      agentProfiles: {
        implementer: {
          driver: "codex",
          model: "gpt-5.4",
        },
      },
    });
    expect(replacement.agentProfiles).toBeDefined();
    const implementer = replacement.agentProfiles?.[AgentProfileName.make("implementer")];
    expect(implementer?.target).toEqual({ kind: "driver", driver: "codex" });
    expect(implementer?.model).toBe("gpt-5.4");
    // Defaults applied by AgentProfile decoding.
    expect(implementer?.runtime).toBe("session");
    expect(implementer?.runtimeMode).toBe("full-access");
    expect(implementer?.interactionMode).toBe("default");
  });

  it("rejects an invalid agent profile name", () => {
    expect(() =>
      decodeServerSettingsPatch({
        agentProfiles: {
          "1bad": { driver: "codex" },
        },
      }),
    ).toThrow();
  });
});

describe("AgentProfile target union", () => {
  it("decodes a canonical instance target", () => {
    const decoded = decodeAgentProfile({
      target: { kind: "instance", instanceId: "codex_work" },
      model: "gpt-5.4",
    });
    expect(decoded.target).toEqual({
      kind: "instance",
      instanceId: ProviderInstanceId.make("codex_work"),
    });
    expect(decoded.model).toBe("gpt-5.4");
    expect(decoded.runtime).toBe("session");
  });

  it("decodes a canonical driver target", () => {
    const decoded = decodeAgentProfile({
      target: { kind: "driver", driver: "claudeAgent" },
    });
    expect(decoded.target).toEqual({
      kind: "driver",
      driver: ProviderDriverKind.make("claudeAgent"),
    });
  });

  it("legacy: instanceId alone becomes an instance target", () => {
    const decoded = decodeAgentProfile({
      instanceId: "codex_personal",
      runtimeMode: "auto",
    });
    expect(decoded.target).toEqual({
      kind: "instance",
      instanceId: ProviderInstanceId.make("codex_personal"),
    });
    expect(decoded.runtimeMode).toBe("auto");
  });

  it("legacy: driver alone becomes a driver target", () => {
    const decoded = decodeAgentProfile({ driver: "grok" });
    expect(decoded.target).toEqual({
      kind: "driver",
      driver: ProviderDriverKind.make("grok"),
    });
  });

  it("legacy: neither instanceId nor driver becomes the Codex driver target", () => {
    const decoded = decodeAgentProfile({});
    expect(decoded.target).toEqual({
      kind: "driver",
      driver: DEFAULT_AGENT_PROFILE_DRIVER,
    });
    expect(decoded.runtime).toBe("session");
    expect(decoded.runtimeMode).toBe("full-access");
    expect(decoded.interactionMode).toBe("default");
  });

  it("legacy: both instanceId and driver prefer the instance target", () => {
    // Historical server resolution preferred the explicit instance whenever it
    // was present, so decode preserves that choice rather than inventing a
    // third "both" state.
    const decoded = decodeAgentProfile({
      instanceId: "codex_work",
      driver: "claudeAgent",
    });
    expect(decoded.target).toEqual({
      kind: "instance",
      instanceId: ProviderInstanceId.make("codex_work"),
    });
  });

  it("legacy: rejects an unknown-format driver instead of storing an arbitrary string", () => {
    expect(() => decodeAgentProfile({ driver: "1bad" })).toThrow(/driver/i);
    expect(() => decodeAgentProfile({ driver: "has spaces" })).toThrow(/driver/i);
    expect(() => decodeAgentProfile({ driver: "" })).toThrow();
    expect(() => decodeAgentProfile({ driver: 42 })).toThrow(/driver/i);
  });

  it("rejects a malformed canonical target", () => {
    expect(() => decodeAgentProfile({ target: { kind: "driver", driver: "1bad" } })).toThrow();
    expect(() =>
      decodeAgentProfile({ target: { kind: "instance", instanceId: "1bad" } }),
    ).toThrow();
    expect(() => decodeAgentProfile({ target: { kind: "neither" } })).toThrow();
  });

  it("encodes only the canonical target shape, never legacy top-level fields", () => {
    const fromLegacy = decodeAgentProfile({
      instanceId: "codex_work",
      driver: "claudeAgent",
      model: "gpt-5.4",
      titlePrefix: "impl",
    });
    const encoded = encodeAgentProfile(fromLegacy) as Record<string, unknown>;
    expect(encoded).toEqual({
      runtime: "session",
      target: { kind: "instance", instanceId: "codex_work" },
      model: "gpt-5.4",
      runtimeMode: "full-access",
      interactionMode: "default",
      titlePrefix: "impl",
    });
    expect(encoded).not.toHaveProperty("instanceId");
    expect(encoded).not.toHaveProperty("driver");
  });

  it("round-trips a driver-target profile through encode/decode", () => {
    const original = decodeAgentProfile({
      target: { kind: "driver", driver: "opencode" },
      runtime: "terminal",
      runtimeMode: "approval-required",
      interactionMode: "plan",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    const encoded = encodeAgentProfile(original);
    expect(encoded).toMatchObject({
      target: { kind: "driver", driver: "opencode" },
      runtime: "terminal",
    });
    expect(encoded).not.toHaveProperty("instanceId");
    expect(encoded).not.toHaveProperty("driver");
    expect(decodeAgentProfile(encoded)).toEqual(original);
  });

  it("preserves runtime/model/options/modes/titlePrefix through legacy migration", () => {
    const decoded = decodeAgentProfile({
      driver: "codex",
      model: "gpt-5.4-codex",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
      runtime: "terminal",
      runtimeMode: "auto-accept-edits",
      interactionMode: "plan",
      titlePrefix: "impl",
    });
    expect(decoded).toEqual({
      runtime: "terminal",
      target: { kind: "driver", driver: ProviderDriverKind.make("codex") },
      model: "gpt-5.4-codex",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
      runtimeMode: "auto-accept-edits",
      interactionMode: "plan",
      titlePrefix: "impl",
    });
  });

  it("accepts open driver slugs that this build may not ship (forks)", () => {
    // ProviderDriverKind is open; "unknown to this build" is a runtime concern.
    // Only invalid *format* fails decode.
    const decoded = decodeAgentProfile({ driver: "ollama" });
    expect(decoded.target).toEqual({
      kind: "driver",
      driver: ProviderDriverKind.make("ollama"),
    });
  });
});

describe("ServerSettingsPatch string normalization", () => {
  it("trims string settings while decoding patches", () => {
    const patch = decodeServerSettingsPatch({
      addProjectBaseDirectory: "  ~/Development  ",
      textGenerationModelSelection: { model: "  gpt-5.4-mini  " },
      observability: {
        otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
      },
      providers: {
        codex: {
          binaryPath: "  /opt/homebrew/bin/codex  ",
          homePath: "  ~/.codex  ",
          launchArgs: "  --strict-config --enable foo  ",
        },
      },
      providerInstances: {
        codex_personal: {
          driver: "  codex  ",
          displayName: "  Codex Personal  ",
          config: { homePath: "  ~/.codex-personal  " },
        },
      },
    });

    expect(patch.addProjectBaseDirectory).toBe("~/Development");
    expect(patch.textGenerationModelSelection?.model).toBe("gpt-5.4-mini");
    expect(patch.observability?.otlpTracesUrl).toBe("http://localhost:4318/v1/traces");
    expect(patch.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(patch.providers?.codex?.homePath).toBe("~/.codex");
    expect(patch.providers?.codex?.launchArgs).toBe("--strict-config --enable foo");
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.driver).toBe(
      "codex",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.displayName).toBe(
      "Codex Personal",
    );
    expect(patch.providerInstances?.[ProviderInstanceId.make("codex_personal")]?.config).toEqual({
      homePath: "  ~/.codex-personal  ",
    });
  });

  it("trims encoded server settings values before validation", () => {
    const defaultSettings = decodeServerSettings({});
    const encoded = encodeServerSettings({
      ...defaultSettings,
      addProjectBaseDirectory: "  ~/Development  ",
      providers: {
        ...defaultSettings.providers,
        codex: {
          ...defaultSettings.providers.codex,
          binaryPath: "  /opt/homebrew/bin/codex  ",
          launchArgs: "  --strict-config  ",
        },
      },
    });

    expect(encoded.addProjectBaseDirectory).toBe("~/Development");
    expect(encoded.providers?.codex?.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(encoded.providers?.codex?.launchArgs).toBe("--strict-config");
  });
});
