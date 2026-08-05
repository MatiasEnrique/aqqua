import type { UsageOverviewDay } from "~/lib/usageOverviewModel";
import { cn } from "~/lib/utils";

const INTENSITY_CLASSES = [
  "bg-muted/45",
  "bg-primary/20",
  "bg-primary/38",
  "bg-primary/62",
  "bg-primary/88",
] as const;

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TOKEN_FORMAT = new Intl.NumberFormat();

function formatDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T12:00:00`));
}

export function UsageHeatmap({ daily }: { readonly daily: ReadonlyArray<UsageOverviewDay> }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/30 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em]">Recent activity</h2>
          <p className="mt-1 text-xs text-muted-foreground/70">Tokens processed over 42 days</p>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <span>Less</span>
          {INTENSITY_CLASSES.map((className, intensity) => (
            <span
              key={className}
              className={cn("size-2.5 rounded-[3px]", className)}
              aria-label={`Intensity ${intensity}`}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      <div
        className="grid w-fit grid-flow-col grid-rows-7 gap-1"
        aria-label="42-day token usage heatmap"
        role="list"
      >
        {daily.map((day) => (
          <span
            key={day.day}
            className={cn(
              "size-3 rounded-[3px] ring-1 ring-inset ring-foreground/4 sm:size-3.5",
              INTENSITY_CLASSES[day.intensity],
            )}
            title={`${formatDay(day.day)}: ${TOKEN_FORMAT.format(day.totalTokens)} tokens`}
            aria-label={`${formatDay(day.day)}, ${TOKEN_FORMAT.format(day.totalTokens)} tokens`}
            role="listitem"
          />
        ))}
      </div>
    </section>
  );
}
