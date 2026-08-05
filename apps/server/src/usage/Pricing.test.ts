import { describe, expect, it } from "@effect/vitest";

import { computeCostUsd, lookupModelPricing } from "./Pricing.ts";

describe("Pricing", () => {
  it("covers current Claude and GPT-5 model families", () => {
    expect(lookupModelPricing("claude-fable-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-opus-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-opus-4-8")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-sonnet-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-haiku-4-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("gpt-5.6-sol")?.source).toBe("openai-api");
    expect(lookupModelPricing("gpt-5.4")?.source).toBe("openai-api");
  });

  it("prices each token category per million tokens", () => {
    expect(
      computeCostUsd("claude-haiku-4-5", {
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(7.35);
  });

  it("applies the scheduled Sonnet 5 price change at the usage-day boundary", () => {
    const tokens = {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    };
    // Introductory rate ($2/$10) through August 31, standard rate ($3/$15) after.
    expect(computeCostUsd("claude-sonnet-5", tokens, "2026-08-31")).toBeCloseTo(12);
    expect(computeCostUsd("claude-sonnet-5", tokens, "2026-09-01")).toBeCloseTo(18);
    expect(computeCostUsd("claude-sonnet-5", tokens)).toBeCloseTo(12);
    expect(
      lookupModelPricing("claude-sonnet-5-20260915", "2026-09-15")?.inputUsdPerMillionTokens,
    ).toBe(3);
  });

  it("returns null for unknown models", () => {
    expect(lookupModelPricing("local-mystery-model")).toBeNull();
    expect(
      computeCostUsd("local-mystery-model", {
        inputTokens: 1,
        cachedInputTokens: 2,
        cacheWriteTokens: 3,
        outputTokens: 4,
      }),
    ).toBeNull();
  });
});
