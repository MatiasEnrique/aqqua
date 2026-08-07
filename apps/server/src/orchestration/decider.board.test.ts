import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  BoardId,
  type BoardStep,
  BoardStepId,
  CardId,
  type CardOperation,
  CardOperationId,
  CommandId,
  type OrchestrationBoard,
  type OrchestrationCard,
  type OrchestrationReadModel,
  type OrchestrationThread,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const STEPS: ReadonlyArray<BoardStep> = [
  {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Implement ${ticket_id}",
    profileName: "default" as BoardStep["profileName"],
    continuation: "auto",
  },
  {
    id: BoardStepId.make("step-2"),
    name: "Review",
    promptTemplate: "Review ${artifact}",
    profileName: "default" as BoardStep["profileName"],
    continuation: "manual",
  },
];

function makeBoard(overrides: Partial<OrchestrationBoard> = {}): OrchestrationBoard {
  return {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: STEPS,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeCard(overrides: Partial<OrchestrationCard> = {}): OrchestrationCard {
  return {
    id: CardId.make("card-1"),
    boardId: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    title: "Fix flaky test",
    parameters: { ticket_id: "T-1" },
    position: { kind: "todo" },
    status: null,
    operation: null,
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
    ...overrides,
  };
}

function startingOperation(operationId = "op-start"): CardOperation {
  return {
    kind: "starting",
    operationId: CardOperationId.make(operationId),
    requestedAt: NOW,
    threadId: ThreadId.make(`board-op-thread:${operationId}`),
  };
}

function deletingOperation(
  operationId = "op-delete",
  purpose?: "delete" | "archive",
): Extract<CardOperation, { kind: "deleting" }> {
  return {
    kind: "deleting",
    operationId: CardOperationId.make(operationId),
    requestedAt: NOW,
    ...(purpose === undefined ? {} : { purpose }),
  };
}

function resettingOperation(
  operationId = "op-reset",
): Extract<CardOperation, { kind: "resetting" }> {
  return {
    kind: "resetting",
    operationId: CardOperationId.make(operationId),
    requestedAt: NOW,
    activeThreadId: ThreadId.make("thread-current"),
    threadIds: [ThreadId.make("thread-current")],
  };
}

function makeReadModel(input: {
  readonly boards?: ReadonlyArray<OrchestrationBoard>;
  readonly cards?: ReadonlyArray<OrchestrationCard>;
  readonly projects?: OrchestrationReadModel["projects"];
  readonly threads?: ReadonlyArray<OrchestrationThread>;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: input.projects ?? [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: input.threads ?? [],
    boards: input.boards ?? [],
    cards: input.cards ?? [],
    updatedAt: NOW,
  };
}

function asEvents(decided: unknown) {
  return Array.isArray(decided) ? decided : [decided];
}

it.layer(NodeServices.layer)("board/card decider", (it) => {
  it.effect("board.create emits board.created when project exists and board is absent", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "board.create",
          commandId: CommandId.make("cmd-board-create"),
          boardId: BoardId.make("board-1"),
          projectId: ProjectId.make("project-1"),
          name: "Delivery",
          steps: STEPS,
        },
        readModel: makeReadModel({}),
      });
      const events = asEvents(decided);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("board.created");
      expect(events[0]?.aggregateKind).toBe("board");
      if (events[0]?.type === "board.created") {
        expect(events[0].payload.boardId).toBe("board-1");
        expect(events[0].payload.steps).toHaveLength(2);
      }
    }),
  );

  it.effect("board.create rejects missing project and duplicate board", () =>
    Effect.gen(function* () {
      const missingProject = yield* decideOrchestrationCommand({
        command: {
          type: "board.create",
          commandId: CommandId.make("cmd-board-create-missing"),
          boardId: BoardId.make("board-1"),
          projectId: ProjectId.make("project-missing"),
          name: "Delivery",
          steps: STEPS,
        },
        readModel: makeReadModel({ projects: [] }),
      }).pipe(Effect.flip);
      expect(missingProject._tag).toBe("OrchestrationCommandInvariantError");

      const duplicate = yield* decideOrchestrationCommand({
        command: {
          type: "board.create",
          commandId: CommandId.make("cmd-board-create-dup"),
          boardId: BoardId.make("board-1"),
          projectId: ProjectId.make("project-1"),
          name: "Delivery",
          steps: STEPS,
        },
        readModel: makeReadModel({ boards: [makeBoard()] }),
      }).pipe(Effect.flip);
      expect(duplicate._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("board.update and board.delete enforce existence rules", () =>
    Effect.gen(function* () {
      const updated = yield* decideOrchestrationCommand({
        command: {
          type: "board.update",
          commandId: CommandId.make("cmd-board-update"),
          boardId: BoardId.make("board-1"),
          name: "Delivery v2",
          steps: [STEPS[0]!],
        },
        readModel: makeReadModel({ boards: [makeBoard()] }),
      });
      expect(asEvents(updated)[0]?.type).toBe("board.updated");

      const deletedBoardUpdate = yield* decideOrchestrationCommand({
        command: {
          type: "board.update",
          commandId: CommandId.make("cmd-board-update-deleted"),
          boardId: BoardId.make("board-1"),
          name: "Delivery v2",
          steps: STEPS,
        },
        readModel: makeReadModel({ boards: [makeBoard({ deletedAt: NOW })] }),
      }).pipe(Effect.flip);
      expect(deletedBoardUpdate._tag).toBe("OrchestrationCommandInvariantError");

      const deleted = yield* decideOrchestrationCommand({
        command: {
          type: "board.delete",
          commandId: CommandId.make("cmd-board-delete"),
          boardId: BoardId.make("board-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()] }),
      });
      expect(asEvents(deleted)[0]?.type).toBe("board.deleted");
    }),
  );

  it.effect("card.create starts in todo with no snapshot", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "card.create",
          commandId: CommandId.make("cmd-card-create"),
          cardId: CardId.make("card-1"),
          boardId: BoardId.make("board-1"),
          title: "Fix flaky test",
          parameters: { ticket_id: "T-1" },
        },
        readModel: makeReadModel({ boards: [makeBoard()] }),
      });
      const events = asEvents(decided);
      expect(events[0]?.type).toBe("card.created");
      expect(events[0]?.aggregateKind).toBe("card");
      if (events[0]?.type === "card.created") {
        expect(events[0].payload.projectId).toBe("project-1");
      }
    }),
  );

  it.effect("card.release snapshots the current board definition", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "card.release",
          commandId: CommandId.make("cmd-card-release"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard({ name: "Snapshotted" })],
          cards: [makeCard()],
        }),
      });
      const events = asEvents(decided);
      expect(events[0]?.type).toBe("card.release-requested");
      if (events[0]?.type === "card.release-requested") {
        expect(events[0].payload.snapshot.name).toBe("Snapshotted");
        expect(events[0].payload.snapshot.steps).toHaveLength(2);
        expect(events[0].payload.operationId).toBe("cmd-card-release");
        expect(events[0].payload.threadId).toBe("board-op-thread:cmd-card-release");
      }

      const noSteps = yield* decideOrchestrationCommand({
        command: {
          type: "card.release",
          commandId: CommandId.make("cmd-card-release-no-steps"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard({ steps: [] })],
          cards: [makeCard()],
        }),
      }).pipe(Effect.flip);
      expect(noSteps._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.release rejects duplicate start while an operation is claimed", () =>
    Effect.gen(function* () {
      const rejected = yield* decideOrchestrationCommand({
        command: {
          type: "card.release",
          commandId: CommandId.make("cmd-card-release-dup"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              snapshot: { name: "Delivery", steps: STEPS },
              operation: startingOperation("op-existing"),
            }),
          ],
        }),
      }).pipe(Effect.flip);
      expect(rejected._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.release.complete and fail update release state correctly", () =>
    Effect.gen(function* () {
      const snapshot = { name: "Delivery", steps: STEPS };
      const operation = startingOperation("op-release");
      const complete = yield* decideOrchestrationCommand({
        command: {
          type: "card.release.complete",
          commandId: CommandId.make("cmd-release-complete"),
          cardId: CardId.make("card-1"),
          operationId: operation.operationId,
          branch: "card/card-1",
          worktreePath: "/tmp/wt/card-1",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot, operation })],
        }),
      });
      expect(asEvents(complete)[0]?.type).toBe("card.released");

      const fail = yield* decideOrchestrationCommand({
        command: {
          type: "card.release.fail",
          commandId: CommandId.make("cmd-release-fail"),
          cardId: CardId.make("card-1"),
          operationId: operation.operationId,
          reason: "worktree failed",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot, operation })],
        }),
      });
      const failEvents = asEvents(fail);
      expect(failEvents[0]?.type).toBe("card.operation-failed");
      if (failEvents[0]?.type === "card.operation-failed") {
        expect(failEvents[0].payload.kind).toBe("starting");
        expect(failEvents[0].payload.reason).toBe("worktree failed");
      }

      const mismatch = yield* decideOrchestrationCommand({
        command: {
          type: "card.release.complete",
          commandId: CommandId.make("cmd-release-mismatch"),
          cardId: CardId.make("card-1"),
          operationId: CardOperationId.make("op-other"),
          branch: "card/card-1",
          worktreePath: "/tmp/wt/card-1",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot, operation })],
        }),
      }).pipe(Effect.flip);
      expect(mismatch._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.step.enter requires a released card and in-range step", () =>
    Effect.gen(function* () {
      const operation = startingOperation("op-enter");
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.enter",
          commandId: CommandId.make("cmd-step-enter"),
          cardId: CardId.make("card-1"),
          operationId: operation.operationId,
          stepIndex: 0,
          threadId: ThreadId.make("thread-step-0"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              snapshot: { name: "Delivery", steps: STEPS },
              releasedAt: NOW,
              branch: "card/card-1",
              worktreePath: "/tmp/wt/card-1",
              operation,
            }),
          ],
        }),
      });
      expect(asEvents(decided)[0]?.type).toBe("card.step-entered");

      const notReleased = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.enter",
          commandId: CommandId.make("cmd-step-enter-bad"),
          cardId: CardId.make("card-1"),
          operationId: CardOperationId.make("op-missing"),
          stepIndex: 0,
          threadId: ThreadId.make("thread-step-0"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot: { name: "Delivery", steps: STEPS } })],
        }),
      }).pipe(Effect.flip);
      expect(notReleased._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.step.report branches on outcome, continuation, and stale thread", () =>
    Effect.gen(function* () {
      const atStep = (stepIndex: number, continuation: BoardStep["continuation"] = "auto") =>
        makeCard({
          position: { kind: "step", stepIndex },
          status: "running",
          releasedAt: NOW,
          branch: "card/card-1",
          worktreePath: "/tmp/wt/card-1",
          snapshot: {
            name: "Delivery",
            steps: STEPS.map((step, index) =>
              index === stepIndex ? { ...step, continuation } : step,
            ),
          },
          stepThreads: [
            {
              stepIndex,
              threadId: ThreadId.make("thread-current"),
              spawnedAt: NOW,
            },
          ],
        });

      const autoAdvance = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-advance"),
          cardId: CardId.make("card-1"),
          stepIndex: 0,
          threadId: ThreadId.make("thread-current"),
          outcome: "success",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [atStep(0, "auto")],
        }),
      });
      const advanceEvents = asEvents(autoAdvance);
      expect(advanceEvents[0]?.type).toBe("card.step-advance-requested");
      if (advanceEvents[0]?.type === "card.step-advance-requested") {
        expect(advanceEvents[0].payload.toStepIndex).toBe(1);
      }

      const manualPause = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-pause"),
          cardId: CardId.make("card-1"),
          stepIndex: 1,
          threadId: ThreadId.make("thread-current"),
          outcome: "success",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [atStep(1, "manual")],
        }),
      });
      const pauseEvents = asEvents(manualPause);
      expect(pauseEvents[0]?.type).toBe("card.status-set");
      if (pauseEvents[0]?.type === "card.status-set") {
        expect(pauseEvents[0].payload.status).toBe("paused");
      }

      const lastAuto = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-complete"),
          cardId: CardId.make("card-1"),
          stepIndex: 1,
          threadId: ThreadId.make("thread-current"),
          outcome: "success",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [atStep(1, "auto")],
        }),
      });
      expect(asEvents(lastAuto)[0]?.type).toBe("card.completed");

      const blocked = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-blocked"),
          cardId: CardId.make("card-1"),
          stepIndex: 0,
          threadId: ThreadId.make("thread-current"),
          outcome: "blocked",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [atStep(0)],
        }),
      });
      const blockedEvents = asEvents(blocked);
      expect(blockedEvents[0]?.type).toBe("card.status-set");
      if (blockedEvents[0]?.type === "card.status-set") {
        expect(blockedEvents[0].payload.status).toBe("needs-input");
      }

      const stale = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.report",
          commandId: CommandId.make("cmd-report-stale"),
          cardId: CardId.make("card-1"),
          stepIndex: 0,
          threadId: ThreadId.make("thread-old"),
          outcome: "success",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [atStep(0)],
        }),
      }).pipe(Effect.flip);
      expect(stale._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.continue, retry, cancel, and archive follow position/status rules", () =>
    Effect.gen(function* () {
      const paused = makeCard({
        position: { kind: "step", stepIndex: 0 },
        status: "paused",
        releasedAt: NOW,
        snapshot: { name: "Delivery", steps: STEPS },
        stepThreads: [
          {
            stepIndex: 0,
            threadId: ThreadId.make("thread-current"),
            spawnedAt: NOW,
          },
        ],
      });

      const cont = yield* decideOrchestrationCommand({
        command: {
          type: "card.continue",
          commandId: CommandId.make("cmd-continue"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [paused] }),
      });
      expect(asEvents(cont)[0]?.type).toBe("card.step-advance-requested");

      for (const status of ["needs-input", "failed", "cancelled"] as const) {
        const stuck = makeCard({
          position: { kind: "step", stepIndex: 0 },
          status,
          releasedAt: NOW,
          snapshot: { name: "Delivery", steps: STEPS },
          stepThreads: [
            {
              stepIndex: 0,
              threadId: ThreadId.make("thread-current"),
              spawnedAt: NOW,
            },
          ],
        });
        const stuckContinue = yield* decideOrchestrationCommand({
          command: {
            type: "card.continue",
            commandId: CommandId.make(`cmd-continue-${status}`),
            cardId: CardId.make("card-1"),
          },
          readModel: makeReadModel({ boards: [makeBoard()], cards: [stuck] }),
        });
        expect(asEvents(stuckContinue)[0]?.type).toBe("card.step-advance-requested");
      }

      const runningContinue = yield* decideOrchestrationCommand({
        command: {
          type: "card.continue",
          commandId: CommandId.make("cmd-continue-running"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              position: { kind: "step", stepIndex: 0 },
              status: "running",
              releasedAt: NOW,
              snapshot: { name: "Delivery", steps: STEPS },
            }),
          ],
        }),
      }).pipe(Effect.flip);
      expect(runningContinue._tag).toBe("OrchestrationCommandInvariantError");

      const retry = yield* decideOrchestrationCommand({
        command: {
          type: "card.retry",
          commandId: CommandId.make("cmd-retry"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [paused] }),
      });
      const retryEvents = asEvents(retry);
      expect(retryEvents[0]?.type).toBe("card.retry-requested");
      if (retryEvents[0]?.type === "card.retry-requested") {
        expect(retryEvents[0].payload.stepIndex).toBe(0);
      }

      // Retry while running (or with null status) is rejected.
      for (const status of ["running", null] as const) {
        const runningCard = makeCard({
          position: { kind: "step", stepIndex: 0 },
          status,
          releasedAt: NOW,
          snapshot: { name: "Delivery", steps: STEPS },
          stepThreads: [
            {
              stepIndex: 0,
              threadId: ThreadId.make("thread-current"),
              spawnedAt: NOW,
            },
          ],
        });
        const runningRetry = yield* decideOrchestrationCommand({
          command: {
            type: "card.retry",
            commandId: CommandId.make(`cmd-retry-${status ?? "null"}`),
            cardId: CardId.make("card-1"),
          },
          readModel: makeReadModel({
            boards: [makeBoard()],
            cards: [runningCard],
          }),
        }).pipe(Effect.flip);
        expect(runningRetry._tag).toBe("OrchestrationCommandInvariantError");
      }

      const cancel = yield* decideOrchestrationCommand({
        command: {
          type: "card.cancel",
          commandId: CommandId.make("cmd-cancel"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [paused] }),
      });
      const cancelEvents = asEvents(cancel);
      expect(cancelEvents).toHaveLength(2);
      expect(cancelEvents[0]?.type).toBe("card.cancel-requested");
      if (cancelEvents[0]?.type === "card.cancel-requested") {
        expect(cancelEvents[0].payload.threadId).toBe("thread-current");
      }
      expect(cancelEvents[1]?.type).toBe("card.status-set");
      if (cancelEvents[1]?.type === "card.status-set") {
        expect(cancelEvents[1].payload.status).toBe("cancelled");
      }

      const reset = yield* decideOrchestrationCommand({
        command: {
          type: "card.reset",
          commandId: CommandId.make("cmd-reset"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [paused] }),
      });
      expect(asEvents(reset)[0]?.type).toBe("card.reset-requested");

      const resetWhileBusy = yield* decideOrchestrationCommand({
        command: {
          type: "card.reset",
          commandId: CommandId.make("cmd-reset-busy"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...paused, operation: deletingOperation() })],
        }),
      }).pipe(Effect.flip);
      expect(resetWhileBusy._tag).toBe("OrchestrationCommandInvariantError");

      const archive = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              position: { kind: "done" },
              completedAt: NOW,
              settledAt: NOW,
            }),
          ],
        }),
      });
      const archiveEvents = asEvents(archive);
      expect(archiveEvents[0]?.type).toBe("card.delete-requested");
      if (archiveEvents[0]?.type === "card.delete-requested") {
        expect(archiveEvents[0].payload).toMatchObject({
          operationId: "cmd-archive",
          purpose: "archive",
          deleteWorktree: true,
        });
      }

      const archiving = makeCard({
        position: { kind: "done" },
        completedAt: NOW,
        settledAt: NOW,
        operation: {
          ...deletingOperation("cmd-archive", "archive"),
          cleanupStage: "artifacts-removed",
        },
      });
      const completedArchive = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-complete"),
          cardId: archiving.id,
          operationId: CardOperationId.make("cmd-archive"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [archiving] }),
      });
      expect(asEvents(completedArchive).map((event) => event.type)).toEqual(["card.archived"]);

      const archivedRootId = ThreadId.make("thread-archived-root");
      const archivedChildId = ThreadId.make("thread-archived-child");
      const makeArchivedThread = (
        id: ThreadId,
        parentThreadId: ThreadId | null,
      ): OrchestrationThread => ({
        id,
        projectId: ProjectId.make("project-1"),
        parentThreadId,
        title: id,
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: NOW,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      });
      const restored = yield* decideOrchestrationCommand({
        command: {
          type: "card.unarchive",
          commandId: CommandId.make("cmd-unarchive"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              position: { kind: "done" },
              archivedAt: NOW,
              stepThreads: [{ stepIndex: 0, threadId: archivedRootId, spawnedAt: NOW }],
            }),
          ],
          threads: [
            makeArchivedThread(archivedRootId, null),
            makeArchivedThread(archivedChildId, archivedRootId),
          ],
        }),
      });
      expect(asEvents(restored).map((event) => event.type)).toEqual([
        "thread.unarchived",
        "thread.unarchived",
        "card.unarchived",
      ]);

      const retryArchive = yield* decideOrchestrationCommand({
        command: {
          type: "card.delete",
          commandId: CommandId.make("cmd-archive-retry"),
          cardId: archiving.id,
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [
            makeCard({
              ...archiving,
              operation: {
                ...deletingOperation("cmd-archive", "archive"),
                cleanupStage: "worktree-removed",
              },
              lastError: "Archive failed while removing artifacts",
            }),
          ],
        }),
      });
      expect(asEvents(retryArchive)[0]).toMatchObject({
        type: "card.delete-requested",
        payload: { operationId: "cmd-archive", purpose: "archive" },
      });

      const archiveUnsettled = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-unsettled"),
          cardId: CardId.make("card-1"),
          deleteWorktree: false,
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ position: { kind: "done" }, completedAt: NOW })],
        }),
      });
      expect(asEvents(archiveUnsettled)[0]).toMatchObject({
        type: "card.delete-requested",
        payload: {
          purpose: "archive",
          deleteWorktree: false,
        },
      });

      const archiveTodo = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-todo"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard()],
        }),
      }).pipe(Effect.flip);
      expect(archiveTodo._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.delete requests cleanup for a cancelled in-flight card", () =>
    Effect.gen(function* () {
      const cancelled = makeCard({
        position: { kind: "step", stepIndex: 0 },
        status: "cancelled",
        releasedAt: NOW,
        snapshot: { name: "Delivery", steps: STEPS },
        branch: "board/fix-flaky-test",
        worktreePath: "/tmp/wt/card-1",
        stepThreads: [
          {
            stepIndex: 0,
            threadId: ThreadId.make("thread-current"),
            spawnedAt: NOW,
          },
        ],
      });

      const requested = yield* decideOrchestrationCommand({
        command: {
          type: "card.delete",
          commandId: CommandId.make("cmd-delete-cancelled"),
          cardId: cancelled.id,
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [cancelled] }),
      });

      const requestEvents = asEvents(requested);
      expect(requestEvents[0]?.type).toBe("card.delete-requested");
      if (requestEvents[0]?.type === "card.delete-requested") {
        expect(requestEvents[0].payload.operationId).toBe("cmd-delete-cancelled");
      }

      const deleting = makeCard({
        ...cancelled,
        operation: {
          ...deletingOperation("cmd-delete-cancelled"),
          cleanupStage: "artifacts-removed",
        },
      });
      const completed = yield* decideOrchestrationCommand({
        command: {
          type: "card.delete.complete",
          commandId: CommandId.make("cmd-delete-complete"),
          cardId: cancelled.id,
          operationId: CardOperationId.make("cmd-delete-cancelled"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [deleting] }),
      });
      expect(asEvents(completed)[0]?.type).toBe("card.deleted");

      const failed = yield* decideOrchestrationCommand({
        command: {
          type: "card.delete.fail",
          commandId: CommandId.make("cmd-delete-fail"),
          cardId: cancelled.id,
          operationId: CardOperationId.make("cmd-delete-cancelled"),
          reason: "worktree remove failed",
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [deleting] }),
      });
      const failEvents = asEvents(failed);
      expect(failEvents[0]?.type).toBe("card.operation-failed");
      if (failEvents[0]?.type === "card.operation-failed") {
        expect(failEvents[0].payload.kind).toBe("deleting");
        expect(failEvents[0].payload.reason).toBe("worktree remove failed");
      }
    }),
  );

  it.effect("card.reset.complete and fail validate the claimed reset operation", () =>
    Effect.gen(function* () {
      const operation: CardOperation = {
        ...resettingOperation("op-reset"),
        cleanupStage: "artifacts-removed",
      };
      const card = makeCard({
        position: { kind: "step", stepIndex: 0 },
        status: "running",
        releasedAt: NOW,
        snapshot: { name: "Delivery", steps: STEPS },
        operation,
        stepThreads: [
          {
            stepIndex: 0,
            threadId: ThreadId.make("thread-current"),
            spawnedAt: NOW,
          },
        ],
      });

      const completed = yield* decideOrchestrationCommand({
        command: {
          type: "card.reset.complete",
          commandId: CommandId.make("cmd-reset-complete"),
          cardId: card.id,
          operationId: operation.operationId,
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [card] }),
      });
      const events = asEvents(completed);
      expect(events[0]?.type).toBe("card.reset");
      if (events[0]?.type === "card.reset") {
        expect(events[0].payload.threadIds).toEqual(["thread-current"]);
      }

      const failed = yield* decideOrchestrationCommand({
        command: {
          type: "card.reset.fail",
          commandId: CommandId.make("cmd-reset-fail"),
          cardId: card.id,
          operationId: operation.operationId,
          reason: "interrupt failed",
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [card] }),
      });
      expect(asEvents(failed)[0]?.type).toBe("card.operation-failed");
    }),
  );

  it.effect("card.operation.fail clears any claimed kind after validating id and kind", () =>
    Effect.gen(function* () {
      const retrying: CardOperation = {
        kind: "retrying",
        operationId: CardOperationId.make("op-retry"),
        requestedAt: NOW,
        stepIndex: 0,
        threadId: ThreadId.make("board-op-thread:op-retry"),
      };
      const advancing: CardOperation = {
        kind: "advancing",
        operationId: CardOperationId.make("op-advance"),
        requestedAt: NOW,
        toStepIndex: 1,
        threadId: ThreadId.make("board-op-thread:op-advance"),
      };
      const baseCard = makeCard({
        position: { kind: "step", stepIndex: 0 },
        status: "failed",
        releasedAt: NOW,
        snapshot: { name: "Delivery", steps: STEPS },
        stepThreads: [
          {
            stepIndex: 0,
            threadId: ThreadId.make("thread-step-0"),
            spawnedAt: NOW,
          },
        ],
      });

      for (const operation of [
        retrying,
        advancing,
        startingOperation("op-start"),
        deletingOperation("op-del"),
        resettingOperation("op-rst"),
      ]) {
        const card = makeCard({ ...baseCard, operation });
        const decided = yield* decideOrchestrationCommand({
          command: {
            type: "card.operation.fail",
            commandId: CommandId.make(`cmd-op-fail-${operation.kind}`),
            cardId: card.id,
            operationId: operation.operationId,
            kind: operation.kind,
            reason: `${operation.kind} failed`,
          },
          readModel: makeReadModel({ boards: [makeBoard()], cards: [card] }),
        });
        const events = asEvents(decided);
        expect(events[0]?.type).toBe("card.operation-failed");
        if (events[0]?.type === "card.operation-failed") {
          expect(events[0].payload.kind).toBe(operation.kind);
          expect(events[0].payload.operationId).toBe(operation.operationId);
          expect(events[0].payload.reason).toBe(`${operation.kind} failed`);
        }
      }

      const mismatchId = yield* decideOrchestrationCommand({
        command: {
          type: "card.operation.fail",
          commandId: CommandId.make("cmd-op-fail-id-mismatch"),
          cardId: baseCard.id,
          operationId: CardOperationId.make("op-other"),
          kind: "retrying",
          reason: "stale",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...baseCard, operation: retrying })],
        }),
      }).pipe(Effect.flip);
      expect(mismatchId._tag).toBe("OrchestrationCommandInvariantError");

      const mismatchKind = yield* decideOrchestrationCommand({
        command: {
          type: "card.operation.fail",
          commandId: CommandId.make("cmd-op-fail-kind-mismatch"),
          cardId: baseCard.id,
          operationId: retrying.operationId,
          kind: "advancing",
          reason: "wrong kind",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...baseCard, operation: retrying })],
        }),
      }).pipe(Effect.flip);
      expect(mismatchKind._tag).toBe("OrchestrationCommandInvariantError");

      const noOperation = yield* decideOrchestrationCommand({
        command: {
          type: "card.operation.fail",
          commandId: CommandId.make("cmd-op-fail-none"),
          cardId: baseCard.id,
          operationId: CardOperationId.make("op-none"),
          kind: "retrying",
          reason: "none",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [baseCard],
        }),
      }).pipe(Effect.flip);
      expect(noOperation._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card.delete rejects cards that are still starting or running", () =>
    Effect.gen(function* () {
      const starting = makeCard({
        snapshot: { name: "Delivery", steps: STEPS },
        branch: "board/fix-flaky-test",
        worktreePath: "/tmp/wt/card-1",
      });
      const running = makeCard({
        position: { kind: "step", stepIndex: 0 },
        status: "running",
        releasedAt: NOW,
        snapshot: { name: "Delivery", steps: STEPS },
        branch: "board/fix-flaky-test",
        worktreePath: "/tmp/wt/card-1",
      });

      for (const [suffix, card] of [
        ["starting", starting],
        ["running", running],
      ] as const) {
        const failure = yield* decideOrchestrationCommand({
          command: {
            type: "card.delete",
            commandId: CommandId.make(`cmd-delete-${suffix}`),
            cardId: card.id,
          },
          readModel: makeReadModel({ boards: [makeBoard()], cards: [card] }),
        }).pipe(Effect.flip);
        expect(failure._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("card.status.set and card.title.set update fields with archive guard", () =>
    Effect.gen(function* () {
      const status = yield* decideOrchestrationCommand({
        command: {
          type: "card.status.set",
          commandId: CommandId.make("cmd-status"),
          cardId: CardId.make("card-1"),
          status: "running",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard()],
        }),
      });
      expect(asEvents(status)[0]?.type).toBe("card.status-set");

      const title = yield* decideOrchestrationCommand({
        command: {
          type: "card.title.set",
          commandId: CommandId.make("cmd-title"),
          cardId: CardId.make("card-1"),
          title: "New title",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard()],
        }),
      });
      expect(asEvents(title)[0]?.type).toBe("card.title-updated");

      const archivedTitle = yield* decideOrchestrationCommand({
        command: {
          type: "card.title.set",
          commandId: CommandId.make("cmd-title-archived"),
          cardId: CardId.make("card-1"),
          title: "Nope",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ position: { kind: "done" }, archivedAt: NOW })],
        }),
      }).pipe(Effect.flip);
      expect(archivedTitle._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card settle is reversible history for completed cards", () =>
    Effect.gen(function* () {
      const done = makeCard({ position: { kind: "done" }, completedAt: NOW });
      const settled = yield* decideOrchestrationCommand({
        command: {
          type: "card.settle",
          commandId: CommandId.make("cmd-card-settle"),
          cardId: done.id,
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [done] }),
      });
      expect(asEvents(settled)[0]?.type).toBe("card.settled");

      const active = yield* decideOrchestrationCommand({
        command: {
          type: "card.unsettle",
          commandId: CommandId.make("cmd-card-unsettle"),
          cardId: done.id,
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...done, settledAt: NOW })],
        }),
      });
      expect(asEvents(active)[0]?.type).toBe("card.unsettled");
    }),
  );

  it.effect("card settle rejects unfinished cards", () =>
    Effect.gen(function* () {
      const rejected = yield* decideOrchestrationCommand({
        command: {
          type: "card.settle",
          commandId: CommandId.make("cmd-card-settle-todo"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard()],
        }),
      }).pipe(Effect.flip);

      expect(rejected._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("card settle and unsettle require coherent Done/Settled states", () =>
    Effect.gen(function* () {
      const done = makeCard({ position: { kind: "done" }, completedAt: NOW });

      const alreadySettled = yield* decideOrchestrationCommand({
        command: {
          type: "card.settle",
          commandId: CommandId.make("cmd-card-settle-again"),
          cardId: done.id,
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...done, settledAt: NOW })],
        }),
      }).pipe(Effect.flip);
      expect(alreadySettled._tag).toBe("OrchestrationCommandInvariantError");

      const notSettled = yield* decideOrchestrationCommand({
        command: {
          type: "card.unsettle",
          commandId: CommandId.make("cmd-card-unsettle-idle"),
          cardId: done.id,
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [done] }),
      }).pipe(Effect.flip);
      expect(notSettled._tag).toBe("OrchestrationCommandInvariantError");

      const busy = yield* decideOrchestrationCommand({
        command: {
          type: "card.settle",
          commandId: CommandId.make("cmd-card-settle-busy"),
          cardId: done.id,
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ ...done, operation: deletingOperation() })],
        }),
      }).pipe(Effect.flip);
      expect(busy._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
