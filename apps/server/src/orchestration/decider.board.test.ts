import {
  BoardId,
  BoardStepId,
  CardId,
  CommandId,
  ProjectId,
  ThreadId,
  type BoardStep,
  type OrchestrationBoard,
  type OrchestrationCard,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
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
    snapshot: null,
    branch: null,
    worktreePath: null,
    stepThreads: [],
    createdAt: NOW,
    updatedAt: NOW,
    releasedAt: null,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeReadModel(input: {
  readonly boards?: ReadonlyArray<OrchestrationBoard>;
  readonly cards?: ReadonlyArray<OrchestrationCard>;
  readonly projects?: OrchestrationReadModel["projects"];
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
    threads: [],
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

  it.effect("card.release.complete and fail update release state correctly", () =>
    Effect.gen(function* () {
      const snapshot = { name: "Delivery", steps: STEPS };
      const complete = yield* decideOrchestrationCommand({
        command: {
          type: "card.release.complete",
          commandId: CommandId.make("cmd-release-complete"),
          cardId: CardId.make("card-1"),
          branch: "card/card-1",
          worktreePath: "/tmp/wt/card-1",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot })],
        }),
      });
      expect(asEvents(complete)[0]?.type).toBe("card.released");

      const fail = yield* decideOrchestrationCommand({
        command: {
          type: "card.release.fail",
          commandId: CommandId.make("cmd-release-fail"),
          cardId: CardId.make("card-1"),
          reason: "worktree failed",
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ snapshot })],
        }),
      });
      const failEvents = asEvents(fail);
      expect(failEvents[0]?.type).toBe("card.status-set");
      if (failEvents[0]?.type === "card.status-set") {
        expect(failEvents[0].payload.status).toBe("failed");
      }
    }),
  );

  it.effect("card.step.enter requires a released card and in-range step", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "card.step.enter",
          commandId: CommandId.make("cmd-step-enter"),
          cardId: CardId.make("card-1"),
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [atStep(0, "auto")] }),
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [atStep(1, "manual")] }),
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [atStep(1, "auto")] }),
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [atStep(0)] }),
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [atStep(0)] }),
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

      // Retry while running (or with null status) is rejected — Cancel first.
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
          readModel: makeReadModel({ boards: [makeBoard()], cards: [runningCard] }),
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
      expect(cancelEvents[1]?.type).toBe("card.status-set");
      if (cancelEvents[0]?.type === "card.cancel-requested") {
        expect(cancelEvents[0].payload.threadId).toBe("thread-current");
      }
      if (cancelEvents[1]?.type === "card.status-set") {
        expect(cancelEvents[1].payload.status).toBe("cancelled");
      }

      const archive = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({
          boards: [makeBoard()],
          cards: [makeCard({ position: { kind: "done" }, completedAt: NOW })],
        }),
      });
      expect(asEvents(archive)[0]?.type).toBe("card.archived");

      const archiveTodo = yield* decideOrchestrationCommand({
        command: {
          type: "card.archive",
          commandId: CommandId.make("cmd-archive-todo"),
          cardId: CardId.make("card-1"),
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [makeCard()] }),
      }).pipe(Effect.flip);
      expect(archiveTodo._tag).toBe("OrchestrationCommandInvariantError");
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
        readModel: makeReadModel({ boards: [makeBoard()], cards: [makeCard()] }),
      });
      expect(asEvents(status)[0]?.type).toBe("card.status-set");

      const title = yield* decideOrchestrationCommand({
        command: {
          type: "card.title.set",
          commandId: CommandId.make("cmd-title"),
          cardId: CardId.make("card-1"),
          title: "New title",
        },
        readModel: makeReadModel({ boards: [makeBoard()], cards: [makeCard()] }),
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
});
