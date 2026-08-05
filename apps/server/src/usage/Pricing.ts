export type PricingSource = "anthropic-api" | "openai-api";

export interface ModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly cacheReadUsdPerMillionTokens: number;
  readonly cacheWriteUsdPerMillionTokens: number;
  readonly source: PricingSource;
}

export interface PriceableTokenUsage {
  /** Input tokens excluding the separately reported cache-read and cache-write categories. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

const anthropicPricing = (
  input: number,
  output: number,
  cacheRead = input * 0.1,
  cacheWrite = input * 1.25,
): ModelPricing => ({
  inputUsdPerMillionTokens: input,
  outputUsdPerMillionTokens: output,
  cacheReadUsdPerMillionTokens: cacheRead,
  cacheWriteUsdPerMillionTokens: cacheWrite,
  source: "anthropic-api",
});

const openAiPricing = (
  input: number,
  output: number,
  cacheRead = input * 0.1,
  cacheWrite = input,
): ModelPricing => ({
  inputUsdPerMillionTokens: input,
  outputUsdPerMillionTokens: output,
  cacheReadUsdPerMillionTokens: cacheRead,
  cacheWriteUsdPerMillionTokens: cacheWrite,
  source: "openai-api",
});

/**
 * Standard API list prices in USD per million tokens. Sonnet 5 uses its
 * introductory price through 2026-08-31. Cache-write prices use the providers'
 * default cache duration; provider-specific long-context and regional uplifts
 * are intentionally outside this estimate. Estimates use the table at scan
 * time rather than reconstructing historical price periods.
 */
export const MODEL_PRICING = {
  "claude-fable-5": anthropicPricing(10, 50),
  "claude-opus-5": anthropicPricing(5, 25),
  "claude-opus-4-8": anthropicPricing(5, 25),
  "claude-opus-4-7": anthropicPricing(5, 25),
  "claude-opus-4-6": anthropicPricing(5, 25),
  "claude-opus-4-5": anthropicPricing(5, 25),
  "claude-opus-4-1": anthropicPricing(15, 75),
  "claude-opus-4": anthropicPricing(15, 75),
  "claude-opus-3": anthropicPricing(15, 75),
  "claude-sonnet-5": anthropicPricing(2, 10),
  "claude-sonnet-4-6": anthropicPricing(3, 15),
  "claude-sonnet-4-5": anthropicPricing(3, 15),
  "claude-sonnet-4": anthropicPricing(3, 15),
  "claude-sonnet-3-7": anthropicPricing(3, 15),
  "claude-sonnet-3-5": anthropicPricing(3, 15),
  "claude-haiku-4-5": anthropicPricing(1, 5),
  "claude-haiku-3-5": anthropicPricing(0.8, 4),
  "claude-haiku-3": anthropicPricing(0.25, 1.25, 0.03, 0.3),
  "gpt-5.6": openAiPricing(5, 30, 0.5, 6.25),
  "gpt-5.6-sol": openAiPricing(5, 30, 0.5, 6.25),
  "gpt-5.6-terra": openAiPricing(2.5, 15, 0.25, 3.125),
  "gpt-5.6-luna": openAiPricing(1, 6, 0.1, 1.25),
  "gpt-5.5": openAiPricing(5, 30, 0.5),
  "gpt-5.4": openAiPricing(2.5, 15, 0.25),
  "gpt-5.4-codex": openAiPricing(2.5, 15, 0.25),
  "gpt-5.4-mini": openAiPricing(0.75, 4.5, 0.075),
  "gpt-5.4-codex-mini": openAiPricing(0.75, 4.5, 0.075),
  "gpt-5.4-nano": openAiPricing(0.2, 1.25, 0.02),
  "gpt-5.3-codex": openAiPricing(1.75, 14, 0.175),
  "gpt-5.2": openAiPricing(1.75, 14, 0.175),
  "gpt-5.2-codex": openAiPricing(1.75, 14, 0.175),
  "gpt-5.1": openAiPricing(1.25, 10, 0.125),
  "gpt-5.1-codex": openAiPricing(1.25, 10, 0.125),
  "gpt-5.1-codex-max": openAiPricing(1.25, 10, 0.125),
  "gpt-5-codex": openAiPricing(1.25, 10, 0.125),
  "gpt-5": openAiPricing(1.25, 10, 0.125),
  "gpt-5-mini": openAiPricing(0.25, 2, 0.025),
  "gpt-5-nano": openAiPricing(0.05, 0.4, 0.005),
} as const satisfies Readonly<Record<string, ModelPricing>>;

/**
 * Scheduled price changes keyed by the usage day (local YYYY-MM-DD). The most
 * recent entry whose `from` is on or before the usage day wins over the base
 * table. Sonnet 5's introductory rate ends 2026-08-31.
 */
const DATED_MODEL_PRICING: Readonly<
  Record<string, ReadonlyArray<{ readonly from: string; readonly pricing: ModelPricing }>>
> = {
  "claude-sonnet-5": [{ from: "2026-09-01", pricing: anthropicPricing(3, 15) }],
};

function datedOverride(model: string, day: string | null): ModelPricing | null {
  if (day === null || !Object.hasOwn(DATED_MODEL_PRICING, model)) return null;
  let selected: ModelPricing | null = null;
  for (const entry of DATED_MODEL_PRICING[model]!) {
    if (entry.from <= day) selected = entry.pricing;
  }
  return selected;
}

function normalizeModelForLookup(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[.*\]$/, "");
}

export function lookupModelPricing(
  model: string | null,
  usageDay: string | null = null,
): ModelPricing | null {
  if (model === null) return null;

  const normalized = normalizeModelForLookup(model);
  const exact = MODEL_PRICING[normalized as keyof typeof MODEL_PRICING];
  if (exact !== undefined) return datedOverride(normalized, usageDay) ?? exact;

  for (const [pricedModel, pricing] of Object.entries(MODEL_PRICING)) {
    const snapshotSuffix = normalized.slice(pricedModel.length + 1);
    if (
      normalized.startsWith(`${pricedModel}-`) &&
      (/^\d{8}$/.test(snapshotSuffix) || /^\d{4}-\d{2}-\d{2}$/.test(snapshotSuffix))
    ) {
      return datedOverride(pricedModel, usageDay) ?? pricing;
    }
  }

  return null;
}

export function computeCostUsd(
  model: string | null,
  tokens: PriceableTokenUsage,
  usageDay: string | null = null,
): number | null {
  const pricing = lookupModelPricing(model, usageDay);
  if (pricing === null) return null;

  return (
    (tokens.inputTokens * pricing.inputUsdPerMillionTokens +
      tokens.cachedInputTokens * pricing.cacheReadUsdPerMillionTokens +
      tokens.cacheWriteTokens * pricing.cacheWriteUsdPerMillionTokens +
      tokens.outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}
