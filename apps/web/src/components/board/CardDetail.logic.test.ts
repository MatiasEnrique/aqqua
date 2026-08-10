import { describe, expect, it } from "vite-plus/test";

import {
  BoardId,
  BoardStepId,
  CardId,
  CardOperationId,
  ProviderDriverKind,
  ProjectId,
  ThreadId,
  type BoardStep,
  type OrchestrationBoard,
  type OrchestrationCard,
} from "@aqqua/contracts";

import type { CardOperationKind } from "@aqqua/client-runtime/state/boards";

import {
  artifactVisibilityRevision,
  buildCardTree,
  cardComposerOperation,
  cardThreadRecovery,
  defaultCardSelection,
  isPendingOperationResolved,
  type PendingCardOperation,
  formatArtifactSize,
  formatCardSelection,
  parseCardSelection,
  resolveCardSelection,
  resolveFlowTabSelection,
  resolveCardThreadPresence,
  selectCardDetailThreads,
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
    title: "aqqua-482",
    parameters: {},
    position: { kind: "step", stepIndex: 1 },
    status: "running",
    operation: null,
    lastError: null,
    snapshot: null,
    branch: "board/aqqua-482",
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
      detailThreadIds: noSubAgents,
    });
    expect(resolved).toEqual({ kind: "step", stepIndex: 1 });
  });

  it("falls back when a URL selects a phase that has not started", () => {
    const resolved = resolveCardSelection({
      card: card(),
      board: board(),
      requested: { kind: "step", stepIndex: 2 },
      detailThreadIds: noSubAgents,
    });
    expect(resolved).toEqual({ kind: "step", stepIndex: 1 });
  });

  it("drops a sub-agent selection that no longer exists, keeping its step", () => {
    const resolved = resolveCardSelection({
      card: card(),
      board: board(),
      requested: { kind: "subagent", stepIndex: 0, threadId: ThreadId.make("ghost") },
      detailThreadIds: noSubAgents,
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
      detailThreadIds: new Set(["sub-1"]),
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

  it("hangs sub-agents off active steps and artifacts only off finished steps", () => {
    const rows = tree().steps;

    expect(rows[0]?.leaves.map((leaf) => leaf.kind)).toEqual(["artifact"]);
    expect(rows[1]?.leaves.map((leaf) => leaf.kind)).toEqual(["subagent"]);
    // A step that has not run has no thread and no artifact on disk yet.
    expect(rows[2]?.leaves).toHaveLength(0);
  });

  it("keeps provider-native children out of Flow step details", () => {
    const nativeThreads = [
      ...threads,
      thread({
        id: "native-of-step",
        title: "Native plan helper",
        parentThreadId: ThreadId.make("thread-implement"),
        providerSubagent: {
          ownerThreadId: ThreadId.make("thread-implement"),
          provider: ProviderDriverKind.make("claudeAgent"),
          childId: "native-of-step",
        },
      }),
      thread({
        id: "native-of-managed-agent",
        title: "Native implementation helper",
        parentThreadId: ThreadId.make("sub-1"),
        providerSubagent: {
          ownerThreadId: ThreadId.make("sub-1"),
          provider: ProviderDriverKind.make("claudeAgent"),
          childId: "native-of-managed-agent",
        },
      }),
    ];

    const implementLeaves = tree({ threads: nativeThreads }).steps[1]?.leaves;
    expect(implementLeaves?.filter((leaf) => leaf.kind === "subagent")).toEqual([
      expect.objectContaining({ threadId: "sub-1", title: "correctness sweep" }),
    ]);
  });

  it("keeps native transcripts reachable while highlighting their Flow owner", () => {
    const nativeThreads = [
      ...threads,
      thread({
        id: "native-of-step",
        title: "Native step helper",
        parentThreadId: ThreadId.make("thread-implement"),
        providerSubagent: {
          ownerThreadId: ThreadId.make("thread-implement"),
          provider: ProviderDriverKind.make("claudeAgent"),
          childId: "native-of-step",
        },
      }),
      thread({
        id: "native-of-managed-agent",
        title: "Native managed helper",
        parentThreadId: ThreadId.make("sub-1"),
        providerSubagent: {
          ownerThreadId: ThreadId.make("sub-1"),
          provider: ProviderDriverKind.make("claudeAgent"),
          childId: "native-of-managed-agent",
        },
      }),
    ];

    const detailThreadIds = new Set(
      selectCardDetailThreads(nativeThreads, ThreadId.make("thread-implement")).map(
        (item) => item.id as string,
      ),
    );
    expect([...detailThreadIds]).toEqual(["sub-1", "native-of-step", "native-of-managed-agent"]);
    expect(
      resolveCardSelection({
        card: card(),
        board: board(),
        requested: {
          kind: "subagent",
          stepIndex: 1,
          threadId: ThreadId.make("native-of-managed-agent"),
        },
        detailThreadIds,
      }),
    ).toEqual({ kind: "subagent", stepIndex: 1, threadId: "native-of-managed-agent" });

    expect(
      resolveFlowTabSelection({
        selection: {
          kind: "subagent",
          stepIndex: 1,
          threadId: ThreadId.make("native-of-step"),
        },
        stepThreadId: ThreadId.make("thread-implement"),
        threads: nativeThreads,
      }),
    ).toEqual({ kind: "step", stepIndex: 1 });
    expect(
      resolveFlowTabSelection({
        selection: {
          kind: "subagent",
          stepIndex: 1,
          threadId: ThreadId.make("native-of-managed-agent"),
        },
        stepThreadId: ThreadId.make("thread-implement"),
        threads: nativeThreads,
      }),
    ).toEqual({ kind: "subagent", stepIndex: 1, threadId: "sub-1" });
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

  it("shows a written artifact when the current step stops for input", () => {
    const needsInput = tree({
      card: card({ status: "needs-input" }),
      artifactByStepIndex: new Map([
        [0, { exists: true, sizeBytes: 3482 }],
        [1, { exists: true, sizeBytes: 2048 }],
      ]),
    });

    expect(needsInput.steps[1]?.leaves.find((leaf) => leaf.kind === "artifact")).toMatchObject({
      fileName: "Implement.md",
      trailing: "2.0 KB",
    });
  });

  it("does not invent an artifact when a step stops for input without writing one", () => {
    const needsInput = tree({ card: card({ status: "needs-input" }) });

    expect(needsInput.steps[1]?.leaves.find((leaf) => leaf.kind === "artifact")).toBeUndefined();
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
});

describe("artifactVisibilityRevision", () => {
  it("changes from absent to the card revision when a step becomes reviewable", () => {
    expect(artifactVisibilityRevision(card(), 1)).toBeNull();
    expect(
      artifactVisibilityRevision(
        card({ status: "paused", updatedAt: "2026-04-01T02:00:00.000Z" }),
        1,
      ),
    ).toBe("2026-04-01T02:00:00.000Z");
    expect(
      artifactVisibilityRevision(
        card({ status: "needs-input", updatedAt: "2026-04-01T02:30:00.000Z" }),
        1,
      ),
    ).toBe("2026-04-01T02:30:00.000Z");
    expect(
      artifactVisibilityRevision(
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

describe("missing card conversations", () => {
  const selection = { kind: "step", stepIndex: 1 } as const;

  it("distinguishes a removed conversation from a real transition", () => {
    expect(
      resolveCardThreadPresence({
        card: card(),
        selection,
        threadId: ThreadId.make("thread-implement"),
        threadShellExists: false,
      }),
    ).toBe("unavailable");

    const advancing = card({
      stepThreads: [],
      operation: {
        kind: "advancing",
        operationId: CardOperationId.make("operation-1"),
        requestedAt: "2026-04-01T00:40:00.000Z",
        threadId: null,
        toStepIndex: 1,
      },
    });
    expect(
      resolveCardThreadPresence({
        card: advancing,
        selection,
        threadId: null,
        threadShellExists: false,
      }),
    ).toBe("preparing");
  });

  it("offers recovery only for the current step", () => {
    const failed = card({ status: "failed" });
    expect(cardThreadRecovery({ card: failed, selection })).toEqual({
      canRetryStep: true,
      canMarkDone: true,
      canReset: true,
      canDelete: true,
    });
    expect(
      cardThreadRecovery({
        card: failed,
        selection: { kind: "step", stepIndex: 0 },
      }),
    ).toEqual({ canRetryStep: false, canMarkDone: false, canReset: false, canDelete: false });
  });
});
