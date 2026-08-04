import type {
  AccountRateLimitCredits,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@aqqua/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  formatRateLimitWindowLabel,
  formatResetCountdown,
  formatUsagePercent,
  getUsageTone,
  normalizeUsagePercent,
  resolveAccountUsagePresentation,
  type AccountUsageTone,
  type AccountUsagePresentation,
} from "~/lib/accountUsage.logic";
import { useAccountUsage } from "~/lib/accountUsageState";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

export const TONE_COLORS: Readonly<Record<AccountUsageTone, string>> = {
  ok: "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)",
  warn: "var(--color-amber-500)",
  critical: "var(--color-red-500)",
};

export function useResetCountdownClock(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [enabled]);
  return nowMs;
}

function formatCredits(credits: AccountRateLimitCredits): string {
  if (credits.unlimited) return "Unlimited";
  if (credits.balance !== null) return credits.balance;
  return credits.hasCredits ? "Available" : "Unavailable";
}

export function useProviderAccountUsage(props: {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
}): { readonly presentation: AccountUsagePresentation; readonly error: string | null } {
  const usage = useAccountUsage();
  const presentation = useMemo(
    () =>
      resolveAccountUsagePresentation({
        provider: props.provider,
        providerInstanceId: props.providerInstanceId,
        snapshots: usage.data?.rateLimits ?? [],
      }),
    [props.provider, props.providerInstanceId, usage.data],
  );
  return { presentation, error: usage.error };
}

export function RateLimitDetails({
  presentation,
  error,
  nowMs,
}: {
  readonly presentation: AccountUsagePresentation;
  readonly error: string | null;
  readonly nowMs: number;
}) {
  if (presentation.state === "unsupported") return null;
  if (presentation.state === "pending") {
    return (
      <p className="text-pretty text-[11px] leading-4 text-muted-foreground/70">
        {error ??
          (presentation.snapshot
            ? `Connected · status ${presentation.snapshot.status ?? "unknown"}. No window details reported yet.`
            : "Waiting for usage data from this provider.")}
      </p>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {presentation.snapshot.windows.map((window) => {
          const percent = formatUsagePercent(window.usedPercent);
          const normalized = normalizeUsagePercent(window.usedPercent) ?? 0;
          const color = TONE_COLORS[getUsageTone(window.usedPercent)];
          return (
            <div
              key={`${window.kind}:${window.windowMinutes ?? "unknown"}:${window.resetsAt ?? "unknown"}`}
              className="grid gap-1"
            >
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-muted-foreground/70">
                  {formatRateLimitWindowLabel(window.kind)}
                </span>
                <span className="tabular-nums text-muted-foreground/80">
                  {percent ?? "--"} · {formatResetCountdown(window.resetsAt, nowMs)}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(normalized)}
                aria-label={`${formatRateLimitWindowLabel(window.kind)} rate-limit usage`}
              >
                <div
                  className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${normalized}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {presentation.snapshot.credits ? (
        <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
          <span className="text-muted-foreground/60">Credits</span>
          <span className="font-medium tabular-nums text-muted-foreground/80">
            {formatCredits(presentation.snapshot.credits)}
          </span>
        </div>
      ) : null}
    </>
  );
}

export function AccountUsageMeter(props: {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const { presentation, error } = useProviderAccountUsage(props);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const nowMs = useResetCountdownClock(popoverOpen && presentation.state === "ready");

  if (presentation.state === "unsupported") return null;

  const headline = presentation.state === "ready" ? presentation.headline : null;
  const normalizedPercentage = headline ? (normalizeUsagePercent(headline.usedPercent) ?? 0) : 0;
  const percentageLabel = headline ? formatUsagePercent(headline.usedPercent) : null;
  const tone = headline ? getUsageTone(headline.usedPercent) : "ok";
  const usageColor = TONE_COLORS[tone];
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 text-muted-foreground outline-none transition-colors",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={
              headline && percentageLabel
                ? `${formatRateLimitWindowLabel(headline.kind)} rate limit ${percentageLabel} used`
                : "Rate-limit usage pending"
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                {headline ? (
                  <circle
                    cx="12"
                    cy="12"
                    r={radius}
                    fill="none"
                    stroke={usageColor}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                  />
                ) : null}
              </svg>
            </span>
            <span className="text-[11px] tabular-nums">
              {headline && percentageLabel
                ? `${formatRateLimitWindowLabel(headline.kind)} ${percentageLabel}`
                : "Usage --"}
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="dropdown-glass w-64 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Rate limits</div>
            {presentation.state === "ready" && presentation.snapshot.planLabel ? (
              <div className="text-[11px] text-muted-foreground/70">
                {presentation.snapshot.planLabel}
              </div>
            ) : null}
          </div>
          <RateLimitDetails presentation={presentation} error={error} nowMs={nowMs} />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ProviderAccountUsageRow(props: {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const { presentation, error } = useProviderAccountUsage(props);
  const nowMs = useResetCountdownClock(presentation.state === "ready");

  if (presentation.state === "unsupported") {
    return <span>Rate limits · Not supported</span>;
  }
  if (presentation.state === "pending") {
    return <span>Rate limits · {error ?? "Waiting for usage data"}</span>;
  }

  const percent = formatUsagePercent(presentation.headline.usedPercent) ?? "--";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 tabular-nums">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: TONE_COLORS[getUsageTone(presentation.headline.usedPercent)] }}
        aria-hidden
      />
      <span>Rate limits</span>
      <span>·</span>
      <span>
        {formatRateLimitWindowLabel(presentation.headline.kind)} {percent}
      </span>
      <span>·</span>
      <span>{formatResetCountdown(presentation.headline.resetsAt, nowMs)}</span>
    </span>
  );
}
