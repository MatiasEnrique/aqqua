import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;

  if (!columns.some((column) => column.name === "checkpoint_completed_at")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN checkpoint_completed_at TEXT
    `;
  }

  yield* sql`
    UPDATE projection_turns
    SET checkpoint_completed_at = COALESCE(
      (
        SELECT json_extract(events.payload_json, '$.completedAt')
        FROM orchestration_events AS events
        WHERE events.aggregate_kind = 'thread'
          AND events.event_type = 'thread.turn-diff-completed'
          AND events.stream_id = projection_turns.thread_id
          AND json_extract(events.payload_json, '$.turnId') = projection_turns.turn_id
          AND json_extract(events.payload_json, '$.checkpointTurnCount') =
            projection_turns.checkpoint_turn_count
        ORDER BY events.sequence DESC
        LIMIT 1
      ),
      completed_at,
      started_at,
      requested_at
    )
    WHERE checkpoint_turn_count IS NOT NULL
      AND checkpoint_completed_at IS NULL
  `;
});
