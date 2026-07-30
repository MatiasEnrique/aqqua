import { describe, expect, it } from "vite-plus/test";

import { BoardId, CardId, ProjectId } from "@t3tools/contracts";
import type { OrchestrationCard } from "@t3tools/contracts";

import {
  buildPositionSegments,
  cardPositionLabel,
  cardStatusPresentation,
  currentSegmentVariant,
  formatElapsed,
  inFlightRowActions,
  summarizeCardParameters,
} from "./BoardRunTable.logic";

const STEP_NAMES = ["Plan", "Implement", "Review"];

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

describe("inFlightRowActions", () => {
  const inStep = (status: OrchestrationCard["status"]) =>
    inFlightRowActions(card({ position: { kind: "step", stepIndex: 1 }, status }));

  it("offers cancel only while a turn is running", () => {
    expect(inStep("running")).toEqual({ cancel: true, retry: false, continue: false });
  });

  it("offers retry on every flagged status", () => {
    for (const status of ["needs-input", "failed", "cancelled", "paused"] as const) {
      expect(inStep(status).retry).toBe(true);
    }
  });

  it("offers continue only on a paused card", () => {
    expect(inStep("paused")).toEqual({ cancel: false, retry: true, continue: true });
    expect(inStep("needs-input").continue).toBe(false);
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
});
