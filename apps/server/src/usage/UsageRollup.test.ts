import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import type { UsageTurnRecord } from "./UsageRollup.ts";
import { localDayFromTimestamp, rollupUsageTurns } from "./UsageRollup.ts";

function turn(overrides: Partial<UsageTurnRecord> = {}): UsageTurnRecord {
  return {
    provider: "codex",
    sessionId: "session-a",
    timestamp: "2026-08-01T10:00:00",
    model: "gpt-5.4",
    projectPath: "/workspace/alpha",
    gitBranch: "main",
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheWriteTokens: 0,
    outputTokens: 3,
    reasoningTokens: 1,
    isSubagent: false,
    ...overrides,
  };
}

describe("UsageRollup", () => {
  it("derives the day in the machine's local time zone near UTC midnight", () => {
    const timestamp = "2026-08-02T00:30:00.000Z";
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(DateTime.toDate(DateTime.makeUnsafe(timestamp)))
        .map((part) => [part.type, part.value]),
    );

    expect(localDayFromTimestamp(timestamp)).toBe(`${parts.year}-${parts.month}-${parts.day}`);
  });

  it("groups by local day, provider, model, project, branch, and source", () => {
    const result = rollupUsageTurns([
      turn(),
      turn({ timestamp: "2026-08-01T11:00:00", inputTokens: 4 }),
      turn({ sessionId: "session-b", timestamp: "2026-08-01T12:00:00" }),
      turn({ projectPath: "/workspace/beta", gitBranch: null }),
      turn({
        provider: "claude",
        sessionId: "session-c",
        timestamp: "2026-08-02T10:00:00",
        model: "unknown-claude",
      }),
    ]);

    expect(result.rows).toHaveLength(3);
    expect(
      result.rows.find(
        (row) =>
          row.day === "2026-08-01" &&
          row.provider === "codex" &&
          row.project_path === "/workspace/alpha",
      ),
    ).toEqual(
      expect.objectContaining({
        input_tokens: 24,
        cached_input_tokens: 6,
        output_tokens: 9,
        reasoning_tokens: 3,
        turns: 3,
        sessions: 2,
        source: "log-scan",
        cost_usd: expect.any(Number),
      }),
    );
    expect(result.rows.find((row) => row.model === "unknown-claude")).toEqual(
      expect.objectContaining({ day: "2026-08-02", cost_usd: null }),
    );
    expect(result.hasPartialCost).toBe(true);
  });
});
