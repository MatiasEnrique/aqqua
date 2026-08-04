import {
  ACCOUNT_USAGE_SUPPORT_BY_PROVIDER,
  type AccountRateLimitWindow,
  type AccountRateLimitWindowKind,
  type AccountRateLimitsSnapshot,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@aqqua/contracts";

export type AccountUsageTone = "ok" | "warn" | "critical";

export type AccountUsagePresentation =
  | { readonly state: "unsupported" }
  | {
      readonly state: "pending";
      /** Present when the provider reported limits but no window details yet. */
      readonly snapshot?: AccountRateLimitsSnapshot;
    }
  | {
      readonly state: "ready";
      readonly snapshot: AccountRateLimitsSnapshot;
      readonly headline: AccountRateLimitWindow;
    };

const WINDOW_LABELS: Readonly<Record<AccountRateLimitWindowKind, string>> = {
  "five-hour": "5h",
  weekly: "Weekly",
  "weekly-fable": "Fable weekly",
  "weekly-opus": "Opus weekly",
  "weekly-sonnet": "Sonnet weekly",
  overage: "Overage",
};

export function normalizeUsagePercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function formatUsagePercent(value: number | null): string | null {
  const normalized = normalizeUsagePercent(value);
  if (normalized === null) return null;
  if (normalized < 10) {
    return `${normalized.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(normalized)}%`;
}

export function getUsageTone(value: number | null): AccountUsageTone {
  const normalized = normalizeUsagePercent(value) ?? 0;
  if (normalized >= 90) return "critical";
  if (normalized >= 70) return "warn";
  return "ok";
}

export function formatResetCountdown(resetsAt: number | null, nowMs: number): string {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return "Reset time unavailable";
  const remainingSeconds = Math.max(0, Math.ceil(resetsAt - nowMs / 1_000));
  if (remainingSeconds === 0) return "Resetting now";
  if (remainingSeconds < 60) return `Resets in ${remainingSeconds}s`;

  const remainingMinutes = Math.floor(remainingSeconds / 60);
  if (remainingMinutes < 60) return `Resets in ${remainingMinutes}m`;

  const remainingHours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (remainingHours < 24) {
    return `Resets in ${remainingHours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  }

  const days = Math.floor(remainingHours / 24);
  const hours = remainingHours % 24;
  return `Resets in ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
}

export function formatRateLimitWindowLabel(kind: AccountRateLimitWindowKind): string {
  return WINDOW_LABELS[kind];
}

export function selectMostConstrainedWindow(
  windows: ReadonlyArray<AccountRateLimitWindow>,
): AccountRateLimitWindow | null {
  let selected: AccountRateLimitWindow | null = null;
  let selectedPercent = -1;
  for (const window of windows) {
    const percent = normalizeUsagePercent(window.usedPercent);
    if (percent === null) continue;
    const selectedMinutes = selected?.windowMinutes ?? Number.POSITIVE_INFINITY;
    const windowMinutes = window.windowMinutes ?? Number.POSITIVE_INFINITY;
    if (
      selected === null ||
      percent > selectedPercent ||
      (percent === selectedPercent && windowMinutes < selectedMinutes)
    ) {
      selected = window;
      selectedPercent = percent;
    }
  }
  if (selected !== null) return selected;

  // No window reported a percentage (Claude omits utilization on plain
  // "allowed" events); fall back to the window that resets soonest so reset
  // times still surface.
  let soonest: AccountRateLimitWindow | null = null;
  for (const window of windows) {
    const resetsAt = window.resetsAt ?? Number.POSITIVE_INFINITY;
    if (soonest === null || resetsAt < (soonest.resetsAt ?? Number.POSITIVE_INFINITY)) {
      soonest = window;
    }
  }
  return soonest;
}

export function isAccountUsageSupported(provider: ProviderDriverKind): boolean {
  return (
    ACCOUNT_USAGE_SUPPORT_BY_PROVIDER[
      provider as keyof typeof ACCOUNT_USAGE_SUPPORT_BY_PROVIDER
    ] === "supported"
  );
}

export function resolveAccountUsagePresentation(input: {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly snapshots: ReadonlyArray<AccountRateLimitsSnapshot>;
}): AccountUsagePresentation {
  if (!isAccountUsageSupported(input.provider)) return { state: "unsupported" };

  const snapshot = input.snapshots.find(
    (candidate) => candidate.providerInstanceId === input.providerInstanceId,
  );
  if (!snapshot) return { state: "pending" };

  const headline = selectMostConstrainedWindow(snapshot.windows);
  if (!headline) return { state: "pending", snapshot };
  return { state: "ready", snapshot, headline };
}
