import { describe, expect, it } from "vite-plus/test";

import {
  BoardId,
  CardId,
  CardOperationId,
  CONTINUABLE_CARD_STATUSES,
  ProjectId,
} from "@t3tools/contracts";
import type { OrchestrationBoard, OrchestrationCard } from "@t3tools/contracts";

import {
  cardActionAvailability,
  type CardOperationKind,
} from "@t3tools/client-runtime/state/boards";

import {
  buildPositionSegments,
  cardFailureNote,
  cardOperationPresentation,
  cardPositionLabel,
  cardSidebarSummaryState,
  cardStatusLine,
  cardStatusPresentation,
  cardWorktreeLabel,
  currentSegmentVariant,
  formatElapsed,
  inFlightRowActions,
  sidebarBoardChoiceAfterSettle,
  sidebarFallbackBoard,
  summarizeCardParameters,
} from "./BoardRunTable.logic";

const STEP_NAMES = ["Plan", "Implement", "Review"];

function board(id: string): OrchestrationBoard {
  return {
    id: BoardId.make(id),
    projectId: ProjectId.make("project-1"),
    name: id,
    steps: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
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

/** How a projected card carries the server's durable operation columns. */
function withOperation(
  subject: OrchestrationCard,
  kind: CardOperationKind | null,
  lastError: string | null = null,
): OrchestrationCard {
  return {
    ...subject,
    operation:
      kind === null
        ? null
        : ({
            kind,
            operationId: CardOperationId.make("operation-1"),
            requestedAt: "2026-04-02T00:00:00.000Z",
            toStepIndex: 1,
            stepIndex: 0,
            activeThreadId: null,
            threadIds: [],
          } as NonNullable<OrchestrationCard["operation"]>),
    lastError,
  };
}

describe("buildPositionSegments", () => {
  it("leaves the track empty for backlog cards", () => {
    expect(buildPositionSegments(card(), STEP_NAMES).map((s) => s.state)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("fills the track for done cards", () => {
    expect(
      buildPositionSegments(card({ position: { kind: "done" } }), STEP_NAMES).map((s) => s.state),
    ).toEqual(["complete", "complete", "complete"]);
  });

  it("marks the current step and everything behind it", () => {
    const segments = buildPositionSegments(
      card({ position: { kind: "step", stepIndex: 1 } }),
      STEP_NAMES,
    );
    expect(segments.map((s) => s.state)).toEqual(["complete", "current", "pending"]);
    expect(segments.map((s) => s.stepName)).toEqual(STEP_NAMES);
  });
});

describe("cardStatusPresentation", () => {
  it("maps each status onto the badge recipe", () => {
    expect(cardStatusPresentation(card({ status: "running" }))?.variant).toBe("info");
    expect(cardStatusPresentation(card({ status: "needs-input" }))?.variant).toBe("warning");
    expect(cardStatusPresentation(card({ status: "paused" }))?.variant).toBe("warning");
    expect(cardStatusPresentation(card({ status: "failed" }))?.variant).toBe("error");
    expect(cardStatusPresentation(card({ status: "cancelled" }))?.variant).toBe("secondary");
    expect(cardStatusPresentation(card({ status: "deleting" }))?.label).toBe("Deleting");
  });

  it("shows Done for completed cards regardless of a stale status", () => {
    const presentation = cardStatusPresentation(
      card({ position: { kind: "done" }, status: "running" }),
    );
    expect(presentation).toEqual({ label: "Done", variant: "success" });
  });

  it("has no badge for a clean backlog card", () => {
    expect(cardStatusPresentation(card())).toBeNull();
  });

  it("colors the current segment with the status", () => {
    expect(currentSegmentVariant(card({ status: "failed" }))).toBe("error");
    expect(currentSegmentVariant(card())).toBe("info");
  });
});

describe("cardOperationPresentation", () => {
  it("names every operation the board can be running", () => {
    expect(cardOperationPresentation("starting")).toEqual({ label: "Starting", variant: "info" });
    expect(cardOperationPresentation("advancing")).toEqual({ label: "Advancing", variant: "info" });
    expect(cardOperationPresentation("retrying")).toEqual({ label: "Retrying", variant: "info" });
    expect(cardOperationPresentation("resetting")).toEqual({
      label: "Resetting",
      variant: "warning",
    });
    expect(cardOperationPresentation("deleting")).toEqual({
      label: "Deleting",
      variant: "secondary",
    });
  });

  it("lets the operation outrank position and status on the badge", () => {
    expect(cardStatusPresentation(withOperation(card({ status: "paused" }), "retrying"))).toEqual({
      label: "Retrying",
      variant: "info",
    });
    expect(
      cardStatusPresentation(withOperation(card({ position: { kind: "done" } }), "deleting"))
        ?.label,
    ).toBe("Deleting");
  });

  it("keeps rendering a legacy cancelled card sensibly", () => {
    expect(cardStatusPresentation(card({ status: "cancelled" }))).toEqual({
      label: "Cancelled",
      variant: "secondary",
    });
  });
});

describe("cardFailureNote", () => {
  it("surfaces the persisted reason a failed operation left behind", () => {
    expect(cardFailureNote(withOperation(card(), null, "worktree is locked"))).toBe(
      "worktree is locked",
    );
  });

  it("stays quiet while an operation is still running or never failed", () => {
    expect(cardFailureNote(card())).toBeNull();
    expect(cardFailureNote(withOperation(card(), "deleting"))).toBeNull();
  });

  it("marks a card that failed its last operation as needing you", () => {
    const failed = withOperation(card(), null, "cleanup failed");
    expect(cardStatusPresentation(failed)).toEqual({ label: "Failed", variant: "error" });
    expect(cardSidebarSummaryState(failed)).toBe("stale");
  });
});

describe("cardSidebarSummaryState", () => {
  it("uses the same lifecycle vocabulary as conversation rows", () => {
    expect(cardSidebarSummaryState(card({ status: "running" }))).toBe("working");
    expect(cardSidebarSummaryState(card({ status: "paused" }))).toBe("needsInput");
    expect(cardSidebarSummaryState(card({ status: "needs-input" }))).toBe("needsInput");
    expect(cardSidebarSummaryState(card({ status: "cancelled" }))).toBe("stale");
    expect(cardSidebarSummaryState(card({ status: "failed" }))).toBe("stale");
    expect(
      cardSidebarSummaryState(card({ status: "deleting", settledAt: "2026-04-02T00:00:00.000Z" })),
    ).toBe("working");
    expect(cardSidebarSummaryState(card({ position: { kind: "done" } }))).toBe("done");
    expect(
      cardSidebarSummaryState(
        card({ position: { kind: "done" }, settledAt: "2026-04-02T00:00:00.000Z" }),
      ),
    ).toBe("settled");
  });
});

describe("sidebarBoardChoiceAfterSettle", () => {
  it("pins a route-following sidebar to the settled card's board", () => {
    expect(sidebarBoardChoiceAfterSettle(null, BoardId.make("board-second"))).toBe("board-second");
  });

  it("preserves an explicit board or All selection", () => {
    expect(sidebarBoardChoiceAfterSettle("board-first", BoardId.make("board-second"))).toBe(
      "board-first",
    );
    expect(sidebarBoardChoiceAfterSettle("all", BoardId.make("board-second"))).toBe("all");
  });
});

describe("sidebarFallbackBoard", () => {
  it("uses a populated board before an empty oldest board", () => {
    const emptyBoard = board("board-empty");
    const populatedBoard = board("board-populated");
    const settledCard = card({
      boardId: populatedBoard.id,
      position: { kind: "done" },
      settledAt: "2026-07-31T20:04:23.269Z",
    });

    expect(sidebarFallbackBoard([emptyBoard, populatedBoard], [settledCard])?.id).toBe(
      populatedBoard.id,
    );
  });

  it("uses the oldest board when the project has no cards", () => {
    const oldest = board("board-oldest");
    expect(sidebarFallbackBoard([oldest, board("board-newer")], [])).toBe(oldest);
  });

  it("does not count a card being deleted as making its board populated", () => {
    const oldest = board("board-oldest");
    const other = board("board-other");
    const leaving = withOperation(card({ boardId: other.id }), "deleting");

    expect(sidebarFallbackBoard([oldest, other], [leaving])).toBe(oldest);
  });
});

describe("cardPositionLabel", () => {
  it("names the section for To-Do and Done", () => {
    expect(cardPositionLabel(card(), STEP_NAMES)).toBe("To-Do");
    expect(cardPositionLabel(card({ position: { kind: "done" } }), STEP_NAMES)).toBe("Done");
  });

  it("numbers the step it sits in", () => {
    expect(cardPositionLabel(card({ position: { kind: "step", stepIndex: 2 } }), STEP_NAMES)).toBe(
      "3 · Review",
    );
  });

  it("falls back to the index when the snapshot has fewer names", () => {
    expect(cardPositionLabel(card({ position: { kind: "step", stepIndex: 4 } }), STEP_NAMES)).toBe(
      "Step 5",
    );
  });
});

describe("formatElapsed", () => {
  const start = "2026-04-01T00:00:00.000Z";
  const startMs = Date.parse(start);

  it("returns nothing for an unreleased card", () => {
    expect(formatElapsed(null, startMs)).toBeNull();
  });

  it("steps down through seconds, minutes, hours and days", () => {
    expect(formatElapsed(start, startMs + 12_000)).toBe("12s");
    expect(formatElapsed(start, startMs + 4 * 60_000)).toBe("4m");
    expect(formatElapsed(start, startMs + 60 * 60_000)).toBe("1h");
    expect(formatElapsed(start, startMs + 72 * 60_000)).toBe("1h 12m");
    expect(formatElapsed(start, startMs + 26 * 60 * 60_000)).toBe("1d 2h");
    expect(formatElapsed(start, startMs + 48 * 60 * 60_000)).toBe("2d");
  });

  it("never goes negative on clock skew", () => {
    expect(formatElapsed(start, startMs - 5_000)).toBe("0s");
  });

  it("ignores an unparseable timestamp", () => {
    expect(formatElapsed("not-a-date", startMs)).toBeNull();
  });
});

describe("summarizeCardParameters", () => {
  it("lists parameters in template order and skips blanks", () => {
    expect(
      summarizeCardParameters({ scope: "web", issue_id: "T3-482", note: "  " }, [
        "issue_id",
        "scope",
        "note",
      ]),
    ).toBe("issue_id: T3-482 · scope: web");
  });

  it("returns nothing when the card carries no values", () => {
    expect(summarizeCardParameters({}, ["issue_id"])).toBeNull();
  });
});

describe("cardStatusLine", () => {
  const nowMs = Date.parse("2026-04-01T00:12:00.000Z");
  const inStep = (stepIndex: number, overrides: Partial<OrchestrationCard> = {}) =>
    card({ position: { kind: "step", stepIndex }, ...overrides });

  it("names and counts the step, with elapsed time while running", () => {
    expect(
      cardStatusLine(
        inStep(1, { status: "running", releasedAt: "2026-04-01T00:00:00.000Z" }),
        STEP_NAMES,
        nowMs,
      ),
    ).toBe("Implement 2/3 · 12m");
  });

  it("drops the elapsed half when the card is not running", () => {
    expect(cardStatusLine(inStep(2), STEP_NAMES, nowMs)).toBe("Review 3/3");
  });

  it("says running when a running card has no release time to measure from", () => {
    expect(cardStatusLine(inStep(0, { status: "running" }), STEP_NAMES, nowMs)).toBe(
      "Plan 1/3 · running",
    );
  });

  it("falls back to the ordinal when the pipeline has no name for the step", () => {
    expect(cardStatusLine(inStep(4), STEP_NAMES, nowMs)).toBe("Step 5");
  });

  it("counts nothing for cards that are not in a step", () => {
    expect(cardStatusLine(card(), STEP_NAMES, nowMs)).toBe("To-Do");
    expect(cardStatusLine(card({ position: { kind: "done" } }), STEP_NAMES, nowMs)).toBe("Done");
  });
});

describe("cardWorktreeLabel", () => {
  it("drops the board namespace and keeps the full truth in the tooltip", () => {
    expect(
      cardWorktreeLabel(
        card({ branch: "board/implement-dev-30-a1b2", worktreePath: "/tmp/wt/implement-dev-30" }),
      ),
    ).toEqual({
      label: "implement-dev-30-a1b2",
      title: "board/implement-dev-30-a1b2\n/tmp/wt/implement-dev-30",
    });
  });

  it("leaves a branch outside the board namespace alone", () => {
    expect(cardWorktreeLabel(card({ branch: "feature/adopted" }))?.label).toBe("feature/adopted");
  });

  it("keeps the branch when the namespace is all there is", () => {
    expect(cardWorktreeLabel(card({ branch: "board/" }))?.label).toBe("board/");
  });

  it("says nothing for a card that has not been released", () => {
    expect(cardWorktreeLabel(card())).toBeNull();
  });
});

describe("inFlightRowActions", () => {
  const inStep = (status: OrchestrationCard["status"]) =>
    inFlightRowActions(card({ position: { kind: "step", stepIndex: 1 }, status }));

  it("offers cancel only while a turn is running", () => {
    expect(inStep("running")).toEqual({ cancel: true, retry: false, continue: false });
  });

  it("offers retry on every flagged status", () => {
    for (const status of CONTINUABLE_CARD_STATUSES) {
      expect(inStep(status).retry).toBe(true);
    }
  });

  it("offers continue on every continuable status, exactly as the detail composer does", () => {
    // A row and the card's own composer answer the same question about the
    // same card; `Continue` doubles as "mark this step done" on a stuck one,
    // so parking it behind `paused` alone contradicted the detail view.
    for (const status of CONTINUABLE_CARD_STATUSES) {
      const parked = card({ position: { kind: "step", stepIndex: 1 }, status });
      expect(inFlightRowActions(parked).continue).toBe(true);
      expect(cardActionAvailability(parked).canContinue).toBe(true);
    }
  });

  it("withholds continue from a running or unflagged step", () => {
    for (const status of ["running", null] as const) {
      const step = card({ position: { kind: "step", stepIndex: 1 }, status });
      expect(inFlightRowActions(step).continue).toBe(false);
      expect(cardActionAvailability(step).canContinue).toBe(false);
    }
  });

  it("offers nothing on a clean run or outside the pipeline", () => {
    expect(inStep(null)).toEqual({ cancel: false, retry: false, continue: false });
    expect(inFlightRowActions(card())).toEqual({ cancel: false, retry: false, continue: false });
    expect(inFlightRowActions(card({ position: { kind: "done" } }))).toEqual({
      cancel: false,
      retry: false,
      continue: false,
    });
  });

  it("offers nothing while the server is running an operation on the card", () => {
    // Same answer the composer's own availability gives — a row and a composer
    // looking at one card must not disagree about what it can do.
    const parked = card({ position: { kind: "step", stepIndex: 1 }, status: "paused" });
    expect(inFlightRowActions(parked)).toEqual({ cancel: false, retry: true, continue: true });

    for (const operation of [
      "starting",
      "advancing",
      "retrying",
      "resetting",
      "deleting",
    ] as const) {
      expect(inFlightRowActions(withOperation(parked, operation))).toEqual({
        cancel: false,
        retry: false,
        continue: false,
      });
    }

    const running = card({ position: { kind: "step", stepIndex: 1 }, status: "running" });
    expect(inFlightRowActions(withOperation(running, "resetting")).cancel).toBe(false);
  });
});
