/**
 * UsageLedgerRepository - persistence for usage derived from provider log files.
 *
 * This is deliberately not a projection repository: its source of truth is
 * external provider logs rather than aqqua's orchestration event log.
 *
 * @module UsageLedgerRepository
 */
import { IsoDateTime, NonNegativeInt } from "@aqqua/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const UsageRange = Schema.Literals(["7d", "30d", "90d", "all"]);
export type UsageRange = typeof UsageRange.Type;

/**
 * `session` is the ledger's session-ish bucket: project path plus git branch.
 * Individual session identities are intentionally not retained in daily rollups.
 */
export const UsageBreakdownBy = Schema.Literals(["model", "project", "session"]);
export type UsageBreakdownBy = typeof UsageBreakdownBy.Type;

export const UsageRollup = Schema.Struct({
  day: Schema.String,
  provider: Schema.String,
  model: Schema.NullOr(Schema.String),
  projectPath: Schema.NullOr(Schema.String),
  gitBranch: Schema.NullOr(Schema.String),
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  turns: NonNegativeInt,
  sessions: NonNegativeInt,
  costUsd: Schema.NullOr(Schema.Number),
  source: Schema.String,
});
export type UsageRollup = typeof UsageRollup.Type;

export const UsageScanFile = Schema.Struct({
  path: Schema.String,
  mtimeMs: NonNegativeInt,
  size: NonNegativeInt,
  byteOffset: NonNegativeInt,
  scannedAt: IsoDateTime,
});
export type UsageScanFile = typeof UsageScanFile.Type;

export const UsageTokenTotals = Schema.Struct({
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  turns: NonNegativeInt,
  sessions: NonNegativeInt,
});
export type UsageTokenTotals = typeof UsageTokenTotals.Type;

export const UsageProviderTotal = Schema.Struct({
  provider: Schema.String,
  ...UsageTokenTotals.fields,
  costUsd: Schema.Number,
  hasNullCost: Schema.Boolean,
});
export type UsageProviderTotal = typeof UsageProviderTotal.Type;

export const UsageDailyTotal = Schema.Struct({
  day: Schema.String,
  ...UsageTokenTotals.fields,
  costUsd: Schema.Number,
  hasNullCost: Schema.Boolean,
});
export type UsageDailyTotal = typeof UsageDailyTotal.Type;

export const UsageTokenMix = Schema.Struct({
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
});
export type UsageTokenMix = typeof UsageTokenMix.Type;

export const UsageOverview = Schema.Struct({
  providers: Schema.Array(UsageProviderTotal),
  daily: Schema.Array(UsageDailyTotal),
  tokenMix: UsageTokenMix,
  costUsd: Schema.Number,
  hasNullCost: Schema.Boolean,
});
export type UsageOverview = typeof UsageOverview.Type;

export const UsageBreakdownRow = Schema.Struct({
  key: Schema.String,
  ...UsageTokenTotals.fields,
  costUsd: Schema.Number,
  hasNullCost: Schema.Boolean,
});
export type UsageBreakdownRow = typeof UsageBreakdownRow.Type;

export interface UsageLedgerRepositoryShape {
  readonly upsertRollups: (
    rows: ReadonlyArray<UsageRollup>,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getScanFile: (
    path: string,
  ) => Effect.Effect<Option.Option<UsageScanFile>, ProjectionRepositoryError>;
  readonly upsertScanFile: (row: UsageScanFile) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly commitScanFile: (
    rows: ReadonlyArray<UsageRollup>,
    scanFile: UsageScanFile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getOverview: (
    range: UsageRange,
  ) => Effect.Effect<UsageOverview, ProjectionRepositoryError>;
  readonly getBreakdown: (
    by: UsageBreakdownBy,
    range: UsageRange,
  ) => Effect.Effect<ReadonlyArray<UsageBreakdownRow>, ProjectionRepositoryError>;
  readonly clear: () => Effect.Effect<void, ProjectionRepositoryError>;
}

export class UsageLedgerRepository extends Context.Service<
  UsageLedgerRepository,
  UsageLedgerRepositoryShape
>()("aqqua/persistence/Services/UsageLedger/UsageLedgerRepository") {}
