import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0039 from "./039_UsageLedger.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_UsageLedger", (it) => {
  it.effect("creates the external usage ledger schema idempotently", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* runMigrations({ toMigrationInclusive: 39 });

      const rollupColumns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly dfltValue: string | null;
        readonly pk: number;
      }>`
        SELECT
          name,
          "notnull",
          dflt_value AS "dfltValue",
          pk
        FROM pragma_table_info('usage_daily_rollup')
        ORDER BY cid
      `;
      assert.deepStrictEqual(
        rollupColumns.map(({ name }) => name),
        [
          "day",
          "provider",
          "model",
          "project_path",
          "git_branch",
          "input_tokens",
          "cached_input_tokens",
          "cache_write_tokens",
          "output_tokens",
          "reasoning_tokens",
          "turns",
          "sessions",
          "cost_usd",
          "source",
        ],
      );
      assert.deepStrictEqual(
        rollupColumns
          .filter(({ pk }) => pk > 0)
          .sort((left, right) => left.pk - right.pk)
          .map(({ name }) => name),
        ["day", "provider", "model", "project_path", "git_branch", "source"],
      );
      for (const name of ["model", "project_path", "git_branch"]) {
        const column = rollupColumns.find((candidate) => candidate.name === name);
        assert.equal(column?.notnull, 1);
        assert.equal(column?.dfltValue, "''");
      }

      const scanFileColumns = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('usage_scan_files')
        ORDER BY cid
      `;
      assert.deepStrictEqual(
        scanFileColumns.map(({ name }) => name),
        ["path", "mtime_ms", "size", "byte_offset", "scanned_at"],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_index_list('usage_daily_rollup')
      `;
      assert.equal(indexes.filter(({ name }) => name === "usage_daily_rollup_day_idx").length, 1);

      yield* sql`
        INSERT INTO usage_daily_rollup (day, provider, source)
        VALUES ('2026-08-04', 'codex', 'log-scan')
      `;
      yield* Migration0039;

      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM usage_daily_rollup
      `;
      assert.deepStrictEqual(rows, [{ count: 1 }]);
    }),
  );
});
