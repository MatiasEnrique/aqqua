import { describe, expect, it } from "vite-plus/test";

import { BoardId, BoardStepId, CardId, ProjectId } from "@t3tools/contracts";
import type { BoardStep, OrchestrationBoard, OrchestrationCard } from "@t3tools/contracts";

import {
  boardArtifactFileName,
  cardActionAvailability,
  cardArtifactProvenance,
  cardCurrentThreadId,
  cardStepCount,
  cardStepNames,
  cardStepThreadId,
  countCardsNeedingYou,
  groupBoardCards,
  selectBoardCards,
  selectCard,
  selectCardSteps,
  selectProjectBoard,
  selectProjectBoards,
  selectSubAgentThreads,
} from "./boards.ts";
import { ThreadId } from "@t3tools/contracts";

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
    title: "T3-482",
    parameters: {},
    position: { kind: "todo" },
    status: null,
    snapshot: null,
    branch: null,
    worktreePath: null,
    stepThreads: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    releasedAt: null,
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("selectProjectBoards", () => {
  it("keeps only the project's live boards, oldest first", () => {
    const boards = [
      board({ id: BoardId.make("b-new"), createdAt: "2026-04-03T00:00:00.000Z" }),
      board({ id: BoardId.make("b-deleted"), deletedAt: "2026-04-02T00:00:00.000Z" }),
      board({ id: BoardId.make("b-other"), projectId: ProjectId.make("project-2") }),
      board({ id: BoardId.make("b-old"), createdAt: "2026-04-01T00:00:00.000Z" }),
    ];

    expect(selectProjectBoards(boards, ProjectId.make("project-1")).map((b) => b.id)).toEqual([
      "b-old",
      "b-new",
    ]);
  });

  it("returns the oldest live board as the project's board", () => {
    const boards = [
      board({ id: BoardId.make("b-new"), createdAt: "2026-04-03T00:00:00.000Z" }),
      board({ id: BoardId.make("b-old"), createdAt: "2026-04-01T00:00:00.000Z" }),
    ];

    expect(selectProjectBoard(boards, ProjectId.make("project-1"))?.id).toBe("b-old");
    expect(selectProjectBoard(boards, ProjectId.make("project-9"))).toBeNull();
  });
});

describe("selectBoardCards", () => {
  it("drops archived cards and cards from other boards", () => {
    const cards = [
      card({ id: CardId.make("c-1"), createdAt: "2026-04-02T00:00:00.000Z" }),
      card({ id: CardId.make("c-archived"), archivedAt: "2026-04-04T00:00:00.000Z" }),
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
  it("splits cards by position and orders in-flight rows by newest release", () => {
    const cards = [
      card({ id: CardId.make("todo-1") }),
      card({
        id: CardId.make("flight-old"),
        position: { kind: "step", stepIndex: 0 },
        releasedAt: "2026-04-01T00:00:00.000Z",
      }),
      card({ id: CardId.make("done-1"), position: { kind: "done" } }),
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
  });

  it("returns empty sections for an empty board", () => {
    const sections = groupBoardCards([]);
    expect(sections.todo).toHaveLength(0);
    expect(sections.inFlight).toHaveLength(0);
    expect(sections.done).toHaveLength(0);
  });
});

describe("card step tracks", () => {
  it("measures a released card against its own snapshot, not the live board", () => {
    const released = card({
      position: { kind: "step", stepIndex: 0 },
      snapshot: { name: "Delivery", steps: [step("Implement")] },
    });
    const edited = board({ steps: [step("Plan"), step("Implement"), step("Review")] });

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
      snapshot: { name: "Delivery", steps: [step("Plan"), step("Implement"), step("Review")] },
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
      { id: ThreadId.make("sub-b"), parentThreadId: ThreadId.make("step-1"), createdAt: "b" },
      { id: ThreadId.make("sub-a"), parentThreadId: ThreadId.make("step-1"), createdAt: "a" },
      { id: ThreadId.make("other"), parentThreadId: ThreadId.make("step-2"), createdAt: "a" },
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
      snapshot: { name: "Delivery", steps: [step("Only"), templatedStep("Next", "${artifact}")] },
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
      card({ id: CardId.make("a"), position: { kind: "step", stepIndex: 0 }, status: "paused" }),
      card({
        id: CardId.make("b"),
        position: { kind: "step", stepIndex: 0 },
        status: "needs-input",
      }),
      card({ id: CardId.make("c"), position: { kind: "step", stepIndex: 0 }, status: "running" }),
      card({ id: CardId.make("d"), position: { kind: "step", stepIndex: 0 }, status: "failed" }),
      card({ id: CardId.make("e") }),
    ];

    expect(countCardsNeedingYou(cards)).toBe(2);
  });

  it("offers cancel while running and retry/continue once flagged", () => {
    const running = card({ position: { kind: "step", stepIndex: 0 }, status: "running" });
    expect(cardActionAvailability(running)).toEqual({
      canCancel: true,
      canRetry: false,
      canContinue: false,
    });

    const paused = card({ position: { kind: "step", stepIndex: 0 }, status: "paused" });
    expect(cardActionAvailability(paused)).toEqual({
      canCancel: false,
      canRetry: true,
      canContinue: true,
    });

    const failed = card({ position: { kind: "step", stepIndex: 0 }, status: "failed" });
    expect(cardActionAvailability(failed).canContinue).toBe(true);
  });

  it("offers nothing on backlog and done cards", () => {
    expect(cardActionAvailability(card())).toEqual({
      canCancel: false,
      canRetry: false,
      canContinue: false,
    });
    expect(cardActionAvailability(card({ position: { kind: "done" } })).canRetry).toBe(false);
  });
});
