// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  type CardCleanupStage,
  type CardId,
  type CardOperation,
  type CardStatus,
  CommandId,
  type OrchestrationCard,
  type ThreadId,
} from "@aqqua/contracts";
import { makeDrainableWorker } from "@aqqua/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { boardArtifactsRoot } from "../../boardArtifacts.ts";
import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import {
  collectThreadLineage,
  findCardForCurrentStepThread,
  hasOpenBlockingRequest,
  isProviderTurnLive,
  resolveStepEntryThreadId,
} from "../boardCardHelpers.ts";
import { selectTopLevelThreadsForBatchAction } from "../threadDeletion.ts";
import { BoardReactor, type BoardReactorShape } from "../Services/BoardReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { WorktreePathCoordination } from "../Services/WorktreePathCoordination.ts";
import { makeBoardCardResourceSaga } from "./BoardCardResourceSaga.ts";
import { makeBoardHandlerDefectRecovery } from "./BoardHandlerDefectRecovery.ts";
import {
  type BoardReactorEvent,
  BoardReactorHandlerDefectInjection,
  isBoardReactorEvent,
} from "./BoardReactorEvent.ts";
import { cardOperationMatches, currentStepRootThreadId } from "./BoardReactorState.ts";
import {
  makeBoardMissingCurrentRootRecoveryEvents,
  makeBoardReconciliationEvents,
} from "./BoardReconciliation.ts";
import { makeBoardStepEntrySaga } from "./BoardStepEntrySaga.ts";
import type { BoardReactorEvent as BoardReactorCoreEvent } from "./BoardStepEntrySaga.ts";

// Re-export pure helpers for tests that imported them from this module.
export {
  boardOperationMessageId,
  boardOperationThreadId,
  decideBoardStepTurnStart,
  findCardForCurrentStepThread,
  hasOpenBlockingRequest as threadHasOpenBlockingRequest,
  isProviderTurnLive,
  resolveStepEntryThreadId,
} from "../boardCardHelpers.ts";
export { BoardReactorHandlerDefectInjection } from "./BoardReactorEvent.ts";
export { collectThreadLineage, type ThreadLineageMember } from "../boardCardHelpers.ts";
export {
  boardCardBranchName,
  boardStepThreadTitle,
  cardOperationOwnsThreadForHandlerFailure,
} from "./BoardReactorState.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/**
 * Statuses a card may leave via an explicit user turn on the step thread
 * (chat-to-resume). Cancelled is deliberate: sending a message picks the
 * step back up.
 */
const REENGAGE_STATUSES = new Set<CardStatus | null>(["needs-input", "failed", "cancelled"]);

/**
 * Statuses that may re-engage from a mere session "running" signal. Excludes
 * "cancelled": the interrupted turn keeps streaming status messages for a
 * moment after cancel, and those must not flip the card back to running —
 * only an explicit user turn (REENGAGE_STATUSES above) may do that.
 */
const SESSION_REENGAGE_STATUSES = new Set<CardStatus | null>(["needs-input", "failed"]);

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:board:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const handlerDefectInjection = yield* Effect.serviceOption(BoardReactorHandlerDefectInjection);
  const _gitWorkflow = yield* GitWorkflowService;
  const _settings = yield* ServerSettingsService;
  const _registry = yield* ProviderAdapterRegistry;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const _textGeneration = yield* TextGeneration;
  const _pathCoordination = yield* WorktreePathCoordination;
  const _setupScriptRunner = yield* ProjectSetupScriptRunner;

  // Per-process: after turn.start is accepted for a stable step thread, do not
  // re-dispatch until a session receipt arrives (or the process restarts).
  const _turnStartDispatchedForThread = new Set<string>();

  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command);

  const setCardStatus = Effect.fn("BoardReactor.setCardStatus")(function* (
    cardId: CardId,
    status: CardStatus | null,
    reason?: string,
  ) {
    if (reason) {
      yield* Effect.logDebug("board reactor setting card status", {
        cardId,
        status,
        reason,
      });
    }
    yield* dispatch({
      type: "card.status.set",
      commandId: yield* serverCommandId("status-set"),
      cardId,
      status,
    });
  });

  const setCardFailed = Effect.fn("BoardReactor.setCardFailed")(function* (
    cardId: CardId,
    reason: string,
  ) {
    yield* Effect.logWarning("board reactor marking card failed", {
      cardId,
      reason,
    });
    yield* setCardStatus(cardId, "failed", reason);
  });

  /**
   * Fail the card's durable operation (or fall back to agent status when the
   * card has no claim). Uses the generic `card.operation.fail` command so every
   * kind persists `lastError` via `card.operation-failed`. Destructive reset
   * and delete claims remain held so partial cleanup cannot visually roll back.
   */
  const failCardOperation = Effect.fn("BoardReactor.failCardOperation")(function* (
    card: OrchestrationCard,
    reason: string,
  ) {
    const operation = card.operation;
    if (operation === null) {
      // Legacy path / residual agent failure without a durable claim.
      yield* setCardFailed(card.id, reason);
      return;
    }

    yield* Effect.logWarning("board reactor failing card operation", {
      cardId: card.id,
      kind: operation.kind,
      operationId: operation.operationId,
      reason,
    });

    yield* dispatch({
      type: "card.operation.fail",
      commandId: yield* serverCommandId("operation-fail"),
      cardId: card.id,
      operationId: operation.operationId,
      kind: operation.kind,
      reason,
    });
  });

  const progressCardCleanup = Effect.fn("BoardReactor.progressCardCleanup")(function* (
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

  const listCards = Effect.fn("BoardReactor.listCards")(function* () {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    return shell.cards;
  });

  const _getThreadSession = Effect.fn("BoardReactor.getThreadSession")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    return shell.threads.find((thread) => thread.id === threadId)?.session ?? null;
  });

  const { enterStep, loadAllThreadShells, processReleaseRequested } = yield* makeBoardStepEntrySaga;

  /**
   * Interrupt every live member of the given root lineage. Returns whether any
   * live member was found (caller must wait for session truth) or whether an
   * interrupt command dispatch failed (operation already failed).
   */
  const interruptLiveLineage = Effect.fn("BoardReactor.interruptLiveLineage")(function* (input: {
    readonly card: OrchestrationCard;
    readonly roots: ReadonlyArray<ThreadId>;
    readonly reasonPrefix: string;
  }) {
    const allThreads = yield* loadAllThreadShells();
    const lineage = collectThreadLineage(input.roots, allThreads);
    const liveMembers = lineage.filter((member) => isProviderTurnLive(member.session));
    if (liveMembers.length === 0) {
      return { staged: false as const, failed: false as const };
    }

    const createdAt = yield* nowIso;
    for (const member of liveMembers) {
      const interruptResult = yield* dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* serverCommandId("lineage-interrupt"),
        threadId: member.id,
        createdAt,
      }).pipe(Effect.result);
      if (Result.isFailure(interruptResult)) {
        const detail =
          interruptResult.failure instanceof Error
            ? interruptResult.failure.message
            : String(interruptResult.failure);
        const latest = yield* projectionSnapshotQuery.getCardById(input.card.id);
        if (Option.isSome(latest)) {
          yield* failCardOperation(
            latest.value,
            `${input.reasonPrefix}: interrupt dispatch failed for '${member.id}': ${detail}`,
          );
        }
        return { staged: true as const, failed: true as const };
      }
    }
    return { staged: true as const, failed: false as const };
  });

  const processStepAdvanceRequested = Effect.fn("BoardReactor.processStepAdvanceRequested")(
    function* (event: Extract<BoardReactorEvent, { type: "card.step-advance-requested" }>) {
      const cardId = event.payload.cardId;
      const operationId = event.payload.operationId;
      const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
      if (Option.isNone(cardOption)) {
        return;
      }
      const card = cardOption.value;
      if (operationId !== undefined && !cardOperationMatches(card, operationId, ["advancing"])) {
        return;
      }
      if (card.operation?.kind !== "advancing") {
        return;
      }
      const claimedOperationId = card.operation.operationId;
      const completionToolAdvance = claimedOperationId.startsWith("mcp:board-complete:");

      // board_complete runs inside the provider turn. Let that turn consume
      // the tool result and settle naturally; an immediate interrupt leaves
      // Claude stopped at `tool_use` and surfaces its EDE diagnostic. Manual
      // Continue still interrupts live lineage as requested by the user.
      const root = currentStepRootThreadId(card);
      if (root !== null) {
        if (completionToolAdvance) {
          const allThreads = yield* loadAllThreadShells();
          const lineage = collectThreadLineage([root], allThreads);
          if (lineage.some((member) => isProviderTurnLive(member.session))) {
            return;
          }
        } else {
          const interrupt = yield* interruptLiveLineage({
            card,
            roots: [root],
            reasonPrefix: "Advance failed",
          });
          if (interrupt.failed || interrupt.staged) {
            return;
          }
        }
      }

      yield* enterStep({
        card,
        stepIndex: event.payload.toStepIndex,
        operationId: claimedOperationId,
      });
    },
  );

  /**
   * Finalize a retrying claim: archive the entire old step lineage, then enter
   * one fresh step exactly once. Caller must ensure no lineage member is live.
   */
  const finalizeRetry = Effect.fn("BoardReactor.finalizeRetry")(function* (
    card: OrchestrationCard,
    operation: Extract<CardOperation, { kind: "retrying" }>,
  ) {
    if (!cardOperationMatches(card, operation.operationId, ["retrying"])) {
      return;
    }

    const oldRoot = [...card.stepThreads]
      .toReversed()
      .find((entry) => entry.stepIndex === operation.stepIndex)?.threadId;
    if (oldRoot !== undefined) {
      const allThreads = yield* loadAllThreadShells();
      const lineage = collectThreadLineage([oldRoot], allThreads);
      const archiveRoots = selectTopLevelThreadsForBatchAction(
        lineage.filter((member) => member.archivedAt === null),
      );
      for (const member of archiveRoots) {
        // Missing-from-shell roots still need an archive attempt when present live.
        const archiveResult = yield* dispatch({
          type: "thread.archive",
          commandId: yield* serverCommandId("retry-archive"),
          threadId: member.id,
        }).pipe(Effect.result);

        if (Result.isFailure(archiveResult)) {
          const detail =
            archiveResult.failure instanceof Error
              ? archiveResult.failure.message
              : String(archiveResult.failure);
          const latest = yield* projectionSnapshotQuery.getCardById(card.id);
          if (Option.isSome(latest)) {
            yield* failCardOperation(
              latest.value,
              `Retry failed while archiving lineage thread '${member.id}': ${detail}`,
            );
          }
          return;
        }
      }
    }

    const latest = yield* projectionSnapshotQuery.getCardById(card.id);
    if (
      Option.isNone(latest) ||
      !cardOperationMatches(latest.value, operation.operationId, ["retrying"])
    ) {
      return;
    }

    yield* enterStep({
      card: latest.value,
      stepIndex: operation.stepIndex,
      operationId: operation.operationId,
    });
  });

  /**
   * Finalize a resetting claim: archive all captured roots + descendants, clear
   * artifacts, then dispatch reset.complete exactly once.
   */
  const finalizeReset = Effect.fn("BoardReactor.finalizeReset")(function* (
    card: OrchestrationCard,
    operation: Extract<CardOperation, { kind: "resetting" }>,
  ) {
    if (!cardOperationMatches(card, operation.operationId, ["resetting"])) {
      return;
    }

    let cleanupStage = operation.cleanupStage ?? "pending";

    if (cleanupStage === "pending") {
      yield* progressCardCleanup(card, "resetting", "cleanup-started");
      cleanupStage = "cleanup-started";
    }

    if (cleanupStage === "cleanup-started") {
      const allThreads = yield* loadAllThreadShells();
      const lineage = collectThreadLineage(operation.threadIds, allThreads);

      const archiveRoots = selectTopLevelThreadsForBatchAction(
        lineage.filter((member) => member.archivedAt === null),
      );
      for (const member of archiveRoots) {
        const archiveResult = yield* dispatch({
          type: "thread.archive",
          commandId: yield* serverCommandId("reset-archive"),
          threadId: member.id,
        }).pipe(Effect.result);
        if (Result.isFailure(archiveResult)) {
          const detail =
            archiveResult.failure instanceof Error
              ? archiveResult.failure.message
              : String(archiveResult.failure);
          const latest = yield* projectionSnapshotQuery.getCardById(card.id);
          if (Option.isSome(latest)) {
            yield* failCardOperation(
              latest.value,
              `Reset failed while archiving thread '${member.id}': ${detail}`,
            );
          }
          return;
        }
      }

      yield* progressCardCleanup(card, "resetting", "threads-archived");
      cleanupStage = "threads-archived";
    }

    if (cleanupStage === "threads-archived") {
      const artifactDir = NodePath.join(boardArtifactsRoot(config.stateDir), card.id);
      const artifactExists = yield* fs
        .exists(artifactDir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (artifactExists) {
        const artifactCleanup = yield* fs
          .remove(artifactDir, { recursive: true })
          .pipe(Effect.result);
        if (Result.isFailure(artifactCleanup)) {
          const detail =
            artifactCleanup.failure instanceof Error
              ? artifactCleanup.failure.message
              : String(artifactCleanup.failure);
          const latest = yield* projectionSnapshotQuery.getCardById(card.id);
          if (Option.isSome(latest)) {
            yield* failCardOperation(
              latest.value,
              `Reset failed while removing artifacts: ${detail}`,
            );
          }
          return;
        }
      }
      yield* progressCardCleanup(card, "resetting", "artifacts-removed");
      cleanupStage = "artifacts-removed";
    }

    if (cleanupStage !== "artifacts-removed") return;

    yield* dispatch({
      type: "card.reset.complete",
      commandId: yield* serverCommandId("reset-complete"),
      cardId: card.id,
      operationId: operation.operationId,
    });
  });

  const processRetryRequested = Effect.fn("BoardReactor.processRetryRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.retry-requested" }>,
  ) {
    const cardOption = yield* projectionSnapshotQuery.getCardById(event.payload.cardId);
    if (Option.isNone(cardOption)) {
      return;
    }
    const card = cardOption.value;
    const operationId = event.payload.operationId;
    if (operationId !== undefined && !cardOperationMatches(card, operationId, ["retrying"])) {
      return;
    }
    if (card.operation?.kind !== "retrying") {
      return;
    }
    const operation = card.operation;

    const oldRoot = [...card.stepThreads]
      .toReversed()
      .find((entry) => entry.stepIndex === operation.stepIndex)?.threadId;
    if (oldRoot !== undefined) {
      const interrupt = yield* interruptLiveLineage({
        card,
        roots: [oldRoot],
        reasonPrefix: "Retry failed",
      });
      if (interrupt.failed || interrupt.staged) {
        return;
      }
    }

    yield* finalizeRetry(card, operation);
  });

  // Compatibility for persisted pre-reset cancel events. New flows emit
  // `card.reset-requested` and use processCardResetRequested below.
  const processCancelRequested = Effect.fn("BoardReactor.processCancelRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.cancel-requested" }>,
  ) {
    const threadId = event.payload.threadId;
    if (threadId === null) {
      return;
    }
    yield* dispatch({
      type: "thread.turn.interrupt",
      commandId: yield* serverCommandId("turn-interrupt"),
      threadId,
      createdAt: yield* nowIso,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("board reactor failed to interrupt cancelled step turn", {
          cardId: event.payload.cardId,
          threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const processCardResetRequested = Effect.fn("BoardReactor.processCardResetRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.reset-requested" }>,
  ) {
    const cardOption = yield* projectionSnapshotQuery.getCardById(event.payload.cardId);
    if (Option.isNone(cardOption)) {
      return;
    }
    const card = cardOption.value;
    if (!cardOperationMatches(card, event.payload.operationId, ["resetting"])) {
      return;
    }
    const operation = card.operation;
    if (operation.kind !== "resetting") {
      return;
    }

    const interrupt = yield* interruptLiveLineage({
      card,
      roots: operation.threadIds,
      reasonPrefix: "Reset failed",
    });
    if (interrupt.failed || interrupt.staged) {
      return;
    }

    yield* finalizeReset(card, operation);
  });

  /**
   * When a staged advance/retry/reset is waiting on live lineage turns, session
   * truth re-checks the whole lineage and finalizes only once none are live.
   */
  const maybeFinalizePendingInterruptSaga = Effect.fn(
    "BoardReactor.maybeFinalizePendingInterruptSaga",
  )(function* (threadId: ThreadId) {
    const cards = yield* listCards();
    const allThreads = yield* loadAllThreadShells();

    for (const card of cards) {
      const operation = card.operation;
      if (operation === null) {
        continue;
      }

      if (operation.kind === "advancing") {
        const root = currentStepRootThreadId(card);
        if (root === null) {
          continue;
        }
        const lineage = collectThreadLineage([root], allThreads);
        if (!lineage.some((member) => member.id === threadId)) {
          continue;
        }
        if (lineage.some((member) => isProviderTurnLive(member.session))) {
          return;
        }
        yield* enterStep({
          card,
          stepIndex: operation.toStepIndex,
          operationId: operation.operationId,
        });
        return;
      }

      if (operation.kind === "retrying") {
        const oldRoot = [...card.stepThreads]
          .toReversed()
          .find((entry) => entry.stepIndex === operation.stepIndex)?.threadId;
        if (oldRoot === undefined) {
          continue;
        }
        const lineage = collectThreadLineage([oldRoot], allThreads);
        if (!lineage.some((member) => member.id === threadId)) {
          continue;
        }
        if (lineage.some((member) => isProviderTurnLive(member.session))) {
          return;
        }
        yield* finalizeRetry(card, operation);
        return;
      }

      if (operation.kind === "resetting") {
        const lineage = collectThreadLineage(operation.threadIds, allThreads);
        if (!lineage.some((member) => member.id === threadId)) {
          continue;
        }
        if (lineage.some((member) => isProviderTurnLive(member.session))) {
          return;
        }
        yield* finalizeReset(card, operation);
        return;
      }
    }
  });

  /**
   * Typed receipt for turn-start: ProviderCommandReactor projects session
   * starting/running (or a terminal status). Re-enter enterStep to clear the
   * claim exactly once the stable operation thread has a session.
   */
  const maybeCompleteStepEntryOnSession = Effect.fn("BoardReactor.maybeCompleteStepEntryOnSession")(
    function* (threadId: ThreadId) {
      const cards = yield* listCards();
      for (const card of cards) {
        const operation = card.operation;
        if (operation === null) {
          continue;
        }
        if (
          operation.kind !== "starting" &&
          operation.kind !== "advancing" &&
          operation.kind !== "retrying"
        ) {
          continue;
        }
        const claimedThreadId = resolveStepEntryThreadId(operation);
        if (claimedThreadId !== threadId) {
          continue;
        }
        const stepIndex =
          operation.kind === "advancing"
            ? operation.toStepIndex
            : operation.kind === "retrying"
              ? operation.stepIndex
              : 0;
        yield* enterStep({
          card,
          stepIndex,
          operationId: operation.operationId,
        });
        return;
      }
    },
  );

  /**
   * Status signals from the current step thread's session lifecycle.
   *
   * We watch `thread.session-set` (projected from provider turn.completed /
   * turn.started / errors via ProviderRuntimeIngestion) rather than polling:
   * - session receipt for a claimed step-entry thread → complete enterStep
   * - ready + still running on that step → turn finished without board_complete → needs-input
   * - error → failed
   * - running while stuck (needs-input/failed/cancelled) → re-engage → running
   * - also unblocks staged retry/reset finalization once the turn is no longer live
   */
  const processSessionSet = Effect.fn("BoardReactor.processSessionSet")(function* (
    event: Extract<BoardReactorEvent, { type: "thread.session-set" }>,
  ) {
    // Step-entry receipt first: clears starting/advancing/retrying claims.
    yield* maybeCompleteStepEntryOnSession(event.payload.threadId);
    yield* maybeFinalizePendingInterruptSaga(event.payload.threadId);

    const cards = yield* listCards();
    const card = findCardForCurrentStepThread(cards, event.payload.threadId);
    if (card === null) {
      return;
    }

    // While a durable lifecycle op is claimed, residual session signals from the
    // old turn must not recolor the card (same rationale as cancelled cards).
    if (card.operation !== null) {
      return;
    }

    const sessionStatus = event.payload.session.status;
    if (sessionStatus === "error") {
      // A cancelled card stays cancelled: interrupting the turn often surfaces
      // as a session error, which is expected fallout, not a step failure.
      if (card.status !== "failed" && card.status !== "cancelled") {
        yield* setCardStatus(card.id, "failed", "step thread session error");
      }
      return;
    }

    if (sessionStatus === "ready" && card.status === "running") {
      // Turn settled without the card moving — board_complete never fired (or
      // was refused). board_complete success already advanced/completed so this
      // card would no longer be running on this thread.
      yield* setCardStatus(card.id, "needs-input", "turn completed without board_complete");
      return;
    }

    if (sessionStatus === "running" && SESSION_REENGAGE_STATUSES.has(card.status)) {
      yield* setCardStatus(card.id, "running", "step thread session running (re-engage)");
    }
  });

  const processActivityAppended = Effect.fn("BoardReactor.processActivityAppended")(function* (
    event: Extract<BoardReactorEvent, { type: "thread.activity-appended" }>,
  ) {
    const kind = event.payload.activity.kind;

    // Provider interrupt failure on any lineage member fails the staged claim.
    if (kind === "provider.turn.interrupt.failed") {
      const cards = yield* listCards();
      const threadId = event.payload.threadId;
      const detail =
        typeof event.payload.activity.payload === "object" &&
        event.payload.activity.payload !== null &&
        "detail" in event.payload.activity.payload &&
        typeof (event.payload.activity.payload as { detail?: unknown }).detail === "string"
          ? (event.payload.activity.payload as { detail: string }).detail
          : "Provider turn interrupt failed";
      const allThreads = yield* loadAllThreadShells();

      for (const card of cards) {
        const operation = card.operation;
        if (operation === null) {
          continue;
        }

        const roots: ThreadId[] = [];
        if (operation.kind === "advancing") {
          const root = currentStepRootThreadId(card);
          if (root !== null) roots.push(root);
        } else if (operation.kind === "retrying") {
          const oldRoot = [...card.stepThreads]
            .toReversed()
            .find((entry) => entry.stepIndex === operation.stepIndex)?.threadId;
          if (oldRoot !== undefined) roots.push(oldRoot);
        } else if (operation.kind === "resetting") {
          roots.push(...operation.threadIds);
        } else {
          continue;
        }

        const lineage = collectThreadLineage(roots, allThreads);
        if (lineage.some((member) => member.id === threadId)) {
          yield* failCardOperation(
            card,
            `Provider interrupt failed during ${operation.kind}: ${detail}`,
          );
          return;
        }
      }
      return;
    }

    if (
      kind !== "approval.requested" &&
      kind !== "user-input.requested" &&
      kind !== "approval.resolved" &&
      kind !== "user-input.resolved"
    ) {
      return;
    }

    const cards = yield* listCards();
    const card = findCardForCurrentStepThread(cards, event.payload.threadId);
    if (card === null) {
      return;
    }

    // Durable lifecycle ops own residual activity from the interrupted turn.
    if (card.operation !== null) {
      return;
    }

    if (kind === "approval.requested" || kind === "user-input.requested") {
      // The dying turn of a cancelled card may still surface blocking requests
      // before the interrupt lands; they must not resurrect the card.
      if (card.status !== "needs-input" && card.status !== "cancelled") {
        yield* setCardStatus(card.id, "needs-input", `blocking request: ${kind}`);
      }
      return;
    }

    // Resolved: if nothing else is open and the turn is still in flight → running.
    const detail = yield* projectionSnapshotQuery
      .getThreadDetailById(event.payload.threadId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!detail) {
      return;
    }
    if (hasOpenBlockingRequest(detail)) {
      return;
    }
    const sessionRunning =
      detail.session?.status === "running" || detail.session?.activeTurnId !== null;
    if (sessionRunning && card.status === "needs-input") {
      yield* setCardStatus(card.id, "running", "blocking request resolved mid-turn");
    }
  });

  const processTurnStartRequested = Effect.fn("BoardReactor.processTurnStartRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const cards = yield* listCards();
    const card = findCardForCurrentStepThread(cards, event.payload.threadId);
    if (card === null || card.operation !== null) {
      return;
    }
    // Chat-to-resume / re-engage: a new user turn on the current step thread.
    if (REENGAGE_STATUSES.has(card.status)) {
      yield* setCardStatus(card.id, "running", "user turn started on stuck step thread");
    }
  });

  const processTurnInterruptRequested = Effect.fn("BoardReactor.processTurnInterruptRequested")(
    function* (event: Extract<BoardReactorEvent, { type: "thread.turn-interrupt-requested" }>) {
      const cards = yield* listCards();
      const card = findCardForCurrentStepThread(cards, event.payload.threadId);
      if (
        card === null ||
        card.operation !== null ||
        (card.status !== "running" && card.status !== "needs-input")
      ) {
        return;
      }
      yield* setCardStatus(card.id, "cancelled", "current step conversation interrupted");
    },
  );

  const processCurrentStepThreadUnavailable = Effect.fn(
    "BoardReactor.processCurrentStepThreadUnavailable",
  )(function* (event: Extract<BoardReactorEvent, { type: "thread.deleted" | "thread.archived" }>) {
    const cards = yield* listCards();
    const card = findCardForCurrentStepThread(cards, event.payload.threadId);
    if (card === null) {
      return;
    }
    if (card.operation !== null) {
      return;
    }
    if (card.status === "failed") {
      return;
    }
    const reason =
      event.type === "thread.deleted"
        ? "current step conversation was deleted"
        : "current step conversation was archived";
    yield* setCardFailed(card.id, reason);
  });

  const { processCardCreated, processCardDeleteRequested } = yield* makeBoardCardResourceSaga;

  const processEvent = Effect.fn("BoardReactor.processEvent")(function* (event: BoardReactorEvent) {
    if (
      Option.isSome(handlerDefectInjection) &&
      handlerDefectInjection.value.shouldFail({ type: event.type })
    ) {
      return yield* Effect.die(
        new Error(`injected board reactor handler defect for ${event.type}`),
      );
    }
    switch (event.type) {
      case "card.release-requested":
        return yield* processReleaseRequested(event);
      case "card.step-advance-requested":
        return yield* processStepAdvanceRequested(event);
      case "card.retry-requested":
        return yield* processRetryRequested(event);
      case "card.cancel-requested":
        return yield* processCancelRequested(event);
      case "card.reset-requested":
        return yield* processCardResetRequested(event);
      case "card.created":
        return yield* processCardCreated(event);
      case "card.delete-requested":
        return yield* processCardDeleteRequested(event);
      case "thread.session-set":
        return yield* processSessionSet(event);
      case "thread.activity-appended":
        return yield* processActivityAppended(event);
      case "thread.turn-interrupt-requested":
        return yield* processTurnInterruptRequested(event);
      case "thread.turn-start-requested":
        return yield* processTurnStartRequested(event);
      case "thread.deleted":
      case "thread.archived":
        return yield* processCurrentStepThreadUnavailable(event);
    }
  });

  const failMatchingClaimsAfterHandlerDefect = yield* makeBoardHandlerDefectRecovery;
  const processEventSafely = (event: BoardReactorEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.gen(function* () {
          yield* Effect.logWarning("board reactor failed to process event", {
            eventType: event.type,
            cause: Cause.pretty(cause),
          });
          // Unexpected handler failures must not strand a durable claim —
          // including thread receipt handlers (session-set / activity / turn-start).
          if (event.type !== "thread.deleted" && event.type !== "thread.archived") {
            yield* failMatchingClaimsAfterHandlerDefect(event as BoardReactorCoreEvent, cause);
          }
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const reconcilePendingOperations = Effect.fn("BoardReactor.reconcilePendingOperations")(
    function* () {
      const cards = yield* listCards();
      for (const event of makeBoardReconciliationEvents(cards)) {
        yield* worker.enqueue(event);
      }
      const allThreads = yield* loadAllThreadShells();
      const knownThreadIds = new Set(
        allThreads
          .filter((thread) => thread.archivedAt === null)
          .map((thread) => String(thread.id)),
      );
      for (const event of makeBoardMissingCurrentRootRecoveryEvents(cards, knownThreadIds)) {
        yield* worker.enqueue(event);
      }
    },
  );

  const start: BoardReactorShape["start"] = Effect.fn("start")(function* () {
    // Subscribe first so completion events produced by reconcile (and by any
    // concurrent client traffic) are observed. Reconciliation then enqueues
    // resume work onto the same drainable worker — drain stays deterministic.
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (!isBoardReactorEvent(event)) {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );

    // Yield so the scoped subscription fiber can attach before we dispatch
    // resume side effects whose follow-up events must not be dropped.
    yield* Effect.yieldNow;

    // Resume unfinished durable operations from the projected read model.
    // Title generation is not replayed — only lifecycle claims.
    yield* reconcilePendingOperations().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("board reactor failed to reconcile pending card operations", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies BoardReactorShape;
});

export const BoardReactorLive = Layer.effect(BoardReactor, make);
