import type {
  BoardId,
  CardId,
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationCommand,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@aqqua/contracts";
import { normalizeProjectPathForComparison } from "@aqqua/shared/path";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

export function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === threadId);
}

export function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function findBoardById(
  readModel: OrchestrationReadModel,
  boardId: BoardId,
): OrchestrationBoard | undefined {
  return (readModel.boards ?? []).find((board) => board.id === boardId);
}

export function findCardById(
  readModel: OrchestrationReadModel,
  cardId: CardId,
): OrchestrationCard | undefined {
  return (readModel.cards ?? []).find((card) => card.id === cardId);
}

export function listThreadsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter((thread) => thread.projectId === projectId);
}

export function listThreadsByParentThreadId(
  readModel: OrchestrationReadModel,
  parentThreadId: ThreadId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter(
    (thread) => (thread.parentThreadId ?? null) === parentThreadId && thread.id !== parentThreadId,
  );
}

export function listActiveDescendantDeletionRoots(
  readModel: OrchestrationReadModel,
  parentThreadId: ThreadId,
): ReadonlyArray<OrchestrationThread> {
  const roots: OrchestrationThread[] = [];
  const visited = new Set<ThreadId>([parentThreadId]);

  const visitChildren = (threadId: ThreadId): void => {
    for (const child of listThreadsByParentThreadId(readModel, threadId)) {
      if (visited.has(child.id)) {
        continue;
      }
      visited.add(child.id);
      if (child.deletedAt === null) {
        roots.push(child);
      } else {
        visitChildren(child.id);
      }
    }
  };

  visitChildren(parentThreadId);
  return roots;
}

/**
 * Nearest live descendants that need their own archive command.
 *
 * Archived/deleted legacy nodes are transparent: a still-live grandchild below
 * one must not escape a parent-family archive.
 */
export function listUnarchivedDescendantArchiveRoots(
  readModel: OrchestrationReadModel,
  parentThreadId: ThreadId,
): ReadonlyArray<OrchestrationThread> {
  const roots: OrchestrationThread[] = [];
  const visited = new Set<ThreadId>([parentThreadId]);

  const visitChildren = (threadId: ThreadId): void => {
    for (const child of listThreadsByParentThreadId(readModel, threadId)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (child.deletedAt === null && child.archivedAt === null) {
        roots.push(child);
      } else {
        visitChildren(child.id);
      }
    }
  };

  visitChildren(parentThreadId);
  return roots;
}

export function listUnarchivedCardsOwningThread(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): ReadonlyArray<OrchestrationCard> {
  const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread]));
  const lineage = new Set<ThreadId>();
  let currentThreadId: ThreadId | null = threadId;

  while (currentThreadId !== null && !lineage.has(currentThreadId)) {
    lineage.add(currentThreadId);
    currentThreadId = threadsById.get(currentThreadId)?.parentThreadId ?? null;
  }

  return (readModel.cards ?? []).filter(
    (card) =>
      card.archivedAt === null &&
      card.stepThreads.some((stepThread) => lineage.has(stepThread.threadId)),
  );
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireActiveProjectWorkspaceRootAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly workspaceRoot: string;
  readonly exceptProjectId?: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const normalizedWorkspaceRoot = normalizeProjectPathForComparison(input.workspaceRoot);
  const existingProject = input.readModel.projects.find(
    (project) =>
      project.deletedAt === null &&
      normalizeProjectPathForComparison(project.workspaceRoot) === normalizedWorkspaceRoot &&
      project.id !== input.exceptProjectId,
  );
  if (existingProject === undefined) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Active project '${existingProject.id}' already exists for workspace root '${normalizedWorkspaceRoot}'.`,
    ),
  );
}

export function requireThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  const thread = findThreadById(input.readModel, input.threadId);
  if (thread) {
    return Effect.succeed(thread);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireThreadArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt !== null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is not archived for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt === null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findThreadById(input.readModel, input.threadId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireBoard(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly boardId: BoardId;
}): Effect.Effect<OrchestrationBoard, OrchestrationCommandInvariantError> {
  const board = findBoardById(input.readModel, input.boardId);
  if (board) {
    return Effect.succeed(board);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Flow '${input.boardId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireBoardNotDeleted(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly boardId: BoardId;
}): Effect.Effect<OrchestrationBoard, OrchestrationCommandInvariantError> {
  return requireBoard(input).pipe(
    Effect.flatMap((board) =>
      board.deletedAt === null
        ? Effect.succeed(board)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Flow '${input.boardId}' is deleted and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireBoardAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly boardId: BoardId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findBoardById(input.readModel, input.boardId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Flow '${input.boardId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireCard(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly cardId: CardId;
}): Effect.Effect<OrchestrationCard, OrchestrationCommandInvariantError> {
  const card = findCardById(input.readModel, input.cardId);
  if (card) {
    return Effect.succeed(card);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Card '${input.cardId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireCardAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly cardId: CardId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findCardById(input.readModel, input.cardId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Card '${input.cardId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireCardNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly cardId: CardId;
}): Effect.Effect<OrchestrationCard, OrchestrationCommandInvariantError> {
  return requireCard(input).pipe(
    Effect.flatMap((card) =>
      card.archivedAt === null
        ? Effect.succeed(card)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Card '${input.cardId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireNonNegativeInteger(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly field: string;
  readonly value: number;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.commandType,
      `${input.field} must be an integer greater than or equal to 0.`,
    ),
  );
}
