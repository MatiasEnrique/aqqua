import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;

  if (!columns.some((column) => column.name === "pending_title_seed")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN pending_title_seed TEXT
    `;
  }

  // Backfill from the originating event so pending rows written before this
  // column existed still replay with their title seed after a crash.
  yield* sql`
    UPDATE projection_turns
    SET pending_title_seed = (
      SELECT json_extract(events.payload_json, '$.titleSeed')
      FROM orchestration_events AS events
      WHERE events.aggregate_kind = 'thread'
        AND events.event_type = 'thread.turn-start-requested'
        AND events.stream_id = projection_turns.thread_id
        AND json_extract(events.payload_json, '$.messageId') =
          projection_turns.pending_message_id
      ORDER BY events.sequence DESC
      LIMIT 1
    )
    WHERE turn_id IS NULL
      AND state = 'pending'
      AND pending_message_id IS NOT NULL
      AND pending_title_seed IS NULL
  `;
});
