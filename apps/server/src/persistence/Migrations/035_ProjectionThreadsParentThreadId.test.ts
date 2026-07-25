import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const insertPreMigrationThread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      'thread-pre-migration',
      'project-pre-migration',
      'Pre-migration thread',
      '{"instanceId":"codex","model":"gpt-5-codex"}',
      'full-access',
      'default',
      NULL,
      NULL,
      NULL,
      NULL,
      0,
      0,
      0,
      '2026-04-06T00:00:00.000Z',
      '2026-04-06T00:00:01.000Z',
      NULL
    )
  `;
});

const assertMigrationApplied = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const migrations = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`
    SELECT migration_id, name
    FROM effect_sql_migrations
    WHERE migration_id = 35
  `;
  assert.deepStrictEqual(migrations, [
    { migration_id: 35, name: "ProjectionThreadsParentThreadId" },
  ]);

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  assert.equal(
    columns.filter((column) => column.name === "parent_thread_id").length,
    1,
    "expected parent_thread_id to exist exactly once",
  );

  const indexes = yield* sql<{ readonly name: string }>`
    PRAGMA index_list(projection_threads)
  `;
  assert.ok(
    indexes.some((index) => index.name === "idx_projection_threads_parent_thread_id"),
    "expected the parent_thread_id lookup index to exist",
  );

  // Threads that predate delegation must read back unparented, so the sidebar
  // renders them as roots instead of inventing an orchestrator edge.
  const rows = yield* sql<{ readonly parent_thread_id: string | null }>`
    SELECT parent_thread_id
    FROM projection_threads
    WHERE thread_id = 'thread-pre-migration'
  `;
  assert.deepStrictEqual(rows, [{ parent_thread_id: null }]);
});

// Separate layers: each suite gets its own in-memory database, so the
// already-migrated case cannot observe the clean case's schema.
const cleanLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const partiallyMigratedLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

cleanLayer("035_ProjectionThreadsParentThreadId", (it) => {
  it.effect("adds the delegation column and index, leaving existing threads unparented", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* insertPreMigrationThread;
      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* assertMigrationApplied;
    }),
  );
});

partiallyMigratedLayer("035_ProjectionThreadsParentThreadId (partially migrated)", (it) => {
  it.effect("continues when projection_threads already has parent_thread_id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* insertPreMigrationThread;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN parent_thread_id TEXT
      `;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* assertMigrationApplied;
    }),
  );
});
