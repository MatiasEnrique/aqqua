import { describe, expect, it } from "vite-plus/test";

import {
  BoardId,
  BoardStepId,
  CardId,
  CardOperationId,
  ProjectId,
  ThreadId,
  type BoardStep,
  type OrchestrationBoard,
  type OrchestrationCard,
} from "@t3tools/contracts";

import type { CardOperationKind } from "@t3tools/client-runtime/state/boards";

import {
  artifactCompletionRevision,
  buildCardTree,
  cardComposerOperation,
  defaultCardSelection,
  isPendingOperationResolved,
  type PendingCardOperation,
  formatArtifactSize,
  formatCardSelection,
  formatDiffFilesLabel,
  parseCardSelection,
  resolveCardSelection,
  selectionThreadId,
  type CardTreeThread,
} from "./CardDetail.logic";

const NOW = Date.parse("2026-04-01T01:00:00.000Z");

function step(name: string, promptTemplate = `Do ${name}`): BoardStep {
  return {
    id: BoardStepId.make(`step-${name}`),
    name,
    promptTemplate,
    profileName: "implementer" as BoardStep["profileName"],
    continuation: "auto",
  };
}

function board(overrides: Partial<OrchestrationBoard> = {}): OrchestrationBoard {
  return {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: [step("Plan"), step("Implement"), step("Review")],
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
    position: { kind: "step", stepIndex: 1 },
    status: "running",
    operation: null,
    lastError: null,
    snapshot: null,
    branch: "board/t3-482",
    worktreePath: "/tmp/wt",
    stepThreads: [
      { stepIndex: 0, threadId: ThreadId.make("thread-plan"), spawnedAt: "2026-04-01T00:00:00Z" },
      {
        stepIndex: 1,
        threadId: ThreadId.make("thread-implement"),
        spawnedAt: "2026-04-01T00:30:00Z",
      },
    ],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    releasedAt: "2026-04-01T00:00:00.000Z",
    completedAt: null,
    settledAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function thread(overrides: Omit<Partial<CardTreeThread>, "id"> & { id: string }): CardTreeThread {
  return {
    title: "Thread",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:20:00.000Z",
    isWorking: false,
    needsInput: false,
    ...overrides,
    id: ThreadId.make(overrides.id),
  };
}

describe("card selection round trip", () => {
  it("survives the URL", () => {
    const selections = [
      { kind: "step", stepIndex: 2 },
      { kind: "artifact", stepIndex: 0 },
      { kind: "subagent", stepIndex: 1, threadId: ThreadId.make("sub-1") },
    ] as const;

    for (const selection of selections) {
      expect(parseCardSelection(formatCardSelection(selection))).toEqual(selection);
    }
  });

  it("rejects nonsense instead of guessing", () => {
    expect(parseCardSelection(null)).toBeNull();
    expect(parseCardSelection("")).toBeNull();
    expect(parseCardSelection("step:-1")).toBeNull();
    expect(parseCardSelection("step:abc")).toBeNull();
    expect(parseCardSelection("sub:1")).toBeNull();
    expect(parseCardSelection("artifact")).toBeNull();
  });
});

describe("resolveCardSelection", () => {
  const noSubAgents: ReadonlySet<string> = new Set();

  it("defaults to the step the card sits in", () => {
    expect(defaultCardSelection(card(), board())).toEqual({ kind: "step", stepIndex: 1 });
  });

  it("defaults a Done card to its last step with a thread", () => {
    const done = card({ position: { kind: "done" }, completedAt: "2026-04-01T00:45:00.000Z" });
    expect(defaultCardSelection(done, board())).toEqual({ kind: "step", stepIndex: 1 });
  });

  it("falls back when a board edit removed the selected step", () => {
    const resolved = resolveCardSelection({
      card: card(),
      board: board(),
      requested: { kind: "step", stepIndex: 7 },
      subAgentThreadIds: noSubAgents,
    });
    expect(resolved).toEqual({ kind: "step", stepIndex: 1 });
  });

  it("drops a sub-agent selection that no longer exists, keeping its step", () => {
    const resolved = resolveCardSelection({
      card: card(),
      board: board(),
      requested: { kind: "subagent", stepIndex: 0, threadId: ThreadId.make("ghost") },
      subAgentThreadIds: noSubAgents,
    });
    expect(resolved).toEqual({ kind: "step", stepIndex: 0 });
  });

  it("keeps a live sub-agent selection", () => {
    const requested = {
      kind: "subagent",
      stepIndex: 0,
      threadId: ThreadId.make("sub-1"),
    } as const;
    const resolved = resolveCardSelection({
      card: card(),
      board: board(),
      requested,
      subAgentThreadIds: new Set(["sub-1"]),
    });
    expect(resolved).toEqual(requested);
  });
});

describe("selectionThreadId", () => {
  it("binds an artifact to its own step's thread", () => {
    expect(selectionThreadId(card(), { kind: "artifact", stepIndex: 0 })).toBe("thread-plan");
  });

  it("binds a sub-agent selection to the sub-agent", () => {
    expect(
      selectionThreadId(card(), {
        kind: "subagent",
        stepIndex: 1,
        threadId: ThreadId.make("sub-1"),
      }),
    ).toBe("sub-1");
  });
});

describe("buildCardTree", () => {
  const threads = [
    thread({ id: "thread-plan", title: "Plan", updatedAt: "2026-04-01T00:25:00.000Z" }),
    thread({ id: "thread-implement", title: "Implement", isWorking: true }),
    thread({
      id: "sub-1",
      title: "correctness sweep",
      parentThreadId: ThreadId.make("thread-implement"),
      createdAt: "2026-04-01T00:40:00.000Z",
      updatedAt: "2026-04-01T00:50:00.000Z",
    }),
  ];

  function tree(overrides: Partial<Parameters<typeof buildCardTree>[0]> = {}) {
    return buildCardTree({
      card: card(),
      board: board(),
      threads,
      diffByThreadId: new Map([
        ["thread-implement", { filesChanged: 14, additions: 214, deletions: 31 }],
      ]),
      artifactByStepIndex: new Map([[0, { exists: true, sizeBytes: 3482 }]]),
      nowMs: NOW,
      ...overrides,
    });
  }

  it("renders one row per step of the card's own pipeline", () => {
    expect(tree().steps.map((row) => row.label)).toEqual([
      "1 · Plan",
      "2 · Implement",
      "3 · Review",
    ]);
  });

  it("takes step icons from the card's status, only on the step it sits in", () => {
    expect(tree().steps.map((row) => row.status)).toEqual(["done", "working", "idle"]);

    const flagged = tree({ card: card({ status: "paused" }) });
    expect(flagged.steps[1]?.status).toBe("needsInput");

    const failed = tree({ card: card({ status: "failed" }) });
    expect(failed.steps[1]?.status).toBe("failed");

    const deleting = tree({ card: card({ status: "deleting" }) });
    expect(deleting.steps[1]?.status).toBe("idle");
  });

  it("hangs sub-agents and the diff off active steps, and artifacts only off finished steps", () => {
    const rows = tree().steps;

    expect(rows[0]?.leaves.map((leaf) => leaf.kind)).toEqual(["diff", "artifact"]);
    expect(rows[1]?.leaves.map((leaf) => leaf.kind)).toEqual(["subagent", "diff"]);
    // A step that has not run has no thread and no artifact on disk yet.
    expect(rows[2]?.leaves).toHaveLength(0);
  });

  it("labels the diff leaf from the thread's own stats", () => {
    const diff = tree().steps[1]?.leaves.find((leaf) => leaf.kind === "diff");
    expect(diff).toMatchObject({ label: "14 files changed" });
    const unknown = tree().steps[0]?.leaves.find((leaf) => leaf.kind === "diff");
    expect(unknown).toMatchObject({ label: "Changes", stat: null });
  });

  it("shows an artifact's size once its step is done and never exposes a draft row", () => {
    const written = tree().steps[0]?.leaves.find((leaf) => leaf.kind === "artifact");
    expect(written).toMatchObject({ fileName: "Plan.md", trailing: "3.4 KB" });

    const pending = tree().steps[1]?.leaves.find((leaf) => leaf.kind === "artifact");
    expect(pending).toBeUndefined();

    const paused = tree({ card: card({ status: "paused" }) });
    expect(paused.steps[1]?.leaves.find((leaf) => leaf.kind === "artifact")).toMatchObject({
      fileName: "Implement.md",
      trailing: null,
    });
  });

  it("times a finished step to its last update and a running one to now", () => {
    const rows = tree().steps;
    expect(rows[0]?.trailing).toBe("25m");
    expect(rows[1]?.trailing).toBe("1h");
    expect(rows[2]?.trailing).toBeNull();
  });

  it("keeps Done a terminal row until the card gets there", () => {
    expect(tree().done).toEqual({ reached: false, trailing: "not reached" });

    const finished = tree({
      card: card({ position: { kind: "done" }, completedAt: "2026-04-01T00:45:00.000Z" }),
    });
    expect(finished.done).toEqual({ reached: true, trailing: "45m" });
  });
});

describe("tree labels", () => {
  it("formats file weights", () => {
    expect(formatArtifactSize(512)).toBe("512 B");
    expect(formatArtifactSize(3482)).toBe("3.4 KB");
    expect(formatArtifactSize(204_800)).toBe("200 KB");
  });

  it("singularizes a one-file diff", () => {
    expect(formatDiffFilesLabel({ filesChanged: 1, additions: 2, deletions: 0 })).toBe(
      "1 file changed",
    );
    expect(formatDiffFilesLabel(null)).toBe("Changes");
  });
});

describe("artifactCompletionRevision", () => {
  it("changes from absent to the card revision only when a step finishes", () => {
    expect(artifactCompletionRevision(card(), 1)).toBeNull();
    expect(
      artifactCompletionRevision(
        card({ status: "paused", updatedAt: "2026-04-01T02:00:00.000Z" }),
        1,
      ),
    ).toBe("2026-04-01T02:00:00.000Z");
    expect(
      artifactCompletionRevision(
        card({ position: { kind: "step", stepIndex: 2 }, updatedAt: "2026-04-01T03:00:00.000Z" }),
        1,
      ),
    ).toBe("2026-04-01T03:00:00.000Z");
  });
});

describe("the composer's pending-operation guard", () => {
  const pending: PendingCardOperation = {
    kind: "advancing",
    cardUpdatedAt: "2026-04-01T00:00:00.000Z",
  };

  function withOperation(subject: OrchestrationCard, kind: CardOperationKind): OrchestrationCard {
    return {
      ...subject,
      operation: {
        kind,
        operationId: CardOperationId.make("operation-1"),
        requestedAt: "2026-04-02T00:00:00.000Z",
        stepIndex: 0,
      } as NonNullable<OrchestrationCard["operation"]>,
    };
  }

  it("shows the clicked operation before the server has projected anything", () => {
    expect(cardComposerOperation(card({ updatedAt: pending.cardUpdatedAt }), pending)).toBe(
      "advancing",
    );
  });

  it("hands over to the server's own operation the moment it lands", () => {
    const retrying = withOperation(card({ updatedAt: pending.cardUpdatedAt }), "retrying");
    expect(cardComposerOperation(retrying, pending)).toBe("retrying");
    expect(isPendingOperationResolved(pending, retrying)).toBe(true);
  });

  it("holds the guard while the card is untouched, and releases it once it moves", () => {
    const untouched = card({ updatedAt: pending.cardUpdatedAt });
    expect(isPendingOperationResolved(pending, untouched)).toBe(false);

    const moved = card({ updatedAt: "2026-04-01T00:00:05.000Z", status: "paused" });
    expect(isPendingOperationResolved(pending, moved)).toBe(true);
    expect(cardComposerOperation(moved, null)).toBeNull();
  });

  it("releases the guard when the card leaves the board entirely", () => {
    expect(isPendingOperationResolved(pending, null)).toBe(true);
    expect(cardComposerOperation(null, pending)).toBeNull();
  });
});
