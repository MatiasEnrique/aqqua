import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Durable card operation columns, plus a one-shot recovery for rows projected
 * before operations existed: `status = 'deleting'` with no claim left the
 * reactor able to re-run cleanup but unable to complete without an operation id.
 *
 * Backfill mints a deterministic deleting claim from the row id and clears the
 * legacy status so a later failure can surface the card again. Safe to re-run:
 * only rows still on legacy deleting without an operation are touched.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_cards)
  `;

  if (!columns.some((column) => column.name === "operation_json")) {
    yield* sql`
      ALTER TABLE projection_cards
      ADD COLUMN operation_json TEXT
    `;
  }

  if (!columns.some((column) => column.name === "last_error")) {
    yield* sql`
      ALTER TABLE projection_cards
      ADD COLUMN last_error TEXT
    `;
  }

  // CardOperation { kind: "deleting", operationId, requestedAt } — operationId is
  // non-empty and stable across restarts so reconcile can complete the delete.
  yield* sql`
    UPDATE projection_cards
    SET
      operation_json = json_object(
        'kind', 'deleting',
        'operationId', 'legacy-delete:' || card_id,
        'requestedAt', updated_at
      ),
      status = NULL
    WHERE status = 'deleting'
      AND operation_json IS NULL
  `;
});
