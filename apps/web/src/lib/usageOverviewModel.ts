import {
  ACCOUNT_USAGE_SUPPORT_BY_PROVIDER,
  type AccountUsageSupport,
  type UsageDailyTotal,
  type UsageOverview,
  type UsageProviderTotal,
  type UsageTokenTotals,
} from "@aqqua/contracts";

const HEATMAP_DAY_COUNT = 42;
// Derived from the contract so a new or reclassified driver cannot silently
// desynchronize this list; only the display labels stay local.
const PROVIDERS = Object.keys(ACCOUNT_USAGE_SUPPORT_BY_PROVIDER) as ReadonlyArray<
  keyof typeof ACCOUNT_USAGE_SUPPORT_BY_PROVIDER
>;

export const PROVIDER_LABELS: Readonly<Record<(typeof PROVIDERS)[number], string>> = {
  claudeAgent: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

export interface UsageOverviewTotals extends UsageTokenTotals {
  readonly totalTokens: number;
  readonly activeDays: number;
}

export interface UsageOverviewDay extends UsageDailyTotal {
  readonly totalTokens: number;
  readonly intensity: 0 | 1 | 2 | 3 | 4;
}

export interface UsageOverviewProvider {
  readonly provider: (typeof PROVIDERS)[number];
  readonly label: string;
  readonly support: AccountUsageSupport;
  readonly totals: UsageProviderTotal | null;
}

export interface UsageOverviewTokenMix {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  readonly reasoning: number;
  readonly total: number;
}

export interface UsageOverviewModel {
  readonly providers: ReadonlyArray<UsageOverviewProvider>;
  readonly totals: UsageOverviewTotals;
  readonly daily: ReadonlyArray<UsageOverviewDay>;
  readonly bestDay: { readonly day: string; readonly totalTokens: number } | null;
  readonly cacheShare: number | null;
  readonly hasPartialCost: boolean;
  readonly costUsd: number;
  readonly tokenMix: UsageOverviewTokenMix;
  readonly scan: UsageOverview["scan"];
}

export function totalUsageTokens(totals: UsageTokenTotals): number {
  return (
    totals.inputTokens +
    totals.cachedInputTokens +
    totals.cacheWriteTokens +
    totals.outputTokens +
    totals.reasoningTokens
  );
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function heatmapDayKeys(now: Date): string[] {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  cursor.setDate(cursor.getDate() - (HEATMAP_DAY_COUNT - 1));
  return Array.from({ length: HEATMAP_DAY_COUNT }, () => {
    const key = localDayKey(cursor);
    cursor.setDate(cursor.getDate() + 1);
    return key;
  });
}

function emptyDay(day: string): UsageDailyTotal {
  return {
    day,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    turns: 0,
    sessions: 0,
    costUsd: 0,
    hasPartialCost: false,
  };
}

function intensityFor(totalTokens: number, maximumTokens: number): 0 | 1 | 2 | 3 | 4 {
  if (totalTokens <= 0 || maximumTokens <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((totalTokens / maximumTokens) * 4))) as 1 | 2 | 3 | 4;
}

export function buildUsageOverviewModel(overview: UsageOverview, now: Date): UsageOverviewModel {
  const dailyByDay = new Map(overview.daily.map((day) => [day.day, day]));
  const heatmapDays = heatmapDayKeys(now).map((day) => dailyByDay.get(day) ?? emptyDay(day));
  const maximumTokens = heatmapDays.reduce(
    (maximum, day) => Math.max(maximum, totalUsageTokens(day)),
    0,
  );
  const daily = heatmapDays.map((day): UsageOverviewDay => {
    const totalTokens = totalUsageTokens(day);
    return { ...day, totalTokens, intensity: intensityFor(totalTokens, maximumTokens) };
  });
  const bestDay = overview.daily.reduce<{
    readonly day: string;
    readonly totalTokens: number;
  } | null>((best, day) => {
    const totalTokens = totalUsageTokens(day);
    return totalTokens > (best?.totalTokens ?? 0) ? { day: day.day, totalTokens } : best;
  }, null);
  const providersByKind = new Map<string, UsageProviderTotal>(
    overview.providers.map((provider) => [
      provider.provider === "claude" ? "claudeAgent" : provider.provider,
      provider,
    ]),
  );
  const providers = PROVIDERS.map((provider): UsageOverviewProvider => {
    const support = ACCOUNT_USAGE_SUPPORT_BY_PROVIDER[provider];
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      support,
      totals: support === "supported" ? (providersByKind.get(provider) ?? null) : null,
    };
  });
  const cacheEligibleInput = overview.totals.inputTokens + overview.totals.cachedInputTokens;
  const tokenMix = {
    input: overview.tokenMix.inputTokens + overview.tokenMix.cacheWriteTokens,
    cached: overview.tokenMix.cachedInputTokens,
    output: overview.tokenMix.outputTokens,
    reasoning: overview.tokenMix.reasoningTokens,
    total:
      overview.tokenMix.inputTokens +
      overview.tokenMix.cacheWriteTokens +
      overview.tokenMix.cachedInputTokens +
      overview.tokenMix.outputTokens +
      overview.tokenMix.reasoningTokens,
  };

  return {
    providers,
    totals: {
      ...overview.totals,
      totalTokens: totalUsageTokens(overview.totals),
      activeDays: overview.daily.filter((day) => totalUsageTokens(day) > 0).length,
    },
    daily,
    bestDay,
    cacheShare:
      cacheEligibleInput > 0 ? overview.totals.cachedInputTokens / cacheEligibleInput : null,
    hasPartialCost: overview.hasPartialCost,
    costUsd: overview.costUsd,
    tokenMix,
    scan: overview.scan,
  };
}
