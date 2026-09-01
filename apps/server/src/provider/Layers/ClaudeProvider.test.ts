import { describe, expect, it } from "@effect/vitest";

import { getClaudeModelCapabilities } from "./ClaudeProvider.ts";

describe("claude reasoning capability metadata", () => {
  it("marks every reasoning-capable model's native `effort` descriptor", () => {
    const reasoningModels = [
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
    ];

    for (const model of reasoningModels) {
      const capabilities = getClaudeModelCapabilities(model);
      const marked = (capabilities.optionDescriptors ?? []).filter(
        (descriptor) => descriptor.semantic === "reasoning",
      );
      expect(marked.map((descriptor) => descriptor.id)).toEqual(["effort"]);
    }
  });

  it("does not claim a semantic reasoning control for Haiku's boolean thinking toggle", () => {
    const capabilities = getClaudeModelCapabilities("claude-haiku-4-5");

    expect(
      (capabilities.optionDescriptors ?? []).filter(
        (descriptor) => descriptor.semantic === "reasoning",
      ),
    ).toEqual([]);
  });
});
