import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { BoardSnapshot, CardOperation, CardParameters, CardStepThread } from "@aqqua/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionCardInput,
  GetProjectionCardInput,
  ProjectionCard,
  ProjectionCardRepository,
  type ProjectionCardRepositoryShape,
} from "../Services/ProjectionCards.ts";

const ProjectionCardDbRow = ProjectionCard.mapFields(
  Struct.assign({
    parameters: Schema.fromJsonString(CardParameters),
    snapshot: Schema.NullOr(Schema.fromJsonString(BoardSnapshot)),
    stepThreads: Schema.fromJsonString(Schema.Array(CardStepThread)),
    operation: Schema.NullOr(Schema.fromJsonString(CardOperation)),
  }),
);
type ProjectionCardDbRow = typeof ProjectionCardDbRow.Type;

const makeProjectionCardRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionCardRow = SqlSchema.void({
    Request: ProjectionCard,
    execute: (row) =>
      sql`
        INSERT INTO projection_cards (
          card_id,
          board_id,
          project_id,
          title,
          parameters_json,
          position_kind,
          position_step_index,
          status,
          snapshot_json,
          branch,
          worktree_path,
          step_threads_json,
          released_at,
          completed_at,
          settled_at,
          archived_at,
          operation_json,
          last_error,
          created_at,
          updated_at
        )
        VALUES (
          ${row.cardId},
          ${row.boardId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(row.parameters)},
          ${row.positionKind},
          ${row.positionStepIndex},
          ${row.status},
          ${row.snapshot !== null ? JSON.stringify(row.snapshot) : null},
          ${row.branch},
          ${row.worktreePath},
          ${JSON.stringify(row.stepThreads)},
          ${row.releasedAt},
          ${row.completedAt},
          ${row.settledAt},
          ${row.archivedAt},
          ${row.operation !== null ? JSON.stringify(row.operation) : null},
          ${row.lastError},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (card_id)
        DO UPDATE SET
          board_id = excluded.board_id,
          project_id = excluded.project_id,
          title = excluded.title,
          parameters_json = excluded.parameters_json,
          position_kind = excluded.position_kind,
          position_step_index = excluded.position_step_index,
          status = excluded.status,
          snapshot_json = excluded.snapshot_json,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          step_threads_json = excluded.step_threads_json,
          released_at = excluded.released_at,
          completed_at = excluded.completed_at,
          settled_at = excluded.settled_at,
          archived_at = excluded.archived_at,
          operation_json = excluded.operation_json,
          last_error = excluded.last_error,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionCardRow = SqlSchema.findOneOption({
    Request: GetProjectionCardInput,
    Result: ProjectionCardDbRow,
    execute: ({ cardId }) =>
      sql`
        SELECT
          card_id AS "cardId",
          board_id AS "boardId",
          project_id AS "projectId",
          title,
          parameters_json AS "parameters",
          position_kind AS "positionKind",
          position_step_index AS "positionStepIndex",
          status,
          snapshot_json AS "snapshot",
          branch,
          worktree_path AS "worktreePath",
          step_threads_json AS "stepThreads",
          released_at AS "releasedAt",
          completed_at AS "completedAt",
          settled_at AS "settledAt",
          archived_at AS "archivedAt",
          operation_json AS "operation",
          last_error AS "lastError",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cards
        WHERE card_id = ${cardId}
      `,
  });

  const listProjectionCardRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCardDbRow,
    execute: () =>
      sql`
        SELECT
          card_id AS "cardId",
          board_id AS "boardId",
          project_id AS "projectId",
          title,
          parameters_json AS "parameters",
          position_kind AS "positionKind",
          position_step_index AS "positionStepIndex",
          status,
          snapshot_json AS "snapshot",
          branch,
          worktree_path AS "worktreePath",
          step_threads_json AS "stepThreads",
          released_at AS "releasedAt",
          completed_at AS "completedAt",
          settled_at AS "settledAt",
          archived_at AS "archivedAt",
          operation_json AS "operation",
          last_error AS "lastError",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cards
        ORDER BY created_at ASC, card_id ASC
      `,
  });

  const deleteProjectionCardRow = SqlSchema.void({
    Request: DeleteProjectionCardInput,
    execute: ({ cardId }) =>
      sql`
        DELETE FROM projection_cards
        WHERE card_id = ${cardId}
      `,
  });

  const upsert: ProjectionCardRepositoryShape["upsert"] = (row) =>
    upsertProjectionCardRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionCardRepository.upsert:query")),
    );

  const getById: ProjectionCardRepositoryShape["getById"] = (input) =>
    getProjectionCardRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionCardRepository.getById:query")),
    );

  const listAll: ProjectionCardRepositoryShape["listAll"] = () =>
    listProjectionCardRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionCardRepository.listAll:query")),
    );

  const deleteById: ProjectionCardRepositoryShape["deleteById"] = (input) =>
    deleteProjectionCardRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionCardRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionCardRepositoryShape;
});

export const ProjectionCardRepositoryLive = Layer.effect(
  ProjectionCardRepository,
  makeProjectionCardRepository,
);
