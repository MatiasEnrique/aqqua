import { describe, expect, it } from "vite-plus/test";

import {
  BoardId,
  BoardStepId,
  CardId,
  CardOperationId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type {
  OrchestrationBoard,
  OrchestrationCard,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@t3tools/contracts";

import { cardOperationFailure, groupBoardCards, selectNextCardAfter } from "./boards.ts";
import { applyShellStreamEvent } from "./shellReducer.ts";

/** A card the server has claimed for deletion, as it arrives on the stream. */
const deletingClaim = {
  kind: "deleting",
  operationId: CardOperationId.make("operation-1"),
  requestedAt: "2026-04-02T00:00:00.000Z",
} as const satisfies NonNullable<OrchestrationCard["operation"]>;

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  boards: [],
  cards: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubBoard: OrchestrationBoard = {
  id: BoardId.make("board-1"),
  projectId: ProjectId.make("project-1"),
  name: "Delivery",
  steps: [
    {
      id: BoardStepId.make("step-1"),
      name: "Implement",
      promptTemplate: "Do ${issue_id}",
      profileName: "implementer" as OrchestrationBoard["steps"][number]["profileName"],
      continuation: "auto",
    },
  ],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  deletedAt: null,
};

const stubCard: OrchestrationCard = {
  id: CardId.make("card-1"),
  boardId: BoardId.make("board-1"),
  projectId: ProjectId.make("project-1"),
  title: "T3-482",
  parameters: { issue_id: "T3-482" },
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
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  describe("board-upserted", () => {
    it("adds a new board", () => {
      const next = applyShellStreamEvent(baseSnapshot, {
        kind: "board-upserted",
        sequence: 7,
        board: stubBoard,
      });

      expect(next.boards).toHaveLength(1);
      expect(next.boards[0]?.id).toBe("board-1");
      expect(next.snapshotSequence).toBe(7);
    });

    it("replaces an existing board in place", () => {
      const snapshotWithBoard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        boards: [{ ...stubBoard, id: BoardId.make("board-0") }, stubBoard],
      };

      const next = applyShellStreamEvent(snapshotWithBoard, {
        kind: "board-upserted",
        sequence: 8,
        board: { ...stubBoard, name: "Renamed" },
      });

      expect(next.boards).toHaveLength(2);
      expect(next.boards[0]?.id).toBe("board-0");
      expect(next.boards[1]?.name).toBe("Renamed");
    });

    it("ignores stale board upserts", () => {
      const snapshotWithBoard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        snapshotSequence: 9,
        boards: [stubBoard],
      };

      const next = applyShellStreamEvent(snapshotWithBoard, {
        kind: "board-upserted",
        sequence: 9,
        board: { ...stubBoard, name: "Stale" },
      });

      expect(next).toBe(snapshotWithBoard);
      expect(next.boards[0]?.name).toBe("Delivery");
    });
  });

  describe("board-removed", () => {
    it("removes the board and leaves cards to the server's own events", () => {
      const snapshotWithBoard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        boards: [stubBoard],
        cards: [stubCard],
      };

      const next = applyShellStreamEvent(snapshotWithBoard, {
        kind: "board-removed",
        sequence: 10,
        boardId: BoardId.make("board-1"),
      });

      expect(next.boards).toHaveLength(0);
      expect(next.cards).toHaveLength(1);
      expect(next.snapshotSequence).toBe(10);
    });
  });

  describe("card-upserted", () => {
    it("adds a new card", () => {
      const next = applyShellStreamEvent(baseSnapshot, {
        kind: "card-upserted",
        sequence: 11,
        card: stubCard,
      });

      expect(next.cards).toHaveLength(1);
      expect(next.cards[0]?.id).toBe("card-1");
      expect(next.snapshotSequence).toBe(11);
    });

    it("updates an existing card without reordering it", () => {
      const otherCard: OrchestrationCard = { ...stubCard, id: CardId.make("card-2") };
      const snapshotWithCards: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        cards: [stubCard, otherCard],
      };

      const next = applyShellStreamEvent(snapshotWithCards, {
        kind: "card-upserted",
        sequence: 12,
        card: { ...stubCard, position: { kind: "step", stepIndex: 0 }, status: "running" },
      });

      expect(next.cards).toHaveLength(2);
      expect(next.cards[0]?.status).toBe("running");
      expect(next.cards[0]?.position).toEqual({ kind: "step", stepIndex: 0 });
      expect(next.cards[1]?.id).toBe("card-2");
    });

    it("drops a card out of the board's sections as soon as the delete operation projects", () => {
      const snapshotWithCard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        cards: [stubCard],
      };

      const next = applyShellStreamEvent(snapshotWithCard, {
        kind: "card-upserted",
        sequence: 12,
        card: { ...stubCard, operation: deletingClaim },
      });

      // The card is still in the snapshot — the server owns when it physically
      // goes — but the board no longer offers it anywhere the user can act.
      expect(next.cards).toHaveLength(1);
      const sections = groupBoardCards(next.cards);
      expect(sections.todo).toHaveLength(0);
      expect(sections.deleting.map((card) => card.id)).toEqual(["card-1"]);
      expect(selectNextCardAfter(sections, CardId.make("card-2"))).toBeNull();
    });

    it("returns a card to its section, with its reason, when the deletion fails", () => {
      const snapshotWithCard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        cards: [{ ...stubCard, operation: deletingClaim }],
      };

      const next = applyShellStreamEvent(snapshotWithCard, {
        kind: "card-upserted",
        sequence: 13,
        card: { ...stubCard, operation: null, lastError: "worktree is locked" },
      });

      const sections = groupBoardCards(next.cards);
      expect(sections.todo.map((card) => card.id)).toEqual(["card-1"]);
      expect(sections.deleting).toHaveLength(0);
      expect(cardOperationFailure(next.cards[0] as OrchestrationCard)).toBe("worktree is locked");
    });
  });

  describe("card-removed", () => {
    it("removes a card by id", () => {
      const snapshotWithCard: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        cards: [stubCard],
      };

      const next = applyShellStreamEvent(snapshotWithCard, {
        kind: "card-removed",
        sequence: 13,
        cardId: CardId.make("card-1"),
      });

      expect(next.cards).toHaveLength(0);
      expect(next.snapshotSequence).toBe(13);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});
