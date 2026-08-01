import { CardOperation, CardOperationId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0038 from "./038_ProjectionCardsOperation.ts";

const decodeCardOperationJson = Schema.decodeUnknownEffect(Schema.fromJsonString(CardOperation));

// Separate layers: each suite gets its own in-memory database so a suite that
// already applied 038 cannot skip the backfill for suites that seed pre-038 rows.
const schemaLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const backfillLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const idempotentLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

schemaLayer("038_ProjectionCardsOperation schema", (it) => {
  it.effect("adds nullable operation columns without changing idle cards", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* sql`
        INSERT INTO projection_cards (
          card_id,
          board_id,
          project_id,
          title,
          parameters_json,
          position_kind,
          step_threads_json,
          settled_at,
          created_at,
          updated_at
        ) VALUES (
          'card-before-operation',
          'board-1',
          'project-1',
          'Existing card',
          '{}',
          'step',
          '[]',
          null,
          '2026-07-31T00:00:00.000Z',
          '2026-07-31T00:00:01.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 38 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_cards)
      `;
      assert.equal(
        columns.filter((column) => column.name === "operation_json").length,
        1,
        "expected operation_json to exist exactly once",
      );
      assert.equal(
        columns.filter((column) => column.name === "last_error").length,
        1,
        "expected last_error to exist exactly once",
      );

      const rows = yield* sql<{
        readonly operationJson: string | null;
        readonly lastError: string | null;
        readonly status: string | null;
      }>`
        SELECT
          operation_json AS "operationJson",
          last_error AS "lastError",
          status
        FROM projection_cards
        WHERE card_id = 'card-before-operation'
      `;
      assert.deepStrictEqual(rows, [{ operationJson: null, lastError: null, status: null }]);
    }),
  );
});

backfillLayer("038_ProjectionCardsOperation backfill", (it) => {
  it.effect("backfills legacy deleting rows into a decodable deleting operation", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const requestedAt = "2026-07-31T12:34:56.000Z";

      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* sql`
        INSERT INTO projection_cards (
          card_id,
          board_id,
          project_id,
          title,
          parameters_json,
          position_kind,
          status,
          step_threads_json,
          created_at,
          updated_at
        ) VALUES
          (
            'card-legacy-deleting',
            'board-1',
            'project-1',
            'Legacy deleting',
            '{}',
            'done',
            'deleting',
            '[]',
            '2026-07-31T00:00:00.000Z',
            ${requestedAt}
          ),
          (
            'card-running',
            'board-1',
            'project-1',
            'Still running',
            '{}',
            'step',
            'running',
            '[]',
            '2026-07-31T00:00:00.000Z',
            '2026-07-31T00:00:02.000Z'
          ),
          (
            'card-paused',
            'board-1',
            'project-1',
            'Paused card',
            '{}',
            'step',
            'paused',
            '[]',
            '2026-07-31T00:00:00.000Z',
            '2026-07-31T00:00:03.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 38 });

      const legacy = yield* sql<{
        readonly status: string | null;
        readonly operationJson: string | null;
        readonly lastError: string | null;
        readonly title: string;
        readonly positionKind: string;
        readonly updatedAt: string;
      }>`
        SELECT
          status,
          operation_json AS "operationJson",
          last_error AS "lastError",
          title,
          position_kind AS "positionKind",
          updated_at AS "updatedAt"
        FROM projection_cards
        WHERE card_id = 'card-legacy-deleting'
      `;
      assert.equal(legacy.length, 1);
      assert.equal(
        legacy[0]?.status,
        null,
        "legacy status must clear so failure can re-surface the card",
      );
      assert.equal(legacy[0]?.lastError, null);
      assert.equal(legacy[0]?.title, "Legacy deleting");
      assert.equal(legacy[0]?.positionKind, "done");
      assert.equal(legacy[0]?.updatedAt, requestedAt);
      assert.ok(legacy[0]?.operationJson, "expected operation_json to be set");

      const operation = yield* decodeCardOperationJson(legacy[0]!.operationJson!);
      assert.deepStrictEqual(operation, {
        kind: "deleting",
        operationId: CardOperationId.make("legacy-delete:card-legacy-deleting"),
        requestedAt,
      });

      const others = yield* sql<{
        readonly cardId: string;
        readonly status: string | null;
        readonly operationJson: string | null;
      }>`
        SELECT
          card_id AS "cardId",
          status,
          operation_json AS "operationJson"
        FROM projection_cards
        WHERE card_id IN ('card-running', 'card-paused')
        ORDER BY card_id ASC
      `;
      assert.deepStrictEqual(others, [
        { cardId: "card-paused", status: "paused", operationJson: null },
        { cardId: "card-running", status: "running", operationJson: null },
      ]);
    }),
  );
});

idempotentLayer("038_ProjectionCardsOperation idempotent", (it) => {
  it.effect("backfill is idempotent when the migration body runs again", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const requestedAt = "2026-07-31T08:00:00.000Z";

      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* sql`
        INSERT INTO projection_cards (
          card_id,
          board_id,
          project_id,
          title,
          parameters_json,
          position_kind,
          status,
          step_threads_json,
          created_at,
          updated_at
        ) VALUES (
          'card-idempotent-delete',
          'board-1',
          'project-1',
          'Idempotent',
          '{}',
          'step',
          'deleting',
          '[]',
          '2026-07-31T00:00:00.000Z',
          ${requestedAt}
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 38 });

      const afterFirst = yield* sql<{
        readonly status: string | null;
        readonly operationJson: string | null;
      }>`
        SELECT
          status,
          operation_json AS "operationJson"
        FROM projection_cards
        WHERE card_id = 'card-idempotent-delete'
      `;
      assert.equal(afterFirst[0]?.status, null);
      const firstJson = afterFirst[0]?.operationJson;
      assert.ok(firstJson);

      // Re-executing the migration body (columns already present) must not
      // rewrite the claim or resurrect the legacy status.
      yield* Migration0038;

      const afterSecond = yield* sql<{
        readonly status: string | null;
        readonly operationJson: string | null;
      }>`
        SELECT
          status,
          operation_json AS "operationJson"
        FROM projection_cards
        WHERE card_id = 'card-idempotent-delete'
      `;
      assert.deepStrictEqual(afterSecond, [{ status: null, operationJson: firstJson }]);

      const operation = yield* decodeCardOperationJson(firstJson!);
      assert.strictEqual(operation.kind, "deleting");
      assert.strictEqual(
        operation.operationId,
        CardOperationId.make("legacy-delete:card-idempotent-delete"),
      );
      assert.strictEqual(operation.requestedAt, requestedAt);
    }),
  );
});
