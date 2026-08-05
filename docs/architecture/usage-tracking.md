# Usage tracking architecture

Status: implemented

## Purpose

Usage tracking gives clients two related views of provider account usage without putting either
one into a thread timeline:

1. live rate-limit windows emitted by provider adapters;
2. historical token and estimated-cost totals derived from provider log files on the server host.

The paths share contracts and UI, but they have different sources of truth and lifetimes. Live
rate limits are an in-memory snapshot. Historical usage is a host-local SQLite ledger that can be
rebuilt from Claude and Codex logs.

## Runtime topology

```text
Claude or Codex adapter
  └─ account.rate-limits.updated
       └─ ProviderRuntimeIngestion
            └─ AccountRateLimits (latest per provider instance, in memory)
                 └─ subscribeAccountUsage stream
                      └─ composer, provider settings, and /usage gauges

~/.claude/projects/**/*.jsonl       ~/.codex/sessions/**/rollout-*.jsonl
                 └─ UsageScanner ──┘
                        ├─ provider parsers
                        ├─ aqqua project/worktree attribution
                        ├─ daily rollup and pricing estimate
                        └─ usage_daily_rollup + usage_scan_files
                                      └─ usage.getOverview / usage.getBreakdown
                                           └─ /usage
```

The scanner runs in `apps/server`, so a web, desktop, mobile, or relay client reads usage from the
machine that owns the selected environment. Provider logs and raw turns never cross the WebSocket;
clients receive live snapshots or aggregate query results.

## Live rate limits

Claude and Codex normalize their native payloads into `AccountRateLimitsSnapshot` at the adapter
boundary. A snapshot identifies the provider instance and contains zero or more windows, the
percentage already used, reset time, window duration, and provider-specific plan, credit, or status
fields when available.

`ProviderRuntimeIngestion` intercepts `account.rate-limits.updated` before resolving a thread and
passes it to `AccountRateLimits`. This is intentional: account limits belong to a provider account,
not to the thread whose activity happened to expose them.

`AccountRateLimits` keeps the latest snapshot per provider instance in memory. During the provider
instance migration, an event without an instance ID falls back to one bucket keyed by provider
kind. The service publishes only semantic changes; a new capture timestamp alone does not cause a
WebSocket update. Its scoped subscription takes the initial snapshot and then streams changes
without a subscribe/snapshot race.

The live state is not persisted. Claude has no rate-limit data in its JSONL files, so its gauge is
pending until the Claude SDK emits a `rate_limit_event`. When historical scanning is enabled, the
scanner can seed an empty Codex account state from the newest inline rate-limit payload it finds in
a rollout. Because rollout logs do not identify an aqqua provider instance, that seed uses the
default `codex` instance ID; configured Codex instances with another ID still wait for a live event.
A live or previously seeded Codex snapshot is never overwritten by the cold seed.

### Window normalization

Claude maps its five-hour, seven-day, model-specific weekly, and overage window types directly.
The SDK does not document whether `utilization` is a fraction or a percentage, so values at or below
`1` are multiplied by 100 and larger values are retained as percentages.

Codex supplies primary and secondary windows. aqqua classifies each by whichever standard duration
it is closest to: 300 minutes for five-hour or 10,080 minutes for weekly. If duration is missing,
primary falls back to five-hour and secondary to weekly.

## Historical scan and ledger

Historical scanning is controlled by the server setting `usage.scanEnabled`, which defaults to
`false`. When background scanning is active, the server attempts a scan after a two-second startup
delay and schedules later work with a 15-minute scan interval. Manual refresh uses the same
single-flight scanner, so concurrent requests share one scan.

The scanner discovers Claude project logs and dated Codex rollout logs under the server user's home
directory. It parses complete JSONL lines only, attributes each source `cwd` to the longest matching
active aqqua project or worktree root, and labels everything else `external`. It then aggregates by
local calendar day, provider, model, attributed project, Git branch, and source.

The migration creates two tables:

- `usage_daily_rollup` stores additive token, turn, session, and cost totals;
- `usage_scan_files` stores file metadata, the committed byte offset, and scan time.

The ledger is not a projection. Its source of truth is external provider logs rather than aqqua's
event log, so it deliberately does not use a `projection_` table name or the projection pipeline.
Committing a file's rollups and resume position is one transaction. Clearing the ledger deletes both
the rollups and the file checkpoints; it does not delete provider logs.

Overview and breakdown aggregation happens in SQL. `usage.getOverview` returns range totals, daily
totals, provider totals, token mix, cost completeness, and scanner state. `usage.getBreakdown`
exposes model and project groupings. Refresh and clear require operate scope; queries and the live
subscription require read scope.

## Provider parsers

### Claude

The Claude source accepts top-level `assistant` records and reads the top-level `message.usage`.
`usage.iterations` is intentionally ignored because it repeats the aggregate and would double-count
tokens. Cache reads and cache creation are retained as separate token categories. `isSidechain`
records remain included, and `requestId` deduplication prevents repeated assistant records from
being counted more than once while a file is being incrementally scanned.

### Codex

Codex `total_token_usage` counters are cumulative within a session. The parser therefore records
the non-negative difference from the previous total, resets when counters or session identity move
backwards, and ignores zero deltas. Summing cumulative totals would multiply usage by the number of
token-count events; relying on repeated per-turn records would make duplicate events unsafe.

The rollout's `session_meta` supplies session identity and `cwd`, while `turn_context` supplies the
current model. Inline rate-limit payloads are retained only to seed the live Codex gauge.

## Incremental resume and rebuilds

Provider JSONL files are append-oriented, so rescans normally begin at the byte offset committed in
`usage_scan_files`. An unterminated final line is left unread until a later pass completes it. This
avoids rereading multi-gigabyte histories and large active session files on every refresh.

Parser state stays in memory. On server restart, Codex reconstructs enough state from the file
header and up to 1 MiB before the saved offset to recover session, model, cumulative counters, and
recent inline limits. If a saved file shrinks, is replaced, or Codex state cannot be recovered, the
scanner clears and rebuilds the ledger rather than adding deltas onto an uncertain base.

## Cost estimates

`Pricing.ts` maps recognized Claude and Codex model names to current API list prices for input,
output, cache-read, and cache-write tokens. Pricing is applied at scan time; it does not reconstruct
historical price changes, subscription allowances, provider-specific uplifts, or billing credits.
Reasoning tokens are counted in token totals but are not a separate priced category.

An unknown or missing model produces a `NULL` cost for its rollup. SQL still sums known costs and
sets `hasPartialCost`, allowing the UI to label the result as a partial estimate instead of treating
unknown prices as free usage.

## Provider support

| Provider | Live rate-limit gauges | Historical log scan | Notes                                                                            |
| -------- | ---------------------- | ------------------- | -------------------------------------------------------------------------------- |
| Claude   | Supported              | Supported           | Live limits require an SDK rate-limit event; JSONL has no cold-start limit data. |
| Codex    | Supported              | Supported           | Rollouts also provide a cold seed when scanning is enabled.                      |
| Cursor   | Unsupported            | Unsupported         | Rendered as unsupported, never as zero usage.                                    |
| Grok     | Unsupported            | Unsupported         | Rendered as unsupported, never as zero usage.                                    |
| OpenCode | Unsupported            | Unsupported         | Rendered as unsupported, never as zero usage.                                    |

Adding support requires an explicit decision for both columns. A provider may expose live account
limits without having a stable log format, or have scannable logs without emitting live limits.

## Maintenance rules

- Keep rate limits out of thread activities. A per-turn activity would persist account state and
  replay it through every thread subscription.
- Keep the ledger outside the projection pipeline. It is rebuilt from host files, not domain events.
- Keep scanning server-side. Moving it into Electron would make remote and headless environments
  report the client's logs instead of the backend host's logs.
- Preserve byte-offset resume and transactional file commits. Updating the checkpoint separately
  from its rollups can permanently skip or double-count a tail.
- Treat provider payload normalization and log parsing as adapter/source-boundary concerns. Public
  contracts and the UI should not learn native Claude or Codex shapes.
- Send aggregates, not raw ledger rows or log contents, across the environment connection.

## Main implementation files

- contracts: [`packages/contracts/src/usage.ts`](../../packages/contracts/src/usage.ts)
- live service: [`apps/server/src/usage/AccountRateLimits.ts`](../../apps/server/src/usage/AccountRateLimits.ts)
- scanner: [`apps/server/src/usage/UsageScanner.ts`](../../apps/server/src/usage/UsageScanner.ts)
- provider sources: [`ClaudeLogSource.ts`](../../apps/server/src/usage/ClaudeLogSource.ts) and
  [`CodexLogSource.ts`](../../apps/server/src/usage/CodexLogSource.ts)
- rollup and pricing: [`UsageRollup.ts`](../../apps/server/src/usage/UsageRollup.ts) and
  [`Pricing.ts`](../../apps/server/src/usage/Pricing.ts)
- persistence: [`039_UsageLedger.ts`](../../apps/server/src/persistence/Migrations/039_UsageLedger.ts)
  and [`UsageLedger.ts`](../../apps/server/src/persistence/Layers/UsageLedger.ts)
