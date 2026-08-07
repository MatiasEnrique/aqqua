// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  type CardCleanupStage,
  type CardId,
  type CardStatus,
  CommandId,
  type OrchestrationCard,
  type OrchestrationSession,
  type ThreadId,
} from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { boardArtifactsRoot } from "../../boardArtifacts.ts";
import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { buildBoardCardTitleMessage } from "../../textGeneration/TextGenerationPrompts.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  deleteWorktreeOwned,
  listActiveThreadsForWorktreePath,
  selectTopLevelThreadsForBatchAction,
} from "../Services/WorktreeDeletion.ts";
import { WorktreePathCoordination } from "../Services/WorktreePathCoordination.ts";
import { cardOperationMatches, collectThreadLineage } from "./BoardReactorState.ts";
import type { BoardReactorEvent } from "./BoardStepEntrySaga.ts";

export const makeBoardCardResourceSaga = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:board:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const settings = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration;
  const pathCoordination = yield* WorktreePathCoordination;
  const terminalManager = yield* Effect.serviceOption(TerminalManager.TerminalManager);

  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command);

  const archiveThreadWithCleanup = Effect.fn("BoardCardResourceSaga.archiveThreadWithCleanup")(
    function* (
      threadId: ThreadId,
      knownSession?: OrchestrationSession | null,
      archiveCommandId?: CommandId,
    ) {
      const session =
        knownSession === undefined
          ? yield* projectionSnapshotQuery.getThreadShellById(threadId).pipe(
              Effect.map(
                Option.match({
                  onNone: () => null,
                  onSome: (thread) => thread.session,
                }),
              ),
            )
          : knownSession;
      if (session !== null && session.status !== "stopped") {
        yield* dispatch({
          type: "thread.session.stop",
          commandId: yield* serverCommandId("stop-card-thread"),
          threadId,
          createdAt: yield* Effect.map(DateTime.now, DateTime.formatIso),
        });
      }
      if (Option.isSome(terminalManager)) {
        yield* terminalManager.value.close({ threadId });
      }
      yield* dispatch({
        type: "thread.archive",
        commandId: archiveCommandId ?? (yield* serverCommandId("archive-card-thread")),
        threadId,
      });
    },
  );

  const setCardStatus = Effect.fn("BoardCardResourceSaga.setCardStatus")(function* (
    cardId: CardId,
    status: CardStatus | null,
  ) {
    yield* dispatch({
      type: "card.status.set",
      commandId: yield* serverCommandId("status-set"),
      cardId,
      status,
    });
  });

  const failCardOperation = Effect.fn("BoardCardResourceSaga.failCardOperation")(function* (
    card: OrchestrationCard,
    reason: string,
  ) {
    const operation = card.operation;
    if (operation === null) {
      yield* setCardStatus(card.id, "failed");
      return;
    }
    yield* dispatch({
      type: "card.operation.fail",
      commandId: yield* serverCommandId("operation-fail"),
      cardId: card.id,
      operationId: operation.operationId,
      kind: operation.kind,
      reason,
    });
  });

  const progressCardCleanup = Effect.fn("BoardCardResourceSaga.progressCardCleanup")(function* (
    card: OrchestrationCard,
    kind: "resetting" | "deleting",
    stage: CardCleanupStage,
  ) {
    const operation = card.operation;
    if (operation?.kind !== kind) return;
    yield* dispatch({
      type: "card.cleanup.progress",
      commandId: yield* serverCommandId("cleanup-progress"),
      cardId: card.id,
      operationId: operation.operationId,
      kind,
      stage,
    });
  });

  const processCardCreated = Effect.fn("BoardReactor.processCardCreated")(function* (
    event: Extract<BoardReactorEvent, { type: "card.created" }>,
  ) {
    // Fire-and-forget title generation: never block release or fail creation.
    const cardId = event.payload.cardId;
    const parameters = event.payload.parameters;
    const placeholderTitle = event.payload.title;
    const projectId = event.payload.projectId;

    yield* Effect.gen(function* () {
      const serverSettings = yield* settings.getSettings;
      const modelSelection = serverSettings.textGenerationModelSelection;
      if (!modelSelection) {
        return;
      }

      const project = yield* projectionSnapshotQuery
        .getProjectShellById(projectId)
        .pipe(Effect.map(Option.getOrUndefined));
      const cwd = project?.workspaceRoot ?? process.cwd();
      const message = buildBoardCardTitleMessage({
        parameters,
        placeholderTitle,
      });

      const generated = yield* textGeneration.generateThreadTitle({
        cwd,
        message,
        modelSelection,
      });
      if (!generated.title.trim()) {
        return;
      }

      // Skip if the card was already retitled (unlikely race).
      const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
      if (Option.isNone(cardOption)) {
        return;
      }
      if (cardOption.value.title !== placeholderTitle) {
        return;
      }

      yield* dispatch({
        type: "card.title.set",
        commandId: yield* serverCommandId("title-set"),
        cardId,
        title: generated.title.trim().slice(0, 255),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug("board reactor skipped card title generation", {
          cardId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const processCardDeleteRequested = Effect.fn("BoardReactor.processCardDeleteRequested")(
    function* (event: Extract<BoardReactorEvent, { type: "card.delete-requested" }>) {
      const cardId = event.payload.cardId;
      const operationId = event.payload.operationId;
      const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
      if (Option.isNone(cardOption)) {
        return;
      }
      const card = cardOption.value;

      // Durable cleanup claim (preferred) or legacy status: deleting.
      const isLegacyDeleting = card.status === "deleting" && card.operation === null;
      const cleanupOperation = card.operation?.kind === "deleting" ? card.operation : null;
      if (operationId !== undefined && !cardOperationMatches(card, operationId, ["deleting"])) {
        if (!isLegacyDeleting) {
          return;
        }
      } else if (cleanupOperation === null && !isLegacyDeleting) {
        return;
      }

      const isArchive = cleanupOperation?.purpose === "archive";
      const preserveWorktree = isArchive && cleanupOperation?.deleteWorktree === false;
      const operationLabel = isArchive ? "Archive" : "Delete";
      const failCleanup = (reason: string) => failCardOperation(card, reason);
      let cleanupStage = cleanupOperation?.cleanupStage ?? "pending";

      if (cleanupOperation !== null && cleanupStage === "pending") {
        yield* progressCardCleanup(card, cleanupOperation.kind, "cleanup-started");
        cleanupStage = "cleanup-started";
      }

      if (isArchive && cleanupStage === "cleanup-started") {
        const [live, archived] = yield* Effect.all([
          projectionSnapshotQuery.getShellSnapshot(),
          projectionSnapshotQuery.getArchivedShellSnapshot(),
        ]);
        const lineage = collectThreadLineage(
          card.stepThreads.map((entry) => entry.threadId),
          [...live.threads, ...archived.threads].map((thread) => ({
            id: thread.id,
            parentThreadId: thread.parentThreadId ?? null,
            session: thread.session,
            archivedAt: thread.archivedAt,
          })),
        );
        const archiveRoots = selectTopLevelThreadsForBatchAction(
          lineage.filter((member) => member.archivedAt === null),
        );
        for (const member of archiveRoots) {
          const archiveResult = yield* archiveThreadWithCleanup(member.id, member.session).pipe(
            Effect.result,
          );
          if (Result.isFailure(archiveResult)) {
            yield* failCleanup(
              `${operationLabel} failed while archiving conversation '${member.id}': ${
                archiveResult.failure instanceof Error
                  ? archiveResult.failure.message
                  : String(archiveResult.failure)
              }`,
            );
            return;
          }
        }
        if (cleanupOperation !== null) {
          yield* progressCardCleanup(card, cleanupOperation.kind, "conversations-archived");
        }
        cleanupStage = "conversations-archived";
      }

      if (preserveWorktree && cleanupStage === "conversations-archived") {
        if (cleanupOperation !== null) {
          yield* progressCardCleanup(card, cleanupOperation.kind, "worktree-removed");
        }
        cleanupStage = "worktree-removed";
      } else if (
        !preserveWorktree &&
        card.worktreePath !== null &&
        cleanupStage !== "worktree-removed" &&
        cleanupStage !== "artifacts-removed"
      ) {
        const project = yield* projectionSnapshotQuery
          .getProjectShellById(card.projectId)
          .pipe(Effect.map(Option.getOrUndefined));
        const cwd = project?.workspaceRoot ?? card.worktreePath;
        const cleanup = yield* deleteWorktreeOwned(
          { cwd, path: card.worktreePath, force: true },
          {
            inspectWorktreeRemoval: (input) => gitWorkflow.inspectWorktreeRemoval(input),
            removeWorktree: (input) => gitWorkflow.removeWorktree(input),
            listMemberThreads: (worktreePath) =>
              Effect.gen(function* () {
                const [live, archived] = yield* Effect.all([
                  projectionSnapshotQuery.getShellSnapshot(),
                  projectionSnapshotQuery.getArchivedShellSnapshot(),
                ]);
                return listActiveThreadsForWorktreePath(
                  [...live.threads, ...archived.threads].map((thread) => ({
                    id: thread.id,
                    parentThreadId: thread.parentThreadId,
                    worktreePath: thread.worktreePath,
                    deletedAt: null,
                    archivedAt: thread.archivedAt,
                  })),
                  worktreePath,
                );
              }).pipe(
                Effect.mapError((error) => ({
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to load worktree conversation membership.",
                })),
              ),
            dispatchThreadArchive: ({ commandId, threadId }) =>
              archiveThreadWithCleanup(threadId, undefined, commandId).pipe(
                Effect.asVoid,
                Effect.mapError((error) => ({
                  message: error instanceof Error ? error.message : String(error),
                })),
              ),
            allocateCommandId: (tag) =>
              serverCommandId(tag).pipe(
                Effect.mapError((error) => ({
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to allocate worktree deletion command id.",
                })),
              ),
            pathCoordination,
          },
        ).pipe(Effect.result);

        if (Result.isFailure(cleanup)) {
          yield* failCleanup(
            `${operationLabel} failed: ${cleanup.failure instanceof Error ? cleanup.failure.message : String(cleanup.failure)}`,
          );
          return;
        }
        if (cleanup.success.status !== "completed") {
          if (
            cleanup.success.status === "partial" &&
            cleanup.success.stage === "worktree" &&
            cleanupStage === "cleanup-started"
          ) {
            if (cleanupOperation !== null) {
              yield* progressCardCleanup(card, cleanupOperation.kind, "conversations-archived");
            }
          }
          const detail =
            cleanup.success.status === "partial"
              ? cleanup.success.detail
              : `Worktree cleanup was rejected (${cleanup.success.reason}).`;
          yield* failCleanup(`${operationLabel} failed: ${detail}`);
          return;
        }
        if (cleanupStage === "cleanup-started") {
          if (cleanupOperation !== null) {
            yield* progressCardCleanup(card, cleanupOperation.kind, "conversations-archived");
          }
        }
        if (cleanupOperation !== null) {
          yield* progressCardCleanup(card, cleanupOperation.kind, "worktree-removed");
        }
      } else if (
        !preserveWorktree &&
        card.worktreePath === null &&
        cleanupStage !== "worktree-removed" &&
        cleanupStage !== "artifacts-removed"
      ) {
        if (cleanupStage === "cleanup-started") {
          if (cleanupOperation !== null) {
            yield* progressCardCleanup(card, cleanupOperation.kind, "conversations-archived");
          }
        }
        if (cleanupOperation !== null) {
          yield* progressCardCleanup(card, cleanupOperation.kind, "worktree-removed");
        }
      }

      if (cleanupStage !== "artifacts-removed") {
        const artifactDir = NodePath.join(boardArtifactsRoot(config.stateDir), card.id);
        const artifactCleanup = yield* fs
          .remove(artifactDir, { recursive: true, force: true })
          .pipe(Effect.result);
        if (Result.isFailure(artifactCleanup)) {
          yield* failCleanup(
            `${operationLabel} failed while removing artifacts: ${artifactCleanup.failure instanceof Error ? artifactCleanup.failure.message : String(artifactCleanup.failure)}`,
          );
          return;
        }
        const beforeArtifactProgress = yield* projectionSnapshotQuery.getCardById(cardId);
        if (Option.isSome(beforeArtifactProgress)) {
          if (cleanupOperation !== null) {
            yield* progressCardCleanup(
              beforeArtifactProgress.value,
              cleanupOperation.kind,
              "artifacts-removed",
            );
          }
        }
      }

      const latest = yield* projectionSnapshotQuery.getCardById(cardId);
      if (Option.isNone(latest)) {
        return;
      }
      const claimedOperationId = latest.value.operation?.operationId ?? operationId;
      if (claimedOperationId === undefined) {
        // Legacy status:deleting rows had no operation id; complete without it
        // is rejected by the new decider — only durable deletes complete here.
        if (latest.value.status === "deleting") {
          yield* Effect.logWarning(
            "board reactor cannot complete legacy deleting card without operation id",
            { cardId },
          );
        }
        return;
      }
      if (!cardOperationMatches(latest.value, claimedOperationId, ["deleting"])) {
        return;
      }

      if (
        latest.value.operation?.kind === "deleting" &&
        latest.value.operation.purpose === "archive"
      ) {
        yield* dispatch({
          type: "card.archive",
          commandId: yield* serverCommandId("archive-complete"),
          cardId,
          operationId: claimedOperationId,
        });
      } else {
        yield* dispatch({
          type: "card.delete.complete",
          commandId: yield* serverCommandId("delete-complete"),
          cardId,
          operationId: claimedOperationId,
        });
      }
    },
  );

  return {
    processCardCreated,
    processCardDeleteRequested,
  } as const;
});
