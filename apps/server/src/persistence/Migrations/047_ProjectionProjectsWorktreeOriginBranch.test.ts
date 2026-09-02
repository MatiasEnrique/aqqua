import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("047_ProjectionProjectsWorktreeOriginBranch", (it) => {
  it.effect("adds a nullable origin branch without changing existing projects", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 46 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          icon_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'existing-project',
          'Existing project',
          '/tmp/existing',
          NULL,
          '[]',
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 47 });

      const [row] = yield* sql<{ readonly originBranch: string | null }>`
        SELECT new_worktrees_origin_branch AS "originBranch"
        FROM projection_projects
        WHERE project_id = 'existing-project'
      `;
      assert.strictEqual(row?.originBranch, null);
    }),
  );
});
