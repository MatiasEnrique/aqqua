import type { UsageOverviewProvider } from "~/lib/usageOverviewModel";
import { totalUsageTokens } from "~/lib/usageOverviewModel";

const TOKEN_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const COST_FORMAT = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function ProviderUsageRow({ provider }: { readonly provider: UsageOverviewProvider }) {
  if (provider.support === "unsupported") {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 sm:px-4">
        <div>
          <div className="text-sm font-medium">{provider.label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground/65">Historical usage</div>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground/65">
          Not supported
        </span>
      </div>
    );
  }

  if (provider.totals === null) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 sm:px-4">
        <div>
          <div className="text-sm font-medium">{provider.label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground/65">Supported</div>
        </div>
        <span className="text-xs text-muted-foreground/65">No scanned usage</span>
      </div>
    );
  }

  const totalTokens = totalUsageTokens(provider.totals);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-3 py-3 @min-[480px]/usage:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{provider.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground/65">
          {TOKEN_FORMAT.format(provider.totals.turns)} turns ·{" "}
          {TOKEN_FORMAT.format(provider.totals.sessions)} sessions
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium tabular-nums">{TOKEN_FORMAT.format(totalTokens)}</div>
        <div className="text-[11px] text-muted-foreground/60">tokens</div>
      </div>
      <div className="col-span-2 text-right @min-[480px]/usage:col-span-1 @min-[480px]/usage:min-w-24">
        <div className="text-sm tabular-nums text-foreground/80">
          {COST_FORMAT.format(provider.totals.costUsd)}
        </div>
        <div className="text-[11px] text-muted-foreground/60">
          {provider.totals.hasPartialCost ? "partial estimate" : "estimated"}
        </div>
      </div>
    </div>
  );
}
