import type { ProviderDriverKind, ProviderInstanceId } from "@aqqua/contracts";
import { useState } from "react";

import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import {
  formatRateLimitWindowLabel,
  formatUsagePercent,
  getUsageTone,
  normalizeUsagePercent,
} from "~/lib/accountUsage.logic";
import { cn } from "~/lib/utils";
import {
  RateLimitDetails,
  TONE_COLORS,
  useProviderAccountUsage,
  useResetCountdownClock,
} from "./AccountUsageMeter";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/**
 * The composer's single usage chip: one ring for the thread's context window,
 * one label for the account's most constrained rate-limit window, and a shared
 * popover with both sections. Replaces the separate ContextWindowMeter and
 * AccountUsageMeter chips that used to sit side by side.
 */
export function ComposerUsageMeter(props: {
  readonly usage: ContextWindowSnapshot | null;
  readonly providerDisplayName: string | null;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const { usage, providerDisplayName } = props;
  const { presentation, error } = useProviderAccountUsage(props);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const nowMs = useResetCountdownClock(popoverOpen && presentation.state === "ready");

  const headline = presentation.state === "ready" ? presentation.headline : null;
  if (usage === null && presentation.state === "unsupported") return null;

  // The ring tracks the context window; when a thread has no context data yet
  // it falls back to the rate-limit headline so the chip is never an empty circle.
  const contextPercent =
    usage !== null && usage.usedPercentage !== null && Number.isFinite(usage.usedPercentage)
      ? Math.max(0, Math.min(100, usage.usedPercentage))
      : null;
  const ringPercent = contextPercent ?? normalizeUsagePercent(headline?.usedPercent ?? null) ?? 0;
  const ringCritical =
    contextPercent !== null ? contextPercent > 90 : headline !== null && ringPercent >= 90;
  const ringColor = ringCritical
    ? "var(--color-red-500)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (ringPercent / 100) * circumference;

  const headlinePercent = headline ? formatUsagePercent(headline.usedPercent) : null;
  const headlineLabel =
    headline && headlinePercent
      ? `${formatRateLimitWindowLabel(headline.kind)} ${headlinePercent}`
      : null;
  const headlineTone = headline ? getUsageTone(headline.usedPercent) : "ok";

  const contextPercentLabel = formatUsagePercent(contextPercent);

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
              [
                contextPercentLabel ? `Context window ${contextPercentLabel} used` : null,
                headlineLabel ? `${headlineLabel} rate limit used` : null,
              ]
                .filter(Boolean)
                .join(", ") || "Usage data pending"
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
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
            {headlineLabel ? (
              <span
                className="text-[11px] tabular-nums"
                style={headlineTone === "ok" ? undefined : { color: TONE_COLORS[headlineTone] }}
              >
                {headlineLabel}
              </span>
            ) : null}
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="dropdown-glass w-64 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-3 p-3">
          {usage !== null ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-muted-foreground text-xs">Context window</div>
                {usage.maxTokens !== null && contextPercentLabel ? (
                  <div className="text-[11px] tabular-nums text-muted-foreground/70">
                    <span>{contextPercentLabel}</span>
                    <span className="mx-1">·</span>
                    <span>
                      {formatContextWindowTokens(usage.usedTokens)}/
                      {formatContextWindowTokens(usage.maxTokens ?? null)}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] tabular-nums text-muted-foreground/70">
                    {formatContextWindowTokens(usage.usedTokens)}
                  </div>
                )}
              </div>
              {usage.maxTokens !== null ? (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(contextPercent ?? 0)}
                  aria-label="Context window usage"
                >
                  <div
                    className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                    style={{
                      width: `${contextPercent ?? 0}%`,
                      backgroundColor:
                        contextPercent !== null && contextPercent > 90
                          ? "var(--color-red-500)"
                          : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)",
                    }}
                  />
                </div>
              ) : null}
              {usage.totalProcessedTokens != null && usage.totalProcessedTokens > 0 ? (
                <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
                  <span className="text-muted-foreground/60">Total processed</span>
                  <span className="font-medium tabular-nums text-muted-foreground/80">
                    {formatContextWindowTokens(usage.totalProcessedTokens)}
                  </span>
                </div>
              ) : null}
              {usage.compactsAutomatically ? (
                <div className="text-pretty text-[11px] font-medium text-muted-foreground/70">
                  {providerDisplayName ?? "It"} automatically compacts its context when needed.
                </div>
              ) : null}
            </div>
          ) : null}
          {presentation.state !== "unsupported" ? (
            <div className="flex flex-col gap-2">
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
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
