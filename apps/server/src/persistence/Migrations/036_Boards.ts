import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_boards (
      board_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_boards_project_id
    ON projection_boards (project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_cards (
      card_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      position_kind TEXT NOT NULL,
      position_step_index INTEGER,
      status TEXT,
      snapshot_json TEXT,
      branch TEXT,
      worktree_path TEXT,
      step_threads_json TEXT NOT NULL,
      released_at TEXT,
      completed_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_cards_board_id
    ON projection_cards (board_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_cards_project_id
    ON projection_cards (project_id)
  `;
});
