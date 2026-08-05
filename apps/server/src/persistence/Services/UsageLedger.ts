/**
 * UsageLedgerRepository - persistence for usage derived from provider log files.
 *
 * This is deliberately not a projection repository: its source of truth is
 * external provider logs rather than aqqua's orchestration event log.
 *
 * Row and range shapes are the wire contracts from `@aqqua/contracts` — the
 * repository aggregates in SQL straight into what clients receive.
 *
 * @module UsageLedgerRepository
 */
import {
  IsoDateTime,
  NonNegativeInt,
  UsageBreakdownBy,
  UsageBreakdownRow,
  UsageDailyTotal,
  UsageProviderTotal,
  UsageRange,
  UsageTokenMix,
  UsageTokenTotals,
} from "@aqqua/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export {
  UsageBreakdownBy,
  UsageBreakdownRow,
  UsageDailyTotal,
  UsageProviderTotal,
  UsageRange,
  UsageTokenMix,
  UsageTokenTotals,
};

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
  /**
   * Rollup identities this file has already contributed `sessions` counts to.
   * Persisted so incremental tail scans after a restart do not re-add a
   * session that was counted before the restart.
   */
  rollupKeys: Schema.Array(Schema.String),
});
export type UsageScanFile = typeof UsageScanFile.Type;

export const UsageOverview = Schema.Struct({
  providers: Schema.Array(UsageProviderTotal),
  daily: Schema.Array(UsageDailyTotal),
  tokenMix: UsageTokenMix,
  costUsd: Schema.Number,
  hasPartialCost: Schema.Boolean,
});
export type UsageOverview = typeof UsageOverview.Type;

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
  /** Deletes one provider's rollups and scan bookkeeping (paths under `pathPrefix`). */
  readonly clearProvider: (
    provider: string,
    pathPrefix: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly clear: () => Effect.Effect<void, ProjectionRepositoryError>;
}

export class UsageLedgerRepository extends Context.Service<
  UsageLedgerRepository,
  UsageLedgerRepositoryShape
>()("aqqua/persistence/Services/UsageLedger/UsageLedgerRepository") {}
