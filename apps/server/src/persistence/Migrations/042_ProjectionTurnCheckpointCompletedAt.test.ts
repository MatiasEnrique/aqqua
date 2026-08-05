import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionTurnCheckpointCompletedAt", (it) => {
  it.effect("separates checkpoint time and repairs active checkpoint rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        ) VALUES
          (
            'thread-active-checkpoint',
            'turn-active-checkpoint',
            'running',
            '2026-08-05T10:00:00.000Z',
            NULL,
            NULL,
            1,
            'provider-diff:active',
            'missing',
            '[]'
          ),
          (
            'thread-settled-checkpoint',
            'turn-settled-checkpoint',
            'completed',
            '2026-08-05T11:00:00.000Z',
            '2026-08-05T11:00:01.000Z',
            '2026-08-05T11:00:02.000Z',
            1,
            'refs/aqqua/checkpoints/settled/turn/1',
            'ready',
            '[]'
          )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          actor_kind,
          payload_json,
          metadata_json
        ) VALUES (
          'event-active-checkpoint',
          'thread',
          'thread-active-checkpoint',
          1,
          'thread.turn-diff-completed',
          '2026-08-05T10:00:05.000Z',
          'system',
          '{"threadId":"thread-active-checkpoint","turnId":"turn-active-checkpoint","checkpointTurnCount":1,"completedAt":"2026-08-05T10:00:05.000Z"}',
          '{}'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      assert.equal(
        columns.filter((column) => column.name === "checkpoint_completed_at").length,
        1,
        "expected checkpoint_completed_at to exist exactly once",
      );

      const rows = yield* sql<{
        readonly threadId: string;
        readonly completedAt: string | null;
        readonly checkpointCompletedAt: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          completed_at AS "completedAt",
          checkpoint_completed_at AS "checkpointCompletedAt"
        FROM projection_turns
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        {
          threadId: "thread-active-checkpoint",
          completedAt: null,
          checkpointCompletedAt: "2026-08-05T10:00:05.000Z",
        },
        {
          threadId: "thread-settled-checkpoint",
          completedAt: "2026-08-05T11:00:02.000Z",
          checkpointCompletedAt: "2026-08-05T11:00:02.000Z",
        },
      ]);
    }),
  );
});
