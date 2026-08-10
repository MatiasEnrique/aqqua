import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Persist the provider-native subagent binding on projection_threads.
 *
 * One nullable JSON column — no new table or index. Absent/null means an
 * ordinary thread (or a pre-native-subagent row).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "provider_subagent_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN provider_subagent_json TEXT
    `;
  }
});
