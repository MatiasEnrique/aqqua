import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Adds the user-chosen project icon column.
 *
 * NULL for every existing project, which keeps them on favicon discovery. No
 * backfill: project icons ship with this migration, so no recorded event can
 * carry one yet.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!columns.some((column) => column.name === "icon_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN icon_json TEXT
    `;
  }
});
