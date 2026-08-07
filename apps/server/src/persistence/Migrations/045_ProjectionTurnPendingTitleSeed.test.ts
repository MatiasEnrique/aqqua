import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionTurnPendingTitleSeed", (it) => {
  it.effect("backfills the pending title seed from the originating turn start", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          state,
          requested_at,
          checkpoint_files_json
        ) VALUES
          ('thread-seeded', NULL, 'message-seeded', 'pending', '2026-08-05T10:00:00.000Z', '[]'),
          ('thread-unseeded', NULL, 'message-unseeded', 'pending', '2026-08-05T10:00:01.000Z', '[]'),
          ('thread-settled', 'turn-settled', NULL, 'completed', '2026-08-05T10:00:02.000Z', '[]')
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
        ) VALUES
          (
            'event-seeded',
            'thread',
            'thread-seeded',
            1,
            'thread.turn-start-requested',
            '2026-08-05T10:00:00.000Z',
            'system',
            '{"threadId":"thread-seeded","messageId":"message-seeded","titleSeed":"Investigate reconnect failures"}',
            '{}'
          ),
          (
            'event-unseeded',
            'thread',
            'thread-unseeded',
            1,
            'thread.turn-start-requested',
            '2026-08-05T10:00:01.000Z',
            'system',
            '{"threadId":"thread-unseeded","messageId":"message-unseeded"}',
            '{}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 45 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      assert.equal(
        columns.filter((column) => column.name === "pending_title_seed").length,
        1,
        "expected pending_title_seed to exist exactly once",
      );

      const rows = yield* sql<{
        readonly threadId: string;
        readonly titleSeed: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          pending_title_seed AS "titleSeed"
        FROM projection_turns
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { threadId: "thread-seeded", titleSeed: "Investigate reconnect failures" },
        { threadId: "thread-settled", titleSeed: null },
        { threadId: "thread-unseeded", titleSeed: null },
      ]);
    }),
  );
});
