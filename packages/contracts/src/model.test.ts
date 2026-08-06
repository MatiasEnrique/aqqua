import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  ProviderOptionDescriptor,
} from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

describe("provider option descriptor semantics", () => {
  const decode = Schema.decodeUnknownSync(ProviderOptionDescriptor);

  it("marks a reasoning control without renaming its provider-native id", () => {
    const descriptor = decode({
      id: "effort",
      label: "Reasoning",
      type: "select",
      semantic: "reasoning",
      options: [{ id: "high", label: "High" }],
    });

    expect(descriptor.semantic).toBe("reasoning");
    expect(descriptor.id).toBe("effort");
  });

  it("leaves non-reasoning controls unmarked", () => {
    const descriptor = decode({
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [{ id: "1m", label: "1M" }],
    });

    expect(descriptor.semantic).toBeUndefined();
  });

  it("refuses to mark a boolean toggle as reasoning", () => {
    // Reasoning is a level chosen from advertised values. A boolean carrying the
    // marker would promise the catalog a choice it cannot make, so the union
    // must not admit it as a valid descriptor at all.
    expect(() =>
      decode({
        id: "thinking",
        label: "Thinking",
        type: "boolean",
        semantic: "reasoning",
      }),
    ).toThrow();
  });

  it("rejects a semantic marker the catalog cannot interpret", () => {
    expect(() =>
      decode({
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        semantic: "speed",
        options: [],
      }),
    ).toThrow();
  });
});

describe("pi provider model metadata", () => {
  const piDriverKind = ProviderDriverKind.make("pi");

  it("uses pi's lowercase product name", () => {
    expect(PROVIDER_DISPLAY_NAMES[piDriverKind]).toBe("pi");
  });

  it("provides pi's default model slug", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[piDriverKind]).toBe("anthropic/claude-sonnet-5");
  });
});
