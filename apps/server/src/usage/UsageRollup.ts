import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { computeCostUsd } from "./Pricing.ts";

export type UsageProvider = "claude" | "codex";

export interface UsageTurnRecord {
  readonly provider: UsageProvider;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly model: string | null;
  readonly projectPath: string | null;
  readonly gitBranch: string | null;
  /** Input tokens excluding the separately reported cache-read and cache-write categories. */
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly isSubagent: boolean;
}

export interface UsageDailyRollupRow {
  readonly day: string;
  readonly provider: UsageProvider;
  readonly model: string | null;
  readonly project_path: string | null;
  readonly git_branch: string | null;
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly cache_write_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_tokens: number;
  readonly turns: number;
  readonly sessions: number;
  readonly cost_usd: number | null;
  readonly source: "log-scan";
}

export interface UsageRollupResult {
  readonly rows: ReadonlyArray<UsageDailyRollupRow>;
  readonly hasPartialCost: boolean;
}

interface MutableRollup {
  day: string;
  provider: UsageProvider;
  model: string | null;
  projectPath: string | null;
  gitBranch: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  turns: number;
  sessions: Set<string>;
  costUsd: number;
  hasPartialCost: boolean;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

export function localDayFromTimestamp(timestamp: string): string | null {
  return Option.match(DateTime.make(timestamp), {
    onNone: () => null,
    onSome: (dateTime) => {
      const local = DateTime.setZone(dateTime, DateTime.zoneMakeLocal());
      const parts = DateTime.toParts(local);
      return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
    },
  });
}

function rollupKey(day: string, turn: UsageTurnRecord): string {
  return JSON.stringify([
    day,
    turn.provider,
    turn.model,
    turn.projectPath,
    turn.gitBranch,
    "log-scan",
  ]);
}

export function rollupUsageTurns(turns: ReadonlyArray<UsageTurnRecord>): UsageRollupResult {
  const aggregates = new Map<string, MutableRollup>();

  for (const turn of turns) {
    const day = localDayFromTimestamp(turn.timestamp);
    if (day === null) continue;

    const key = rollupKey(day, turn);
    let aggregate = aggregates.get(key);
    if (aggregate === undefined) {
      aggregate = {
        day,
        provider: turn.provider,
        model: turn.model,
        projectPath: turn.projectPath,
        gitBranch: turn.gitBranch,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        turns: 0,
        sessions: new Set(),
        costUsd: 0,
        hasPartialCost: false,
      };
      aggregates.set(key, aggregate);
    }

    aggregate.inputTokens += turn.inputTokens;
    aggregate.cachedInputTokens += turn.cachedInputTokens;
    aggregate.cacheWriteTokens += turn.cacheWriteTokens;
    aggregate.outputTokens += turn.outputTokens;
    aggregate.reasoningTokens += turn.reasoningTokens;
    aggregate.turns += 1;
    aggregate.sessions.add(turn.sessionId);

    const cost = computeCostUsd(turn.model, turn);
    if (cost === null) {
      aggregate.hasPartialCost = true;
    } else {
      aggregate.costUsd += cost;
    }
  }

  const rows = Array.from(
    aggregates.values(),
    (aggregate): UsageDailyRollupRow => ({
      day: aggregate.day,
      provider: aggregate.provider,
      model: aggregate.model,
      project_path: aggregate.projectPath,
      git_branch: aggregate.gitBranch,
      input_tokens: aggregate.inputTokens,
      cached_input_tokens: aggregate.cachedInputTokens,
      cache_write_tokens: aggregate.cacheWriteTokens,
      output_tokens: aggregate.outputTokens,
      reasoning_tokens: aggregate.reasoningTokens,
      turns: aggregate.turns,
      sessions: aggregate.sessions.size,
      cost_usd: aggregate.hasPartialCost ? null : aggregate.costUsd,
      source: "log-scan",
    }),
  );

  return {
    rows,
    hasPartialCost: Array.from(aggregates.values()).some((aggregate) => aggregate.hasPartialCost),
  };
}
