import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const scanFileColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(usage_scan_files)
  `;
  const hasRollupKeys = scanFileColumns.some((column) => column.name === "rollup_keys");
  if (scanFileColumns.length > 0 && !hasRollupKeys) {
    yield* sql`
      ALTER TABLE usage_scan_files
      ADD COLUMN rollup_keys TEXT NOT NULL DEFAULT '[]'
    `;
  }
});
