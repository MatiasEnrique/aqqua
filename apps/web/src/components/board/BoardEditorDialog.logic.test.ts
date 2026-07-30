import { describe, expect, it } from "vite-plus/test";

import { BoardId, BoardStepId, ProjectId } from "@t3tools/contracts";
import type { OrchestrationBoard } from "@t3tools/contracts";

import {
  type BoardDraft,
  type BoardStepDraft,
  createStepDraft,
  draftFromBoard,
  isBoardDraftSubmittable,
  moveStep,
  removeStep,
  toBoardSteps,
  updateStep,
  validateBoardDraft,
} from "./BoardEditorDialog.logic";

function stepDraft(overrides: Partial<BoardStepDraft> = {}): BoardStepDraft {
  return {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Implement ${issue_id}",
    profileName: "implementer",
    continuation: "auto",
    ...overrides,
  };
}

function draft(steps: ReadonlyArray<BoardStepDraft>): BoardDraft {
  return { name: "Delivery", steps };
}

describe("step editing", () => {
  const steps = [
    stepDraft({ id: BoardStepId.make("a"), name: "Plan" }),
    stepDraft({ id: BoardStepId.make("b"), name: "Implement" }),
    stepDraft({ id: BoardStepId.make("c"), name: "Review" }),
  ];

  it("patches one step and leaves the rest untouched", () => {
    const next = updateStep(steps, 1, { continuation: "manual" });
    expect(next[1]?.continuation).toBe("manual");
    expect(next[0]).toBe(steps[0]);
    expect(next[2]).toBe(steps[2]);
  });

  it("removes a step by index", () => {
    expect(removeStep(steps, 0).map((s) => s.name)).toEqual(["Implement", "Review"]);
  });

  it("swaps steps with the neighbour", () => {
    expect(moveStep(steps, 1, "up").map((s) => s.name)).toEqual(["Implement", "Plan", "Review"]);
    expect(moveStep(steps, 1, "down").map((s) => s.name)).toEqual(["Plan", "Review", "Implement"]);
  });

  it("ignores moves off either end", () => {
    expect(moveStep(steps, 0, "up")).toBe(steps);
    expect(moveStep(steps, 2, "down")).toBe(steps);
    expect(moveStep(steps, 9, "up")).toBe(steps);
  });

  it("seeds a new step with the default continuation", () => {
    const created = createStepDraft(BoardStepId.make("new"), "implementer");
    expect(created).toEqual({
      id: "new",
      name: "",
      promptTemplate: "",
      profileName: "implementer",
      continuation: "auto",
    });
  });
});

describe("validateBoardDraft", () => {
  it("accepts a complete draft", () => {
    const errors = validateBoardDraft(draft([stepDraft()]));
    expect(errors).toEqual({ name: null, general: null, steps: {} });
    expect(isBoardDraftSubmittable(errors)).toBe(true);
  });

  it("requires a board name and at least one step", () => {
    const errors = validateBoardDraft({ name: "   ", steps: [] });
    expect(errors.name).toBe("Give the board a name.");
    expect(errors.general).toBe("Add at least one step.");
    expect(isBoardDraftSubmittable(errors)).toBe(false);
  });

  it("reports the first problem per step, keyed by step id", () => {
    const errors = validateBoardDraft(
      draft([
        stepDraft({ id: BoardStepId.make("a"), name: "  " }),
        stepDraft({ id: BoardStepId.make("b"), promptTemplate: " " }),
        stepDraft({ id: BoardStepId.make("c"), name: "Review", profileName: "" }),
      ]),
    );
    expect(errors.steps).toEqual({
      a: "Give the step a name.",
      b: "Give the step a prompt template.",
      c: "Pick an agent profile.",
    });
  });

  it("rejects duplicate step names regardless of case", () => {
    const errors = validateBoardDraft(
      draft([
        stepDraft({ id: BoardStepId.make("a"), name: "Review" }),
        stepDraft({ id: BoardStepId.make("b"), name: "review" }),
      ]),
    );
    expect(errors.steps).toEqual({ b: "Step names must be unique." });
  });

  it("caps the step count", () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      stepDraft({ id: BoardStepId.make(`s-${i}`), name: `Step ${i}` }),
    );
    expect(validateBoardDraft(draft(many)).general).toBe("A board holds at most 20 steps.");
  });
});

describe("board <-> draft round trip", () => {
  const board: OrchestrationBoard = {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: [
      {
        id: BoardStepId.make("a"),
        name: "Implement",
        promptTemplate: "Implement ${issue_id}",
        profileName: "implementer" as OrchestrationBoard["steps"][number]["profileName"],
        continuation: "manual",
      },
    ],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
  };

  it("loads an existing board into the editor and back out unchanged", () => {
    expect(toBoardSteps(draftFromBoard(board))).toEqual(board.steps);
  });

  it("trims whitespace on the way out", () => {
    const steps = toBoardSteps(
      draft([
        stepDraft({ name: "  Implement  ", promptTemplate: "  do it  ", profileName: " cc " }),
      ]),
    );
    expect(steps[0]).toEqual({
      id: "step-1",
      name: "Implement",
      promptTemplate: "do it",
      profileName: "cc",
      continuation: "auto",
    });
  });
});
