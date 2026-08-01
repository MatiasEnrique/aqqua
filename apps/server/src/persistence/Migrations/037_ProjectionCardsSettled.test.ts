import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("037_ProjectionCardsSettled", (it) => {
  it.effect("adds nullable settlement history without changing existing cards", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 36 });
      yield* sql`
        INSERT INTO projection_cards (
          card_id,
          board_id,
          project_id,
          title,
          parameters_json,
          position_kind,
          step_threads_json,
          created_at,
          updated_at
        ) VALUES (
          'card-before-settlement',
          'board-1',
          'project-1',
          'Existing card',
          '{}',
          'done',
          '[]',
          '2026-07-31T00:00:00.000Z',
          '2026-07-31T00:00:01.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 37 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_cards)
      `;
      assert.equal(
        columns.filter((column) => column.name === "settled_at").length,
        1,
        "expected settled_at to exist exactly once",
      );

      const rows = yield* sql<{ readonly settledAt: string | null }>`
        SELECT settled_at AS "settledAt"
        FROM projection_cards
        WHERE card_id = 'card-before-settlement'
      `;
      assert.deepStrictEqual(rows, [{ settledAt: null }]);
    }),
  );
});
