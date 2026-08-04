# Usage

Open **Usage** from the bottom of the sidebar, or open the command palette and choose
**Open usage**. The page shows usage for the currently selected environment.

## Current rate limits

Claude and Codex can show live account rate-limit gauges. The gauge beside the message box shows the
most constrained available window: the window with the highest percentage already used. Open or
hover over it to see every reported window, its reset countdown, and plan or credit details when the
provider supplies them.

The same gauges appear at the top of the Usage page, and provider settings shows the current
rate-limit status. **Usage --** means aqqua is waiting for the provider to report account data; it
does not mean zero usage. Claude normally needs an active session to emit its first rate-limit
update. The default Codex provider instance can also recover a last known window from its local
rollout logs when historical scanning is enabled.

## Historical usage

Historical scanning is off by default. Select **Enable usage scanning** on the Usage page to turn on
the `usage.scanEnabled` setting for the selected environment, then use the refresh button in the
top-right corner to run a scan immediately.

Scanning is opt-in because the first pass may read about 2 GB of local Claude and Codex logs on a
machine with substantial history. The files stay on the environment's host. aqqua stores daily
aggregate totals in that environment's database and sends only aggregate results to the client.
After the first pass, scans normally resume from the last completed byte in each file. The server
also checks for new usage periodically while scanning is enabled.

The page includes:

- total tokens, turns, active days, estimated cost, and cache share;
- a 42-day activity heatmap and token-category mix;
- totals by provider;
- model and project breakdowns;
- 7-day, 30-day, 90-day, and all-time ranges.

The scan includes sessions created outside aqqua when they appear in the same provider log
directories. Sessions whose working directory matches an aqqua project or worktree are attributed
to that project; other sessions are grouped as external usage.

## Environments and remote connections

Usage is per environment, not per device. The aqqua server scans the provider logs on its own host,
so opening a remote environment shows that remote machine's ledger and live provider limits. Switch
environments to see the totals owned by another backend.

This also means usage from two environments is not merged, even when both environments use the same
provider account. The page subtitle names the selected environment and labels the totals as
host-local.

## Provider support

| Provider | Rate-limit gauges | Historical usage |
| -------- | ----------------- | ---------------- |
| Claude   | Supported         | Supported        |
| Codex    | Supported         | Supported        |
| Cursor   | Not supported     | Not supported    |
| Grok     | Not supported     | Not supported    |
| OpenCode | Not supported     | Not supported    |

Unsupported providers are labeled **Not supported** rather than shown with zero totals. A supported
provider can still show **No scanned usage** when its logs are absent, scanning has not run, or the
selected range contains no records.

## Cost estimates

Cost is an estimate based on the model name in each log and aqqua's current API pricing table. It is
not a provider invoice and does not account for subscription allowances, credits, historical price
changes, or every provider-specific pricing rule.

If a log has no model name or aqqua does not recognize its price, the known portion is still shown
and marked **partial estimate**. Missing prices are never treated as proof that the usage was free.

## Refresh or clear usage

Select the refresh icon in the Usage page header to scan new log data now. Refresh is unavailable
while scanning is disabled or another scan is already running.

Select **Clear ledger** to remove the selected environment's aggregate usage and scan checkpoints.
aqqua asks for confirmation first. Clearing does not delete Claude or Codex logs, disable future
scans, or affect another environment. Because the checkpoints are also removed, the next scan reads
the available logs again and rebuilds the ledger.
