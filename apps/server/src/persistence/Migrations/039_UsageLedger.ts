import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rollupColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(usage_daily_rollup)
  `;
  if (rollupColumns.length === 0) {
    yield* sql`
      CREATE TABLE usage_daily_rollup (
        day TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        project_path TEXT NOT NULL DEFAULT '',
        git_branch TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        turns INTEGER NOT NULL DEFAULT 0,
        sessions INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        source TEXT NOT NULL,
        PRIMARY KEY (day, provider, model, project_path, git_branch, source)
      )
    `;
  }

  const scanFileColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(usage_scan_files)
  `;
  if (scanFileColumns.length === 0) {
    yield* sql`
      CREATE TABLE usage_scan_files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        size INTEGER NOT NULL,
        byte_offset INTEGER NOT NULL,
        scanned_at TEXT NOT NULL
      )
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS usage_daily_rollup_day_idx
    ON usage_daily_rollup (day)
  `;
});
