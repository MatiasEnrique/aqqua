import { describe, expect, it } from "@effect/vitest";

import { computeCostUsd, lookupModelPricing } from "./Pricing.ts";

describe("Pricing", () => {
  it("covers current Claude and GPT-5 model families", () => {
    expect(lookupModelPricing("claude-fable-5-1")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-fable-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-opus-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-opus-4-8")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-sonnet-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("claude-haiku-4-5")?.source).toBe("anthropic-api");
    expect(lookupModelPricing("gpt-5.6-sol")?.source).toBe("openai-api");
    expect(lookupModelPricing("gpt-5.4")?.source).toBe("openai-api");
  });

  it("uses Claude Fable 5.1's reduced cache-read price", () => {
    expect(lookupModelPricing("claude-fable-5-1")?.cacheReadUsdPerMillionTokens).toBe(0.25);
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

  it("keeps Sonnet 5's launch price after the former increase date", () => {
    const tokens = {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    };
    expect(computeCostUsd("claude-sonnet-5", tokens, "2026-08-31")).toBeCloseTo(12);
    expect(computeCostUsd("claude-sonnet-5", tokens, "2026-09-01")).toBeCloseTo(12);
    expect(computeCostUsd("claude-sonnet-5", tokens)).toBeCloseTo(12);
    expect(
      lookupModelPricing("claude-sonnet-5-20260915", "2026-09-15")?.inputUsdPerMillionTokens,
    ).toBe(2);
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
