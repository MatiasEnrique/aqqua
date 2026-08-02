import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { BoardStep } from "@aqqua/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionBoardInput,
  GetProjectionBoardInput,
  ProjectionBoard,
  ProjectionBoardRepository,
  type ProjectionBoardRepositoryShape,
} from "../Services/ProjectionBoards.ts";

const ProjectionBoardDbRow = ProjectionBoard.mapFields(
  Struct.assign({
    steps: Schema.fromJsonString(Schema.Array(BoardStep)),
  }),
);
type ProjectionBoardDbRow = typeof ProjectionBoardDbRow.Type;

const makeProjectionBoardRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionBoardRow = SqlSchema.void({
    Request: ProjectionBoard,
    execute: (row) =>
      sql`
        INSERT INTO projection_boards (
          board_id,
          project_id,
          name,
          steps_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.boardId},
          ${row.projectId},
          ${row.name},
          ${JSON.stringify(row.steps)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (board_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          steps_json = excluded.steps_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionBoardRow = SqlSchema.findOneOption({
    Request: GetProjectionBoardInput,
    Result: ProjectionBoardDbRow,
    execute: ({ boardId }) =>
      sql`
        SELECT
          board_id AS "boardId",
          project_id AS "projectId",
          name,
          steps_json AS "steps",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_boards
        WHERE board_id = ${boardId}
      `,
  });

  const listProjectionBoardRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionBoardDbRow,
    execute: () =>
      sql`
        SELECT
          board_id AS "boardId",
          project_id AS "projectId",
          name,
          steps_json AS "steps",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_boards
        ORDER BY created_at ASC, board_id ASC
      `,
  });

  const deleteProjectionBoardRow = SqlSchema.void({
    Request: DeleteProjectionBoardInput,
    execute: ({ boardId }) =>
      sql`
        DELETE FROM projection_boards
        WHERE board_id = ${boardId}
      `,
  });

  const upsert: ProjectionBoardRepositoryShape["upsert"] = (row) =>
    upsertProjectionBoardRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardRepository.upsert:query")),
    );

  const getById: ProjectionBoardRepositoryShape["getById"] = (input) =>
    getProjectionBoardRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardRepository.getById:query")),
    );

  const listAll: ProjectionBoardRepositoryShape["listAll"] = () =>
    listProjectionBoardRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardRepository.listAll:query")),
    );

  const deleteById: ProjectionBoardRepositoryShape["deleteById"] = (input) =>
    deleteProjectionBoardRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBoardRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionBoardRepositoryShape;
});

export const ProjectionBoardRepositoryLive = Layer.effect(
  ProjectionBoardRepository,
  makeProjectionBoardRepository,
);
