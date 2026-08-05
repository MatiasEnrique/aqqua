import type { UsageOverview } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageOverviewModel } from "./usageOverviewModel";

const ZERO_TOTALS = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  turns: 0,
  sessions: 0,
} as const;

function overviewFixture(): UsageOverview {
  return {
    range: "30d",
    totals: {
      inputTokens: 300,
      cachedInputTokens: 100,
      cacheWriteTokens: 50,
      outputTokens: 40,
      reasoningTokens: 10,
      turns: 5,
      sessions: 2,
    },
    providers: [
      {
        provider: "claude",
        inputTokens: 200,
        cachedInputTokens: 100,
        cacheWriteTokens: 50,
        outputTokens: 20,
        reasoningTokens: 0,
        turns: 3,
        sessions: 1,
        costUsd: 1.25,
        hasPartialCost: false,
      },
      {
        provider: "codex",
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 20,
        reasoningTokens: 10,
        turns: 2,
        sessions: 1,
        costUsd: 0.75,
        hasPartialCost: true,
      },
    ],
    daily: [
      {
        day: "2026-08-01",
        ...ZERO_TOTALS,
        inputTokens: 10,
        costUsd: 0.1,
        hasPartialCost: false,
      },
      {
        day: "2026-08-02",
        ...ZERO_TOTALS,
        inputTokens: 30,
        costUsd: 0.2,
        hasPartialCost: false,
      },
      {
        day: "2026-08-03",
        ...ZERO_TOTALS,
        inputTokens: 60,
        costUsd: 0.3,
        hasPartialCost: true,
      },
      {
        day: "2026-08-04",
        ...ZERO_TOTALS,
        inputTokens: 100,
        costUsd: 0.4,
        hasPartialCost: false,
      },
    ],
    tokenMix: {
      inputTokens: 300,
      cachedInputTokens: 100,
      cacheWriteTokens: 50,
      outputTokens: 40,
      reasoningTokens: 10,
    },
    costUsd: 2,
    hasPartialCost: true,
    scan: { enabled: true, scanning: false, lastScanAt: "2026-08-04T10:00:00.000Z" },
  };
}

describe("buildUsageOverviewModel", () => {
  it("turns a sparse overview into an honest 42-day presentation", () => {
    const model = buildUsageOverviewModel(overviewFixture(), new Date(2026, 7, 4, 12, 0, 0));

    expect(model.daily).toHaveLength(42);
    expect(model.daily.at(0)?.day).toBe("2026-06-24");
    expect(model.daily.slice(-5).map(({ day, intensity }) => [day, intensity])).toEqual([
      ["2026-07-31", 0],
      ["2026-08-01", 1],
      ["2026-08-02", 2],
      ["2026-08-03", 3],
      ["2026-08-04", 4],
    ]);
    expect(model.bestDay).toMatchObject({ day: "2026-08-04", totalTokens: 100 });
    expect(model.totals.totalTokens).toBe(500);
    expect(model.totals.activeDays).toBe(4);
    expect(model.cacheShare).toBeCloseTo(0.25);
    expect(model.hasPartialCost).toBe(true);
  });

  it("keeps unsupported providers distinct from supported providers with no rows", () => {
    const model = buildUsageOverviewModel(overviewFixture(), new Date(2026, 7, 4, 12, 0, 0));

    expect(
      model.providers.map(({ provider, support, totals }) => ({ provider, support, totals })),
    ).toEqual([
      { provider: "claudeAgent", support: "supported", totals: expect.any(Object) },
      { provider: "codex", support: "supported", totals: expect.any(Object) },
      { provider: "cursor", support: "unsupported", totals: null },
      { provider: "grok", support: "unsupported", totals: null },
      { provider: "opencode", support: "unsupported", totals: null },
    ]);
  });

  it("finds the best day across the selected range, not only the 42-day heatmap", () => {
    const input = overviewFixture();
    const model = buildUsageOverviewModel(
      {
        ...input,
        daily: [
          ...input.daily,
          {
            day: "2026-05-01",
            ...ZERO_TOTALS,
            inputTokens: 1_000,
            costUsd: 1,
            hasPartialCost: false,
          },
        ],
      },
      new Date("2026-08-04T12:00:00.000Z"),
    );

    expect(model.bestDay).toEqual({ day: "2026-05-01", totalTokens: 1_000 });
    expect(model.daily.some((day) => day.day === "2026-05-01")).toBe(false);
  });

  it("returns no best day or cache percentage when there is no usage", () => {
    const input = overviewFixture();
    const model = buildUsageOverviewModel(
      {
        ...input,
        totals: ZERO_TOTALS,
        providers: [],
        daily: [],
        tokenMix: ZERO_TOTALS,
        costUsd: 0,
        hasPartialCost: false,
      },
      new Date("2026-08-04T12:00:00.000Z"),
    );

    expect(model.bestDay).toBeNull();
    expect(model.cacheShare).toBeNull();
    expect(model.daily.every((day) => day.intensity === 0)).toBe(true);
  });
});
