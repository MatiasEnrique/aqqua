import { useAtomValue } from "@effect/atom-react";
import type { UsageRange } from "@aqqua/contracts";
import { ChartNoAxesCombinedIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { AccountUsageMeter } from "~/components/chat/AccountUsageMeter";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { ACCOUNT_USAGE_SUPPORT_BY_PROVIDER } from "@aqqua/contracts";
import { isAccountUsageSupported } from "~/lib/accountUsage.logic";
import { buildUsageOverviewModel, PROVIDER_LABELS } from "~/lib/usageOverviewModel";
import { useUsageOverview } from "~/lib/usagePageState";
import { cn } from "~/lib/utils";
import { primaryServerProvidersAtom } from "~/state/server";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { ProviderUsageRow } from "./ProviderUsageRow";
import { TokenMixBar } from "./TokenMixBar";
import { UsageBreakdownTable } from "./UsageBreakdownTable";
import { UsageHeatmap } from "./UsageHeatmap";

const UNSUPPORTED_PROVIDER_LABELS = Object.entries(ACCOUNT_USAGE_SUPPORT_BY_PROVIDER)
  .filter(([, support]) => support === "unsupported")
  .map(([provider]) => PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider);

const RANGES: ReadonlyArray<{ readonly value: UsageRange; readonly label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];
const TOKEN_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const COST_FORMAT = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function StatCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/30 p-4 sm:p-5">
      <div className="text-xs font-medium text-muted-foreground/65">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-muted-foreground/60">{detail}</div>
    </div>
  );
}

function UsageRateLimitGauges() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const supportedProviders = providers.filter((provider) =>
    isAccountUsageSupported(provider.driver),
  );

  return (
    <section className="rounded-2xl border border-border/70 bg-card/30 p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Current rate limits</h2>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Live provider windows for this environment
        </p>
      </div>
      {supportedProviders.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {supportedProviders.map((provider) => (
            <div
              key={provider.instanceId}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/45 py-1 pl-3 pr-1"
            >
              <span className="text-xs font-medium text-foreground/80">
                {provider.displayName?.trim() || provider.driver}
              </span>
              <AccountUsageMeter
                provider={provider.driver}
                providerInstanceId={provider.instanceId}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/65">
          No configured provider currently exposes rate-limit data.
        </p>
      )}
      {UNSUPPORTED_PROVIDER_LABELS.length > 0 ? (
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground/55">
          {UNSUPPORTED_PROVIDER_LABELS.join(", ")} usage is not supported; the page never reports
          missing data as zero.
        </p>
      ) : null}
    </section>
  );
}

function ScanDisabledState({
  busy,
  error,
  onEnable,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onEnable: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/30 px-5 py-10 text-center sm:px-8">
      <ChartNoAxesCombinedIcon className="mx-auto size-7 text-muted-foreground/55" />
      <h2 className="mt-4 text-base font-semibold">Historical scanning is off</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground/70">
        Usage scanning is opt-in because the first pass may read about 2 GB of local Claude and
        Codex logs. Enable{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">usage.scanEnabled</code>
        for this environment. The source logs stay on the host and only aggregated totals are sent
        to this client.
      </p>
      <div className="mt-5 flex justify-center">
        <Button size="sm" disabled={busy} onClick={onEnable}>
          {busy ? "Enabling…" : "Enable usage scanning"}
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive-foreground">{error}</p> : null}
    </section>
  );
}

export function UsagePane() {
  const [range, setRange] = useState<UsageRange>("30d");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [activeAction, setActiveAction] = useState<"enable" | "refresh" | "clear" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [breakdownRefreshSignal, setBreakdownRefreshSignal] = useState(0);
  const usage = useUsageOverview(range);
  const model = useMemo(
    () => (usage.data ? buildUsageOverviewModel(usage.data, new Date()) : null),
    [usage.data],
  );

  const runRefresh = async () => {
    setActiveAction("refresh");
    setActionError(null);
    try {
      await usage.refreshScan();
      setBreakdownRefreshSignal((signal) => signal + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The usage scan failed.");
    } finally {
      setActiveAction(null);
    }
  };
  const runEnable = async () => {
    setActiveAction("enable");
    setActionError(null);
    try {
      await usage.enableScanning();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Usage scanning could not be enabled.",
      );
    } finally {
      setActiveAction(null);
    }
  };
  const runClear = async () => {
    setActiveAction("clear");
    setActionError(null);
    try {
      await usage.clearLedger();
      setBreakdownRefreshSignal((signal) => signal + 1);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The usage ledger could not be cleared.",
      );
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "workspace-topbar shrink-0 border-b border-border/60 px-3 sm:px-5",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            isElectron && "drag-region",
          )}
        >
          <div className="flex w-full min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Usage</div>
              <div className="truncate text-[11px] text-muted-foreground/60">
                {usage.environment?.label ?? "No environment selected"} · host-local totals
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex rounded-lg bg-muted/55 p-0.5" aria-label="Usage range">
                {RANGES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors",
                      range === option.value && "bg-background text-foreground shadow-xs",
                    )}
                    aria-pressed={range === option.value}
                    onClick={() => setRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh usage scan"
                title="Refresh usage scan"
                disabled={!model?.scan.enabled || model.scan.scanning || activeAction !== null}
                onClick={() => void runRefresh()}
              >
                <RefreshCwIcon />
              </Button>
            </div>
          </div>
        </header>

        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 sm:py-9">
          <div className="@container/usage mx-auto flex w-full max-w-5xl flex-col gap-5">
            <UsageRateLimitGauges />

            {usage.environment === null ? (
              <section className="rounded-2xl border border-border/70 bg-card/30 px-5 py-8 text-sm text-muted-foreground/65">
                Select or connect an environment to see its host-local usage.
              </section>
            ) : usage.error && model === null ? (
              <section className="rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-sm text-destructive-foreground">
                {usage.error}
              </section>
            ) : usage.isPending && model === null ? (
              <section className="rounded-2xl border border-border/70 bg-card/30 px-5 py-8 text-sm text-muted-foreground/65">
                Loading usage for this environment…
              </section>
            ) : model && !model.scan.enabled ? (
              <ScanDisabledState
                busy={activeAction === "enable"}
                error={actionError}
                onEnable={() => void runEnable()}
              />
            ) : model ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground/65">
                  <span>
                    {activeAction === "refresh" || model.scan.scanning
                      ? "Scanning local logs…"
                      : model.scan.lastScanAt
                        ? `Last scanned ${DATE_TIME_FORMAT.format(new Date(model.scan.lastScanAt))}`
                        : "Not scanned yet"}
                  </span>
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={activeAction !== null || model.scan.scanning}
                    onClick={() => setConfirmingClear(true)}
                  >
                    <Trash2Icon />
                    {activeAction === "clear" ? "Clearing…" : "Clear ledger"}
                  </Button>
                  <AlertDialog
                    open={confirmingClear}
                    onOpenChange={(open) => {
                      if (!open) setConfirmingClear(false);
                    }}
                  >
                    <AlertDialogPopup>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear the usage ledger?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This deletes the scanned usage history for this environment. The source
                          logs are not deleted and can be scanned again.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogClose render={<Button variant="outline" />}>
                          Cancel
                        </AlertDialogClose>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            setConfirmingClear(false);
                            void runClear();
                          }}
                        >
                          Clear ledger
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogPopup>
                  </AlertDialog>
                </div>
                {actionError ? (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-foreground">
                    {actionError}
                  </p>
                ) : null}
                <div className="grid gap-3 @min-[440px]/usage:grid-cols-2 @min-[820px]/usage:grid-cols-4">
                  <StatCard
                    label="Total tokens"
                    value={TOKEN_FORMAT.format(model.totals.totalTokens)}
                    detail={`${TOKEN_FORMAT.format(model.totals.turns)} turns in this environment`}
                  />
                  <StatCard
                    label="Estimated cost"
                    value={COST_FORMAT.format(model.costUsd)}
                    detail={
                      model.hasPartialCost
                        ? "Some model prices are unavailable"
                        : "Estimated from current model pricing"
                    }
                  />
                  <StatCard
                    label="Active days"
                    value={TOKEN_FORMAT.format(model.totals.activeDays)}
                    detail={
                      model.bestDay
                        ? `Best day ${model.bestDay.day}`
                        : "No scanned activity in this range"
                    }
                  />
                  <StatCard
                    label="Cache share"
                    value={
                      model.cacheShare === null ? "—" : `${Math.round(model.cacheShare * 100)}%`
                    }
                    detail="Cached share of read input tokens"
                  />
                </div>
                <div className="grid gap-5 @min-[760px]/usage:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
                  <UsageHeatmap daily={model.daily} />
                  <TokenMixBar mix={model.tokenMix} />
                </div>
                <section className="rounded-2xl border border-border/70 bg-card/30 p-2">
                  <div className="px-3 pb-2 pt-2 sm:px-4">
                    <h2 className="text-sm font-semibold tracking-[-0.01em]">Providers</h2>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Range totals for supported log sources
                    </p>
                  </div>
                  <div className="divide-y divide-border/50">
                    {model.providers.map((provider) => (
                      <ProviderUsageRow key={provider.provider} provider={provider} />
                    ))}
                  </div>
                </section>
                <UsageBreakdownTable range={range} refreshSignal={breakdownRefreshSignal} />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
