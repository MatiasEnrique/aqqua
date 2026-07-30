// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  BoardId,
  BoardStepId,
  CardId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type BoardStep,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProviderAdapterRegistry } from "../../provider/Services/ProviderAdapterRegistry.ts";
import { layerTest as serverSettingsLayerTest } from "../../serverSettings.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { BoardReactor } from "../Services/BoardReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { layer as WorktreePathCoordinationLive } from "../Services/WorktreePathCoordination.ts";
import {
  BoardReactorLive,
  boardCardBranchName,
  boardStepThreadTitle,
  findCardForCurrentStepThread,
  threadHasOpenBlockingRequest,
} from "./BoardReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
let commandSerial = 0;
const nextCommandSerial = () => ++commandSerial;
const NOW = "2026-01-01T00:00:00.000Z";
const codexInstanceId = ProviderInstanceId.make("codex");

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
  readonly createWorktreeFails?: boolean;
  readonly generateTitle?: string | null;
  readonly titleGenerationFails?: boolean;
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
    status: "ready" | "running" | "error",
    activeTurnId?: TurnId | null,
  ) => Effect.Effect<void>;
  readonly readEvents: Effect.Effect<ReadonlyArray<{ type: string; [key: string]: unknown }>>;
  readonly dispatch: (
    command: Parameters<OrchestrationEngineShape["dispatch"]>[0],
  ) => Effect.Effect<void>;
  readonly dispatchFlip: (
    command: Parameters<OrchestrationEngineShape["dispatch"]>[0],
  ) => Effect.Effect<{ readonly _tag: string }>;
};

const withBoardReactorHarness = <A, E>(
  options: HarnessOptions,
  use: (harness: BoardHarness) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const workspaceRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-board-reactor-"));
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
        }) => {
          if (options.createWorktreeFails) {
            return Effect.fail(
              Object.assign(new Error("git worktree add failed"), {
                _tag: "GitCommandError" as const,
              }),
            ) as never;
          }
          return Effect.succeed({
            worktree: {
              path: worktreePath,
              refName: input.newRefName ?? input.refName,
            },
          });
        },
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

      const removeWorktree = vi.fn(() => Effect.void);
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
            Object.assign(new Error("title gen failed"), { _tag: "TextGenerationError" as const }),
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
        listRefs,
        removeWorktree,
        inspectWorktreeRemoval,
      } satisfies Partial<GitWorkflowService["Service"]>);

      const textGenerationLayer = Layer.succeed(TextGeneration, {
        generateCommitMessage: () => Effect.die("unused"),
        generatePrContent: () => Effect.die("unused"),
        generateBranchName: () => Effect.die("unused"),
        generateThreadTitle,
      } as unknown as typeof TextGeneration.Service);

      const layer = BoardReactorLive.pipe(
        Layer.provideMerge(orchestrationLayer),
        Layer.provideMerge(projectionSnapshotLayer),
        Layer.provideMerge(gitLayer),
        Layer.provideMerge(registryStub),
        Layer.provideMerge(textGenerationLayer),
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
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-board-reactor-test-" }),
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
          parameters: { ticket_id: "T3-482" },
        });

        const harness: BoardHarness = {
          engine,
          readModel: snapshotQuery.getSnapshot().pipe(Effect.orDie),
          drain: reactor.drain,
          createWorktree,
          removeWorktree,
          generateThreadTitle,
          workspaceRoot,
          worktreePath,
          projectId,
          boardId,
          cardId,
          stateDir: config.stateDir,
          releaseCard: dispatch({
            type: "card.release",
            commandId: CommandId.make(`cmd-card-release-${nextCommandSerial()}`),
            cardId,
          }).pipe(Effect.andThen(reactor.drain)),
          sessionSet: (threadId, status, activeTurnId = null) =>
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
            }),
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
        };

        return yield* use(harness);
      }).pipe(Effect.provide(layer), Effect.orDie);
    }),
  );

describe("boardCardBranchName / boardStepThreadTitle / helpers", () => {
  it("builds a unique board branch and step title", () => {
    expect(boardCardBranchName({ title: "Fix Flaky Test!", cardId: "card-abcdefgh" })).toBe(
      "board/fix-flaky-test-abcdefgh",
    );
    expect(
      boardStepThreadTitle({
        cardTitle: "Fix flaky test",
        stepIndex: 0,
        stepName: "Implement",
      }),
    ).toBe("Fix flaky test · 1 Implement");
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
            payload: { requestId: "r3", detail: "stale pending approval request" },
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
            (entry) => entry.id === card?.stepThreads[0]?.threadId,
          );
          expect(thread).toBeDefined();
          expect(thread?.parentThreadId ?? null).toBeNull();
          expect(thread?.branch).toBe(card?.branch);
          expect(thread?.worktreePath).toBe(harness.worktreePath);
          expect(thread?.title).toContain("· 1 Implement");

          const userMessage = events.find(
            (e) =>
              e.type === "thread.message-sent" &&
              e.aggregateId === card?.stepThreads[0]?.threadId &&
              (e as { payload?: { role?: string } }).payload?.role === "user",
          ) as
            | {
                type: "thread.message-sent";
                payload: { text: string };
              }
            | undefined;
          expect(userMessage?.type).toBe("thread.message-sent");
          if (userMessage?.type === "thread.message-sent") {
            expect(userMessage.payload.text).toContain("Implement T3-482 titled Fix flaky test");
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

  it.effect("step.report success on a 2-step snapshot advances to step 2", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        const afterRelease = yield* harness.readModel;
        const card = afterRelease.cards.find((entry) => entry.id === harness.cardId)!;
        const step0ThreadId = card.stepThreads[0]!.threadId;

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
          (entry) => entry.id === advanced.stepThreads[1]?.threadId,
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

  it.effect("success on last step reaches Done with null status", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;

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

  it.effect("cancel interrupts the step turn and stays in place; retry discards old thread", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;

        let model = yield* harness.readModel;
        let card = model.cards.find((entry) => entry.id === harness.cardId)!;
        const firstThreadId = card.stepThreads[0]!.threadId;

        yield* harness.dispatch({
          type: "card.cancel",
          commandId: CommandId.make("cmd-card-cancel"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).toBe("cancelled");
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });

        const eventsAfterCancel = yield* harness.readEvents;
        expect(
          eventsAfterCancel.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
          ),
        ).toBe(true);

        yield* harness.dispatch({
          type: "card.retry",
          commandId: CommandId.make("cmd-card-retry"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.status).toBe("running");
        expect(card.stepThreads.length).toBeGreaterThanOrEqual(2);
        const currentThread = [...card.stepThreads]
          .toReversed()
          .find((entry) => entry.stepIndex === 0)!;
        expect(currentThread.threadId).not.toBe(firstThreadId);

        // Old thread was interrupted (again on retry) and archived (discarded).
        const events = yield* harness.readEvents;
        expect(
          events.some((e) => e.type === "thread.archived" && e.aggregateId === firstThreadId),
        ).toBe(true);
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

  it.effect("retry on a needs-input card interrupts + archives the old thread and re-enters", () =>
    withBoardReactorHarness({}, (harness) =>
      Effect.gen(function* () {
        yield* harness.releaseCard;
        const afterRelease = yield* harness.readModel;
        const firstThreadId = afterRelease.cards.find((entry) => entry.id === harness.cardId)!
          .stepThreads[0]!.threadId;

        // Turn completed without board_complete → needs-input.
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
        expect(card.position).toEqual({ kind: "step", stepIndex: 0 });
        const current = [...card.stepThreads].toReversed().find((e) => e.stepIndex === 0)!;
        expect(current.threadId).not.toBe(firstThreadId);

        const events = yield* harness.readEvents;
        expect(
          events.some(
            (e) => e.type === "thread.turn-interrupt-requested" && e.aggregateId === firstThreadId,
          ),
        ).toBe(true);
        expect(
          events.some((e) => e.type === "thread.archived" && e.aggregateId === firstThreadId),
        ).toBe(true);
        expect(model.threads.find((t) => t.id === firstThreadId)?.archivedAt).not.toBeNull();
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

  it.effect("Done performs no cleanup; archive deletes worktree + artifact dir", () =>
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
        expect(model.threads.some((t) => t.id === card.stepThreads[0]?.threadId)).toBe(true);

        yield* harness.dispatch({
          type: "card.archive",
          commandId: CommandId.make("cmd-card-archive"),
          cardId: harness.cardId,
        });
        yield* harness.drain;

        model = yield* harness.readModel;
        card = model.cards.find((entry) => entry.id === harness.cardId)!;
        expect(card.archivedAt).not.toBeNull();
        expect(harness.removeWorktree).toHaveBeenCalled();
        expect(NodeFS.existsSync(artifactDir)).toBe(false);
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
});
