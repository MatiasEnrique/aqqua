import type {
  CardId,
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type OrchestrationProjectorDecodeError, toProjectorDecodeError } from "./Errors.ts";
import {
  BoardCreatedPayload,
  BoardDeletedPayload,
  BoardUpdatedPayload,
  CardArchivedPayload,
  CardCleanupProgressedPayload,
  CardCompletedPayload,
  CardCreatedPayload,
  CardDeletedPayload,
  CardDeleteRequestedPayload,
  CardOperationFailedPayload,
  CardReleasedPayload,
  CardReleaseRequestedPayload,
  CardResetPayload,
  CardResetRequestedPayload,
  CardRetryRequestedPayload,
  CardSettledPayload,
  CardStatusSetPayload,
  CardStepAdvanceRequestedPayload,
  CardStepEnteredPayload,
  CardTitleUpdatedPayload,
  CardUnarchivedPayload,
  CardUnsettledPayload,
} from "./Schemas.ts";

type CardPatch = Partial<Omit<OrchestrationCard, "id" | "boardId" | "projectId">>;

function updateCard(
  cards: ReadonlyArray<OrchestrationCard>,
  cardId: CardId,
  patch: CardPatch,
): ReadonlyArray<OrchestrationCard> {
  return cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card));
}

function decodeForEvent<A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(toProjectorDecodeError(`${eventType}:${field}`)),
  );
}

/** Projects board/card events behind one seam so the core thread projector stays focused. */
export function projectBoardEvent(
  nextBase: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  switch (event.type) {
    case "board.created":
      return decodeForEvent(BoardCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const nextBoard: OrchestrationBoard = {
            id: payload.boardId,
            projectId: payload.projectId,
            name: payload.name,
            steps: payload.steps,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };
          const boards = nextBase.boards ?? [];
          const existing = boards.find((entry) => entry.id === payload.boardId);
          return {
            ...nextBase,
            boards: existing
              ? boards.map((entry) => (entry.id === payload.boardId ? nextBoard : entry))
              : [...boards, nextBoard],
          };
        }),
      );

    case "board.updated":
      return decodeForEvent(BoardUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          boards: (nextBase.boards ?? []).map((board) =>
            board.id === payload.boardId
              ? {
                  ...board,
                  name: payload.name,
                  steps: payload.steps,
                  updatedAt: payload.updatedAt,
                }
              : board,
          ),
        })),
      );

    case "board.deleted":
      return decodeForEvent(BoardDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          boards: (nextBase.boards ?? []).map((board) =>
            board.id === payload.boardId
              ? {
                  ...board,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : board,
          ),
        })),
      );

    case "card.created":
      return decodeForEvent(CardCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const nextCard: OrchestrationCard = {
            id: payload.cardId,
            boardId: payload.boardId,
            projectId: payload.projectId,
            title: payload.title,
            parameters: payload.parameters,
            position: { kind: "todo" },
            status: null,
            operation: null,
            lastError: null,
            snapshot: null,
            branch: null,
            worktreePath: null,
            stepThreads: [],
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            releasedAt: null,
            completedAt: null,
            settledAt: null,
            archivedAt: null,
          };
          const cards = nextBase.cards ?? [];
          const existing = cards.find((entry) => entry.id === payload.cardId);
          return {
            ...nextBase,
            cards: existing
              ? cards.map((entry) => (entry.id === payload.cardId ? nextCard : entry))
              : [...cards, nextCard],
          };
        }),
      );

    case "card.title-updated":
      return decodeForEvent(CardTitleUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            title: payload.title,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.release-requested":
      return decodeForEvent(CardReleaseRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            snapshot: payload.snapshot,
            // A fresh Start supersedes an earlier failed release; a stale
            // `failed` here would read as "not starting" while setup runs.
            status: null,
            lastError: null,
            ...(payload.operationId === undefined
              ? {}
              : {
                  operation: {
                    kind: "starting" as const,
                    operationId: payload.operationId,
                    requestedAt: payload.requestedAt,
                    threadId: payload.threadId ?? null,
                  },
                }),
            updatedAt: payload.requestedAt,
          }),
        })),
      );

    case "card.released":
      return decodeForEvent(CardReleasedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            releasedAt: payload.releasedAt,
            // Keep `starting` until step-enter clears it so reactors can resume.
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.step-entered":
      return decodeForEvent(CardStepEnteredPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const cards = nextBase.cards ?? [];
          const card = cards.find((entry) => entry.id === payload.cardId);
          if (!card) {
            return nextBase;
          }
          const stepThreads = [
            ...card.stepThreads,
            {
              stepIndex: payload.stepIndex,
              threadId: payload.threadId,
              spawnedAt: payload.enteredAt,
            },
          ];
          return {
            ...nextBase,
            cards: updateCard(cards, payload.cardId, {
              position: { kind: "step", stepIndex: payload.stepIndex },
              status: "running",
              operation: null,
              stepThreads,
              updatedAt: payload.updatedAt,
            }),
          };
        }),
      );

    case "card.step-advance-requested":
      return decodeForEvent(
        CardStepAdvanceRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          if (payload.operationId === undefined) {
            return nextBase;
          }
          return {
            ...nextBase,
            cards: updateCard(nextBase.cards ?? [], payload.cardId, {
              lastError: null,
              operation: {
                kind: "advancing",
                operationId: payload.operationId,
                requestedAt: payload.requestedAt,
                toStepIndex: payload.toStepIndex,
                threadId: payload.threadId ?? null,
              },
              updatedAt: payload.requestedAt,
            }),
          };
        }),
      );

    case "card.retry-requested":
      return decodeForEvent(CardRetryRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          if (payload.operationId === undefined) {
            return nextBase;
          }
          return {
            ...nextBase,
            cards: updateCard(nextBase.cards ?? [], payload.cardId, {
              lastError: null,
              operation: {
                kind: "retrying",
                operationId: payload.operationId,
                requestedAt: payload.requestedAt,
                stepIndex: payload.stepIndex,
                threadId: payload.threadId ?? null,
              },
              updatedAt: payload.requestedAt,
            }),
          };
        }),
      );

    case "card.cancel-requested":
      // Legacy reactor signal: no durable operation projection.
      return Effect.succeed(nextBase);

    case "card.reset-requested":
      return decodeForEvent(CardResetRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const current = (nextBase.cards ?? []).find((card) => card.id === payload.cardId);
          const cleanupStage =
            current?.operation?.kind === "resetting" &&
            current.operation.operationId === payload.operationId
              ? (current.operation.cleanupStage ?? "pending")
              : "pending";
          return {
            ...nextBase,
            cards: updateCard(nextBase.cards ?? [], payload.cardId, {
              lastError: null,
              operation: {
                kind: "resetting",
                operationId: payload.operationId,
                requestedAt: payload.requestedAt,
                activeThreadId: payload.activeThreadId,
                threadIds: payload.threadIds,
                cleanupStage,
              },
              // Position and agent status stay put until reset completes.
              updatedAt: payload.requestedAt,
            }),
          };
        }),
      );

    case "card.reset":
      return decodeForEvent(CardResetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            position: { kind: "todo" },
            status: null,
            operation: null,
            lastError: null,
            snapshot: null,
            stepThreads: [],
            releasedAt: null,
            completedAt: null,
            settledAt: null,
            updatedAt: payload.resetAt,
          }),
        })),
      );

    case "card.operation-failed":
      return decodeForEvent(CardOperationFailedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            // Destructive cleanup never rolls back after resources disappear.
            // Its claim stays visible and retry resumes the recorded stage.
            ...(() => {
              const operation = (nextBase.cards ?? []).find(
                (card) => card.id === payload.cardId,
              )?.operation;
              const destructiveCleanupStarted =
                (payload.kind === "resetting" || payload.kind === "deleting") &&
                operation?.kind === payload.kind &&
                (operation.cleanupStage ?? "pending") !== "pending";
              return destructiveCleanupStarted ? {} : { operation: null };
            })(),
            lastError: payload.reason,
            // Starting failures mark the agent status failed; other kinds keep
            // the prior position/status so the user can recover in place.
            ...(payload.kind === "starting" ? { status: "failed" as const } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.cleanup-progressed":
      return decodeForEvent(
        CardCleanupProgressedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const current = (nextBase.cards ?? []).find((card) => card.id === payload.cardId);
          if (
            current?.operation === null ||
            current?.operation === undefined ||
            current.operation.operationId !== payload.operationId ||
            current.operation.kind !== payload.kind
          ) {
            return nextBase;
          }
          return {
            ...nextBase,
            cards: updateCard(nextBase.cards ?? [], payload.cardId, {
              operation: { ...current.operation, cleanupStage: payload.stage },
              lastError: null,
              updatedAt: payload.progressedAt,
            }),
          };
        }),
      );

    case "card.status-set":
      return decodeForEvent(CardStatusSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            status: payload.status,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.completed":
      return decodeForEvent(CardCompletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            position: { kind: "done" },
            status: null,
            operation: null,
            completedAt: payload.completedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.archived":
      return decodeForEvent(CardArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            archivedAt: payload.archivedAt,
            lastError: null,
            operation: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.unarchived":
      return decodeForEvent(CardUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            archivedAt: null,
            lastError: null,
            operation: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.delete-requested":
      return decodeForEvent(CardDeleteRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          if (payload.operationId === undefined) {
            // Legacy events wrote agent status instead of a durable operation.
            return {
              ...nextBase,
              cards: updateCard(nextBase.cards ?? [], payload.cardId, {
                status: "deleting",
                updatedAt: payload.requestedAt,
              }),
            };
          }
          const current = (nextBase.cards ?? []).find((card) => card.id === payload.cardId);
          const matchingOperation =
            current?.operation?.kind === "deleting" &&
            current.operation.operationId === payload.operationId
              ? current.operation
              : null;
          const cleanupStage = matchingOperation?.cleanupStage ?? "pending";
          const purpose = payload.purpose ?? matchingOperation?.purpose ?? "delete";
          const deleteWorktree =
            payload.deleteWorktree ?? matchingOperation?.deleteWorktree ?? true;
          return {
            ...nextBase,
            cards: updateCard(nextBase.cards ?? [], payload.cardId, {
              lastError: null,
              operation: {
                kind: "deleting",
                operationId: payload.operationId,
                requestedAt: payload.requestedAt,
                purpose,
                deleteWorktree,
                cleanupStage,
              },
              updatedAt: payload.requestedAt,
            }),
          };
        }),
      );

    case "card.deleted":
      return decodeForEvent(CardDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: (nextBase.cards ?? []).filter((card) => card.id !== payload.cardId),
        })),
      );

    case "card.settled":
      return decodeForEvent(CardSettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            settledAt: payload.settledAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "card.unsettled":
      return decodeForEvent(CardUnsettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          cards: updateCard(nextBase.cards ?? [], payload.cardId, {
            settledAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
