/**
 * ProjectionBoardRepository - Projection repository interface for boards.
 *
 * Owns persistence operations for board rows in the orchestration projection
 * read model.
 *
 * @module ProjectionBoardRepository
 */
import {
  BoardId,
  BoardStep,
  IsoDateTime,
  ProjectId,
  TrimmedNonEmptyString,
} from "@aqqua/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionBoard = Schema.Struct({
  boardId: BoardId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString,
  steps: Schema.Array(BoardStep),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionBoard = typeof ProjectionBoard.Type;

export const GetProjectionBoardInput = Schema.Struct({
  boardId: BoardId,
});
export type GetProjectionBoardInput = typeof GetProjectionBoardInput.Type;

export const DeleteProjectionBoardInput = Schema.Struct({
  boardId: BoardId,
});
export type DeleteProjectionBoardInput = typeof DeleteProjectionBoardInput.Type;

/**
 * ProjectionBoardRepositoryShape - Service API for projected board records.
 */
export interface ProjectionBoardRepositoryShape {
  /**
   * Insert or replace a projected board row.
   *
   * Upserts by `boardId` and persists steps through JSON encoding.
   */
  readonly upsert: (row: ProjectionBoard) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected board row by id.
   */
  readonly getById: (
    input: GetProjectionBoardInput,
  ) => Effect.Effect<Option.Option<ProjectionBoard>, ProjectionRepositoryError>;

  /**
   * List all projected board rows.
   *
   * Returned in deterministic creation order.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionBoard>, ProjectionRepositoryError>;

  /**
   * Hard-delete a projected board row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionBoardInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionBoardRepository - Service tag for board projection persistence.
 */
export class ProjectionBoardRepository extends Context.Service<
  ProjectionBoardRepository,
  ProjectionBoardRepositoryShape
>()("aqqua/persistence/Services/ProjectionBoards/ProjectionBoardRepository") {}
