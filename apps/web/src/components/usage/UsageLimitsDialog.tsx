import { useAtomValue } from "@effect/atom-react";
import type { AccountRateLimitWindow } from "@aqqua/contracts";
import { GaugeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatRateLimitWindowLabel,
  formatResetCountdown,
  formatUsagePercent,
  getUsageTone,
  isAccountUsageSupported,
  normalizeUsagePercent,
  resolveAccountUsagePresentation,
} from "~/lib/accountUsage.logic";
import { useAccountUsage } from "~/lib/accountUsageState";
import { TONE_COLORS } from "../chat/AccountUsageMeter";
import { primaryServerProvidersAtom } from "~/state/server";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** Windows that govern Fable 5: its dedicated weekly quota when the account
 * has one, plus the shared five-hour and weekly limits it also draws from. */
const FABLE_WINDOW_KINDS: ReadonlySet<AccountRateLimitWindow["kind"]> = new Set([
  "weekly-fable",
  "five-hour",
  "weekly",
]);

function WindowRow({
  window,
  nowMs,
}: {
  readonly window: AccountRateLimitWindow;
  readonly nowMs: number;
}) {
  const percent = formatUsagePercent(window.usedPercent);
  const normalized = normalizeUsagePercent(window.usedPercent) ?? 0;
  const color = TONE_COLORS[getUsageTone(window.usedPercent)];
  const label = formatRateLimitWindowLabel(window.kind);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground/75">{label}</span>
        <span className="tabular-nums text-muted-foreground/85">
          {percent ?? "--"} · {formatResetCountdown(window.resetsAt, nowMs)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized)}
        aria-label={`${label} rate-limit usage`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${normalized}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function UsageLimitsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const usage = useAccountUsage();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [open]);

  const supportedProviders = providers.filter((provider) =>
    isAccountUsageSupported(provider.driver),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GaugeIcon className="size-4" />
            Rate limits
          </DialogTitle>
          <DialogDescription>
            Live provider limits for this environment. The full history lives on the usage page.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          {supportedProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground/70">
              No configured provider exposes rate-limit data.
            </p>
          ) : (
            supportedProviders.map((provider) => {
              const presentation = resolveAccountUsagePresentation({
                provider: provider.driver,
                providerInstanceId: provider.instanceId,
                snapshots: usage.data?.rateLimits ?? [],
              });
              const label = provider.displayName?.trim() || provider.driver;
              if (presentation.state !== "ready") {
                return (
                  <section key={provider.instanceId} className="space-y-1.5">
                    <h3 className="text-xs font-semibold text-foreground/85">{label}</h3>
                    <p className="text-xs text-muted-foreground/65">
                      {usage.error ?? "Waiting for usage data from this provider."}
                    </p>
                  </section>
                );
              }

              const isClaude = provider.driver === "claudeAgent";
              const fableWindows = presentation.snapshot.windows.filter((window) =>
                FABLE_WINDOW_KINDS.has(window.kind),
              );
              const otherWindows = presentation.snapshot.windows.filter(
                (window) => !FABLE_WINDOW_KINDS.has(window.kind),
              );

              return (
                <section key={provider.instanceId} className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xs font-semibold text-foreground/85">{label}</h3>
                    {presentation.snapshot.planLabel ? (
                      <span className="text-[11px] text-muted-foreground/65">
                        {presentation.snapshot.planLabel}
                      </span>
                    ) : null}
                  </div>
                  {isClaude && fableWindows.length > 0 ? (
                    <div className="space-y-2 rounded-xl border border-border/60 bg-background/45 p-3">
                      <div className="text-[11px] font-medium text-muted-foreground/75">
                        {fableWindows.some((window) => window.kind === "weekly-fable")
                          ? "Fable 5 · dedicated weekly quota plus shared windows"
                          : "Fable 5 · shares the 5h and weekly windows"}
                      </div>
                      {fableWindows.map((window) => (
                        <WindowRow
                          key={`${window.kind}:${window.resetsAt ?? "unknown"}`}
                          window={window}
                          nowMs={nowMs}
                        />
                      ))}
                    </div>
                  ) : (
                    fableWindows.map((window) => (
                      <WindowRow
                        key={`${window.kind}:${window.resetsAt ?? "unknown"}`}
                        window={window}
                        nowMs={nowMs}
                      />
                    ))
                  )}
                  {otherWindows.map((window) => (
                    <WindowRow
                      key={`${window.kind}:${window.resetsAt ?? "unknown"}`}
                      window={window}
                      nowMs={nowMs}
                    />
                  ))}
                </section>
              );
            })
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
