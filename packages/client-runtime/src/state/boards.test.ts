import type {
  BoardStep,
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationShellSnapshot,
} from "@aqqua/contracts";
import {
  BoardId,
  BoardStepId,
  CardId,
  CardOperationId,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@aqqua/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { scopeProjectRef } from "../environment/scoped.ts";
import {
  boardArtifactFileName,
  type CardOperationKind,
  canDeleteCard,
  cardActionAvailability,
  cardArtifactProvenance,
  cardCurrentThreadId,
  cardOperation,
  cardOperationFailure,
  cardStepCount,
  cardStepNames,
  cardStepThreadId,
  countCardsNeedingYou,
  createEnvironmentBoardAtoms,
  createFlowThreadOwnership,
  findFlowOwnedThread,
  groupBoardCards,
  isCardDeleting,
  isCardStarting,
  selectBoardCards,
  selectCard,
  selectCardSteps,
  selectNextCardAfter,
  selectProjectBoard,
  selectProjectBoards,
  selectProjectCards,
  selectSubAgentThreads,
} from "./boards.ts";

function step(name: string): BoardStep {
  return {
    id: BoardStepId.make(`step-${name}`),
    name,
    promptTemplate: `Do ${name}`,
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  };
}

function board(overrides: Partial<OrchestrationBoard> = {}): OrchestrationBoard {
  return {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: [step("Implement"), step("Review")],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function card(overrides: Partial<OrchestrationCard> = {}): OrchestrationCard {
  return {
    id: CardId.make("card-1"),
    boardId: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    title: "aqqua-482",
    parameters: {},
    position: { kind: "todo" },
    status: null,
    operation: null,
    lastError: null,
    snapshot: null,
    branch: null,
    worktreePath: null,
    stepThreads: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    releasedAt: null,
    completedAt: null,
    settledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * The durable operation columns are the server's, and the client only ever
 * reads them — mirroring how a projected card arrives over the wire.
 */
function withOperation(
  subject: OrchestrationCard,
  kind: CardOperationKind | null,
  lastError: string | null = null,
): OrchestrationCard {
  return {
    ...subject,
    operation: kind === null ? null : operationClaim(kind),
    lastError,
  };
}

function operationClaim(kind: CardOperationKind): NonNullable<OrchestrationCard["operation"]> {
  const base = {
    operationId: CardOperationId.make("operation-1"),
    requestedAt: "2026-04-02T00:00:00.000Z",
  };
  switch (kind) {
    case "advancing":
      return { ...base, kind, threadId: null, toStepIndex: 1 };
    case "retrying":
      return { ...base, kind, threadId: null, stepIndex: 0 };
    case "resetting":
      return { ...base, kind, activeThreadId: null, threadIds: [] };
    case "starting":
      return { ...base, kind, threadId: null };
    case "deleting":
      return { ...base, kind };
  }
}

describe("selectProjectBoards", () => {
  it("keeps only the project's live boards, oldest first", () => {
    const boards = [
      board({
        id: BoardId.make("b-new"),
        createdAt: "2026-04-03T00:00:00.000Z",
      }),
      board({
        id: BoardId.make("b-deleted"),
        deletedAt: "2026-04-02T00:00:00.000Z",
      }),
      board({
        id: BoardId.make("b-other"),
        projectId: ProjectId.make("project-2"),
      }),
      board({
        id: BoardId.make("b-old"),
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
    ];

    expect(selectProjectBoards(boards, ProjectId.make("project-1")).map((b) => b.id)).toEqual([
      "b-old",
      "b-new",
    ]);
  });

  it("returns the oldest live board as the project's board", () => {
    const boards = [
      board({
        id: BoardId.make("b-new"),
        createdAt: "2026-04-03T00:00:00.000Z",
      }),
      board({
        id: BoardId.make("b-old"),
        createdAt: "2026-04-01T00:00:00.000Z",
      }),
    ];

    expect(selectProjectBoard(boards, ProjectId.make("project-1"))?.id).toBe("b-old");
    expect(selectProjectBoard(boards, ProjectId.make("project-9"))).toBeNull();
  });
});

describe("project card atoms", () => {
  it("includes cards from every board owned by the project", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const projectId = ProjectId.make("project-1");
    const firstBoard = board({ id: BoardId.make("board-first") });
    const secondBoard = board({ id: BoardId.make("board-second") });
    const firstCard = card({
      id: CardId.make("card-first"),
      boardId: firstBoard.id,
    });
    const secondCard = card({
      id: CardId.make("card-second"),
      boardId: secondBoard.id,
    });
    const snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 1,
      projects: [],
      threads: [],
      boards: [firstBoard, secondBoard],
      cards: [firstCard, secondCard],
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    const snapshotAtom = Atom.make<OrchestrationShellSnapshot | null>(snapshot);
    const atoms = createEnvironmentBoardAtoms({
      snapshotAtom: () => snapshotAtom,
    });
    const registry = AtomRegistry.make();

    expect(
      registry
        .get(atoms.projectCardsAtom(scopeProjectRef(environmentId, projectId)))
        .map((entry) => entry.id),
    ).toEqual(["card-first", "card-second"]);

    registry.dispose();
  });
});

describe("selectProjectCards", () => {
  it("drops cards from other or deleted boards", () => {
    const live = board({ id: BoardId.make("board-live") });
    const deleted = board({
      id: BoardId.make("board-deleted"),
      deletedAt: "2026-04-02",
    });
    const cards = [
      card({ id: CardId.make("live"), boardId: live.id }),
      card({ id: CardId.make("deleted-board"), boardId: deleted.id }),
      card({
        id: CardId.make("other-board"),
        boardId: BoardId.make("board-other"),
      }),
    ];

    expect(selectProjectCards(cards, selectProjectBoards([live, deleted], live.projectId))).toEqual(
      [cards[0]],
    );
  });
});

describe("selectBoardCards", () => {
  it("drops archived cards and cards from other boards", () => {
    const cards = [
      card({ id: CardId.make("c-1"), createdAt: "2026-04-02T00:00:00.000Z" }),
      card({
        id: CardId.make("c-archived"),
        archivedAt: "2026-04-04T00:00:00.000Z",
      }),
      card({ id: CardId.make("c-other"), boardId: BoardId.make("board-2") }),
      card({ id: CardId.make("c-0"), createdAt: "2026-04-01T00:00:00.000Z" }),
    ];

    expect(selectBoardCards(cards, BoardId.make("board-1")).map((c) => c.id)).toEqual([
      "c-0",
      "c-1",
    ]);
  });
});

describe("groupBoardCards", () => {
  it("splits cards by position and settlement and orders in-flight rows by newest release", () => {
    const cards = [
      card({ id: CardId.make("todo-1") }),
      card({
        id: CardId.make("flight-old"),
        position: { kind: "step", stepIndex: 0 },
        releasedAt: "2026-04-01T00:00:00.000Z",
      }),
      card({ id: CardId.make("done-1"), position: { kind: "done" } }),
      card({
        id: CardId.make("settled-1"),
        position: { kind: "done" },
        settledAt: "2026-04-06T00:00:00.000Z",
      }),
      card({
        id: CardId.make("flight-new"),
        position: { kind: "step", stepIndex: 1 },
        releasedAt: "2026-04-05T00:00:00.000Z",
      }),
    ];

    const sections = groupBoardCards(cards);

    expect(sections.todo.map((c) => c.id)).toEqual(["todo-1"]);
    expect(sections.inFlight.map((c) => c.id)).toEqual(["flight-new", "flight-old"]);
    expect(sections.done.map((c) => c.id)).toEqual(["done-1"]);
    expect(sections.settled.map((c) => c.id)).toEqual(["settled-1"]);
  });

  it("returns empty sections for an empty board", () => {
    const sections = groupBoardCards([]);
    expect(sections.todo).toHaveLength(0);
    expect(sections.inFlight).toHaveLength(0);
    expect(sections.done).toHaveLength(0);
    expect(sections.settled).toHaveLength(0);
    expect(sections.deleting).toHaveLength(0);
  });

  it("pulls a card being deleted out of every normal section the moment the operation lands", () => {
    const cards = [
      withOperation(card({ id: CardId.make("todo-gone") }), "deleting"),
      withOperation(
        card({
          id: CardId.make("flight-gone"),
          position: { kind: "step", stepIndex: 0 },
        }),
        "deleting",
      ),
      withOperation(card({ id: CardId.make("done-gone"), position: { kind: "done" } }), "deleting"),
      withOperation(
        card({
          id: CardId.make("settled-gone"),
          position: { kind: "done" },
          settledAt: "2026-04-06T00:00:00.000Z",
        }),
        "deleting",
      ),
      card({ id: CardId.make("todo-stays") }),
    ];

    const sections = groupBoardCards(cards);

    expect(sections.todo.map((c) => c.id)).toEqual(["todo-stays"]);
    expect(sections.inFlight).toHaveLength(0);
    expect(sections.done).toHaveLength(0);
    expect(sections.settled).toHaveLength(0);
    expect(sections.deleting.map((c) => c.id)).toEqual([
      "todo-gone",
      "flight-gone",
      "done-gone",
      "settled-gone",
    ]);
  });

  it("returns a card to its original section once the deletion fails", () => {
    const failed = withOperation(
      card({ id: CardId.make("done-1"), position: { kind: "done" } }),
      null,
      "worktree is locked by another process",
    );

    const sections = groupBoardCards([failed]);

    expect(sections.done.map((c) => c.id)).toEqual(["done-1"]);
    expect(sections.deleting).toHaveLength(0);
    expect(cardOperationFailure(failed)).toBe("worktree is locked by another process");
  });
});

describe("card operations", () => {
  it("reads the durable operation the server projected", () => {
    expect(cardOperation(withOperation(card(), "deleting"))).toBe("deleting");
    expect(cardOperation(withOperation(card(), "retrying"))).toBe("retrying");
    expect(cardOperation(withOperation(card(), "resetting"))).toBe("resetting");
    expect(cardOperation(withOperation(card(), "advancing"))).toBe("advancing");
    expect(cardOperation(card())).toBeNull();
  });

  it("reports a released-but-unstarted card as starting without a durable operation", () => {
    const starting = card({
      snapshot: { name: "Delivery", steps: [step("Implement")] },
    });
    expect(cardOperation(starting)).toBe("starting");
    expect(isCardStarting(starting)).toBe(true);
  });

  it("treats the legacy deleting status as the deleting operation", () => {
    expect(cardOperation(card({ status: "deleting" }))).toBe("deleting");
    expect(isCardDeleting(card({ status: "deleting" }))).toBe(true);
    expect(isCardDeleting(withOperation(card(), "deleting"))).toBe(true);
    expect(isCardDeleting(card())).toBe(false);
  });

  it("keeps a card's own failure reason readable after a failed operation", () => {
    expect(cardOperationFailure(card())).toBeNull();
    expect(cardOperationFailure(withOperation(card(), null, "  "))).toBeNull();
    expect(cardOperationFailure(withOperation(card(), null, "cleanup failed"))).toBe(
      "cleanup failed",
    );
  });

  it("does not count a card being deleted as waiting on you", () => {
    const cards = [
      card({
        id: CardId.make("a"),
        position: { kind: "step", stepIndex: 0 },
        status: "paused",
      }),
      withOperation(
        card({
          id: CardId.make("b"),
          position: { kind: "step", stepIndex: 0 },
          status: "paused",
        }),
        "deleting",
      ),
    ];

    expect(countCardsNeedingYou(cards)).toBe(1);
  });

  it("suspends recovery actions while the server is running an operation", () => {
    const advancing = withOperation(
      card({ position: { kind: "step", stepIndex: 0 }, status: "paused" }),
      "advancing",
    );

    expect(cardActionAvailability(advancing)).toEqual({
      operation: "advancing",
      canReset: false,
      canRetry: false,
      canContinue: false,
    });
  });

  it("re-offers deletion once a failed deletion has released the card", () => {
    const failed = withOperation(card({ position: { kind: "done" } }), null, "cleanup failed");
    expect(canDeleteCard(failed)).toBe(true);
    expect(canDeleteCard(withOperation(card({ position: { kind: "done" } }), "deleting"))).toBe(
      false,
    );
  });

  it("withholds deletion under every operation, not just the deleting one", () => {
    // A flagged step is otherwise deletable, which is exactly what makes an
    // unrelated operation dangerous here: the row would offer Delete over work
    // the server is already doing, and the server would reject it.
    const flagged = card({
      position: { kind: "step", stepIndex: 0 },
      status: "paused",
    });
    expect(canDeleteCard(flagged)).toBe(true);

    for (const operation of [
      "starting",
      "advancing",
      "retrying",
      "resetting",
      "deleting",
    ] as const) {
      expect(canDeleteCard(withOperation(flagged, operation))).toBe(false);
    }
  });

  it("withholds deletion from a Done or backlog card under an operation", () => {
    for (const position of [{ kind: "done" } as const, { kind: "todo" } as const]) {
      expect(canDeleteCard(card({ position }))).toBe(true);
      for (const operation of ["advancing", "retrying", "resetting"] as const) {
        expect(canDeleteCard(withOperation(card({ position }), operation))).toBe(false);
      }
    }
  });

  it("still withholds deletion from a card the server is releasing", () => {
    // Pre-operation rows say "starting" through their snapshot alone; the
    // durable claim says it outright. Both have to close the action.
    const releasing = card({
      snapshot: { name: "Delivery", steps: [step("Implement")] },
    });
    expect(canDeleteCard(releasing)).toBe(false);
    expect(canDeleteCard(withOperation(card(), "starting"))).toBe(false);
  });
});

describe("selectNextCardAfter", () => {
  const needsYouCard = card({
    id: CardId.make("needs-you"),
    position: { kind: "step", stepIndex: 0 },
    status: "needs-input",
  });
  const activeCard = card({
    id: CardId.make("active"),
    position: { kind: "step", stepIndex: 0 },
    status: "running",
  });
  const todoCard = card({ id: CardId.make("todo") });
  const doneCard = card({
    id: CardId.make("done"),
    position: { kind: "done" },
  });

  it("picks the most urgent card that is not the one leaving", () => {
    const sections = groupBoardCards([todoCard, activeCard, doneCard, needsYouCard]);
    expect(selectNextCardAfter(sections, CardId.make("other"))).toBe("needs-you");
    expect(selectNextCardAfter(sections, needsYouCard.id)).toBe("active");
  });

  it("never lands on a card that is itself being deleted", () => {
    const sections = groupBoardCards([
      withOperation(needsYouCard, "deleting"),
      withOperation(activeCard, "deleting"),
      todoCard,
    ]);

    expect(selectNextCardAfter(sections, CardId.make("other"))).toBe("todo");
  });

  it("returns null when the board index is the only place left to go", () => {
    const sections = groupBoardCards([todoCard]);
    expect(selectNextCardAfter(sections, todoCard.id)).toBeNull();
  });
});

describe("card step tracks", () => {
  it("measures a released card against its own snapshot, not the live board", () => {
    const released = card({
      position: { kind: "step", stepIndex: 0 },
      snapshot: { name: "Delivery", steps: [step("Implement")] },
    });
    const edited = board({
      steps: [step("Plan"), step("Implement"), step("Review")],
    });

    expect(cardStepCount(released, edited)).toBe(1);
    expect(cardStepNames(released, edited)).toEqual(["Implement"]);
  });

  it("falls back to the live board for backlog cards", () => {
    expect(cardStepCount(card(), board())).toBe(2);
    expect(cardStepNames(card(), board())).toEqual(["Implement", "Review"]);
  });
});

function templatedStep(name: string, promptTemplate: string): BoardStep {
  return { ...step(name), promptTemplate };
}

function stepThread(stepIndex: number, threadId: string, spawnedAt: string) {
  return { stepIndex, threadId: ThreadId.make(threadId), spawnedAt };
}

describe("card detail selectors", () => {
  it("finds a card by id", () => {
    const target = card({ id: CardId.make("card-2") });
    expect(selectCard([card(), target], CardId.make("card-2"))).toBe(target);
    expect(selectCard([card()], CardId.make("missing"))).toBeNull();
  });

  it("takes the newest thread for a step so retries win", () => {
    const retried = card({
      position: { kind: "step", stepIndex: 0 },
      stepThreads: [
        stepThread(0, "thread-first", "2026-04-01T00:00:00.000Z"),
        stepThread(0, "thread-retry", "2026-04-02T00:00:00.000Z"),
        stepThread(1, "thread-next", "2026-04-03T00:00:00.000Z"),
      ],
    });

    expect(cardStepThreadId(retried, 0)).toBe("thread-retry");
    expect(cardStepThreadId(retried, 1)).toBe("thread-next");
    expect(cardStepThreadId(retried, 2)).toBeNull();
    expect(cardCurrentThreadId(retried)).toBe("thread-retry");
    expect(cardCurrentThreadId(card())).toBeNull();
  });

  it("marks steps behind the card complete and later steps pending", () => {
    const inFlight = card({
      position: { kind: "step", stepIndex: 1 },
      snapshot: {
        name: "Delivery",
        steps: [step("Plan"), step("Implement"), step("Review")],
      },
      stepThreads: [stepThread(1, "thread-implement", "2026-04-02T00:00:00.000Z")],
    });

    const steps = selectCardSteps(inFlight, board());

    expect(steps.map((entry) => entry.state)).toEqual(["complete", "current", "pending"]);
    expect(steps[1]?.threadId).toBe("thread-implement");
    expect(steps[0]?.threadId).toBeNull();
  });

  it("treats every step of a Done card as complete", () => {
    const finished = card({ position: { kind: "done" } });
    expect(selectCardSteps(finished, board()).map((entry) => entry.state)).toEqual([
      "complete",
      "complete",
    ]);
  });

  it("groups sub-agent threads under the step thread that spawned them", () => {
    const threads = [
      {
        id: ThreadId.make("sub-b"),
        parentThreadId: ThreadId.make("step-1"),
        createdAt: "b",
      },
      {
        id: ThreadId.make("sub-a"),
        parentThreadId: ThreadId.make("step-1"),
        createdAt: "a",
      },
      {
        id: ThreadId.make("other"),
        parentThreadId: ThreadId.make("step-2"),
        createdAt: "a",
      },
      { id: ThreadId.make("root"), createdAt: "a" },
    ];

    expect(selectSubAgentThreads(threads, ThreadId.make("step-1")).map((t) => t.id)).toEqual([
      "sub-a",
      "sub-b",
    ]);
    expect(selectSubAgentThreads(threads, null)).toHaveLength(0);
  });

  it("names artifact files the way the server does", () => {
    expect(boardArtifactFileName("Review")).toBe("Review.md");
    expect(boardArtifactFileName("Fix / polish")).toBe("Fix-_-polish.md");
    expect(boardArtifactFileName("   ")).toBe("artifact.md");
  });
});

describe("cardArtifactProvenance", () => {
  const templated = board({
    steps: [
      templatedStep("Plan", "Write the plan"),
      templatedStep("Implement", "Follow ${artifact}"),
      templatedStep("Review", "Check ${artifact:Plan} and ${artifact}"),
    ],
  });

  it("credits the writing step and every later reader with its placeholder", () => {
    const provenance = cardArtifactProvenance(card(), templated, 0);

    expect(provenance?.writtenBy).toEqual({ stepIndex: 0, stepName: "Plan" });
    expect(provenance?.readBy).toEqual([
      { stepIndex: 1, stepName: "Implement", placeholder: "${artifact}" },
      { stepIndex: 2, stepName: "Review", placeholder: "${artifact:Plan}" },
    ]);
  });

  it("binds ${artifact} to the immediately preceding step only", () => {
    const provenance = cardArtifactProvenance(card(), templated, 1);
    expect(provenance?.readBy).toEqual([
      { stepIndex: 2, stepName: "Review", placeholder: "${artifact}" },
    ]);
  });

  it("reads the card's snapshot ahead of the live board", () => {
    const released = card({
      snapshot: {
        name: "Delivery",
        steps: [step("Only"), templatedStep("Next", "${artifact}")],
      },
    });
    const provenance = cardArtifactProvenance(released, templated, 0);
    expect(provenance?.writtenBy.stepName).toBe("Only");
    expect(provenance?.readBy).toHaveLength(1);
  });

  it("returns null for a step the card does not have", () => {
    expect(cardArtifactProvenance(card(), templated, 9)).toBeNull();
  });
});

describe("card status affordances", () => {
  it("counts paused and needs-input cards as waiting on you", () => {
    const cards = [
      card({
        id: CardId.make("a"),
        position: { kind: "step", stepIndex: 0 },
        status: "paused",
      }),
      card({
        id: CardId.make("b"),
        position: { kind: "step", stepIndex: 0 },
        status: "needs-input",
      }),
      card({
        id: CardId.make("c"),
        position: { kind: "step", stepIndex: 0 },
        status: "running",
      }),
      card({
        id: CardId.make("d"),
        position: { kind: "step", stepIndex: 0 },
        status: "failed",
      }),
      card({ id: CardId.make("e") }),
    ];

    expect(countCardsNeedingYou(cards)).toBe(2);
  });

  it("offers a full-card cancel from any active step and retry/continue once flagged", () => {
    const running = card({
      position: { kind: "step", stepIndex: 0 },
      status: "running",
    });
    expect(cardActionAvailability(running)).toEqual({
      operation: null,
      canReset: true,
      canRetry: false,
      canContinue: false,
    });

    const paused = card({
      position: { kind: "step", stepIndex: 0 },
      status: "paused",
    });
    expect(cardActionAvailability(paused)).toEqual({
      operation: null,
      canReset: true,
      canRetry: true,
      canContinue: true,
    });

    const failed = card({
      position: { kind: "step", stepIndex: 0 },
      status: "failed",
    });
    expect(cardActionAvailability(failed).canReset).toBe(true);
    expect(cardActionAvailability(failed).canContinue).toBe(true);

    const deleting = card({
      position: { kind: "step", stepIndex: 0 },
      status: "deleting",
    });
    expect(cardActionAvailability(deleting)).toEqual({
      operation: "deleting",
      canReset: false,
      canRetry: false,
      canContinue: false,
    });
  });

  it("offers nothing on backlog and done cards", () => {
    expect(cardActionAvailability(card())).toEqual({
      operation: null,
      canReset: false,
      canRetry: false,
      canContinue: false,
    });
    expect(cardActionAvailability(card({ position: { kind: "done" } })).canRetry).toBe(false);
  });

  it("allows deletion only after a card run is no longer changing state", () => {
    expect(canDeleteCard(card())).toBe(true);
    expect(canDeleteCard(card({ position: { kind: "done" } }))).toBe(true);
    expect(
      canDeleteCard(card({ position: { kind: "step", stepIndex: 0 }, status: "cancelled" })),
    ).toBe(true);
    expect(
      canDeleteCard(card({ position: { kind: "step", stepIndex: 0 }, status: "failed" })),
    ).toBe(true);

    expect(
      canDeleteCard(card({ position: { kind: "step", stepIndex: 0 }, status: "running" })),
    ).toBe(false);
    expect(canDeleteCard(card({ position: { kind: "step", stepIndex: 0 }, status: null }))).toBe(
      false,
    );
    expect(
      canDeleteCard(
        card({
          snapshot: { name: "Delivery", steps: [step("Implement")] },
          status: null,
        }),
      ),
    ).toBe(false);
    expect(canDeleteCard(card({ archivedAt: "2026-04-02T00:00:00.000Z" }))).toBe(false);
    expect(canDeleteCard(card({ status: "deleting" }))).toBe(false);
  });
});

describe("flow thread ownership", () => {
  const flowCard = card({
    position: { kind: "step", stepIndex: 1 },
    status: "running",
    stepThreads: [
      { stepIndex: 0, threadId: ThreadId.make("thread-plan"), spawnedAt: "2026-04-01T00:00:00Z" },
      {
        stepIndex: 1,
        threadId: ThreadId.make("thread-implement"),
        spawnedAt: "2026-04-01T00:30:00Z",
      },
    ],
  });
  const threads = [
    { id: ThreadId.make("thread-plan") },
    { id: ThreadId.make("thread-implement") },
    { id: ThreadId.make("thread-sub"), parentThreadId: ThreadId.make("thread-implement") },
    { id: ThreadId.make("thread-sub-sub"), parentThreadId: ThreadId.make("thread-sub") },
    { id: ThreadId.make("thread-loose"), parentThreadId: null },
  ];

  it("owns every step root and descendant, but not unrelated conversations", () => {
    const ownership = createFlowThreadOwnership({ cards: [flowCard], threads });
    expect(
      ["thread-plan", "thread-implement", "thread-sub", "thread-sub-sub", "thread-loose"].map(
        (id) => ownership.isFlowOwned(ThreadId.make(id)),
      ),
    ).toEqual([true, true, true, true, false]);
  });

  it("blocks a mixed delete selection until the card is archived", () => {
    const targets = [{ id: ThreadId.make("thread-loose") }, { id: ThreadId.make("thread-sub") }];
    expect(findFlowOwnedThread({ targets, cards: [flowCard], threads })?.id).toBe("thread-sub");
    expect(
      findFlowOwnedThread({
        targets,
        cards: [{ ...flowCard, archivedAt: "2026-04-02T00:00:00.000Z" }],
        threads,
      }),
    ).toBeNull();
  });
});
