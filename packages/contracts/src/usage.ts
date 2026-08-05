import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const AccountRateLimitWindowKind = Schema.Literals([
  "five-hour",
  "weekly",
  "weekly-fable",
  "weekly-opus",
  "weekly-sonnet",
  "overage",
]);
export type AccountRateLimitWindowKind = typeof AccountRateLimitWindowKind.Type;

export const AccountRateLimitWindow = Schema.Struct({
  kind: AccountRateLimitWindowKind,
  // Claude omits utilization on plain "allowed" events; a window with only a
  // known kind and reset time is still worth reporting.
  usedPercent: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  resetsAt: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  windowMinutes: Schema.NullOr(NonNegativeInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type AccountRateLimitWindow = typeof AccountRateLimitWindow.Type;

export const AccountRateLimitCredits = Schema.Struct({
  balance: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  hasCredits: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  unlimited: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type AccountRateLimitCredits = typeof AccountRateLimitCredits.Type;

export const AccountRateLimitsSnapshot = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  provider: ProviderDriverKind,
  planLabel: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  credits: Schema.NullOr(AccountRateLimitCredits).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  windows: Schema.Array(AccountRateLimitWindow).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  status: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  capturedAt: IsoDateTime,
});
export type AccountRateLimitsSnapshot = typeof AccountRateLimitsSnapshot.Type;

export const AccountUsageSupport = Schema.Literals(["supported", "unsupported"]);
export type AccountUsageSupport = typeof AccountUsageSupport.Type;

export const ACCOUNT_USAGE_SUPPORT_BY_PROVIDER = {
  claudeAgent: "supported",
  codex: "supported",
  cursor: "unsupported",
  grok: "unsupported",
  opencode: "unsupported",
  // ProviderDriverKind is an open branded slug (see providerInstance.ts), so
  // this map cannot be exhaustiveness-checked; lookups treat absence as unsupported.
} as const satisfies Readonly<Record<string, AccountUsageSupport>>;

export const AccountUsageSnapshot = Schema.Struct({
  rateLimits: Schema.Array(AccountRateLimitsSnapshot).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AccountUsageSnapshot = typeof AccountUsageSnapshot.Type;

export const UsageRange = Schema.Literals(["7d", "30d", "90d", "all"]);
export type UsageRange = typeof UsageRange.Type;

export const UsageBreakdownBy = Schema.Literals(["model", "project"]);
export type UsageBreakdownBy = typeof UsageBreakdownBy.Type;

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
  hasPartialCost: Schema.Boolean,
});
export type UsageProviderTotal = typeof UsageProviderTotal.Type;

export const UsageDailyTotal = Schema.Struct({
  day: Schema.String,
  ...UsageTokenTotals.fields,
  costUsd: Schema.Number,
  hasPartialCost: Schema.Boolean,
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

export const UsageScanState = Schema.Struct({
  enabled: Schema.Boolean,
  scanning: Schema.Boolean,
  lastScanAt: Schema.NullOr(IsoDateTime),
});
export type UsageScanState = typeof UsageScanState.Type;

export const UsageGetOverviewInput = Schema.Struct({
  range: UsageRange,
});
export type UsageGetOverviewInput = typeof UsageGetOverviewInput.Type;

export const UsageOverview = Schema.Struct({
  range: UsageRange,
  totals: UsageTokenTotals,
  providers: Schema.Array(UsageProviderTotal),
  daily: Schema.Array(UsageDailyTotal),
  tokenMix: UsageTokenMix,
  costUsd: Schema.Number,
  hasPartialCost: Schema.Boolean,
  scan: UsageScanState,
});
export type UsageOverview = typeof UsageOverview.Type;

export const UsageGetBreakdownInput = Schema.Struct({
  by: UsageBreakdownBy,
  range: UsageRange,
});
export type UsageGetBreakdownInput = typeof UsageGetBreakdownInput.Type;

export const UsageBreakdownRow = Schema.Struct({
  key: Schema.String,
  ...UsageTokenTotals.fields,
  costUsd: Schema.Number,
  hasPartialCost: Schema.Boolean,
});
export type UsageBreakdownRow = typeof UsageBreakdownRow.Type;

export const UsageBreakdown = Schema.Struct({
  by: UsageBreakdownBy,
  range: UsageRange,
  rows: Schema.Array(UsageBreakdownRow),
});
export type UsageBreakdown = typeof UsageBreakdown.Type;

export const UsageRefreshScanResult = Schema.Struct({
  type: Schema.Literal("usage.scan.completed"),
  scannedFiles: NonNegativeInt,
  parsedTurns: NonNegativeInt,
  completedAt: IsoDateTime,
});
export type UsageRefreshScanResult = typeof UsageRefreshScanResult.Type;

export const UsageClearLedgerResult = Schema.Struct({});
export type UsageClearLedgerResult = typeof UsageClearLedgerResult.Type;

export class UsageRpcError extends Schema.TaggedErrorClass<UsageRpcError>()("UsageRpcError", {
  message: Schema.String,
}) {}
