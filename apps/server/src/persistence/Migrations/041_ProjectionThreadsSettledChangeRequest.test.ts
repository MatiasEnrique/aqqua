import { ProjectId, ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadRepositoryLive } from "../Layers/ProjectionThreads.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionThreadsSettledChangeRequest", (it) => {
  it.effect(
    "adds nullable change request settlement history without changing existing threads",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 40 });
        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        ) VALUES (
          'thread-before-change-request-settlement',
          'project-1',
          'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          '2026-08-04T00:00:00.000Z',
          '2026-08-04T00:00:01.000Z'
        )
      `;

        yield* runMigrations({ toMigrationInclusive: 41 });

        const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
        assert.equal(
          columns.filter((column) => column.name === "settled_change_request_number").length,
          1,
          "expected settled_change_request_number to exist exactly once",
        );

        const rows = yield* sql<{ readonly settledChangeRequestNumber: number | null }>`
        SELECT settled_change_request_number AS "settledChangeRequestNumber"
        FROM projection_threads
        WHERE thread_id = 'thread-before-change-request-settlement'
      `;
        assert.deepStrictEqual(rows, [{ settledChangeRequestNumber: null }]);
      }),
  );

  it.effect("retains the recorded change request across later thread projection upserts", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const threads = yield* ProjectionThreadRepository;
      const threadId = ThreadId.make("thread-settled-by-change-request");
      const row = {
        threadId,
        projectId: ProjectId.make("project-1"),
        parentThreadId: null,
        title: "Settled thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: "feature/settle-merged",
        worktreePath: "/repo",
        latestTurnId: null,
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
        archivedAt: null,
        settledOverride: "settled" as const,
        settledAt: "2026-08-04T00:00:00.000Z",
        snoozedUntil: null,
        snoozedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      };

      yield* threads.upsert(row);
      yield* threads.upsert({
        ...row,
        settledChangeRequestNumber: 42,
      });
      yield* threads.upsert({
        ...row,
        settledOverride: "active",
        settledAt: null,
      });

      const stored = yield* threads.getById({ threadId });
      assert.isTrue(Option.isSome(stored));
      if (Option.isSome(stored)) {
        assert.strictEqual(stored.value.settledOverride, "active");
        assert.strictEqual(stored.value.settledAt, null);
        assert.strictEqual(stored.value.settledChangeRequestNumber, 42);
      }
    }).pipe(Effect.provide(ProjectionThreadRepositoryLive)),
  );
});
