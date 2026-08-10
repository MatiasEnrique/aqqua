// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  type BoardSnapshot,
  type BoardStep,
  type CardId,
  type CardOperation,
  type CardOperationId,
  type CardStatus,
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationCard,
  type OrchestrationEvent,
  type ThreadId,
} from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { resolveAgentModelSelection } from "../../agent-control/ModelCatalog.ts";
import { resolveAgentProfile } from "../../agent-control/Profiles.ts";
import { boardArtifactsRoot, resolveBoardArtifactPath } from "../../boardArtifacts.ts";
import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  boardOperationMessageId,
  decideBoardStepTurnStart,
  resolveStepEntryThreadId,
  type ThreadLineageMember,
} from "../boardCardHelpers.ts";
import { assembleBoardStepPrompt } from "../boardPrompt.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  boardCardBranchName,
  boardStepThreadTitle,
  cardOperationMatches,
} from "./BoardReactorState.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export type BoardReactorEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "card.release-requested"
      | "card.step-advance-requested"
      | "card.retry-requested"
      | "card.cancel-requested"
      | "card.reset-requested"
      | "card.created"
      | "card.archived"
      | "card.delete-requested"
      | "thread.session-set"
      | "thread.activity-appended"
      | "thread.turn-interrupt-requested"
      | "thread.turn-start-requested";
  }
>;

export const makeBoardStepEntrySaga = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:board:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const settings = yield* ServerSettingsService;
  const registry = yield* ProviderAdapterRegistry;
  // Read-only snapshot access. A canonical step resolves against whatever the
  // registry already holds; the saga never refreshes, subscribes, or polls.
  const providerRegistry = yield* ProviderRegistry;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const setupScriptRunner = yield* ProjectSetupScriptRunner;
  const turnStartDispatchedForThread = new Set<string>();

  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command);

  const setCardStatus = Effect.fn("BoardStepEntrySaga.setCardStatus")(function* (
    cardId: CardId,
    status: CardStatus | null,
    reason?: string,
  ) {
    if (reason) {
      yield* Effect.logDebug("board step entry setting card status", {
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

  const failCardOperation = Effect.fn("BoardStepEntrySaga.failCardOperation")(function* (
    card: OrchestrationCard,
    reason: string,
  ) {
    const operation = card.operation;
    if (operation === null) {
      yield* setCardStatus(card.id, "failed", reason);
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

  const getThreadSession = Effect.fn("BoardStepEntrySaga.getThreadSession")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    return shell.threads.find((thread) => thread.id === threadId)?.session ?? null;
  });

  const instanceCandidates = Effect.gen(function* () {
    const ids = yield* registry.listInstances();
    const candidates: Array<{
      readonly instanceId: (typeof ids)[number];
      readonly driverKind: import("@aqqua/contracts").ProviderDriverKind;
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

  /**
   * Decide which agent a step runs as.
   *
   * A canonical step carries an exact `instanceId + model` and resolves through
   * the pure model catalog against the provider snapshots this environment
   * already holds — the authoring machine never saw them, so this is the first
   * and only place the selection can be checked. A step persisted before
   * model-first orchestration keeps resolving through the profile adapter, so
   * existing flows and their `terminal`-runtime profiles are unaffected.
   *
   * Both branches return the same three things the thread is created and
   * started with: an exact model selection, a runtime mode, and an interaction
   * mode. Failures come back as the reason to fail the card operation with.
   */
  const resolveStepAgent = Effect.fn("BoardStepEntrySaga.resolveStepAgent")(function* (input: {
    readonly step: BoardStep;
    readonly projectDefaultModelSelection: ModelSelection | null;
  }) {
    const { projectDefaultModelSelection, step } = input;

    if (step.agent !== undefined) {
      const providers = yield* providerRegistry.getProviders;
      const resolved = resolveAgentModelSelection({
        providers,
        projectDefaultModelSelection,
        selection: {
          model: { instanceId: step.agent.instanceId, model: step.agent.model },
          ...(step.agent.reasoning === undefined ? {} : { reasoning: step.agent.reasoning }),
        },
      });
      return Result.isFailure(resolved)
        ? {
            ok: false as const,
            reason: `Step '${step.name}' cannot run its agent: ${resolved.failure.message}`,
          }
        : { ok: true as const, launch: resolved.success };
    }

    const profileName = step.profileName;
    if (profileName === undefined) {
      return {
        ok: false as const,
        reason: `Step '${step.name}' names no agent: it must set 'agent' (instanceId + model).`,
      };
    }
    const serverSettings = yield* settings.getSettings;
    const instances = yield* instanceCandidates;
    const resolved = resolveAgentProfile({
      profile: profileName,
      profiles: serverSettings.agentProfiles,
      instances,
      projectDefaultModelSelection,
    });
    return Result.isFailure(resolved)
      ? {
          ok: false as const,
          reason: `Agent profile '${profileName}' is unavailable: ${resolved.failure.message}`,
        }
      : { ok: true as const, launch: resolved.success };
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

  const appendSetupScriptActivity = Effect.fn("BoardReactor.appendSetupScriptActivity")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) {
      yield* dispatch({
        type: "thread.activity.append",
        commandId: yield* serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.make(yield* randomUUID),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });
    },
  );

  /**
   * Launch the project's worktree-setup script in the card worktree, same as
   * the chat bootstrap path: fire-and-forget into a thread terminal, progress
   * surfaced as `setup-script.*` activities. Never blocks or fails the step.
   */
  const runWorktreeSetupScript = Effect.fn("BoardReactor.runWorktreeSetupScript")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly projectId: string;
      readonly worktreePath: string;
    }) {
      const requestedAt = yield* nowIso;
      yield* setupScriptRunner
        .runForThread({
          threadId: input.threadId,
          projectId: input.projectId,
          worktreePath: input.worktreePath,
        })
        .pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              appendSetupScriptActivity({
                threadId: input.threadId,
                kind: "setup-script.failed",
                summary: "Setup script failed to start",
                createdAt: requestedAt,
                payload: {
                  detail: error.message,
                  worktreePath: input.worktreePath,
                },
                tone: "error",
              }),
            onSuccess: (result) =>
              Effect.gen(function* () {
                if (result.status !== "started") {
                  return;
                }
                const startedAt = yield* nowIso;
                const payload = {
                  scriptId: result.scriptId,
                  scriptName: result.scriptName,
                  terminalId: result.terminalId,
                  worktreePath: input.worktreePath,
                };
                yield* appendSetupScriptActivity({
                  threadId: input.threadId,
                  kind: "setup-script.requested",
                  summary: "Starting setup script",
                  createdAt: requestedAt,
                  payload,
                  tone: "info",
                });
                yield* appendSetupScriptActivity({
                  threadId: input.threadId,
                  kind: "setup-script.started",
                  summary: "Setup script started",
                  createdAt: startedAt,
                  payload,
                  tone: "info",
                });
              }),
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning("board reactor failed to launch worktree setup script", {
              threadId: input.threadId,
              worktreePath: input.worktreePath,
              cause: Cause.pretty(cause),
            }),
          ),
        );
    },
  );

  const loadAllThreadShells = Effect.fn("BoardReactor.loadAllThreadShells")(function* () {
    const [live, archived] = yield* Effect.all([
      projectionSnapshotQuery.getShellSnapshot(),
      projectionSnapshotQuery.getArchivedShellSnapshot(),
    ]);
    const members: ThreadLineageMember[] = [];
    for (const thread of [...live.threads, ...archived.threads]) {
      members.push({
        id: thread.id,
        parentThreadId: thread.parentThreadId ?? null,
        session: thread.session,
        archivedAt: thread.archivedAt,
      });
    }
    return members;
  });

  /**
   * Spawn (or resume) the claimed step thread and mark the card as entered.
   * Uses the durable operation's stable threadId so restart never allocates a
   * second agent. Session truth decides whether to (re)request the turn.
   */
  const enterStep = Effect.fn("BoardReactor.enterStep")(function* (input: {
    readonly card: OrchestrationCard;
    readonly stepIndex: number;
    readonly operationId: CardOperationId;
  }) {
    const { card, stepIndex, operationId } = input;
    // Stale/duplicate events: only proceed while this operation is still claimed.
    if (
      !cardOperationMatches(card, operationId, ["starting", "advancing", "retrying"]) ||
      card.operation.operationId !== operationId
    ) {
      yield* Effect.logDebug("board reactor skip enterStep: operation no longer claimed", {
        cardId: card.id,
        operationId,
        currentOperation: card.operation?.kind ?? null,
      });
      return;
    }

    const operation = card.operation as Extract<
      CardOperation,
      { kind: "starting" | "advancing" | "retrying" }
    >;
    const threadId = resolveStepEntryThreadId(operation);
    const fail = (reason: string) => failCardOperation(card, reason);

    const snapshot = card.snapshot;
    if (snapshot === null) {
      yield* fail(`Card '${card.id}' has no flow snapshot.`);
      return;
    }
    if (card.branch === null || card.worktreePath === null) {
      yield* fail(`Card '${card.id}' is missing branch/worktreePath for step entry.`);
      return;
    }

    const step = snapshot.steps[stepIndex];
    if (step === undefined) {
      yield* fail(`Step index ${stepIndex} is out of range for card '${card.id}'.`);
      return;
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(card.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!project) {
      yield* fail(`Project '${card.projectId}' was not found for card step.`);
      return;
    }

    const agent = yield* resolveStepAgent({
      step,
      projectDefaultModelSelection: project.defaultModelSelection ?? null,
    });
    if (!agent.ok) {
      yield* fail(agent.reason);
      return;
    }
    const launch = agent.launch;

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
      yield* fail(prompt.reason);
      return;
    }

    const outputPath = resolveBoardArtifactPath({
      stateDir: config.stateDir,
      cardId: card.id,
      stepName: step.name,
    });
    if (outputPath === null) {
      yield* fail(`Invalid artifact step name '${step.name}'.`);
      return;
    }
    yield* ensureArtifactDirectory(card.id);

    // Re-check after async work so a concurrent cancel/complete cannot race us
    // into spawning a second agent on a completed operation.
    const latestCardOption = yield* projectionSnapshotQuery.getCardById(card.id);
    if (Option.isNone(latestCardOption)) {
      return;
    }
    const latestCard = latestCardOption.value;
    if (!cardOperationMatches(latestCard, operationId, ["starting", "advancing", "retrying"])) {
      yield* Effect.logDebug("board reactor skip enterStep after prep: operation cleared", {
        cardId: card.id,
        operationId,
      });
      return;
    }
    if (latestCard.branch === null || latestCard.worktreePath === null) {
      yield* failCardOperation(
        latestCard,
        `Card '${latestCard.id}' lost its branch/worktree before step entry.`,
      );
      return;
    }
    const latestBranch = latestCard.branch;
    const latestWorktreePath = latestCard.worktreePath;

    const createdAt = yield* nowIso;
    const title = boardStepThreadTitle({
      cardTitle: latestCard.title,
      stepIndex,
      stepName: step.name,
    });

    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    const existingThread = shell.threads.find((thread) => thread.id === threadId);
    if (existingThread === undefined) {
      yield* dispatch({
        type: "thread.create",
        commandId: yield* serverCommandId("thread-create"),
        threadId,
        projectId: latestCard.projectId,
        parentThreadId: null,
        title,
        modelSelection: launch.modelSelection,
        runtimeMode: launch.runtimeMode,
        interactionMode: launch.interactionMode,
        branch: latestBranch,
        worktreePath: latestWorktreePath,
        createdAt,
      });

      // First thread on this card means the worktree is fresh from release:
      // launch the project's worktree-setup script before the agent starts.
      // Retries and later steps reuse the worktree, so they skip it.
      if (latestCard.stepThreads.length === 0 && latestCard.worktreePath !== null) {
        yield* runWorktreeSetupScript({
          threadId,
          projectId: latestCard.projectId,
          worktreePath: latestCard.worktreePath,
        });
      }
    }

    const sessionAfterCreate = yield* getThreadSession(threadId);
    const threadKey = String(threadId);
    const turnDecision = decideBoardStepTurnStart({
      session: sessionAfterCreate,
      turnStartAlreadyDispatched: turnStartDispatchedForThread.has(threadKey),
    });

    // ProviderCommandReactor projects `session: starting` before the provider
    // is invoked. Until that receipt lands the operation stays claimed so a
    // crash cannot leave the card "running" with a null session forever.
    if (turnDecision.action === "request-turn") {
      turnStartDispatchedForThread.add(threadKey);
      // Fresh command id (not the stable message id) so command-receipt
      // deduplication cannot suppress a post-restart replacement hot event.
      yield* dispatch({
        type: "thread.turn.start",
        commandId: yield* serverCommandId("turn-start"),
        threadId,
        message: {
          messageId: boardOperationMessageId(operationId),
          role: "user",
          text: prompt.text,
          attachments: [],
        },
        modelSelection: launch.modelSelection,
        runtimeMode: launch.runtimeMode,
        interactionMode: launch.interactionMode,
        createdAt: yield* nowIso,
      });
      // Keep the durable claim; processSessionSet / restart will re-enter.
      return;
    }

    if (turnDecision.action === "await-session") {
      // Same process already requested; wait for session-set receipt.
      return;
    }

    // Session receipt observed — allow a future re-request only after a full
    // new claim (new operation id → new thread id).
    turnStartDispatchedForThread.delete(threadKey);

    // Final claim check before linking the card to this thread.
    const preEnter = yield* projectionSnapshotQuery.getCardById(card.id);
    if (
      Option.isNone(preEnter) ||
      !cardOperationMatches(preEnter.value, operationId, ["starting", "advancing", "retrying"])
    ) {
      return;
    }

    yield* dispatch({
      type: "card.step.enter",
      commandId: yield* serverCommandId("step-enter"),
      cardId: preEnter.value.id,
      operationId,
      stepIndex,
      threadId,
    });

    if (turnDecision.terminalStatus !== null) {
      yield* setCardStatus(
        preEnter.value.id,
        turnDecision.terminalStatus,
        `step thread session was ${sessionAfterCreate?.status ?? "unknown"} before step.enter`,
      );
    }
  });

  const processReleaseRequested = Effect.fn("BoardReactor.processReleaseRequested")(function* (
    event: Extract<BoardReactorEvent, { type: "card.release-requested" }>,
  ) {
    const cardId = event.payload.cardId;
    const operationId = event.payload.operationId;
    const cardOption = yield* projectionSnapshotQuery.getCardById(cardId);
    if (Option.isNone(cardOption)) {
      yield* Effect.logWarning("board reactor release: card missing after release-requested", {
        cardId,
      });
      return;
    }
    const card = cardOption.value;
    if (operationId !== undefined && !cardOperationMatches(card, operationId, ["starting"])) {
      yield* Effect.logDebug("board reactor skip release: operation mismatch", {
        cardId,
        operationId,
        current: card.operation,
      });
      return;
    }
    // Legacy events without operationId: only run when the card still looks like
    // a release claim (snapshot set, still in todo).
    if (operationId === undefined) {
      if (card.position.kind !== "todo" || card.snapshot === null || card.status === "failed") {
        return;
      }
    }

    const fail = (reason: string) => failCardOperation(card, reason);
    const snapshot: BoardSnapshot | null = card.snapshot ?? event.payload.snapshot;
    if (snapshot === null || snapshot.steps.length === 0) {
      yield* fail(`Card '${cardId}' has no steps in its release snapshot.`);
      return;
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(card.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!project) {
      yield* fail(`Project '${card.projectId}' was not found for release.`);
      return;
    }

    // Worktree already present (resume after restart mid-release, or re-release
    // of a reset card that kept its worktree).
    if (card.releasedAt !== null && card.branch !== null && card.worktreePath !== null) {
      const claimedOperationId = card.operation?.operationId ?? operationId;
      if (claimedOperationId === undefined) {
        return;
      }
      yield* enterStep({
        card: { ...card, snapshot: card.snapshot ?? snapshot },
        stepIndex: 0,
        operationId: claimedOperationId,
      });
      return;
    }

    const branch = card.branch ?? boardCardBranchName({ title: card.title, cardId: card.id });
    const projectedWorktreeReusable =
      card.worktreePath !== null &&
      card.branch !== null &&
      (yield* fs.exists(card.worktreePath).pipe(Effect.catchCause(() => Effect.succeed(false))));

    /**
     * Crash after `createWorktree` but before `card.release.complete` leaves a
     * `starting` claim with null branch/path while the deterministic board
     * branch (and often its worktree) already exist in git. Reconcile by
     * exact local ref match only — never fuzzy/remote.
     */
    const discoverExistingBoardWorktree = Effect.gen(function* () {
      if (card.branch !== null) {
        return null;
      }
      const refs = yield* gitWorkflow
        .listRefs({
          cwd: project.workspaceRoot,
          query: branch,
          refKind: "local",
          limit: 2,
        })
        .pipe(
          Effect.catchCause(() =>
            Effect.succeed({
              refs: [] as ReadonlyArray<{
                readonly name: string;
                readonly isRemote?: boolean;
                readonly worktreePath: string | null;
              }>,
            }),
          ),
        );
      const exactLocal = refs.refs.find((ref) => ref.isRemote !== true && ref.name === branch);
      if (exactLocal === undefined) {
        return null;
      }
      if (exactLocal.worktreePath !== null) {
        const pathExists = yield* fs
          .exists(exactLocal.worktreePath)
          .pipe(Effect.catchCause(() => Effect.succeed(false)));
        if (pathExists) {
          return {
            refName: exactLocal.name,
            path: exactLocal.worktreePath,
            attach: false as const,
          };
        }
      }
      // Branch exists without a live worktree — attach it, do not recreate.
      return {
        refName: exactLocal.name,
        path: null as string | null,
        attach: true as const,
      };
    });

    const existingBoard = yield* discoverExistingBoardWorktree;
    const projectedWorktree =
      projectedWorktreeReusable && card.branch !== null && card.worktreePath !== null
        ? { refName: card.branch, path: card.worktreePath }
        : null;
    const discoveredWorktree =
      existingBoard !== null && !existingBoard.attach && existingBoard.path !== null
        ? { refName: existingBoard.refName, path: existingBoard.path }
        : null;

    const releaseResult =
      projectedWorktree !== null
        ? {
            ok: true as const,
            worktree: {
              worktree: {
                refName: projectedWorktree.refName,
                path: projectedWorktree.path,
              },
            },
          }
        : discoveredWorktree !== null
          ? {
              ok: true as const,
              worktree: {
                worktree: {
                  refName: discoveredWorktree.refName,
                  path: discoveredWorktree.path,
                },
              },
            }
          : yield* Effect.gen(function* () {
              const baseBranch = yield* resolveBaseBranch(project.workspaceRoot);
              if (existingBoard?.attach) {
                // Exact local branch already exists; add a worktree without `-b`.
                return yield* gitWorkflow.createWorktree({
                  cwd: project.workspaceRoot,
                  refName: existingBoard.refName,
                  path: null,
                });
              }
              if (card.branch !== null) {
                return yield* gitWorkflow.createWorktree({
                  cwd: project.workspaceRoot,
                  refName: card.branch,
                  path: card.worktreePath,
                });
              }
              // First start: create the deterministic branch + worktree.
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
      yield* fail(releaseResult.reason);
      return;
    }

    const claimedOperationId = card.operation?.operationId ?? operationId;
    if (claimedOperationId === undefined) {
      yield* Effect.logWarning("board reactor release missing operation id", {
        cardId,
      });
      return;
    }

    // Re-check claim before completion so a concurrent fail is harmless.
    const preComplete = yield* projectionSnapshotQuery.getCardById(cardId);
    if (
      Option.isNone(preComplete) ||
      !cardOperationMatches(preComplete.value, claimedOperationId, ["starting"])
    ) {
      return;
    }

    yield* dispatch({
      type: "card.release.complete",
      commandId: yield* serverCommandId("release-complete"),
      cardId,
      operationId: claimedOperationId,
      branch: releaseResult.worktree.worktree.refName,
      worktreePath: releaseResult.worktree.worktree.path,
    });

    const releasedCardOption = yield* projectionSnapshotQuery.getCardById(cardId);
    if (Option.isNone(releasedCardOption)) {
      return;
    }

    yield* enterStep({
      card: {
        ...releasedCardOption.value,
        snapshot: releasedCardOption.value.snapshot ?? snapshot,
      },
      stepIndex: 0,
      operationId: claimedOperationId,
    });
  });

  return {
    enterStep,
    loadAllThreadShells,
    processReleaseRequested,
  } as const;
});

export type BoardStepEntrySaga = Effect.Success<typeof makeBoardStepEntrySaga>;
