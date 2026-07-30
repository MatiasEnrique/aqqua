// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  type AgentProfileName,
  type BoardSnapshot,
  type CardStatus,
  CardId,
  CommandId,
  type OrchestrationCard,
  type OrchestrationEvent,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { resolveAgentProfile } from "../../agent-control/Profiles.ts";
import { boardArtifactsRoot, resolveBoardArtifactPath } from "../../boardArtifacts.ts";
import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { buildBoardCardTitleMessage } from "../../textGeneration/TextGenerationPrompts.ts";
import { assembleBoardStepPrompt } from "../boardPrompt.ts";
import { findCardForCurrentStepThread, hasOpenBlockingRequest } from "../boardCardHelpers.ts";
import { BoardReactor, type BoardReactorShape } from "../Services/BoardReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  deleteWorktreeOwned,
  listActiveThreadsForWorktreePath,
} from "../Services/WorktreeDeletion.ts";
import { WorktreePathCoordination } from "../Services/WorktreePathCoordination.ts";

// Re-export pure helpers for tests that imported them from this module.
export { findCardForCurrentStepThread, hasOpenBlockingRequest as threadHasOpenBlockingRequest };

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const REENGAGE_STATUSES = new Set<CardStatus | null>(["needs-input", "failed", "cancelled"]);

/**
 * Branch for a released card: `board/<slugified-title>-<short-id>`.
 * Short id is the trailing 8 chars of the card id for uniqueness.
 */
export function boardCardBranchName(input: {
  readonly title: string;
  readonly cardId: string;
}): string {
  const slug = sanitizeBranchFragment(input.title);
  const shortId = input.cardId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "card";
  return `board/${slug}-${shortId}`;
}

/**
 * Step thread title shown in the sidebar: `<card title> · <n> <step name>`.
 * Step numbers are 1-based for humans.
 */
export function boardStepThreadTitle(input: {
  readonly cardTitle: string;
  readonly stepIndex: number;
  readonly stepName: string;
}): string {
  return `${input.cardTitle} · ${input.stepIndex + 1} ${input.stepName}`;
}

type BoardReactorEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "card.release-requested"
      | "card.step-advance-requested"
      | "card.retry-requested"
      | "card.cancel-requested"
      | "card.created"
      | "card.archived"
      | "thread.session-set"
      | "thread.activity-appended"
      | "thread.turn-start-requested";
  }
>;

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:board:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderAdapterRegistry;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration;
  const pathCoordination = yield* WorktreePathCoordination;

  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command);

  const setCardStatus = Effect.fn("BoardReactor.setCardStatus")(function* (
    cardId: CardId,
    status: CardStatus | null,
    reason?: string,
  ) {
    if (reason) {
      yield* Effect.logDebug("board reactor setting card status", { cardId, status, reason });
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

  const failRelease = Effect.fn("BoardReactor.failRelease")(function* (
    cardId: CardId,
    reason: string,
  ) {
    yield* Effect.logWarning("board reactor release failed", {
      cardId,
      reason,
    });
    yield* dispatch({
      type: "card.release.fail",
      commandId: yield* serverCommandId("release-fail"),
      cardId,
      reason,
    });
  });

  const listCards = Effect.fn("BoardReactor.listCards")(function* () {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    return shell.cards;
  });

  const instanceCandidates = Effect.gen(function* () {
    const ids = yield* registry.listInstances();
    const candidates: Array<{
      readonly instanceId: (typeof ids)[number];
      readonly driverKind: import("@t3tools/contracts").ProviderDriverKind;
      readonly enabled: boolean;
    }> = [];
    for (const instanceId of ids) {
      const info = yield* registry.getInstanceInfo(instanceId).pipe(Effect.option);
      if (Option.isNone(info)) continue;
      candidates.push({
        instanceId: info.value.instanceId,
        driverKind: info.value.driverKind,
        enabled: info.value.enabled,
      });
    }
    return candidates;
  });

  const resolveBaseBranch = Effect.fn("BoardReactor.resolveBaseBranch")(function* (
    projectCwd: string,
  ) {
    const refs = yield* gitWorkflow.listRefs({ cwd: projectCwd });
    const localRefs = refs.refs.filter((ref) => ref.isRemote !== true);
    return (
      localRefs.find((ref) => ref.isDefault)?.name ??
      localRefs.find((ref) => ref.current)?.name ??
      localRefs[0]?.name ??
      "main"
    );
  });

  const ensureArtifactDirectory = Effect.fn("BoardReactor.ensureArtifactDirectory")(function* (
    cardId: string,
  ) {
    const dir = NodePath.join(boardArtifactsRoot(config.stateDir), cardId);
    yield* fs.makeDirectory(dir, { recursive: true });
  });

  /**
   * Spawn a fresh top-level step thread and mark the card as entered.
   * Uses the card snapshot only — never the live board definition.
   */
  const enterStep = Effect.fn("BoardReactor.enterStep")(function* (input: {
    readonly card: OrchestrationCard;
    readonly stepIndex: number;
  }) {
    const { card, stepIndex } = input;
    const snapshot = card.snapshot;
    if (snapshot === null) {
      yield* setCardFailed(card.id, `Card '${card.id}' has no board snapshot.`);
      return;
    }
    if (card.branch === null || card.worktreePath === null) {
      yield* setCardFailed(
        card.id,
        `Card '${card.id}' is missing branch/worktreePath for step entry.`,
      );
      return;
    }

    const step = snapshot.steps[stepIndex];
    if (step === undefined) {
      yield* setCardFailed(
        card.id,
        `Step index ${stepIndex} is out of range for card '${card.id}'.`,
      );
      return;
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(card.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!project) {
      yield* setCardFailed(card.id, `Project '${card.projectId}' was not found for card step.`);
      return;
    }

    const serverSettings = yield* settings.getSettings;
    const instances = yield* instanceCandidates;
    const resolved = resolveAgentProfile({
      profile: step.profileName as AgentProfileName,
      profiles: serverSettings.agentProfiles,
      instances,
      projectDefaultModelSelection: project.defaultModelSelection ?? null,
    });
    if (Result.isFailure(resolved)) {
      yield* setCardFailed(
        card.id,
        `Agent profile '${step.profileName}' is unavailable: ${resolved.failure.message}`,
      );
      return;
    }

    const prompt = assembleBoardStepPrompt({
      template: step.promptTemplate,
      parameters: card.parameters,
      cardTitle: card.title,
      cardId: card.id,
      stepIndex,
      steps: snapshot.steps,
      stateDir: config.stateDir,
    });
    if (!prompt.ok) {
      yield* setCardFailed(card.id, prompt.reason);
      return;
    }

    const outputPath = resolveBoardArtifactPath({
      stateDir: config.stateDir,
      cardId: card.id,
      stepName: step.name,
    });
    if (outputPath === null) {
      yield* setCardFailed(card.id, `Invalid artifact step name '${step.name}'.`);
      return;
    }
    yield* ensureArtifactDirectory(card.id);

    const threadId = ThreadId.make(yield* randomUUID);
    const createdAt = yield* nowIso;
    const title = boardStepThreadTitle({
      cardTitle: card.title,
      stepIndex,
      stepName: step.name,
    });

    yield* dispatch({
      type: "thread.create",
      commandId: yield* serverCommandId("thread-create"),
      threadId,
      projectId: card.projectId,
      parentThreadId: null,
      title,
      modelSelection: resolved.success.modelSelection,
      runtimeMode: resolved.success.runtimeMode,
      interactionMode: resolved.success.interactionMode,
      branch: card.branch,
      worktreePath: card.worktreePath,
      createdAt,
    });

    yield* dispatch({
      type: "thread.turn.start",
      commandId: yield* serverCommandId("turn-start"),
      threadId,
      message: {
        messageId: MessageId.make(yield* randomUUID),
        role: "user",
        text: prompt.text,
        attachments: [],
      },
      modelSelection: resolved.success.modelSelection,
      runtimeMode: resolved.success.runtimeMode,
      interactionMode: resolved.success.interactionMode,
      createdAt,
    });

    yield* dispatch({
      type: "card.step.enter",
      commandId: yield* serverCommandId("step-enter"),
      cardId: card.id,
      stepIndex,
      threadId,
    });
  });

  const processReleaseRequested = Effect.fn("BoardReactor.processReleaseRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.release-requested" }>,
  ) {
    const cardId = event.payload.cardId;
    const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
    if (Option.isNone(cardOption)) {
      yield* failRelease(cardId, `Card '${cardId}' was not found after release-requested.`);
      return;
    }
    const card = cardOption.value;
    const snapshot: BoardSnapshot | null = card.snapshot ?? event.payload.snapshot;
    if (snapshot === null || snapshot.steps.length === 0) {
      yield* failRelease(cardId, `Card '${cardId}' has no steps in its release snapshot.`);
      return;
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(card.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!project) {
      yield* failRelease(cardId, `Project '${card.projectId}' was not found for release.`);
      return;
    }

    const branch = boardCardBranchName({ title: card.title, cardId: card.id });

    const releaseResult = yield* Effect.gen(function* () {
      const baseBranch = yield* resolveBaseBranch(project.workspaceRoot);
      return yield* gitWorkflow.createWorktree({
        cwd: project.workspaceRoot,
        refName: baseBranch,
        newRefName: branch,
        baseRefName: baseBranch,
        path: null,
      });
    }).pipe(
      Effect.map((worktree) => ({ ok: true as const, worktree })),
      Effect.catchCause((cause) =>
        Effect.succeed({
          ok: false as const,
          reason: Cause.pretty(cause),
        }),
      ),
    );

    if (!releaseResult.ok) {
      yield* failRelease(cardId, releaseResult.reason);
      return;
    }

    yield* dispatch({
      type: "card.release.complete",
      commandId: yield* serverCommandId("release-complete"),
      cardId,
      branch: releaseResult.worktree.worktree.refName,
      worktreePath: releaseResult.worktree.worktree.path,
    });

    const releasedCardOption = yield* projectionSnapshotQuery.getCardById(cardId);
    if (Option.isNone(releasedCardOption)) {
      yield* setCardFailed(cardId, `Card '${cardId}' disappeared after release.complete.`);
      return;
    }

    yield* enterStep({
      card: {
        ...releasedCardOption.value,
        snapshot: releasedCardOption.value.snapshot ?? snapshot,
      },
      stepIndex: 0,
    });
  });

  const processStepAdvanceRequested = Effect.fn("BoardReactor.processStepAdvanceRequested")(
    function* (event: Extract<BoardReactorEvent, { type: "card.step-advance-requested" }>) {
      const cardId = event.payload.cardId;
      const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
      if (Option.isNone(cardOption)) {
        yield* setCardFailed(cardId, `Card '${cardId}' was not found for step advance.`);
        return;
      }
      yield* enterStep({
        card: cardOption.value,
        stepIndex: event.payload.toStepIndex,
      });
    },
  );

  const processRetryRequested = Effect.fn("BoardReactor.processRetryRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.retry-requested" }>,
  ) {
    const cardOption = yield* projectionSnapshotQuery.getCardById(event.payload.cardId);
    if (Option.isNone(cardOption)) {
      yield* setCardFailed(
        event.payload.cardId,
        `Card '${event.payload.cardId}' was not found for retry.`,
      );
      return;
    }
    const card = cardOption.value;

    // Spec: discard the old step thread before spawning a fresh one. Interrupt
    // any in-flight turn, then archive so it leaves the main sidebar. Failures
    // are logged — retry must still work when the old thread is already gone.
    const oldThread = [...card.stepThreads]
      .toReversed()
      .find((entry) => entry.stepIndex === event.payload.stepIndex);
    if (oldThread !== undefined) {
      const createdAt = yield* nowIso;
      yield* dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* serverCommandId("retry-interrupt"),
        threadId: oldThread.threadId,
        createdAt,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("board reactor failed to interrupt old step thread on retry", {
            cardId: card.id,
            threadId: oldThread.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      yield* dispatch({
        type: "thread.archive",
        commandId: yield* serverCommandId("retry-archive"),
        threadId: oldThread.threadId,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("board reactor failed to archive old step thread on retry", {
            cardId: card.id,
            threadId: oldThread.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    }

    // Fresh thread from the same snapshot template + inputs (enterStep).
    yield* enterStep({
      card,
      stepIndex: event.payload.stepIndex,
    });
  });

  const processCancelRequested = Effect.fn("BoardReactor.processCancelRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.cancel-requested" }>,
  ) {
    const threadId = event.payload.threadId;
    if (threadId === null) {
      return;
    }
    // Decider already set status cancelled; interrupt the running turn.
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

  /**
   * Status signals from the current step thread's session lifecycle.
   *
   * We watch `thread.session-set` (projected from provider turn.completed /
   * turn.started / errors via ProviderRuntimeIngestion) rather than polling:
   * - ready + still running on that step → turn finished without board_complete → needs-input
   * - error → failed
   * - running while stuck (needs-input/failed/cancelled) → re-engage → running
   */
  const processSessionSet = Effect.fn("BoardReactor.processSessionSet")(function* (
    event: Extract<BoardReactorEvent, { type: "thread.session-set" }>,
  ) {
    const cards = yield* listCards();
    const card = findCardForCurrentStepThread(cards, event.payload.threadId);
    if (card === null) {
      return;
    }

    const sessionStatus = event.payload.session.status;
    if (sessionStatus === "error") {
      if (card.status !== "failed") {
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

    if (sessionStatus === "running" && REENGAGE_STATUSES.has(card.status)) {
      yield* setCardStatus(card.id, "running", "step thread session running (re-engage)");
    }
  });

  const processActivityAppended = Effect.fn("BoardReactor.processActivityAppended")(function* (
    event: Extract<BoardReactorEvent, { type: "thread.activity-appended" }>,
  ) {
    const kind = event.payload.activity.kind;
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

    if (kind === "approval.requested" || kind === "user-input.requested") {
      if (card.status !== "needs-input") {
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
    if (card === null) {
      return;
    }
    // Chat-to-resume / re-engage: a new user turn on the current step thread.
    if (REENGAGE_STATUSES.has(card.status)) {
      yield* setCardStatus(card.id, "running", "user turn started on stuck step thread");
    }
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

  const processCardArchived = Effect.fn("BoardReactor.processCardArchived")(function* (
    event: Extract<BoardReactorEvent, { type: "card.archived" }>,
  ) {
    const cardId = event.payload.cardId;
    // Re-read for worktree path (archived cards stay in projection).
    const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
    if (Option.isNone(cardOption)) {
      return;
    }
    const card = cardOption.value;

    // Artifacts first (independent of worktree membership).
    const artifactDir = NodePath.join(boardArtifactsRoot(config.stateDir), card.id);
    yield* fs.remove(artifactDir, { recursive: true }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("board reactor failed to remove card artifact directory", {
          cardId,
          artifactDir,
          cause: Cause.pretty(cause),
        }),
      ),
    );

    if (card.worktreePath === null) {
      return;
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(card.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    const cwd = project?.workspaceRoot ?? card.worktreePath;

    yield* deleteWorktreeOwned(
      {
        cwd,
        path: card.worktreePath,
      },
      {
        inspectWorktreeRemoval: (input) => gitWorkflow.inspectWorktreeRemoval(input),
        removeWorktree: (input) => gitWorkflow.removeWorktree(input),
        listMemberThreads: (worktreePath) =>
          Effect.gen(function* () {
            const [live, archived] = yield* Effect.all([
              projectionSnapshotQuery.getShellSnapshot(),
              projectionSnapshotQuery.getArchivedShellSnapshot(),
            ]);
            const members = [...live.threads, ...archived.threads].map((thread) => ({
              id: thread.id,
              parentThreadId: thread.parentThreadId,
              worktreePath: thread.worktreePath,
              deletedAt: null,
              archivedAt: thread.archivedAt,
            }));
            return listActiveThreadsForWorktreePath(members, worktreePath);
          }).pipe(
            Effect.mapError((error) => ({
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to load worktree conversation membership.",
            })),
          ),
        dispatchThreadDelete: ({ commandId, threadId }) =>
          orchestrationEngine
            .dispatch({
              type: "thread.delete",
              commandId,
              threadId,
            })
            .pipe(
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
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("board reactor failed to delete card worktree on archive", {
          cardId,
          worktreePath: card.worktreePath,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const processEvent = Effect.fn("BoardReactor.processEvent")(function* (event: BoardReactorEvent) {
    switch (event.type) {
      case "card.release-requested":
        return yield* processReleaseRequested(event);
      case "card.step-advance-requested":
        return yield* processStepAdvanceRequested(event);
      case "card.retry-requested":
        return yield* processRetryRequested(event);
      case "card.cancel-requested":
        return yield* processCancelRequested(event);
      case "card.created":
        return yield* processCardCreated(event);
      case "card.archived":
        return yield* processCardArchived(event);
      case "thread.session-set":
        return yield* processSessionSet(event);
      case "thread.activity-appended":
        return yield* processActivityAppended(event);
      case "thread.turn-start-requested":
        return yield* processTurnStartRequested(event);
    }
  });

  const processEventSafely = (event: BoardReactorEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("board reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const isBoardReactorEvent = (event: OrchestrationEvent): event is BoardReactorEvent =>
    event.type === "card.release-requested" ||
    event.type === "card.step-advance-requested" ||
    event.type === "card.retry-requested" ||
    event.type === "card.cancel-requested" ||
    event.type === "card.created" ||
    event.type === "card.archived" ||
    event.type === "thread.session-set" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-start-requested";

  const start: BoardReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (!isBoardReactorEvent(event)) {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies BoardReactorShape;
});

export const BoardReactorLive = Layer.effect(BoardReactor, make);
