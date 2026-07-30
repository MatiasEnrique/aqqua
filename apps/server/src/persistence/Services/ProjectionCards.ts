/**
 * ProjectionCardRepository - Projection repository interface for cards.
 *
 * Owns persistence operations for card rows in the orchestration projection
 * read model.
 *
 * @module ProjectionCardRepository
 */
import {
  BoardId,
  BoardSnapshot,
  CardId,
  CardParameters,
  CardStatus,
  CardStepThread,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionCardPositionKind = Schema.Literals(["todo", "step", "done"]);
export type ProjectionCardPositionKind = typeof ProjectionCardPositionKind.Type;

export const ProjectionCard = Schema.Struct({
  cardId: CardId,
  boardId: BoardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  parameters: CardParameters,
  positionKind: ProjectionCardPositionKind,
  positionStepIndex: Schema.NullOr(NonNegativeInt),
  status: Schema.NullOr(CardStatus),
  snapshot: Schema.NullOr(BoardSnapshot),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  stepThreads: Schema.Array(CardStepThread),
  releasedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionCard = typeof ProjectionCard.Type;

export const GetProjectionCardInput = Schema.Struct({
  cardId: CardId,
});
export type GetProjectionCardInput = typeof GetProjectionCardInput.Type;

export const DeleteProjectionCardInput = Schema.Struct({
  cardId: CardId,
});
export type DeleteProjectionCardInput = typeof DeleteProjectionCardInput.Type;

/**
 * ProjectionCardRepositoryShape - Service API for projected card records.
 */
export interface ProjectionCardRepositoryShape {
  /**
   * Insert or replace a projected card row.
   *
   * Upserts by `cardId` and persists JSON-encoded fields.
   */
  readonly upsert: (row: ProjectionCard) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected card row by id.
   */
  readonly getById: (
    input: GetProjectionCardInput,
  ) => Effect.Effect<Option.Option<ProjectionCard>, ProjectionRepositoryError>;

  /**
   * List all projected card rows.
   *
   * Returned in deterministic creation order. Includes archived cards.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionCard>, ProjectionRepositoryError>;

  /**
   * Hard-delete a projected card row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionCardInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionCardRepository - Service tag for card projection persistence.
 */
export class ProjectionCardRepository extends Context.Service<
  ProjectionCardRepository,
  ProjectionCardRepositoryShape
>()("t3/persistence/Services/ProjectionCards/ProjectionCardRepository") {}
