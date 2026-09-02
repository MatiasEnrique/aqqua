import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Adds the per-project origin branch used when creating worktrees. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!columns.some((column) => column.name === "new_worktrees_origin_branch")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN new_worktrees_origin_branch TEXT
    `;
  }
});
