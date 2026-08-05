import type { UsageOverviewTokenMix } from "~/lib/usageOverviewModel";

const TOKEN_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const SEGMENTS = [
  { key: "input", label: "Input", className: "bg-sky-500/75" },
  { key: "cached", label: "Cached", className: "bg-emerald-500/75" },
  { key: "output", label: "Output", className: "bg-violet-500/75" },
  { key: "reasoning", label: "Reasoning", className: "bg-amber-500/75" },
] as const;

export function TokenMixBar({ mix }: { readonly mix: UsageOverviewTokenMix }) {
  return (
    <section className="@container/token-mix rounded-2xl border border-border/70 bg-card/30 p-4 sm:p-5">
      <h2 className="text-sm font-semibold tracking-[-0.01em]">Token mix</h2>
      <p className="mt-1 text-xs text-muted-foreground/70">
        Cache writes are included with input tokens.
      </p>
      <div
        className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted/50"
        aria-label="Token type distribution"
      >
        {SEGMENTS.map((segment) => {
          const value = mix[segment.key];
          if (value === 0 || mix.total === 0) return null;
          return (
            <span
              key={segment.key}
              className={segment.className}
              style={{ width: `${(value / mix.total) * 100}%` }}
              title={`${segment.label}: ${TOKEN_FORMAT.format(value)}`}
            />
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 @min-[240px]/token-mix:grid-cols-2 @min-[480px]/token-mix:grid-cols-4">
        {SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex min-w-0 items-center gap-2 text-xs">
            <span className={`size-2 shrink-0 rounded-full ${segment.className}`} aria-hidden />
            <span className="truncate text-muted-foreground/70">{segment.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-foreground/85">
              {TOKEN_FORMAT.format(mix[segment.key])}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
