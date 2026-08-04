import type { UsageBreakdownBy, UsageRange } from "@aqqua/contracts";
import { useEffect, useState } from "react";

import { useUsageBreakdown } from "~/lib/usagePageState";
import { totalUsageTokens } from "~/lib/usageOverviewModel";
import { cn } from "~/lib/utils";

const TOKEN_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const COST_FORMAT = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function UsageBreakdownTable({
  range,
  refreshSignal,
}: {
  readonly range: UsageRange;
  readonly refreshSignal: number;
}) {
  const [by, setBy] = useState<UsageBreakdownBy>("model");
  const breakdown = useUsageBreakdown(range, by);

  useEffect(() => {
    if (refreshSignal === 0) return;
    void breakdown.refresh().catch(() => undefined);
  }, [breakdown.refresh, refreshSignal]);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em]">Breakdown</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">Scanned usage by {by}</p>
        </div>
        <div className="flex rounded-lg bg-muted/50 p-0.5" aria-label="Breakdown grouping">
          {(["model", "project"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1 text-xs capitalize text-muted-foreground transition-colors",
                by === option && "bg-background text-foreground shadow-xs",
              )}
              aria-pressed={by === option}
              onClick={() => setBy(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {breakdown.error ? (
        <p className="px-4 py-6 text-sm text-destructive-foreground sm:px-5">{breakdown.error}</p>
      ) : breakdown.isPending && breakdown.data === null ? (
        <p className="px-4 py-6 text-sm text-muted-foreground/65 sm:px-5">Loading breakdown…</p>
      ) : breakdown.data?.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-lg text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground/55">
              <tr>
                <th className="px-4 py-2.5 font-medium sm:px-5">{by}</th>
                <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                <th className="px-3 py-2.5 text-right font-medium">Turns</th>
                <th className="px-4 py-2.5 text-right font-medium sm:px-5">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {breakdown.data.rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-72 truncate px-4 py-3 font-medium sm:px-5" title={row.key}>
                    {row.key.length > 0 ? (
                      row.key
                    ) : (
                      <span className="text-muted-foreground/65">
                        {by === "model" ? "Unknown model" : "Unattributed"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground/80">
                    {TOKEN_FORMAT.format(totalUsageTokens(row))}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground/80">
                    {TOKEN_FORMAT.format(row.turns)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground/80 sm:px-5">
                    {COST_FORMAT.format(row.costUsd)}
                    {row.hasPartialCost ? (
                      <span className="ml-1 text-[10px] text-muted-foreground/55">partial</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground/65 sm:px-5">
          No {by} usage in this range.
        </p>
      )}
    </section>
  );
}
