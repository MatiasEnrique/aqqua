// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// biome-ignore-all lint/style/noNonNullAssertion: fixtures assert required card and thread members below.
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  BoardId,
  type BoardStep,
  BoardStepId,
  type CardCleanupStage,
  CardId,
  CardOperationId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type OrchestrationCard,
  type OrchestrationReadModel,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionCardRepositoryLive } from "../../persistence/Layers/ProjectionCards.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import { ProjectionCardRepository } from "../../persistence/Services/ProjectionCards.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { layerTest as serverSettingsLayerTest } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import {
  boardOperationMessageId,
  boardOperationThreadId,
  decideBoardStepTurnStart,
} from "../boardCardHelpers.ts";
import { BoardReactor } from "../Services/BoardReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { layer as WorktreePathCoordinationLive } from "../Services/WorktreePathCoordination.ts";
import {
  BoardReactorHandlerDefectInjection,
  BoardReactorLive,
  boardCardBranchName,
  boardStepThreadTitle,
  cardOperationOwnsThreadForHandlerFailure,
  collectThreadLineage,
  findCardForCurrentStepThread,
  isProviderTurnLive,
  resolveStepEntryThreadId,
  threadHasOpenBlockingRequest,
} from "./BoardReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { makeBoardReconciliationEvents } from "./BoardReconciliation.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
let commandSerial = 0;
const nextCommandSerial = () => ++commandSerial;
const NOW = "2026-01-01T00:00:00.000Z";
const codexInstanceId = ProviderInstanceId.make("codex");

/**
 * One spawnable codex instance advertising one model with a provider-native
 * `reasoningEffort` select — enough for the model catalog to resolve a
 * canonical step and reject anything the instance does not advertise.
 */
const codexProviderSnapshot: ServerProvider = {
  instanceId: codexInstanceId,
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: NOW,
  models: [
    {
      slug: "gpt-5-codex",
      name: "gpt-5-codex",
      isCustom: false,
      isDefault: true,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            semantic: "reasoning",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

const providerRegistryStub = Layer.mock(ProviderRegistry)({
  getProviders: Effect.succeed([codexProviderSnapshot]),
  refresh: () => Effect.succeed([codexProviderSnapshot]),
  refreshInstance: () => Effect.succeed([codexProviderSnapshot]),
  setProviderMaintenanceActionState: () => Effect.succeed([codexProviderSnapshot]),
  streamChanges: Stream.empty,
} satisfies Partial<ProviderRegistry["Service"]>);

const STEPS: ReadonlyArray<BoardStep> = [
  {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Implement ${ticket_id} titled ${card_title}",
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  },
  {
    id: BoardStepId.make("step-2"),
    name: "Review",
    promptTemplate: "Review ${artifact} for ${ticket_id}",
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  },
];

type HarnessOptions = {
  readonly agentProfiles?: Record<string, unknown>;
  readonly newWorktreesOriginBranch?: string;
  readonly createWorktreeFails?: boolean;
  readonly removeWorktreeFails?: boolean;
  readonly generateTitle?: string | null;
  readonly titleGenerationFails?: boolean;
  /**
   * Extra local refs returned by listRefs (merged with the default `main`).
   * Used to simulate git state after a crash mid-release. Receives the harness
   * worktree path so tests can point an existing ref at it.
   */
  readonly extraLocalRefs?: (ctx: {
    readonly worktreePath: string;
    readonly workspaceRoot: string;
  }) => ReadonlyArray<{
    readonly name: string;
    readonly worktreePath: string | null;
    readonly isRemote?: boolean;
  }>;
  /**
   * When true, createWorktree fails if `newRefName` is set (branch already
   * exists) but still succeeds when attaching an existing ref.
   */
  readonly createWorktreeRejectsNewBranch?: boolean;
  /** Synchronous throw from createWorktree to exercise processEventSafely. */
  readonly createWorktreeThrows?: boolean;
  /**
   * When true (default), drain simulates ProviderCommandReactor's session:starting
   * receipt for claimed step-entry threads so enterStep can clear the claim.
   * Set false to test the turn-start → session-set gap explicitly.
   */
  readonly autoSettleStepEntryReceipts?: boolean;
  /** Inject processEvent defects for these event types (processEventSafely path). */
  readonly injectHandlerFailureOnEventTypes?: ReadonlyArray<string>;
  /**
   * When true, type-based defect injection starts disabled so setup (release /
   * lineage seed) can complete; call harness.enableHandlerDefectInjection().
   */
  readonly injectHandlerFailureDeferred?: boolean;
};

type BoardHarness = {
  readonly engine: OrchestrationEngineShape;
  readonly readModel: Effect.Effect<OrchestrationReadModel>;
  readonly drain: Effect.Effect<void>;
  readonly createWorktree: ReturnType<typeof vi.fn>;
  readonly removeWorktree: ReturnType<typeof vi.fn>;
  readonly generateThreadTitle: ReturnType<typeof vi.fn>;
  readonly workspaceRoot: string;
  readonly worktreePath: string;
  readonly projectId: ProjectId;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly stateDir: string;
  readonly releaseCard: Effect.Effect<void>;
  readonly sessionSet: (
    threadId: ThreadId,
    status: "ready" | "running" | "error" | "starting",
    activeTurnId?: TurnId | null,
  ) => Effect.Effect<void>;
  readonly readEvents: Effect.Effect<ReadonlyArray<{ type: string; [key: string]: unknown }>>;
  readonly dispatch: (
    command: Parameters<OrchestrationEngineShape["dispatch"]>[0],
  ) => Effect.Effect<void>;
  readonly dispatchFlip: (
    command: Parameters<OrchestrationEngineShape["dispatch"]>[0],
  ) => Effect.Effect<{ readonly _tag: string }>;
  readonly enableHandlerDefectInjection: () => void;
};

const withBoardReactorHarness = <A, E>(
  options: HarnessOptions,
  use: (harness: BoardHarness) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const workspaceRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "aqqua-board-reactor-"),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(workspaceRoot, { recursive: true, force: true });
        }),
      );
      const worktreePath = NodePath.join(workspaceRoot, ".worktrees", "board-card");
      NodeFS.mkdirSync(worktreePath, { recursive: true });

      const createWorktree = vi.fn(
        (input: {
          readonly cwd: string;
          readonly newRefName?: string | undefined;
          readonly refName: string;
          readonly baseRefName?: string | undefined;
          readonly path?: string | null;
        }) => {
          if (options.createWorktreeThrows) {
            throw new Error("unexpected createWorktree boom");
          }
          if (options.createWorktreeFails) {
            return Effect.fail(
              Object.assign(new Error("git worktree add failed"), {
                _tag: "GitCommandError" as const,
              }),
            ) as never;
          }
          if (options.createWorktreeRejectsNewBranch && input.newRefName !== undefined) {
            return Effect.fail(
              Object.assign(new Error(`a branch named '${input.newRefName}' already exists`), {
                _tag: "GitCommandError" as const,
              }),
            ) as never;
          }
          return Effect.succeed({
            worktree: {
              path: input.path ?? worktreePath,
              refName: input.newRefName ?? input.refName,
            },
          });
        },
      );

      const extraRefs = options.extraLocalRefs?.({ worktreePath, workspaceRoot }) ?? [];
      const listRefs = vi.fn(() =>
        Effect.succeed({
          refs: [
            {
              name: "main",
              isRemote: false,
              isDefault: true,
              current: true,
              worktreePath: null,
            },
            ...extraRefs.map((ref) => ({
              name: ref.name,
              isRemote: ref.isRemote ?? false,
              isDefault: false,
              current: false,
              worktreePath: ref.worktreePath,
            })),
          ],
          isRepo: true,
          hasPrimaryRemote: false,
          nextCursor: null,
          totalCount: 1 + extraRefs.length,
        }),
      );
      const fetchRemote = vi.fn(() => Effect.void);
      const resolveRemoteTrackingCommit = vi.fn(
        (input: { readonly refName: string; readonly fallbackRemoteName: string }) =>
          Effect.succeed({
            commitSha: "configured-origin-commit",
            remoteRefName: input.refName.startsWith(`${input.fallbackRemoteName}/`)
              ? input.refName
              : `${input.fallbackRemoteName}/${input.refName}`,
          }),
      );

      const removeWorktree = vi.fn(() =>
        options.removeWorktreeFails
          ? (Effect.fail(
              Object.assign(new Error("git worktree remove failed"), {
                _tag: "GitCommandError" as const,
              }),
            ) as never)
          : Effect.void,
      );
      const inspectWorktreeRemoval = vi.fn(() =>
        Effect.succeed({
          availability: "available" as const,
          refName: "board/test",
          headCommit: "abc123",
          baseRef: "main",
          mergeStatus: "unmerged" as const,
          workingTreeStatus: "clean" as const,
        }),
      );

      const generateThreadTitle = vi.fn(() => {
        if (options.titleGenerationFails) {
          return Effect.fail(
            Object.assign(new Error("title gen failed"), {
              _tag: "TextGenerationError" as const,
            }),
          ) as never;
        }
        // Default: skip rename so release/status tests keep the placeholder title.
        if (options.generateTitle === undefined || options.generateTitle === null) {
          return Effect.succeed({ title: "" });
        }
        return Effect.succeed({
          title: options.generateTitle,
        });
      });

      const orchestrationLayer = OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(RepositoryIdentityResolver.layer),
        Layer.provide(SqlitePersistenceMemory),
      );
      const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
        Layer.provide(RepositoryIdentityResolver.layer),
        Layer.provide(SqlitePersistenceMemory),
      );

      const registryStub = Layer.succeed(ProviderAdapterRegistry, {
        getByInstance: () => Effect.die("unused"),
        getInstanceInfo: (instanceId: ProviderInstanceId) =>
          Effect.succeed({
            instanceId,
            driverKind: ProviderDriverKind.make("codex"),
            displayName: "Codex",
            enabled: true,
            continuationIdentity: { kind: "instance", instanceId },
          }),
        listInstances: () => Effect.succeed([codexInstanceId]),
        listProviders: () => Effect.succeed([ProviderDriverKind.make("codex")]),
        streamChanges: Stream.empty,
        subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
      } as unknown as typeof ProviderAdapterRegistry.Service);

      const gitLayer = Layer.mock(GitWorkflowService)({
        createWorktree,
        fetchRemote,
        listRefs,
        removeWorktree,
        resolveRemoteTrackingCommit,
        inspectWorktreeRemoval,
      } satisfies Partial<GitWorkflowService["Service"]>);

      const setupScriptRunnerStub = Layer.succeed(
        ProjectSetupScriptRunner,
        ProjectSetupScriptRunner.of({
          runForThread: () => Effect.succeed({ status: "no-script" as const }),
        }),
      );

      const textGenerationLayer = Layer.succeed(TextGeneration, {
        generateCommitMessage: () => Effect.die("unused"),
        generatePrContent: () => Effect.die("unused"),
        generateBranchName: () => Effect.die("unused"),
        generateThreadTitle,
      } as unknown as typeof TextGeneration.Service);

      const defectTypes = new Set(options.injectHandlerFailureOnEventTypes ?? []);
      const defectInjectionState = {
        enabled: options.injectHandlerFailureDeferred !== true,
      };
      const defectInjectionLayer = Layer.succeed(BoardReactorHandlerDefectInjection, {
        shouldFail: (event) => defectInjectionState.enabled && defectTypes.has(event.type),
      });

      const layer = BoardReactorLive.pipe(
        Layer.provideMerge(defectInjectionLayer),
        Layer.provideMerge(orchestrationLayer),
        Layer.provideMerge(projectionSnapshotLayer),
        Layer.provideMerge(gitLayer),
        Layer.provideMerge(registryStub),
        Layer.provideMerge(providerRegistryStub),
        Layer.provideMerge(textGenerationLayer),
        Layer.provideMerge(setupScriptRunnerStub),
        Layer.provideMerge(WorktreePathCoordinationLive),
        Layer.provideMerge(
          serverSettingsLayerTest({
            agentProfiles: (options.agentProfiles ?? {}) as never,
            textGenerationModelSelection: {
              instanceId: codexInstanceId,
              model: "gpt-5-codex",
            },
          }),
        ),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "aqqua-board-reactor-test-",
          }),
        ),
        Layer.provideMerge(NodeServices.layer),
      );

      return yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const reactor = yield* BoardReactor;
        const config = yield* ServerConfig;
        yield* reactor.start();
        // Let the scoped domain-event fiber subscribe before seeding.
        yield* Effect.yieldNow;

        const projectId = asProjectId("project-1");
        const boardId = BoardId.make("board-1");
        const cardId = CardId.make("card-board-1");

        const dispatch = (command: Parameters<OrchestrationEngineShape["dispatch"]>[0]) =>
          engine.dispatch(command).pipe(Effect.asVoid, Effect.orDie);

        yield* dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-project-create"),
          projectId,
          title: "Board Project",
          workspaceRoot,
          ...(options.newWorktreesOriginBranch !== undefined
            ? { newWorktreesOriginBranch: options.newWorktreesOriginBranch }
            : {}),
          defaultModelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          createdAt: NOW,
        });
        yield* dispatch({
          type: "board.create",
          commandId: CommandId.make("cmd-board-create"),
          boardId,
          projectId,
          name: "Delivery",
          steps: STEPS,
        });
        yield* dispatch({
          type: "card.create",
          commandId: CommandId.make("cmd-card-create"),
          cardId,
          boardId,
          title: "Fix flaky test",
          parameters: { ticket_id: "aqqua-482" },
        });

        const sessionSet = (
          threadId: ThreadId,
          status: "ready" | "running" | "error" | "starting",
          activeTurnId: TurnId | null = null,
        ) =>
          dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`cmd-session-${status}-${nextCommandSerial()}`),
            threadId,
            session: {
              threadId,
              status,
              providerName: "codex",
              providerInstanceId: codexInstanceId,
              runtimeMode: "full-access",
              activeTurnId,
              lastError: status === "error" ? "boom" : null,
              updatedAt: NOW,
            },
            createdAt: NOW,
          });

        const autoSettleStepEntry = options.autoSettleStepEntryReceipts !== false;

        /**
         * Simulate PCR projecting session:starting for claimed step-entry
         * threads after turn.start (tests do not run ProviderCommandReactor).
         * Does not auto-stop interrupt waits — staged saga tests own that.
         */
        const settleStepEntryReceipts = Effect.gen(function* () {
          if (!autoSettleStepEntry) {
            return;
          }
          const model = yield* snapshotQuery.getSnapshot().pipe(Effect.orDie);
          for (const card of model.cards) {
            const operation = card.operation;
            if (
              operation === null ||
              (operation.kind !== "starting" &&
                operation.kind !== "advancing" &&
                operation.kind !== "retrying")
            ) {
              continue;
            }
            const threadId = resolveStepEntryThreadId(operation);
            const thread = model.threads.find((entry) => entry.id === threadId);
            if (thread === undefined || thread.session !== null) {
              continue;
            }
            yield* sessionSet(
              threadId,
              "starting",
              TurnId.make(`turn-settle-${nextCommandSerial()}`),
            );
            yield* reactor.drain;
          }
        });

        const drain = Effect.gen(function* () {
          yield* reactor.drain;
          yield* settleStepEntryReceipts;
        });

        const releaseCard = Effect.gen(function* () {
          yield* dispatch({
            type: "card.release",
            commandId: CommandId.make(`cmd-card-release-${nextCommandSerial()}`),
            cardId,
          });
          yield* drain;
        });

        const harness: BoardHarness = {
          engine,
          readModel: snapshotQuery.getSnapshot().pipe(Effect.orDie),
          drain,
          createWorktree,
          removeWorktree,
          generateThreadTitle,
          workspaceRoot,
          worktreePath,
          projectId,
          boardId,
          cardId,
          stateDir: config.stateDir,
          releaseCard,
          sessionSet,
          readEvents: Stream.runCollect(engine.readEvents(0)).pipe(
            Effect.map((chunk) => Array.from(chunk) as ReadonlyArray<{ type: string }>),
            Effect.orDie,
          ),
          dispatch,
          dispatchFlip: (command) =>
            engine.dispatch(command).pipe(
              Effect.matchEffect({
                onFailure: (error) => Effect.succeed(error as { readonly _tag: string }),
                onSuccess: () => Effect.die("expected dispatch to fail"),
              }),
            ),
          enableHandlerDefectInjection: () => {
            defectInjectionState.enabled = true;
          },
        };

        return yield* use(harness);
      }).pipe(Effect.provide(layer), Effect.orDie);
    }),
  );

describe("boardCardBranchName / boardStepThreadTitle / helpers", () => {
  it("builds a unique board branch and step title", () => {
    expect(
      boardCardBranchName({
        title: "Fix Flaky Test!",
        cardId: "card-abcdefgh",
      }),
    ).toBe("board/fix-flaky-test-abcdefgh");
    expect(
      boardStepThreadTitle({
        cardTitle: "Fix flaky test",
        stepIndex: 0,
        stepName: "Implement",
      }),
    ).toBe("Fix flaky test · 1 Implement");
  });

  it("derives stable board operation thread and message ids", () => {
    expect(String(boardOperationThreadId("cmd-release-1"))).toBe("board-op-thread:cmd-release-1");
    expect(String(boardOperationMessageId("cmd-release-1"))).toBe("board-op-message:cmd-release-1");
    // Same operation → same logical prompt identity across process restarts.
    expect(boardOperationMessageId("cmd-release-1")).toBe(boardOperationMessageId("cmd-release-1"));
  });

  it("decideBoardStepTurnStart models per-process request then restart re-request", () => {
    expect(
      decideBoardStepTurnStart({
        session: null,
        turnStartAlreadyDispatched: false,
      }),
    ).toEqual({ action: "request-turn" });
    expect(
      decideBoardStepTurnStart({
        session: null,
        turnStartAlreadyDispatched: true,
      }),
    ).toEqual({ action: "await-session" });
    // Fresh process after crash: guard is empty again → one replacement request.
    expect(
      decideBoardStepTurnStart({
        session: null,
        turnStartAlreadyDispatched: false,
      }),
    ).toEqual({ action: "request-turn" });
    expect(
      decideBoardStepTurnStart({
        session: {
          threadId: ThreadId.make("t1"),
          status: "starting",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
        turnStartAlreadyDispatched: true,
      }),
    ).toEqual({ action: "link", terminalStatus: null });
    expect(
      decideBoardStepTurnStart({
        session: {
          threadId: ThreadId.make("t1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
        turnStartAlreadyDispatched: false,
      }),
    ).toEqual({ action: "link", terminalStatus: "needs-input" });
  });

  it("collectThreadLineage includes roots and all descendants", () => {
    const root = ThreadId.make("root");
    const child = ThreadId.make("child");
    const grand = ThreadId.make("grand");
    const other = ThreadId.make("other");
    const lineage = collectThreadLineage(
      [root],
      [
        { id: root, parentThreadId: null, session: null, archivedAt: null },
        { id: child, parentThreadId: root, session: null, archivedAt: null },
        { id: grand, parentThreadId: child, session: null, archivedAt: null },
        { id: other, parentThreadId: null, session: null, archivedAt: null },
      ],
    );
    expect(lineage.map((m) => m.id).sort()).toEqual([child, grand, root].map(String).sort());
    expect(isProviderTurnLive(null)).toBe(false);
    expect(
      isProviderTurnLive({
        threadId: root,
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      }),
    ).toBe(true);
  });

  it("cardOperationOwnsThreadForHandlerFailure matches step-entry and lineage, not idle cards", () => {
    const stepThread = ThreadId.make("board-op-thread:op-start");
    const child = ThreadId.make("child");
    const stranger = ThreadId.make("stranger");
    const allThreads = [
      { id: stepThread, parentThreadId: null, session: null, archivedAt: null },
      {
        id: child,
        parentThreadId: stepThread,
        session: null,
        archivedAt: null,
      },
      { id: stranger, parentThreadId: null, session: null, archivedAt: null },
    ];
    const startingCard = {
      id: CardId.make("c1"),
      boardId: BoardId.make("b1"),
      projectId: ProjectId.make("p1"),
      title: "t",
      parameters: {},
      position: { kind: "todo" as const },
      status: null,
      operation: {
        kind: "starting" as const,
        operationId: CardOperationId.make("op-start"),
        requestedAt: NOW,
        threadId: stepThread,
      },
      lastError: null,
      snapshot: null,
      branch: null,
      worktreePath: null,
      stepThreads: [],
      createdAt: NOW,
      updatedAt: NOW,
      releasedAt: null,
      completedAt: null,
      settledAt: null,
      archivedAt: null,
    } satisfies OrchestrationCard;
    const idleCard: OrchestrationCard = {
      ...startingCard,
      id: CardId.make("c-idle"),
      operation: null,
    };
    expect(
      cardOperationOwnsThreadForHandlerFailure({
        card: startingCard,
        threadId: stepThread,
        allThreads,
      }),
    ).toBe(true);
    expect(
      cardOperationOwnsThreadForHandlerFailure({
        card: startingCard,
        threadId: stranger,
        allThreads,
      }),
    ).toBe(false);
    expect(
      cardOperationOwnsThreadForHandlerFailure({
        card: idleCard,
        threadId: stepThread,
        allThreads,
      }),
    ).toBe(false);

    const resettingCard: OrchestrationCard = {
      ...startingCard,
      id: CardId.make("c-reset"),
      position: { kind: "step", stepIndex: 0 },
      operation: {
        kind: "resetting",
        operationId: CardOperationId.make("op-reset"),
        requestedAt: NOW,
        activeThreadId: stepThread,
        threadIds: [stepThread],
      },
      stepThreads: [{ stepIndex: 0, threadId: stepThread, spawnedAt: NOW }],
    };
    expect(
      cardOperationOwnsThreadForHandlerFailure({
        card: resettingCard,
        threadId: child,
        allThreads,
      }),
    ).toBe(true);
  });

  it("threadHasOpenBlockingRequest tracks request/resolve pairs and stale failures", () => {
    expect(
      threadHasOpenBlockingRequest({
        activities: [
          { kind: "approval.requested", payload: { requestId: "r1" } },
          { kind: "approval.resolved", payload: { requestId: "r1" } },
        ],
      }),
    ).toBe(false);
    expect(
      threadHasOpenBlockingRequest({
        activities: [{ kind: "user-input.requested", payload: { requestId: "r2" } }],
      }),
    ).toBe(true);
    expect(
      threadHasOpenBlockingRequest({
        activities: [
          { kind: "approval.requested", payload: { requestId: "r3" } },
          {
            kind: "provider.approval.respond.failed",
            payload: {
              requestId: "r3",
              detail: "stale pending approval request",
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("findCardForCurrentStepThread ignores non-current threads", () => {
    const card = {
      id: CardId.make("c1"),
      boardId: BoardId.make("b1"),
      projectId: ProjectId.make("p1"),
      title: "t",
      parameters: {},
      position: { kind: "step" as const, stepIndex: 0 },
      status: "running" as const,
      operation: null,
      lastError: null,
      snapshot: null,
      branch: null,
      worktreePath: null,
      stepThreads: [
        { stepIndex: 0, threadId: ThreadId.make("old"), spawnedAt: NOW },
        { stepIndex: 0, threadId: ThreadId.make("cur"), spawnedAt: NOW },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      releasedAt: NOW,
      completedAt: null,
      settledAt: null,
      archivedAt: null,
    };
    expect(findCardForCurrentStepThread([card], ThreadId.make("cur"))?.id).toBe("c1");
    expect(findCardForCurrentStepThread([card], ThreadId.make("old"))).toBeNull();
  });
});

describe("BoardReactor", () => {
  it.effect(
    "release-requested creates worktree+branch, starts step thread, and enters step 0",
    () =>
      withBoardReactorHarness({}, (harness) =>
        Effect.gen(function* () {
          yield* harness.dispatch({
            type: "card.release",
            commandId: CommandId.make("cmd-card-release"),
            cardId: harness.cardId,
          });
          yield* harness.drain;

          const events = yield* harness.readEvents;
          expect(events.some((e) => e.type === "card.released")).toBe(true);
          expect(events.some((e) => e.type === "card.step-entered")).toBe(true);
          expect(events.some((e) => e.type === "thread.created")).toBe(true);
          expect(events.some((e) => e.type === "thread.turn-start-requested")).toBe(true);

          expect(harness.createWorktree).toHaveBeenCalled();
          const createArg = harness.createWorktree.mock.calls[0]?.[0];
          expect(createArg?.cwd).toBe(harness.workspaceRoot);
          expect(createArg?.newRefName).toMatch(/^board\/fix-flaky-test-/);
          expect((createArg as { baseRefName?: string } | undefined)?.baseRefName).toBe("main");

          const snapshot = yield* harness.readModel;
          const card = snapshot.cards.find((entry) => entry.id === harness.cardId);
          expect(card?.position).toEqual({ kind: "step", stepIndex: 0 });
          expect(card?.status).toBe("running");
          expect(card?.branch).toMatch(/^board\/fix-flaky-test-/);
          expect(card?.worktreePath).toBe(harness.worktreePath);
          expect(card?.stepThreads).toHaveLength(1);

          const thread = snapshot.threads.find(
            (entry) => entry.id === card?.stepThreads[0]!.threadId,
          );
          expect(thread).toBeDefined();
          expect(thread?.parentThreadId ?? null).toBeNull();
          expect(thread?.branch).toBe(card?.branch);
          expect(thread?.worktreePath).toBe(harness.worktreePath);
          expect(thread?.title).toContain("· 1 Implement");

          const userMessage = events.find(
            (e) =>
              e.type === "thread.message-sent" &&
              e.aggregateId === card?.stepThreads[0]!.threadId &&
              (e as { payload?: { role?: string } }).payload?.role === "user",
          ) as
            | {
                type: "thread.message-sent";
                payload: { text: string };
              }
            | undefined;
          expect(userMessage?.type).toBe("thread.message-sent");
          if (userMessage?.type === "thread.message-sent") {
            expect(userMessage.payload.text).toContain("Implement aqqua-482 titled Fix flaky test");
            expect(userMessage.payload.text).toContain("board_complete");
            expect(userMessage.payload.text).toContain(
              NodePath.join(harness.stateDir, "board-artifacts", harness.cardId, "Implement.md"),
            );
          }
          expect(events.some((e) => e.type === "thread.turn-start-requested")).toBe(true);

          expect(
            NodeFS.existsSync(NodePath.join(harness.stateDir, "board-artifacts", harness.cardId)),
          ).toBe(true);
        }),
      ),
  );

  it.effect("creates a card worktree from the configured origin branch", () =>
    withBoardReactorHarness({ newWorktreesOriginBranch: "develop" }, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        yield* harness.drain;

        const createArg = harness.createWorktree.mock.calls[0]?.[0];
        expect(createArg).toMatchObject({
          cwd: harness.workspaceRoot,
          refName: "configured-origin-commit",
          baseRefName: "origin/develop",
        });
      }),
    ),
  );

  it.effect("ordinary conversation interrupt marks the current card run cancelled", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const releasedCard = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        );
        const currentThreadId = releasedCard?.stepThreads[0]?.threadId;
        if (currentThreadId === undefined) {
          return yield* Effect.die("released card has no current step thread");
        }

        yield* harness.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-interrupt-card-conversation"),
          threadId: currentThreadId,
          createdAt: NOW,
        });
        yield* harness.drain;

        const events = yield* harness.readEvents;
        expect(
          events.some(
            (event) =>
              event.type === "thread.turn-interrupt-requested" &&
              event.aggregateId === currentThreadId,
          ),
        ).toBe(true);
        expect(events.some((event) => event.type === "card.cancel-requested")).toBe(false);
        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("cancelled");

        // A provider can surface one last running/tool-use signal while its
        // interrupt settles. That late session event must not revive the card.
        yield* harness.sessionSet(currentThreadId, "running", TurnId.make("turn-after-interrupt"));
        yield* harness.drain;
        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("cancelled");
      }),
    ),
  );

  it.effect("ordinary conversation interrupt cancels a card waiting on approval", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const releasedCard = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        );
        const currentThreadId = releasedCard?.stepThreads[0]?.threadId;
        if (currentThreadId === undefined) {
          return yield* Effect.die("released card has no current step thread");
        }

        yield* harness.sessionSet(
          currentThreadId,
          "running",
          TurnId.make("turn-awaiting-approval"),
        );
        yield* harness.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make("cmd-card-approval-requested"),
          threadId: currentThreadId,
          activity: {
            id: EventId.make("act-card-approval-requested"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: { requestId: "req-card-cancel" },
            turnId: TurnId.make("turn-awaiting-approval"),
            createdAt: NOW,
          },
          createdAt: NOW,
        });
        yield* harness.drain;
        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("needs-input");

        yield* harness.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-interrupt-blocked-card"),
          threadId: currentThreadId,
          createdAt: NOW,
        });
        yield* harness.drain;

        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("cancelled");
      }),
    ),
  );

  it.effect(
    "release reconciliation adopts an exact existing board branch+worktree after mid-release crash",
    () => {
      const expectedBranch = boardCardBranchName({
        title: "Fix flaky test",
        cardId: "card-board-1",
      });
      return withBoardReactorHarness(
        {
          // Simulates: createWorktree already succeeded; a second `-b` would fail.
          createWorktreeRejectsNewBranch: true,
          extraLocalRefs: ({ worktreePath }) => [
            {
              name: expectedBranch,
              worktreePath,
            },
            // Remote-only lookalike must not be adopted.
            {
              name: expectedBranch,
              worktreePath: null,
              isRemote: true,
            },
          ],
        },
        (harness) =>
          Effect.gen(function* () {
            yield* harness.dispatch({
              type: "card.release",
              commandId: CommandId.make("cmd-card-release-adopt"),
              cardId: harness.cardId,
            });
            yield* harness.drain;

            const model = yield* harness.readModel;
            const card = model.cards.find((entry) => entry.id === harness.cardId)!;
            expect(card.operation).toBeNull();
            expect(card.branch).toBe(expectedBranch);
            expect(card.worktreePath).toBe(harness.worktreePath);
            expect(card.status).toBe("running");
            expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
            expect(card.stepThreads).toHaveLength(1);

            // Must not have attempted to recreate the branch with `-b`.
            expect(
              harness.createWorktree.mock.calls.some(
                (call) => (call[0] as { newRefName?: string }).newRefName !== undefined,
              ),
            ).toBe(false);
            // And must not have needed a fresh create at all when path already exists.
            expect(harness.createWorktree).not.toHaveBeenCalled();

            const events = yield* harness.readEvents;
            expect(events.some((e) => e.type === "card.released")).toBe(true);
            expect(events.some((e) => e.type === "card.step-entered")).toBe(true);
          }),
      );
    },
  );

  it.effect("release reconciliation attaches an exact local branch that has no worktree", () => {
    const expectedBranch = boardCardBranchName({
      title: "Fix flaky test",
      cardId: "card-board-1",
    });
    return withBoardReactorHarness(
      {
        createWorktreeRejectsNewBranch: true,
        extraLocalRefs: () => [
          {
            name: expectedBranch,
            worktreePath: null,
          },
        ],
      },
      (harness) =>
        Effect.gen(function* () {
          yield* harness.dispatch({
            type: "card.release",
            commandId: CommandId.make("cmd-card-release-attach"),
            cardId: harness.cardId,
          });
          yield* harness.drain;

          const card = (yield* harness.readModel).cards.find(
            (entry) => entry.id === harness.cardId,
          )!;
          expect(card.branch).toBe(expectedBranch);
          expect(card.worktreePath).toBe(harness.worktreePath);
          expect(card.status).toBe("running");
          expect(card.operation).toBeNull();

          expect(harness.createWorktree).toHaveBeenCalledTimes(1);
          const createArg = harness.createWorktree.mock.calls[0]?.[0] as {
            refName: string;
            newRefName?: string;
          };
          expect(createArg.refName).toBe(expectedBranch);
          expect(createArg.newRefName).toBeUndefined();
        }),
    );
  });

  /** Mark the current step session non-live so auto-advance does not wait on interrupt. */
  const stopCurrentStepSession = (harness: BoardHarness, threadId: ThreadId) =>
    Effect.gen(function* () {
      yield* harness.sessionSet(threadId, "ready");
      yield* harness.drain;
      // ready+running would flip needs-input; restore running for a clean report.
      yield* harness.dispatch({
        type: "card.status.set",
        commandId: CommandId.make(`cmd-status-running-${nextCommandSerial()}`),
        cardId: harness.cardId,
        status: "running",
      });
    });

  const completeAndSettleCard = (harness: BoardHarness) =>
    Effect.gen(function* () {
      yield* harness.releaseCard;
      for (let stepIndex = 0; stepIndex < STEPS.length; stepIndex += 1) {
        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const currentThread = [...card.stepThreads]
          .toReversed()
          .find((entry) => entry.stepIndex === stepIndex)!;
        yield* stopCurrentStepSession(harness, currentThread.threadId);
        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make(`cmd-complete-for-archive-${stepIndex}`),
          cardId: harness.cardId,
          stepIndex,
          threadId: currentThread.threadId,
          outcome: "success",
        });
        yield* harness.drain;
      }
      yield* harness.dispatch({
        type: "card.settle",
        commandId: CommandId.make("cmd-settle-for-archive"),
        cardId: harness.cardId,
      });
    });

  const verifyCleanupRestartFromStage = (
    cleanupStage: CardCleanupStage,
    purpose: "archive" | undefined = "archive",
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseDir = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "aqqua-board-archive-restart-"),
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        );
        const workspaceRoot = NodePath.join(baseDir, "workspace");
        const worktreePath = NodePath.join(workspaceRoot, ".worktrees", "board-card");
        NodeFS.mkdirSync(worktreePath, { recursive: true });

        const removeWorktree = vi.fn(() => Effect.void);
        const gitLayer = Layer.mock(GitWorkflowService)({
          removeWorktree,
          inspectWorktreeRemoval: () =>
            Effect.succeed({
              availability: "available" as const,
              refName: "board/archive-restart",
              headCommit: "abc123",
              baseRef: "main",
              mergeStatus: "unmerged" as const,
              workingTreeStatus: "clean" as const,
            }),
        } satisfies Partial<GitWorkflowService["Service"]>);
        const registryStub = Layer.succeed(ProviderAdapterRegistry, {
          getByInstance: () => Effect.die("unused"),
          getInstanceInfo: () => Effect.die("unused"),
          listInstances: () => Effect.succeed([codexInstanceId]),
          listProviders: () => Effect.succeed([ProviderDriverKind.make("codex")]),
          streamChanges: Stream.empty,
          subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
        } as unknown as typeof ProviderAdapterRegistry.Service);
        const textGenerationLayer = Layer.succeed(TextGeneration, {
          generateCommitMessage: () => Effect.die("unused"),
          generatePrContent: () => Effect.die("unused"),
          generateBranchName: () => Effect.die("unused"),
          generateThreadTitle: () => Effect.succeed({ title: "" }),
        } as unknown as typeof TextGeneration.Service);
        const setupScriptRunnerStub = Layer.succeed(
          ProjectSetupScriptRunner,
          ProjectSetupScriptRunner.of({
            runForThread: () => Effect.succeed({ status: "no-script" as const }),
          }),
        );
        const persistenceLayer = makeSqlitePersistenceLive(
          NodePath.join(baseDir, "userdata", "state.sqlite"),
        );
        const makeProcessLayer = () => {
          const orchestrationLayer = OrchestrationEngineLive.pipe(
            Layer.provide(OrchestrationProjectionSnapshotQueryLive),
            Layer.provide(OrchestrationProjectionPipelineLive),
            Layer.provide(OrchestrationEventStoreLive),
            Layer.provide(OrchestrationCommandReceiptRepositoryLive),
            Layer.provide(RepositoryIdentityResolver.layer),
            Layer.provide(persistenceLayer),
          );
          const snapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
            Layer.provide(RepositoryIdentityResolver.layer),
            Layer.provide(persistenceLayer),
          );
          const cardsLayer = ProjectionCardRepositoryLive.pipe(Layer.provide(persistenceLayer));
          return BoardReactorLive.pipe(
            Layer.provideMerge(orchestrationLayer),
            Layer.provideMerge(snapshotLayer),
            Layer.provideMerge(cardsLayer),
            Layer.provideMerge(gitLayer),
            Layer.provideMerge(registryStub),
            Layer.provideMerge(providerRegistryStub),
            Layer.provideMerge(textGenerationLayer),
            Layer.provideMerge(setupScriptRunnerStub),
            Layer.provideMerge(WorktreePathCoordinationLive),
            Layer.provideMerge(
              serverSettingsLayerTest({
                agentProfiles: {} as never,
                textGenerationModelSelection: {
                  instanceId: codexInstanceId,
                  model: "gpt-5-codex",
                },
              }),
            ),
            Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provideMerge(NodeServices.layer),
          );
        };

        const projectId = ProjectId.make("project-archive-restart");
        const boardId = BoardId.make("board-archive-restart");
        const cardId = CardId.make("card-archive-restart");
        let artifactDir = "";

        // Process 1 persists a partially completed archive operation, then exits.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* OrchestrationEngineService;
            const cards = yield* ProjectionCardRepository;
            const config = yield* ServerConfig;
            const dispatch = (command: Parameters<OrchestrationEngineShape["dispatch"]>[0]) =>
              engine.dispatch(command).pipe(Effect.asVoid, Effect.orDie);
            yield* dispatch({
              type: "project.create",
              commandId: CommandId.make("cmd-project-archive-restart"),
              projectId,
              title: "Archive restart",
              workspaceRoot,
              defaultModelSelection: { instanceId: codexInstanceId, model: "gpt-5-codex" },
              createdAt: NOW,
            });
            yield* dispatch({
              type: "board.create",
              commandId: CommandId.make("cmd-board-archive-restart"),
              boardId,
              projectId,
              name: "Delivery",
              steps: STEPS,
            });
            yield* dispatch({
              type: "card.create",
              commandId: CommandId.make("cmd-card-archive-restart"),
              cardId,
              boardId,
              title: "Archive after restart",
              parameters: {},
            });
            if (cleanupStage === "cleanup-started") {
              yield* dispatch({
                type: "thread.create",
                commandId: CommandId.make("cmd-thread-archive-restart"),
                threadId: ThreadId.make("thread-archive-restart"),
                projectId,
                parentThreadId: null,
                title: "Archive member",
                modelSelection: { instanceId: codexInstanceId, model: "gpt-5-codex" },
                runtimeMode: "full-access",
                interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                branch: "board/archive-restart",
                worktreePath,
                createdAt: NOW,
              });
            }
            const row = yield* cards
              .getById({ cardId })
              .pipe(Effect.map(Option.getOrThrow), Effect.orDie);
            yield* cards
              .upsert({
                ...row,
                positionKind: "done",
                status: null,
                snapshot: { name: "Delivery", steps: STEPS },
                branch: "board/archive-restart",
                worktreePath,
                releasedAt: NOW,
                completedAt: NOW,
                settledAt: NOW,
                operation: {
                  kind: "deleting",
                  operationId: CardOperationId.make(
                    purpose === undefined ? "archive:historical-delete" : "cmd-before-restart",
                  ),
                  requestedAt: NOW,
                  ...(purpose === undefined ? {} : { purpose }),
                  cleanupStage,
                },
                lastError: "process stopped",
              })
              .pipe(Effect.orDie);
            artifactDir = NodePath.join(config.stateDir, "board-artifacts", cardId);
            if (cleanupStage !== "artifacts-removed") {
              NodeFS.mkdirSync(artifactDir, { recursive: true });
              NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "persisted");
            }
          }).pipe(Effect.provide(makeProcessLayer()), Effect.orDie),
        );

        // Process 2 rehydrates the claim and executes the real reconciled handler.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* OrchestrationEngineService;
            const reactor = yield* BoardReactor;
            const snapshotQuery = yield* ProjectionSnapshotQuery;
            yield* reactor.start();
            yield* Effect.yieldNow;
            yield* reactor.drain;

            const card = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).cards.find(
              (entry) => entry.id === cardId,
            );
            if (purpose === "archive") {
              expect(card?.archivedAt).not.toBeNull();
              expect(card?.operation).toBeNull();
            } else {
              expect(card).toBeUndefined();
            }
            expect(NodeFS.existsSync(artifactDir)).toBe(false);
            expect(removeWorktree).toHaveBeenCalledTimes(
              cleanupStage === "cleanup-started" || cleanupStage === "conversations-archived"
                ? 1
                : 0,
            );
            const events = yield* Stream.runCollect(engine.readEvents(0)).pipe(
              Effect.map((chunk) => Array.from(chunk)),
              Effect.orDie,
            );
            expect(events.filter((event) => event.type === "thread.archived")).toHaveLength(
              cleanupStage === "cleanup-started" ? 1 : 0,
            );
          }).pipe(Effect.provide(makeProcessLayer()), Effect.orDie),
        );
      }),
    );

  it.effect("step.report success on a 2-step snapshot advances to step 2", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        const afterRelease = yield* harness.readModel;
        const card = afterRelease.cards.find((entry) => entry.id === harness.cardId)!;
        const step0ThreadId = card.stepThreads[0]!.threadId;
        yield* stopCurrentStepSession(harness, step0ThreadId);

        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("cmd-step-report-0"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: step0ThreadId,
          outcome: "success",
        });
        yield* harness.drain;

        const snapshot = yield* harness.readModel;
        const advanced = snapshot.cards.find((entry) => entry.id === harness.cardId)!;
        expect(advanced.position).toEqual({ kind: "step", stepIndex: 1 });
        expect(advanced.status).toBe("running");
        expect(advanced.stepThreads).toHaveLength(2);

        const step1Thread = snapshot.threads.find(
          (entry) => entry.id === advanced.stepThreads[1]!.threadId,
        );
        expect(step1Thread?.title).toContain("· 2 Review");

        const events = yield* harness.readEvents;
        const reviewMessage = events.find(
          (e) =>
            e.type === "thread.message-sent" &&
            e.aggregateId === step1Thread?.id &&
            (e as { payload?: { role?: string } }).payload?.role === "user",
        ) as { type: "thread.message-sent"; payload: { text: string } } | undefined;
        expect(reviewMessage?.type).toBe("thread.message-sent");
        if (reviewMessage?.type === "thread.message-sent") {
          expect(reviewMessage.payload.text).toContain(
            NodePath.join(harness.stateDir, "board-artifacts", harness.cardId, "Implement.md"),
          );
          expect(reviewMessage.payload.text).toContain("Review");
        }
      }),
    ),
  );

  it.effect("step.report waits for the live completion tool turn without interrupting it", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        const step0ThreadId = card.stepThreads[0]!.threadId;
        yield* harness.sessionSet(step0ThreadId, "running", TurnId.make("turn-board-complete"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("mcp:board-complete:live-step-report"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: step0ThreadId,
          outcome: "success",
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("advancing");
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
        expect(
          (yield* harness.readEvents).some(
            (event) =>
              event.type === "thread.turn-interrupt-requested" &&
              event.aggregateId === step0ThreadId,
          ),
        ).toBe(false);

        yield* harness.sessionSet(step0ThreadId, "ready");
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.position).toEqual({ kind: "step", stepIndex: 1 });
        expect(card.status).toBe("running");
      }),
    ),
  );

  it.effect("force advance releases a card blocked by a hung provider-native child", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        const step0ThreadId = card.stepThreads[0]!.threadId;
        const childId = ThreadId.make("thread-hung-native-child");
        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-hung-native-child"),
          threadId: childId,
          projectId: harness.projectId,
          parentThreadId: step0ThreadId,
          providerSubagent: {
            ownerThreadId: step0ThreadId,
            provider: ProviderDriverKind.make("codex"),
            childId: "hung-native-child",
          },
          title: "hung native child",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: card.branch,
          worktreePath: card.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(step0ThreadId, "running", TurnId.make("turn-hung-root"));
        yield* harness.sessionSet(childId, "running", TurnId.make("turn-hung-native-child"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("mcp:board-complete:hung-native-child"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: step0ThreadId,
          outcome: "success",
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("advancing");
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });

        yield* harness.dispatch({
          type: "card.force-advance",
          commandId: CommandId.make("cmd-force-advance-hung-native-child"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        const root = model.threads.find((entry) => entry.id === step0ThreadId)!;
        const child = model.threads.find((entry) => entry.id === childId)!;
        expect(root.session?.status).toBe("interrupted");
        expect(root.session?.activeTurnId).toBeNull();
        expect(child.session?.status).toBe("interrupted");
        expect(child.session?.activeTurnId).toBeNull();
        expect(child.session?.lastError).toBe(
          "Manually marked finished to force card advancement.",
        );
        expect(card.operation).toBeNull();
        expect(card.position).toEqual({ kind: "step", stepIndex: 1 });
        expect(card.status).toBe("running");
      }),
    ),
  );

  it.effect("success on last step reaches Done with null status", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        yield* stopCurrentStepSession(harness, card.stepThreads[0]!.threadId);

        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("cmd-step-report-0"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: card.stepThreads[0]!.threadId,
          outcome: "success",
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        yield* stopCurrentStepSession(harness, card.stepThreads[1]!.threadId);

        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("cmd-step-report-1"),
          cardId: harness.cardId,
          stepIndex: 1,
          threadId: card.stepThreads[1]!.threadId,
          outcome: "success",
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.position).toEqual({ kind: "done" });
        expect(card.status).toBeNull();
        expect(card.completedAt).not.toBeNull();
        expect(card.branch).not.toBeNull();
        expect(card.worktreePath).toBe(harness.worktreePath);
      }),
    ),
  );

  /**
   * Replace the flow with one step and release a fresh card through it, so a
   * selector can be exercised end to end without disturbing the shared card.
   */
  const releaseSingleStepCard = (
    harness: BoardHarness,
    input: { readonly tag: string; readonly step: BoardStep },
  ) =>
    Effect.gen(function* () {
      yield* harness.dispatch({
        type: "board.update",
        commandId: CommandId.make(`cmd-board-update-${input.tag}`),
        boardId: harness.boardId,
        name: "Delivery",
        steps: [input.step],
      });
      const cardId = CardId.make(`card-${input.tag}`);
      yield* harness.dispatch({
        type: "card.create",
        commandId: CommandId.make(`cmd-card-create-${input.tag}`),
        cardId,
        boardId: harness.boardId,
        title: `${input.tag} card`,
        parameters: { ticket_id: "T-1" },
      });
      yield* harness.dispatch({
        type: "card.release",
        commandId: CommandId.make(`cmd-card-release-${input.tag}`),
        cardId,
      });
      yield* harness.drain;
      return cardId;
    });

  it.effect(
    "canonical agent step starts its thread on the exact model with provider-native reasoning",
    () =>
      withBoardReactorHarness({}, (harness) =>
        Effect.gen(function* () {
          yield* releaseSingleStepCard(harness, {
            tag: "canonical",
            step: {
              id: BoardStepId.make("step-canonical"),
              name: "Implement",
              promptTemplate: "Do ${ticket_id}",
              agent: {
                instanceId: codexInstanceId,
                model: "gpt-5-codex",
                reasoning: "high",
              },
              continuation: "auto",
            },
          });

          const expectedSelection = {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
            options: [{ id: "reasoningEffort", value: "high" }],
          };

          const events = yield* harness.readEvents;
          const created = events.find((e) => e.type === "thread.created") as
            | {
                payload: {
                  modelSelection: unknown;
                  runtimeMode: string;
                  interactionMode: string;
                };
              }
            | undefined;
          expect(created).toBeDefined();
          expect(created!.payload.modelSelection).toEqual(expectedSelection);
          expect(created!.payload.runtimeMode).toBe("full-access");
          expect(created!.payload.interactionMode).toBe(DEFAULT_PROVIDER_INTERACTION_MODE);

          const turnStart = events.find((e) => e.type === "thread.turn-start-requested") as
            | { payload: { modelSelection: unknown; runtimeMode: string } }
            | undefined;
          expect(turnStart).toBeDefined();
          expect(turnStart!.payload.modelSelection).toEqual(expectedSelection);
          expect(turnStart!.payload.runtimeMode).toBe("full-access");
        }),
      ),
  );

  it.effect("canonical agent step naming a model the instance does not offer fails the card", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        const cardId = yield* releaseSingleStepCard(harness, {
          tag: "unknown-model",
          step: {
            id: BoardStepId.make("step-unknown-model"),
            name: "Implement",
            promptTemplate: "Do ${ticket_id}",
            agent: { instanceId: codexInstanceId, model: "gpt-4o" },
            continuation: "auto",
          },
        });

        const snapshot = yield* harness.readModel;
        const card = snapshot.cards.find((entry) => entry.id === cardId)!;
        expect(card.status).toBe("failed");
        expect(card.stepThreads).toHaveLength(0);
        expect(card.lastError).toContain("gpt-4o");
      }),
    ),
  );

  it.effect("legacy profileName step still resolves through the profile adapter", () =>
    withBoardReactorHarness(
      {
        agentProfiles: {
          reviewer: {
            runtime: "session",
            target: { kind: "instance", instanceId: "codex" },
            model: "gpt-5-codex-mini",
            options: [{ id: "reasoningEffort", value: "low" }],
            runtimeMode: "full-access",
            interactionMode: "default",
          },
        },
      },
      (harness) =>
        Effect.gen(function* () {
          yield* releaseSingleStepCard(harness, {
            tag: "legacy",
            step: {
              id: BoardStepId.make("step-legacy"),
              name: "Review",
              promptTemplate: "Do ${ticket_id}",
              profileName: "reviewer" as BoardStep["profileName"],
              continuation: "auto",
            },
          });

          const events = yield* harness.readEvents;
          const created = events.find((e) => e.type === "thread.created") as
            | { payload: { modelSelection: unknown } }
            | undefined;
          expect(created).toBeDefined();
          // Resolved from settings, not the catalog: a model the provider
          // snapshot does not advertise still launches on the legacy path.
          expect(created!.payload.modelSelection).toEqual({
            instanceId: codexInstanceId,
            model: "gpt-5-codex-mini",
            options: [{ id: "reasoningEffort", value: "low" }],
          });
        }),
    ),
  );

  it.effect("release with missing profile marks the card failed after release.complete", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.dispatch({
          type: "board.update",
          commandId: CommandId.make("cmd-board-update-missing-profile"),
          boardId: harness.boardId,
          name: "Delivery",
          steps: [
            {
              id: BoardStepId.make("step-missing"),
              name: "Broken",
              promptTemplate: "Do ${ticket_id}",
              profileName: "missingProfile" as BoardStep["profileName"],
              continuation: "auto",
            },
          ],
        });

        const badCardId = CardId.make("card-missing-profile");
        yield* harness.dispatch({
          type: "card.create",
          commandId: CommandId.make("cmd-card-create-bad"),
          cardId: badCardId,
          boardId: harness.boardId,
          title: "Bad profile card",
          parameters: { ticket_id: "T-9" },
        });
        yield* harness.dispatch({
          type: "card.release",
          commandId: CommandId.make("cmd-card-release-bad"),
          cardId: badCardId,
        });
        yield* harness.drain;

        const snapshot = yield* harness.readModel;
        const card = snapshot.cards.find((entry) => entry.id === badCardId)!;
        expect(card.releasedAt).not.toBeNull();
        expect(card.branch).not.toBeNull();
        expect(card.status).toBe("failed");
        expect(card.position.kind).toBe("todo");
        expect(card.stepThreads).toHaveLength(0);
      }),
    ),
  );

  it.effect("2-step board runs release → Done with no user interaction (MCP-style reports)", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        for (let stepIndex = 0; stepIndex < STEPS.length; stepIndex += 1) {
          const model = yield* harness.readModel;
          const card = model.cards.find((entry) => entry.id === harness.cardId)!;
          const currentThread = [...card.stepThreads]
            .toReversed()
            .find((entry) => entry.stepIndex === stepIndex);
          expect(currentThread).toBeDefined();
          yield* stopCurrentStepSession(harness, currentThread!.threadId);

          yield* harness.dispatch({
            type: "card.step.report",
            commandId: CommandId.make(`cmd-step-report-${stepIndex}`),
            cardId: harness.cardId,
            stepIndex,
            threadId: currentThread!.threadId,
            outcome: "success",
          });
          yield* harness.drain;
        }

        const finalModel = yield* harness.readModel;
        const done = finalModel.cards.find((entry) => entry.id === harness.cardId)!;
        expect(done.position).toEqual({ kind: "done" });
        expect(done.status).toBeNull();
        expect(done.stepThreads).toHaveLength(2);
        expect(done.snapshot?.steps.map((s) => s.name)).toEqual(["Implement", "Review"]);
      }),
    ),
  );

  it.effect("release failure from git marks the card failed without entering a step", () =>
    withBoardReactorHarness({ createWorktreeFails: true }, (harness) =>
      Effect.gen(function* () {
        yield* harness.dispatch({
          type: "card.release",
          commandId: CommandId.make("cmd-card-release"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const snapshot = yield* harness.readModel;
        const card = snapshot.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).toBe("failed");
        expect(card.releasedAt).toBeNull();
        expect(card.position.kind).toBe("todo");
        expect(card.stepThreads).toHaveLength(0);
      }),
    ),
  );

  it.effect("turn completed without board_complete → needs-input; turn error → failed", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        const afterRelease = yield* harness.readModel;
        const card = afterRelease.cards.find((entry) => entry.id === harness.cardId)!;
        const stepThreadId = card.stepThreads[0]!.threadId;
        expect(card.status).toBe("running");

        yield* harness.sessionSet(stepThreadId, "ready");
        yield* harness.drain;

        let model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.status).toBe(
          "needs-input",
        );
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.position).toEqual({
          kind: "step",
          stepIndex: 0,
        });

        yield* harness.sessionSet(stepThreadId, "running", TurnId.make("turn-1"));
        yield* harness.drain;
        model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.status).toBe("running");

        yield* harness.sessionSet(stepThreadId, "error");
        yield* harness.drain;
        model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.status).toBe("failed");
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.position.kind).toBe(
          "step",
        );
      }),
    ),
  );

  it.effect("pending approval → needs-input; resolved mid-turn → running again", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const stepThreadId = card.stepThreads[0]!.threadId;

        yield* harness.sessionSet(stepThreadId, "running", TurnId.make("turn-approval"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make("cmd-approval-requested"),
          threadId: stepThreadId,
          activity: {
            id: EventId.make("act-approval-req"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: { requestId: "req-1" },
            turnId: TurnId.make("turn-approval"),
            createdAt: NOW,
          },
          createdAt: NOW,
        });
        yield* harness.drain;

        let model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.status).toBe(
          "needs-input",
        );

        yield* harness.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make("cmd-approval-resolved"),
          threadId: stepThreadId,
          activity: {
            id: EventId.make("act-approval-res"),
            tone: "approval",
            kind: "approval.resolved",
            summary: "Command approval resolved",
            payload: { requestId: "req-1" },
            turnId: TurnId.make("turn-approval"),
            createdAt: NOW,
          },
          createdAt: NOW,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)?.status).toBe("running");
      }),
    ),
  );

  it.effect("reset stages on a live turn, then finalizes once the session stops", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        const firstThreadId = card.stepThreads[0]!.threadId;
        const subAgentThreadId = ThreadId.make("thread-reset-subagent");
        const firstWorktreePath = card.worktreePath;
        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.mkdirSync(artifactDir, { recursive: true });
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "old run", "utf8");

        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-reset-subagent"),
          threadId: subAgentThreadId,
          projectId: harness.projectId,
          parentThreadId: firstThreadId,
          title: "Reset sub-agent",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: card.branch,
          worktreePath: card.worktreePath,
          createdAt: NOW,
        });

        // Live provider turn: reset must interrupt and wait before cleanup.
        yield* harness.sessionSet(firstThreadId, "running", TurnId.make("turn-live-reset"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "board.update",
          commandId: CommandId.make("cmd-board-update-before-reset"),
          boardId: harness.boardId,
          name: "Delivery v2",
          steps: [
            {
              ...STEPS[0]!,
              promptTemplate: "Use the updated board model for ${ticket_id}",
            },
          ],
        });

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-card-reset"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        // Durable claim stays put while the old turn may still be running.
        expect(card.operation?.kind).toBe("resetting");
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
        expect(NodeFS.existsSync(artifactDir)).toBe(true);

        const eventsAfterResetRequest = yield* harness.readEvents;
        expect(
          eventsAfterResetRequest.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
          ),
        ).toBe(true);
        expect(
          eventsAfterResetRequest.some(
            (event) => event.type === "thread.archived" && event.aggregateId === firstThreadId,
          ),
        ).toBe(false);

        // Session proves the turn stopped → finalize once.
        yield* harness.sessionSet(firstThreadId, "ready");
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card).toMatchObject({
          status: null,
          operation: null,
          position: { kind: "todo" },
          snapshot: null,
          stepThreads: [],
          releasedAt: null,
          worktreePath: firstWorktreePath,
        });
        expect(NodeFS.existsSync(artifactDir)).toBe(false);

        const eventsAfterFinalize = yield* harness.readEvents;
        expect(
          eventsAfterFinalize
            .filter((event) => event.type === "thread.archived")
            .map((event) => event.aggregateId),
        ).toEqual(expect.arrayContaining([firstThreadId, subAgentThreadId]));

        yield* harness.dispatch({
          type: "card.release",
          commandId: CommandId.make("cmd-card-restart"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).toBe("running");
        expect(card.snapshot).toMatchObject({
          name: "Delivery v2",
          steps: [
            {
              promptTemplate: "Use the updated board model for ${ticket_id}",
            },
          ],
        });
        expect(card.stepThreads).toHaveLength(1);
        expect(card.stepThreads[0]!.threadId).not.toBe(firstThreadId);
        expect(card.worktreePath).toBe(firstWorktreePath);
        expect(harness.createWorktree).toHaveBeenCalledTimes(1);
        const oldThread = model.threads.find((entry) => entry.id === firstThreadId);
        expect(oldThread?.archivedAt).not.toBeNull();

        const stale = yield* harness.dispatchFlip({
          type: "card.step.report",
          commandId: CommandId.make("cmd-stale-report"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: firstThreadId,
          outcome: "success",
        });
        expect(stale._tag).toBe("OrchestrationCommandInvariantError");
      }),
    ),
  );

  it.effect("reset finalizes immediately when the active thread is already stopped", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const firstThreadId = card.stepThreads[0]!.threadId;
        // Release settle left session:starting (live). Stop it so reset finalizes now.
        yield* harness.sessionSet(firstThreadId, "ready");
        yield* harness.drain;

        // No live session → finalize without waiting for another session-set.
        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-card-reset-idle"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const after = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!;
        expect(after).toMatchObject({
          operation: null,
          position: { kind: "todo" },
          snapshot: null,
          stepThreads: [],
        });
        const events = yield* harness.readEvents;
        expect(
          events.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
          ),
        ).toBe(false);
        expect(
          events.some((e) => e.type === "thread.archived" && e.aggregateId === firstThreadId),
        ).toBe(true);
      }),
    ),
  );

  it.effect("a reset card ignores the previous turn's residual signals", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const stepThreadId = card.stepThreads[0]!.threadId;

        // Live turn so reset stages and keeps the claim while residuals stream.
        yield* harness.sessionSet(stepThreadId, "running", TurnId.make("turn-dying"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-stick"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const readCard = () =>
          Effect.map(
            harness.readModel,
            (model) => model.cards.find((entry) => entry.id === harness.cardId)!,
          );

        expect((yield* readCard()).operation?.kind).toBe("resetting");
        expect((yield* readCard()).position).toEqual({
          kind: "step",
          stepIndex: 0,
        });

        // Residual running signals must not recolor the card mid-reset.
        yield* harness.sessionSet(stepThreadId, "running", TurnId.make("turn-dying"));
        yield* harness.drain;
        expect((yield* readCard()).operation?.kind).toBe("resetting");

        // …may surface a blocking request before the interrupt lands…
        yield* harness.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make("cmd-reset-approval"),
          threadId: stepThreadId,
          activity: {
            id: EventId.make("act-reset-approval"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Command approval requested",
            payload: { requestId: "req-resetting" },
            turnId: TurnId.make("turn-dying"),
            createdAt: NOW,
          },
          createdAt: NOW,
        });
        yield* harness.drain;
        expect((yield* readCard()).status).not.toBe("needs-input");
        expect((yield* readCard()).operation?.kind).toBe("resetting");

        // Turn settles → reset finalizes to To-Do.
        yield* harness.sessionSet(stepThreadId, "error");
        yield* harness.drain;
        const settled = yield* readCard();
        expect(settled.operation).toBeNull();
        expect(settled.position).toEqual({ kind: "todo" });
        expect(settled.status).toBeNull();

        // The dying turn cannot report the step done and advance the card.
        const report = yield* harness.dispatchFlip({
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-reset"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: stepThreadId,
          outcome: "success",
        });
        expect(report._tag).toBe("OrchestrationCommandInvariantError");
      }),
    ),
  );

  it.effect(
    "retry on a ready session archives the old thread and re-enters without interrupt",
    () =>
      withBoardReactorHarness({}, (harness) =>
        Effect.gen(function* () {
          yield* harness.releaseCard;
          const afterRelease = yield* harness.readModel;
          const firstThreadId = afterRelease.cards.find((entry) => entry.id === harness.cardId)!
            .stepThreads[0]!.threadId;

          // Turn completed without board_complete → needs-input (session ready).
          yield* harness.sessionSet(firstThreadId, "ready");
          yield* harness.drain;
          expect(
            (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
          ).toBe("needs-input");

          yield* harness.dispatch({
            type: "card.retry",
            commandId: CommandId.make("cmd-retry-needs-input"),
            cardId: harness.cardId,
          });
          yield* harness.drain;

          const model = yield* harness.readModel;
          const card = model.cards.find((entry) => entry.id === harness.cardId)!;
          expect(card.status).toBe("running");
          expect(card.operation).toBeNull();
          expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
          const current = [...card.stepThreads].toReversed().find((e) => e.stepIndex === 0)!;
          expect(current.threadId).not.toBe(firstThreadId);

          const events = yield* harness.readEvents;
          // Already ready → no interrupt staging required.
          expect(
            events.some(
              (e) =>
                e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
            ),
          ).toBe(false);
          expect(
            events.some((e) => e.type === "thread.archived" && e.aggregateId === firstThreadId),
          ).toBe(true);
          expect(model.threads.find((t) => t.id === firstThreadId)?.archivedAt).not.toBeNull();
        }),
      ),
  );

  it.effect("retry stages interrupt while the old turn is live, then finalizes once ready", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const firstThreadId = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!.stepThreads[0]!.threadId;

        // Residual live provider session, then mark the card continuable.
        // (Session-running after failed would re-engage the card to running.)
        yield* harness.sessionSet(firstThreadId, "running", TurnId.make("turn-residual"));
        yield* harness.drain;
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-retry-mark-failed"),
          cardId: harness.cardId,
          status: "failed",
        });

        yield* harness.dispatch({
          type: "card.retry",
          commandId: CommandId.make("cmd-retry-live"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("retrying");
        expect(card.stepThreads.some((entry) => entry.threadId === firstThreadId)).toBe(true);

        const eventsAfterRequest = yield* harness.readEvents;
        expect(
          eventsAfterRequest.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
          ),
        ).toBe(true);
        expect(
          eventsAfterRequest.some(
            (e) => e.type === "thread.archived" && e.aggregateId === firstThreadId,
          ),
        ).toBe(false);

        yield* harness.sessionSet(firstThreadId, "ready");
        yield* harness.drain;

        const model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.status).toBe("running");
        const current = [...card.stepThreads].toReversed().find((e) => e.stepIndex === 0)!;
        expect(current.threadId).not.toBe(firstThreadId);
        expect(model.threads.find((t) => t.id === firstThreadId)?.archivedAt).not.toBeNull();
      }),
    ),
  );

  it.effect("provider interrupt failure fails a staged reset with a persisted reason", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const firstThreadId = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!.stepThreads[0]!.threadId;

        yield* harness.sessionSet(firstThreadId, "running", TurnId.make("turn-interrupt-fail"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-interrupt-fail"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.operation
            ?.kind,
        ).toBe("resetting");

        yield* harness.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make("cmd-interrupt-failed-activity"),
          threadId: firstThreadId,
          activity: {
            id: EventId.make("act-interrupt-failed"),
            tone: "error",
            kind: "provider.turn.interrupt.failed",
            summary: "Provider turn interrupt failed",
            payload: { detail: "provider refused interrupt" },
            turnId: TurnId.make("turn-interrupt-fail"),
            createdAt: NOW,
          },
          createdAt: NOW,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.lastError).toContain("provider refused interrupt");
        // Position/status preserved so the user can recover in place.
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
        expect(
          (yield* harness.readEvents).some(
            (e) => e.type === "thread.archived" && e.aggregateId === firstThreadId,
          ),
        ).toBe(false);
      }),
    ),
  );

  it.effect("retry resumes when the old lineage root is already archived", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const firstThreadId = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!.stepThreads[0]!.threadId;

        yield* harness.sessionSet(firstThreadId, "ready");
        yield* harness.drain;

        // Partial cleanup from a prior attempt: root already archived.
        yield* harness.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("cmd-pre-archive-retry"),
          threadId: firstThreadId,
        });

        yield* harness.dispatch({
          type: "card.retry",
          commandId: CommandId.make("cmd-retry-resume-archived"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const model = yield* harness.readModel;
        const card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.status).toBe("running");
        const step0 = [...card.stepThreads].toReversed().find((e) => e.stepIndex === 0)!;
        expect(step0.threadId).not.toBe(firstThreadId);
        expect(model.threads.find((t) => t.id === firstThreadId)?.archivedAt).not.toBeNull();
      }),
    ),
  );

  it.effect("reset fails the claimed operation when artifact cleanup fails", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const firstThreadId = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!.stepThreads[0]!.threadId;
        // Stop the step session so finalize runs and hits artifact cleanup.
        yield* harness.sessionSet(firstThreadId, "ready");
        yield* harness.drain;

        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.mkdirSync(artifactDir, { recursive: true });
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "partial", "utf8");
        // Remove write permission so recursive delete of contents fails.
        NodeFS.chmodSync(artifactDir, 0o555);

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-artifact-fail"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        // Always restore permissions so the harness can clean up.
        NodeFS.chmodSync(artifactDir, 0o755);

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toMatchObject({
          kind: "resetting",
          operationId: "cmd-reset-artifact-fail",
          cleanupStage: "threads-archived",
        });
        expect(card.lastError).toMatch(/artifact/i);
        // Did not complete to To-Do.
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
        expect(card.snapshot).not.toBeNull();
        expect(
          (yield* harness.readEvents).some(
            (e) => e.type === "card.reset" && e.aggregateId === harness.cardId,
          ),
        ).toBe(false);
        // Threads were archived before artifact failure — cleanup is partial
        // but the claim is failed and visible for recovery.
        expect(
          (yield* harness.readModel).threads.find((t) => t.id === firstThreadId)?.archivedAt,
        ).not.toBeNull();

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-artifact-retry"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.position).toEqual({ kind: "todo" });
        expect(card.lastError).toBeNull();
        expect(NodeFS.existsSync(artifactDir)).toBe(false);
      }),
    ),
  );

  it.effect("chat-to-resume: user turn on needs-input then board_complete advances", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const stepThreadId = card.stepThreads[0]!.threadId;

        yield* harness.sessionSet(stepThreadId, "ready");
        yield* harness.drain;
        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("needs-input");

        yield* harness.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-user-resume"),
          threadId: stepThreadId,
          message: {
            messageId: MessageId.make("msg-resume"),
            role: "user",
            text: "the failure is unrelated, proceed",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: NOW,
        });
        yield* harness.drain;

        expect(
          (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)?.status,
        ).toBe("running");

        // Session still ready from above → advance will not wait on interrupt.
        yield* harness.dispatch({
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-after-resume"),
          cardId: harness.cardId,
          stepIndex: 0,
          threadId: stepThreadId,
          outcome: "success",
        });
        yield* harness.drain;

        const advanced = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!;
        expect(advanced.position).toEqual({ kind: "step", stepIndex: 1 });
        expect(advanced.status).toBe("running");
      }),
    ),
  );

  it.effect("enterStep reuses the claimed thread after restart past thread.create", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        // Pre-create the stable step thread the release claim will allocate.
        const releaseCommandId = CommandId.make("cmd-release-stable-thread");
        const claimedThreadId = boardOperationThreadId(releaseCommandId);
        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-precreate-step-thread"),
          threadId: claimedThreadId,
          projectId: harness.projectId,
          parentThreadId: null,
          title: "pre-created step",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });

        yield* harness.dispatch({
          type: "card.release",
          commandId: releaseCommandId,
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const model = yield* harness.readModel;
        const card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.stepThreads).toHaveLength(1);
        expect(card.stepThreads[0]!.threadId).toBe(claimedThreadId);
        // Only the pre-created thread for this claim — no second spawn.
        const stepThreads = model.threads.filter((t) => t.id === claimedThreadId);
        expect(stepThreads).toHaveLength(1);
        const turnStarts = (yield* harness.readEvents).filter(
          (e) => e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
        );
        expect(turnStarts.length).toBe(1);
      }),
    ),
  );

  it.effect("enterStep skips turn.start when session is already starting/running", () =>
    withBoardReactorHarness({ autoSettleStepEntryReceipts: false }, (harness) =>
      Effect.gen(function* () {
        const releaseCommandId = CommandId.make("cmd-release-session-running");
        const claimedThreadId = boardOperationThreadId(releaseCommandId);
        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-precreate-running"),
          threadId: claimedThreadId,
          projectId: harness.projectId,
          parentThreadId: null,
          title: "pre-created running",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(claimedThreadId, "starting", TurnId.make("turn-pre"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.release",
          commandId: releaseCommandId,
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.stepThreads[0]!.threadId).toBe(claimedThreadId);
        expect(card.status).toBe("running");
        expect(card.operation).toBeNull();
        const turnStarts = (yield* harness.readEvents).filter(
          (e) => e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
        );
        expect(turnStarts.length).toBe(0);
      }),
    ),
  );

  it.effect("enterStep links a terminal session without replaying the prompt", () =>
    withBoardReactorHarness({ autoSettleStepEntryReceipts: false }, (harness) =>
      Effect.gen(function* () {
        const releaseCommandId = CommandId.make("cmd-release-terminal-session");
        const claimedThreadId = boardOperationThreadId(releaseCommandId);
        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-precreate-ready"),
          threadId: claimedThreadId,
          projectId: harness.projectId,
          parentThreadId: null,
          title: "pre-created ready",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(claimedThreadId, "ready");
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.release",
          commandId: releaseCommandId,
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.stepThreads[0]!.threadId).toBe(claimedThreadId);
        expect(card.operation).toBeNull();
        expect(card.status).toBe("needs-input");
        const turnStarts = (yield* harness.readEvents).filter(
          (e) => e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
        );
        expect(turnStarts.length).toBe(0);
      }),
    ),
  );

  it.effect(
    "restart process re-requests turn once with stable message id then converges on session",
    () =>
      Effect.gen(function* () {
        const baseDir = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "aqqua-board-reactor-restart-"),
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            NodeFS.rmSync(baseDir, { recursive: true, force: true });
          }),
        );

        const workspaceRoot = NodePath.join(baseDir, "workspace");
        const worktreePath = NodePath.join(workspaceRoot, ".worktrees", "board-card");
        NodeFS.mkdirSync(worktreePath, { recursive: true });

        const createWorktree = vi.fn(
          (input: { readonly newRefName?: string | undefined; readonly refName: string }) =>
            Effect.succeed({
              worktree: {
                path: worktreePath,
                refName: input.newRefName ?? input.refName,
              },
            }),
        );
        const listRefs = vi.fn(() =>
          Effect.succeed({
            refs: [
              {
                name: "main",
                isRemote: false,
                isDefault: true,
                current: true,
                worktreePath: null,
              },
            ],
            isRepo: true,
            hasPrimaryRemote: false,
            nextCursor: null,
            totalCount: 1,
          }),
        );
        const gitLayer = Layer.mock(GitWorkflowService)({
          createWorktree,
          listRefs,
          removeWorktree: () => Effect.void,
          inspectWorktreeRemoval: () =>
            Effect.succeed({
              availability: "available" as const,
              refName: "board/test",
              headCommit: "abc123",
              baseRef: "main",
              mergeStatus: "unmerged" as const,
              workingTreeStatus: "clean" as const,
            }),
        } satisfies Partial<GitWorkflowService["Service"]>);

        const registryStub = Layer.succeed(ProviderAdapterRegistry, {
          getByInstance: () => Effect.die("unused"),
          getInstanceInfo: (instanceId: ProviderInstanceId) =>
            Effect.succeed({
              instanceId,
              driverKind: ProviderDriverKind.make("codex"),
              displayName: "Codex",
              enabled: true,
              continuationIdentity: { kind: "instance", instanceId },
            }),
          listInstances: () => Effect.succeed([codexInstanceId]),
          listProviders: () => Effect.succeed([ProviderDriverKind.make("codex")]),
          streamChanges: Stream.empty,
          subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
        } as unknown as typeof ProviderAdapterRegistry.Service);

        const textGenerationLayer = Layer.succeed(TextGeneration, {
          generateCommitMessage: () => Effect.die("unused"),
          generatePrContent: () => Effect.die("unused"),
          generateBranchName: () => Effect.die("unused"),
          generateThreadTitle: () => Effect.succeed({ title: "" }),
        } as unknown as typeof TextGeneration.Service);

        const setupScriptRunnerStub = Layer.succeed(
          ProjectSetupScriptRunner,
          ProjectSetupScriptRunner.of({
            runForThread: () => Effect.succeed({ status: "no-script" as const }),
          }),
        );

        // Shared on-disk DB so process 2 rehydrates process 1's projections.
        const persistenceLayer = makeSqlitePersistenceLive(
          NodePath.join(baseDir, "userdata", "state.sqlite"),
        );

        const makeProcessLayer = () => {
          const orchestrationLayer = OrchestrationEngineLive.pipe(
            Layer.provide(OrchestrationProjectionSnapshotQueryLive),
            Layer.provide(OrchestrationProjectionPipelineLive),
            Layer.provide(OrchestrationEventStoreLive),
            Layer.provide(OrchestrationCommandReceiptRepositoryLive),
            Layer.provide(RepositoryIdentityResolver.layer),
            Layer.provide(persistenceLayer),
          );
          const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
            Layer.provide(RepositoryIdentityResolver.layer),
            Layer.provide(persistenceLayer),
          );
          return BoardReactorLive.pipe(
            Layer.provideMerge(orchestrationLayer),
            Layer.provideMerge(projectionSnapshotLayer),
            Layer.provideMerge(gitLayer),
            Layer.provideMerge(registryStub),
            Layer.provideMerge(providerRegistryStub),
            Layer.provideMerge(textGenerationLayer),
            Layer.provideMerge(setupScriptRunnerStub),
            Layer.provideMerge(WorktreePathCoordinationLive),
            Layer.provideMerge(
              serverSettingsLayerTest({
                agentProfiles: {} as never,
                textGenerationModelSelection: {
                  instanceId: codexInstanceId,
                  model: "gpt-5-codex",
                },
              }),
            ),
            // Explicit baseDir so both processes share the same state tree.
            Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provideMerge(NodeServices.layer),
          );
        };

        const projectId = asProjectId("project-1");
        const boardId = BoardId.make("board-1");
        const cardId = CardId.make("card-board-1");
        const releaseCommandId = CommandId.make("cmd-release-turn-start-gap");
        const claimedThreadId = boardOperationThreadId(releaseCommandId);
        const claimedMessageId = boardOperationMessageId(releaseCommandId);

        // ── Process 1: accept turn.start, crash before session receipt ──
        yield* Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* OrchestrationEngineService;
            const reactor = yield* BoardReactor;
            const snapshotQuery = yield* ProjectionSnapshotQuery;
            yield* reactor.start();
            yield* Effect.yieldNow;

            const dispatch = (command: Parameters<OrchestrationEngineShape["dispatch"]>[0]) =>
              engine.dispatch(command).pipe(Effect.asVoid, Effect.orDie);

            yield* dispatch({
              type: "project.create",
              commandId: CommandId.make("cmd-project-create"),
              projectId,
              title: "Board Project",
              workspaceRoot,
              defaultModelSelection: {
                instanceId: codexInstanceId,
                model: "gpt-5-codex",
              },
              createdAt: NOW,
            });
            yield* dispatch({
              type: "board.create",
              commandId: CommandId.make("cmd-board-create"),
              boardId,
              projectId,
              name: "Delivery",
              steps: STEPS,
            });
            yield* dispatch({
              type: "card.create",
              commandId: CommandId.make("cmd-card-create"),
              cardId,
              boardId,
              title: "Fix flaky test",
              parameters: { ticket_id: "aqqua-482" },
            });
            yield* dispatch({
              type: "card.release",
              commandId: releaseCommandId,
              cardId,
            });
            yield* reactor.drain;

            const card = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).cards.find(
              (entry) => entry.id === cardId,
            )!;
            expect(card.operation?.kind).toBe("starting");
            expect(card.stepThreads).toHaveLength(0);
            expect(card.branch).not.toBeNull();

            const events = yield* Stream.runCollect(engine.readEvents(0)).pipe(
              Effect.map((chunk) => Array.from(chunk)),
              Effect.orDie,
            );
            const turnStarts = events.filter(
              (e) => e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
            );
            expect(turnStarts).toHaveLength(1);
            expect(
              turnStarts[0] &&
                turnStarts[0].type === "thread.turn-start-requested" &&
                turnStarts[0].payload.messageId,
            ).toBe(claimedMessageId);
            expect(events.some((e) => e.type === "card.step-entered")).toBe(false);

            const messages = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).threads.find(
              (t) => t.id === claimedThreadId,
            )?.messages;
            expect(messages?.filter((m) => m.role === "user")).toHaveLength(1);
            expect(messages?.[0]?.id).toBe(claimedMessageId);
          }).pipe(Effect.provide(makeProcessLayer()), Effect.orDie),
        );

        // ── Process 2: fresh reactor/guard over same DB; reconcile re-requests ──
        yield* Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* OrchestrationEngineService;
            const reactor = yield* BoardReactor;
            const snapshotQuery = yield* ProjectionSnapshotQuery;
            yield* reactor.start();
            yield* Effect.yieldNow;
            // Reconcile pending starting claim (subscribe-then-reconcile).
            yield* reactor.drain;

            const events = yield* Stream.runCollect(engine.readEvents(0)).pipe(
              Effect.map((chunk) => Array.from(chunk)),
              Effect.orDie,
            );
            const turnStarts = events.filter(
              (e) => e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
            );
            // Original process event + exactly one replacement in the new process.
            expect(turnStarts.length).toBe(2);
            for (const start of turnStarts) {
              if (start.type === "thread.turn-start-requested") {
                expect(start.payload.messageId).toBe(claimedMessageId);
              }
            }
            // Distinct command ids so receipt dedupe cannot suppress the restart event.
            const commandIds = new Set(
              turnStarts.map((e) => ("commandId" in e ? String(e.commandId) : "")),
            );
            expect(commandIds.size).toBe(2);

            let card = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).cards.find(
              (entry) => entry.id === cardId,
            )!;
            expect(card.operation?.kind).toBe("starting");
            expect(card.stepThreads).toHaveLength(0);

            // Stable prompt: still one user message after replacement turn.start.
            const thread = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).threads.find(
              (t) => t.id === claimedThreadId,
            );
            const userMessages = thread?.messages.filter((m) => m.role === "user") ?? [];
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0]?.id).toBe(claimedMessageId);

            // Session receipt → single step thread, claim cleared.
            yield* engine
              .dispatch({
                type: "thread.session.set",
                commandId: CommandId.make("cmd-session-after-restart"),
                threadId: claimedThreadId,
                session: {
                  threadId: claimedThreadId,
                  status: "starting",
                  providerName: "codex",
                  providerInstanceId: codexInstanceId,
                  runtimeMode: "full-access",
                  activeTurnId: TurnId.make("turn-after-restart"),
                  lastError: null,
                  updatedAt: NOW,
                },
                createdAt: NOW,
              })
              .pipe(Effect.orDie);
            yield* reactor.drain;

            card = (yield* snapshotQuery.getSnapshot().pipe(Effect.orDie)).cards.find(
              (entry) => entry.id === cardId,
            )!;
            expect(card.operation).toBeNull();
            expect(card.stepThreads).toHaveLength(1);
            expect(card.stepThreads[0]!.threadId).toBe(claimedThreadId);
            expect(card.status).toBe("running");
            // No additional turn-start on session receipt.
            expect(
              (yield* Stream.runCollect(engine.readEvents(0)).pipe(
                Effect.map((chunk) => Array.from(chunk)),
                Effect.orDie,
              )).filter(
                (e) =>
                  e.type === "thread.turn-start-requested" && e.aggregateId === claimedThreadId,
              ),
            ).toHaveLength(2);
          }).pipe(Effect.provide(makeProcessLayer()), Effect.orDie),
        );
      }),
  );

  it.effect("continue interrupts a live sub-agent before entering the next step", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        const step0 = card.stepThreads[0]!.threadId;
        const childId = ThreadId.make("thread-advance-child");

        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-advance-child"),
          threadId: childId,
          projectId: harness.projectId,
          parentThreadId: step0,
          title: "sub-agent",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: card.branch,
          worktreePath: card.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(step0, "ready");
        yield* harness.sessionSet(childId, "running", TurnId.make("turn-child-advance"));
        yield* harness.drain;

        // Mark continuable without clearing the live child.
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-mark-paused-for-continue"),
          cardId: harness.cardId,
          status: "paused",
        });

        yield* harness.dispatch({
          type: "card.continue",
          commandId: CommandId.make("cmd-continue-with-child"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("advancing");
        // Still on step 0 until the child stops.
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });

        const events = yield* harness.readEvents;
        expect(
          events.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === childId,
          ),
        ).toBe(true);

        yield* harness.sessionSet(childId, "ready");
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.position).toEqual({ kind: "step", stepIndex: 1 });
        expect(card.status).toBe("running");
      }),
    ),
  );

  it.effect("retry interrupts a live sub-agent lineage before re-entry", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const step0 = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!
          .stepThreads[0]!.threadId;
        const childId = ThreadId.make("thread-retry-child");

        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-retry-child"),
          threadId: childId,
          projectId: harness.projectId,
          parentThreadId: step0,
          title: "retry child",
          modelSelection: { instanceId: codexInstanceId, model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(step0, "running", TurnId.make("turn-root"));
        yield* harness.sessionSet(childId, "running", TurnId.make("turn-child"));
        yield* harness.drain;
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-retry-mark-failed-child"),
          cardId: harness.cardId,
          status: "failed",
        });

        yield* harness.dispatch({
          type: "card.retry",
          commandId: CommandId.make("cmd-retry-lineage"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("retrying");

        const events = yield* harness.readEvents;
        expect(
          events.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === step0,
          ),
        ).toBe(true);
        expect(
          events.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === childId,
          ),
        ).toBe(true);

        yield* harness.sessionSet(step0, "ready");
        yield* harness.drain;
        // Child still live — must not finalize.
        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("retrying");

        yield* harness.sessionSet(childId, "ready");
        yield* harness.drain;

        const model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.status).toBe("running");
        const fresh = [...card.stepThreads].toReversed().find((e) => e.stepIndex === 0)!;
        expect(fresh.threadId).not.toBe(step0);
        expect(model.threads.find((t) => t.id === step0)?.archivedAt).not.toBeNull();
        expect(model.threads.find((t) => t.id === childId)?.archivedAt).not.toBeNull();
      }),
    ),
  );

  it.effect("reset interrupts sub-agents and finalizes once the whole lineage stops", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const step0 = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!
          .stepThreads[0]!.threadId;
        const childId = ThreadId.make("thread-reset-child");

        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-reset-child"),
          threadId: childId,
          projectId: harness.projectId,
          parentThreadId: step0,
          title: "reset child",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });
        yield* harness.sessionSet(step0, "running", TurnId.make("turn-reset-root"));
        yield* harness.sessionSet(childId, "running", TurnId.make("turn-reset-child"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-lineage"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("resetting");
        expect(card.position.kind).toBe("step");

        yield* harness.sessionSet(step0, "ready");
        yield* harness.drain;
        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("resetting");

        yield* harness.sessionSet(childId, "ready");
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.position).toEqual({ kind: "todo" });
        expect(card.snapshot).toBeNull();
      }),
    ),
  );

  it.effect("partial reset resume skips already-archived roots and finishes cleanup", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const step0 = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!
          .stepThreads[0]!.threadId;
        const childId = ThreadId.make("thread-partial-reset-child");

        yield* harness.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-partial-child"),
          threadId: childId,
          projectId: harness.projectId,
          parentThreadId: step0,
          title: "partial child",
          modelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: harness.worktreePath,
          createdAt: NOW,
        });

        // Root is no longer live (and already archived); only the child still runs.
        yield* harness.sessionSet(step0, "ready");
        yield* harness.drain;
        yield* harness.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("cmd-pre-archive-root"),
          threadId: step0,
        });
        yield* harness.sessionSet(childId, "running", TurnId.make("turn-partial-child"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-partial"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation?.kind).toBe("resetting");

        yield* harness.sessionSet(childId, "ready");
        yield* harness.drain;

        const model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.position).toEqual({ kind: "todo" });
        expect(model.threads.find((t) => t.id === step0)?.archivedAt).not.toBeNull();
        expect(model.threads.find((t) => t.id === childId)?.archivedAt).not.toBeNull();
      }),
    ),
  );

  it.effect("unexpected handler failure clears the matching durable claim", () =>
    withBoardReactorHarness({ createWorktreeThrows: true }, (harness) =>
      Effect.gen(function* () {
        yield* harness.dispatch({
          type: "card.release",
          commandId: CommandId.make("cmd-release-handler-boom"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.operation).toBeNull();
        expect(card.lastError).toEqual(expect.stringMatching(/createWorktree boom|handler/i));
        // Starting failures also mark agent status failed.
        expect(card.status).toBe("failed");
      }),
    ),
  );

  it.effect(
    "session-set handler defect fails the matching step-entry claim and persists lastError",
    () =>
      withBoardReactorHarness(
        {
          autoSettleStepEntryReceipts: false,
          injectHandlerFailureOnEventTypes: ["thread.session-set"],
        },
        (harness) =>
          Effect.gen(function* () {
            const releaseCommandId = CommandId.make("cmd-release-session-defect");
            const claimedThreadId = boardOperationThreadId(releaseCommandId);

            yield* harness.dispatch({
              type: "card.release",
              commandId: releaseCommandId,
              cardId: harness.cardId,
            });
            yield* harness.drain;

            let card = (yield* harness.readModel).cards.find(
              (entry) => entry.id === harness.cardId,
            )!;
            expect(card.operation?.kind).toBe("starting");

            // Receipt would complete enterStep, but the handler is injected to fail.
            yield* harness.sessionSet(claimedThreadId, "starting", TurnId.make("turn-defect"));
            yield* harness.drain;

            card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
            expect(card.operation).toBeNull();
            expect(card.lastError).toMatch(/injected board reactor handler defect/i);
            expect(card.status).toBe("failed");
          }),
      ),
  );

  it.effect(
    "session-set handler defect fails a staged reset lineage claim; ignores idle cards",
    () =>
      withBoardReactorHarness(
        {
          // Defer so release + lineage seed session receipts can complete first.
          injectHandlerFailureOnEventTypes: ["thread.session-set"],
          injectHandlerFailureDeferred: true,
        },
        (harness) =>
          Effect.gen(function* () {
            yield* harness.releaseCard;
            const step0 = (yield* harness.readModel).cards.find(
              (entry) => entry.id === harness.cardId,
            )!.stepThreads[0]!.threadId;
            const childId = ThreadId.make("thread-reset-defect-child");

            // Idle card that shares no claim — must not be failed.
            const idleCardId = CardId.make("card-idle-other");
            yield* harness.dispatch({
              type: "card.create",
              commandId: CommandId.make("cmd-create-idle"),
              cardId: idleCardId,
              boardId: harness.boardId,
              title: "Idle",
              parameters: { ticket_id: "IDLE" },
            });

            yield* harness.dispatch({
              type: "thread.create",
              commandId: CommandId.make("cmd-create-defect-child"),
              threadId: childId,
              projectId: harness.projectId,
              parentThreadId: step0,
              title: "child",
              modelSelection: {
                instanceId: codexInstanceId,
                model: "gpt-5-codex",
              },
              runtimeMode: "full-access",
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: harness.worktreePath,
              createdAt: NOW,
            });
            yield* harness.sessionSet(step0, "running", TurnId.make("turn-root-live"));
            yield* harness.sessionSet(childId, "running", TurnId.make("turn-child-live"));
            yield* harness.drain;

            yield* harness.dispatch({
              type: "card.reset",
              commandId: CommandId.make("cmd-reset-lineage-defect"),
              cardId: harness.cardId,
            });
            yield* harness.drain;

            let card = (yield* harness.readModel).cards.find(
              (entry) => entry.id === harness.cardId,
            )!;
            expect(card.operation?.kind).toBe("resetting");

            // Finalization receipt defects → clear the still-matching reset claim.
            harness.enableHandlerDefectInjection();
            yield* harness.sessionSet(childId, "ready");
            yield* harness.drain;

            card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
            expect(card.operation).toBeNull();
            expect(card.lastError).toMatch(/injected board reactor handler defect/i);
            // Reset is not a starting claim — status is preserved (still running/step).
            expect(card.position.kind).toBe("step");

            const idle = (yield* harness.readModel).cards.find((entry) => entry.id === idleCardId)!;
            expect(idle.operation).toBeNull();
            expect(idle.lastError).toBeNull();
            expect(idle.status).toBeNull();
          }),
      ),
  );

  it.effect(
    "session-set handler defect does not clear a newer unrelated claim on another card",
    () =>
      withBoardReactorHarness(
        {
          autoSettleStepEntryReceipts: false,
          injectHandlerFailureOnEventTypes: ["thread.session-set"],
        },
        (harness) =>
          Effect.gen(function* () {
            const releaseA = CommandId.make("cmd-release-a-defect");
            const threadA = boardOperationThreadId(releaseA);
            yield* harness.dispatch({
              type: "card.release",
              commandId: releaseA,
              cardId: harness.cardId,
            });
            yield* harness.drain;

            // Second card with its own starting claim (not owning thread A).
            const otherCardId = CardId.make("card-other-starting");
            const releaseB = CommandId.make("cmd-release-b-other");
            yield* harness.dispatch({
              type: "card.create",
              commandId: CommandId.make("cmd-create-other"),
              cardId: otherCardId,
              boardId: harness.boardId,
              title: "Other",
              parameters: { ticket_id: "OTHER" },
            });
            yield* harness.dispatch({
              type: "card.release",
              commandId: releaseB,
              cardId: otherCardId,
            });
            yield* harness.drain;

            let other = (yield* harness.readModel).cards.find((e) => e.id === otherCardId)!;
            expect(other.operation?.kind).toBe("starting");
            expect(other.operation?.operationId).toBe(String(releaseB));

            // Defect on thread A's session receipt — only card A fails.
            yield* harness.sessionSet(threadA, "starting", TurnId.make("turn-a"));
            yield* harness.drain;

            const cardA = (yield* harness.readModel).cards.find(
              (entry) => entry.id === harness.cardId,
            )!;
            expect(cardA.operation).toBeNull();
            expect(cardA.lastError).toMatch(/injected board reactor handler defect/i);

            other = (yield* harness.readModel).cards.find((e) => e.id === otherCardId)!;
            expect(other.operation?.kind).toBe("starting");
            expect(other.operation?.operationId).toBe(String(releaseB));
            expect(other.lastError).toBeNull();
          }),
      ),
  );

  it.effect("settle keeps card resources; archive deletes worktree + artifact dir", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.mkdirSync(artifactDir, { recursive: true });
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "# implement\n", "utf8");

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        for (let stepIndex = 0; stepIndex < STEPS.length; stepIndex += 1) {
          model = yield* harness.readModel;
          card = model.cards.find((entry) => entry.id === harness.cardId)!;
          const currentThread = [...card.stepThreads]
            .toReversed()
            .find((entry) => entry.stepIndex === stepIndex)!;
          yield* stopCurrentStepSession(harness, currentThread.threadId);
          yield* harness.dispatch({
            type: "card.step.report",
            commandId: CommandId.make(`cmd-done-report-${stepIndex}`),
            cardId: harness.cardId,
            stepIndex,
            threadId: currentThread.threadId,
            outcome: "success",
          });
          yield* harness.drain;
        }

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.position).toEqual({ kind: "done" });
        expect(card.worktreePath).toBe(harness.worktreePath);
        expect(NodeFS.existsSync(NodePath.join(artifactDir, "Implement.md"))).toBe(true);
        expect(harness.removeWorktree).not.toHaveBeenCalled();
        expect(card.stepThreads).toHaveLength(2);
        expect(model.threads.some((t) => t.id === card.stepThreads[0]!.threadId)).toBe(true);

        yield* harness.dispatch({
          type: "card.settle",
          commandId: CommandId.make("cmd-card-settle"),
          cardId: harness.cardId,
        });
        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.settledAt).not.toBeNull();
        expect(harness.removeWorktree).not.toHaveBeenCalled();
        expect(NodeFS.existsSync(NodePath.join(artifactDir, "Implement.md"))).toBe(true);

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-card-archive"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.archivedAt).not.toBeNull();
        expect(card.operation).toBeNull();
        expect(card.branch).toBe("board/fix-flaky-test-rdboard1");
        expect(harness.removeWorktree).toHaveBeenCalled();
        expect(harness.removeWorktree).toHaveBeenCalledWith(
          expect.not.objectContaining({ deleteBranch: true }),
        );
        expect(NodeFS.existsSync(artifactDir)).toBe(false);

        const lifecycleEvents = (yield* harness.readEvents).filter(
          (event) =>
            event.aggregateId === harness.cardId &&
            (event.type === "card.delete-requested" ||
              event.type === "card.cleanup-progressed" ||
              event.type === "card.archived"),
        );
        expect(lifecycleEvents.at(-1)?.type).toBe("card.archived");
        expect(
          lifecycleEvents.some(
            (event) =>
              event.type === "card.cleanup-progressed" &&
              (event.payload as { stage?: string }).stage === "artifacts-removed",
          ),
        ).toBe(true);
      }),
    ),
  );

  it.effect("archive can preserve the worktree while archiving every card conversation", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* completeAndSettleCard(harness);
        const before = yield* harness.readModel;
        const cardBefore = before.cards.find((entry) => entry.id === harness.cardId)!;
        const ownedThreadIds = cardBefore.stepThreads.map((entry) => entry.threadId);
        const liveOwnedThreadId = ownedThreadIds[0]!;
        yield* harness.sessionSet(liveOwnedThreadId, "running", TurnId.make("turn-archive-live"));
        yield* harness.drain;

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-card-archive-keep-worktree"),
          cardId: harness.cardId,
          deleteWorktree: false,
        });
        yield* harness.drain;

        const after = yield* harness.readModel;
        const cardAfter = after.cards.find((entry) => entry.id === harness.cardId)!;
        expect(cardAfter).toMatchObject({
          archivedAt: expect.any(String),
          operation: null,
          worktreePath: harness.worktreePath,
        });
        expect(harness.removeWorktree).not.toHaveBeenCalled();
        for (const threadId of ownedThreadIds) {
          expect(after.threads.find((thread) => thread.id === threadId)?.archivedAt).not.toBeNull();
        }
        expect(
          (yield* harness.readEvents).some(
            (event) =>
              event.type === "thread.session-stop-requested" &&
              event.aggregateId === liveOwnedThreadId,
          ),
        ).toBe(true);
      }),
    ),
  );

  it.effect("archive worktree failure stays visible and resumes the same cleanup claim", () =>
    withBoardReactorHarness({ removeWorktreeFails: true }, (harness) =>
      Effect.gen(function* () {
        yield* completeAndSettleCard(harness);
        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "partial", "utf8");

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-worktree-failure"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card).toMatchObject({
          archivedAt: null,
          settledAt: expect.any(String),
          operation: {
            kind: "deleting",
            operationId: "cmd-archive-worktree-failure",
            purpose: "archive",
            cleanupStage: "conversations-archived",
          },
        });
        expect(card.lastError).toMatch(/Archive failed/i);
        expect(NodeFS.existsSync(artifactDir)).toBe(true);
        const deletedConversationCount = (yield* harness.readEvents).filter(
          (event) => event.type === "thread.deleted",
        ).length;

        harness.removeWorktree.mockImplementation(() => Effect.void);
        yield* harness.dispatch({
          type: "card.delete",
          commandId: CommandId.make("cmd-archive-worktree-retry"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.archivedAt).not.toBeNull();
        expect(card.operation).toBeNull();
        expect(card.lastError).toBeNull();
        expect(
          (yield* harness.readEvents).filter((event) => event.type === "thread.deleted"),
        ).toHaveLength(deletedConversationCount);
      }),
    ),
  );

  it.effect("archive artifact failure resumes after worktree cleanup without repeating it", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* completeAndSettleCard(harness);
        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "partial", "utf8");
        NodeFS.chmodSync(artifactDir, 0o555);

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-artifact-failure"),
          cardId: harness.cardId,
        });
        yield* harness.drain;
        NodeFS.chmodSync(artifactDir, 0o755);

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card).toMatchObject({
          archivedAt: null,
          operation: {
            operationId: "cmd-archive-artifact-failure",
            purpose: "archive",
            cleanupStage: "worktree-removed",
          },
        });
        expect(card.lastError).toMatch(/Archive failed while removing artifacts/i);
        expect(harness.removeWorktree).toHaveBeenCalledTimes(1);

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-artifact-retry"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.archivedAt).not.toBeNull();
        expect(card.operation).toBeNull();
        expect(harness.removeWorktree).toHaveBeenCalledTimes(1);
        expect(NodeFS.existsSync(artifactDir)).toBe(false);
      }),
    ),
  );

  it.effect("archive treats an already-missing artifact directory as completed cleanup", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* completeAndSettleCard(harness);
        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.rmSync(artifactDir, { recursive: true, force: true });

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-missing-artifacts"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.archivedAt).not.toBeNull();
        expect(card.operation).toBeNull();
        expect(makeBoardReconciliationEvents([card])).toEqual([]);
      }),
    ),
  );

  for (const cleanupStage of [
    "cleanup-started",
    "conversations-archived",
    "worktree-removed",
    "artifacts-removed",
  ] as const satisfies ReadonlyArray<CardCleanupStage>) {
    it.effect(`restart reconciliation resumes archive cleanup from ${cleanupStage}`, () =>
      verifyCleanupRestartFromStage(cleanupStage),
    );
  }

  it.effect("restart treats a historical deleting operation without purpose as delete", () =>
    verifyCleanupRestartFromStage("artifacts-removed", undefined),
  );

  it.effect("delete command ids beginning with archive: remain deletion operations", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-delete-prefix-cancelled"),
          cardId: harness.cardId,
          status: "cancelled",
        });
        yield* harness.dispatch({
          type: "card.delete",
          commandId: CommandId.make("archive:normal-delete-command"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)).toBeUndefined();
        const lifecycleEvents = (yield* harness.readEvents).filter(
          (event) => event.aggregateId === harness.cardId,
        );
        expect(lifecycleEvents.some((event) => event.type === "card.deleted")).toBe(true);
        expect(lifecycleEvents.some((event) => event.type === "card.archived")).toBe(false);
        expect(
          lifecycleEvents.find((event) => event.type === "card.delete-requested")?.payload,
        ).toMatchObject({
          operationId: "archive:normal-delete-command",
          purpose: "delete",
        });
      }),
    ),
  );

  it.effect("delete removes a cancelled card run and all of its owned resources", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        const artifactDir = NodePath.join(harness.stateDir, "board-artifacts", harness.cardId);
        NodeFS.writeFileSync(NodePath.join(artifactDir, "Implement.md"), "# partial\n", "utf8");

        const released = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!;
        const stepThreadId = released.stepThreads[0]!.threadId;
        const childThreadId = ThreadId.make("thread-card-child");
        const grandchildThreadId = ThreadId.make("thread-card-grandchild");
        const siblingRootThreadId = ThreadId.make("thread-card-sibling-root");
        const unrelatedThreadId = ThreadId.make("thread-unrelated-worktree");
        const createOwnedThread = (
          threadId: ThreadId,
          parentThreadId: ThreadId | null,
          worktreePath: string,
        ) =>
          harness.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`cmd-create-${threadId}`),
            threadId,
            projectId: harness.projectId,
            parentThreadId,
            title: `Owned ${threadId}`,
            modelSelection: {
              instanceId: codexInstanceId,
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: released.branch,
            worktreePath,
            createdAt: NOW,
          });

        yield* createOwnedThread(childThreadId, stepThreadId, harness.worktreePath);
        yield* createOwnedThread(grandchildThreadId, childThreadId, harness.worktreePath);
        yield* createOwnedThread(siblingRootThreadId, null, harness.worktreePath);
        yield* createOwnedThread(unrelatedThreadId, null, harness.workspaceRoot);

        // Legacy clients left interrupted cards in this terminal in-flight
        // state instead of resetting them to To-Do.
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-card-cancelled-legacy"),
          cardId: harness.cardId,
          status: "cancelled",
        });
        yield* harness.dispatch({
          type: "card.delete",
          commandId: CommandId.make("cmd-card-delete-cancelled"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const model = yield* harness.readModel;
        expect(model.cards.find((entry) => entry.id === harness.cardId)).toBeUndefined();
        for (const archivedThreadId of [
          stepThreadId,
          childThreadId,
          grandchildThreadId,
          siblingRootThreadId,
        ]) {
          const archivedThread = model.threads.find((thread) => thread.id === archivedThreadId);
          expect(archivedThread?.archivedAt).not.toBeNull();
          expect(archivedThread?.deletedAt).toBeNull();
        }
        expect(
          model.threads.find((thread) => thread.id === unrelatedThreadId)?.deletedAt,
        ).toBeNull();
        expect(harness.removeWorktree).toHaveBeenCalledWith(
          expect.objectContaining({
            force: true,
            path: harness.worktreePath,
          }),
        );
        expect(NodeFS.existsSync(artifactDir)).toBe(false);
      }),
    ),
  );

  it.effect("failed card deletion stays visible and can be retried", () =>
    withBoardReactorHarness({ removeWorktreeFails: true }, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        yield* harness.dispatch({
          type: "card.status.set",
          commandId: CommandId.make("cmd-delete-retry-cancelled"),
          cardId: harness.cardId,
          status: "cancelled",
        });
        yield* harness.dispatch({
          type: "card.delete",
          commandId: CommandId.make("cmd-delete-retry-first"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        let card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId);
        // Cleanup is monotonic: conversations stay deleted, the claim remains
        // visible, and retry resumes the same operation at worktree removal.
        expect(card?.operation).toMatchObject({
          kind: "deleting",
          operationId: "cmd-delete-retry-first",
          cleanupStage: "conversations-archived",
        });
        expect(card?.status).toBe("cancelled");
        expect(card?.lastError).toMatch(/Delete failed/i);

        harness.removeWorktree.mockImplementation(() => Effect.void);
        yield* harness.dispatch({
          type: "card.delete",
          commandId: CommandId.make("cmd-delete-retry-second"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId);
        expect(card).toBeUndefined();

        const deleteRequests = (yield* harness.readEvents).filter(
          (event) => event.type === "card.delete-requested",
        );
        expect(deleteRequests).toHaveLength(2);
        expect(deleteRequests[0]?.payload).toMatchObject({
          operationId: "cmd-delete-retry-first",
        });
        expect(deleteRequests[1]?.payload).toMatchObject({
          operationId: "cmd-delete-retry-first",
        });
      }),
    ),
  );

  it.effect("card.created generates a title asynchronously without blocking creation", () =>
    withBoardReactorHarness({ generateTitle: "Flaky login suite" }, (harness) =>
      Effect.gen(function* () {
        yield* harness.drain;

        const model = yield* harness.readModel;
        const card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.title).toBe("Flaky login suite");
        expect(harness.generateThreadTitle).toHaveBeenCalled();

        const events = yield* harness.readEvents;
        const created = events.find((e) => e.type === "card.created") as
          | { type: "card.created"; payload: { title: string } }
          | undefined;
        expect(created?.type).toBe("card.created");
        if (created?.type === "card.created") {
          expect(created.payload.title).toBe("Fix flaky test");
        }
        expect(events.some((e) => e.type === "card.title-updated")).toBe(true);
      }),
    ),
  );

  it.effect("title generation failure leaves the placeholder title", () =>
    withBoardReactorHarness({ titleGenerationFails: true }, (harness) =>
      Effect.gen(function* () {
        yield* harness.drain;

        const model = yield* harness.readModel;
        const card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.title).toBe("Fix flaky test");
      }),
    ),
  );

  it.effect("marks the card failed when its current step conversation is archived", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const released = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!;
        const threadId = released.stepThreads[0]!.threadId;
        yield* harness.sessionSet(threadId, "ready");
        yield* harness.drain;
        yield* harness.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("cmd-archive-current-root"),
          threadId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).toBe("failed");
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
      }),
    ),
  );

  it.effect("does not fail a card for conversation teardown owned by reset", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const released = (yield* harness.readModel).cards.find(
          (entry) => entry.id === harness.cardId,
        )!;
        yield* harness.sessionSet(released.stepThreads[0]!.threadId, "ready");
        yield* harness.drain;
        yield* harness.dispatch({
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-with-archive"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        const card = (yield* harness.readModel).cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).not.toBe("failed");
        expect(card.position).toEqual({ kind: "todo" });
        expect(card.operation).toBeNull();
      }),
    ),
  );
});
