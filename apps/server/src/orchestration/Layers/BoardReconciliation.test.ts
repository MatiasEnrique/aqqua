import { describe, expect, it } from "@effect/vitest";
import {
  BoardId,
  CardId,
  CardOperationId,
  type OrchestrationCard,
  ProjectId,
  ThreadId,
} from "@aqqua/contracts";

import { makeBoardMissingCurrentRootRecoveryEvents } from "./BoardReconciliation.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function card(overrides: Partial<OrchestrationCard> = {}): OrchestrationCard {
  return {
    id: CardId.make("card-1"),
    boardId: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    title: "Test card",
    parameters: {},
    position: { kind: "step", stepIndex: 1 },
    status: "needs-input",
    operation: null,
    lastError: null,
    snapshot: { name: "Delivery", steps: [] },
    branch: "board/test",
    worktreePath: "/tmp/wt",
    stepThreads: [
      { stepIndex: 0, threadId: ThreadId.make("thread-step-0"), spawnedAt: NOW },
      { stepIndex: 1, threadId: ThreadId.make("thread-step-1"), spawnedAt: NOW },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    releasedAt: NOW,
    completedAt: null,
    settledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("makeBoardMissingCurrentRootRecoveryEvents", () => {
  it("emits one deterministic event for a missing current root", () => {
    const first = makeBoardMissingCurrentRootRecoveryEvents([card()], new Set(["thread-step-0"]));
    const second = makeBoardMissingCurrentRootRecoveryEvents([card()], new Set(["thread-step-0"]));

    expect(first).toEqual(second);
    expect(first).toMatchObject([
      {
        type: "thread.deleted",
        eventId: "board-reconcile-missing-root-card-1",
        aggregateId: "thread-step-1",
      },
    ]);
  });

  it("ignores cards that are healthy or already governed by another state", () => {
    const resetting = card({
      id: CardId.make("card-resetting"),
      operation: {
        kind: "resetting",
        operationId: CardOperationId.make("op-reset"),
        requestedAt: NOW,
        activeThreadId: ThreadId.make("thread-step-1"),
        threadIds: [ThreadId.make("thread-step-1")],
      },
    });
    const guarded = [
      card({ id: CardId.make("card-failed"), status: "failed" }),
      card({ id: CardId.make("card-archived"), archivedAt: NOW }),
      card({ id: CardId.make("card-deleting"), status: "deleting" }),
      resetting,
    ];

    expect(makeBoardMissingCurrentRootRecoveryEvents(guarded, new Set())).toEqual([]);
    expect(makeBoardMissingCurrentRootRecoveryEvents([card()], new Set(["thread-step-1"]))).toEqual(
      [],
    );
  });
});
