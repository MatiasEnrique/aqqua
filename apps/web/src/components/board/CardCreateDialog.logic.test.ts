import { describe, expect, it } from "vite-plus/test";

import { BoardId, BoardStepId, ProjectId } from "@aqqua/contracts";
import type { BoardStep, OrchestrationBoard } from "@aqqua/contracts";

import {
  boardParameterNames,
  buildPlaceholderCardTitle,
  missingParameterNames,
  resolveCardCreateBoard,
  toCardParameters,
} from "./CardCreateDialog.logic";

function board(templates: ReadonlyArray<string>): OrchestrationBoard {
  return {
    id: BoardId.make("board-1"),
    projectId: ProjectId.make("project-1"),
    name: "Delivery",
    steps: templates.map((promptTemplate, index) => ({
      id: BoardStepId.make(`step-${index}`),
      name: `Step ${index}`,
      promptTemplate,
      profileName: "implementer" as BoardStep["profileName"],
      continuation: "auto" as const,
    })),
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("boardParameterNames", () => {
  it("unions placeholders across every step, in first-seen order", () => {
    expect(
      boardParameterNames(board(["Plan ${issue_id} for ${scope}", "Review ${issue_id}"])),
    ).toEqual(["issue_id", "scope"]);
  });

  it("adds a field for a brand-new placeholder with no other configuration", () => {
    const before = boardParameterNames(board(["Plan ${issue_id}"]));
    const after = boardParameterNames(board(["Plan ${issue_id}", "Ship ${new_param}"]));
    expect(before).toEqual(["issue_id"]);
    expect(after).toEqual(["issue_id", "new_param"]);
  });

  it("excludes reserved artifact and card-title placeholders", () => {
    expect(
      boardParameterNames(
        board(["Read ${artifact} and ${artifact:Plan} for ${card_title}: ${issue_id}"]),
      ),
    ).toEqual(["issue_id"]);
  });

  it("has no fields without a board", () => {
    expect(boardParameterNames(null)).toEqual([]);
  });
});

describe("resolveCardCreateBoard", () => {
  const delivery = board(["Plan ${issue_id}"]);
  const release = {
    ...board(["Ship ${version}"]),
    id: BoardId.make("board-2"),
    name: "Release",
  };

  it("uses the flow selected in the new-card dialog", () => {
    expect(resolveCardCreateBoard([delivery, release], release.id)).toBe(release);
  });

  it("falls back to the first flow when no contextual flow is selected", () => {
    expect(resolveCardCreateBoard([delivery, release], null)).toBe(delivery);
  });

  it("falls back to the first flow when the selected flow no longer exists", () => {
    expect(resolveCardCreateBoard([delivery, release], BoardId.make("board-missing"))).toBe(
      delivery,
    );
  });

  it("returns null when the project has no flows", () => {
    expect(resolveCardCreateBoard([], BoardId.make("board-missing"))).toBeNull();
  });
});

describe("missingParameterNames", () => {
  it("treats whitespace-only values as missing", () => {
    expect(
      missingParameterNames(["issue_id", "scope"], { issue_id: "aqqua-482", scope: "  " }),
    ).toEqual(["scope"]);
  });

  it("is empty once every field is filled", () => {
    expect(missingParameterNames(["issue_id"], { issue_id: "aqqua-482" })).toEqual([]);
  });
});

describe("buildPlaceholderCardTitle", () => {
  it("joins the values in template order", () => {
    expect(
      buildPlaceholderCardTitle(["issue_id", "scope"], { scope: "web", issue_id: "aqqua-482" }),
    ).toBe("aqqua-482 · web");
  });

  it("truncates long joins", () => {
    const title = buildPlaceholderCardTitle(["note"], { note: "x".repeat(200) });
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back when nothing was entered", () => {
    expect(buildPlaceholderCardTitle(["issue_id"], {})).toBe("Untitled card");
  });
});

describe("toCardParameters", () => {
  it("trims values and drops keys the board does not ask for", () => {
    expect(
      toCardParameters(["issue_id"], {
        issue_id: "  aqqua-482 ",
        leftover: "from an older template",
      }),
    ).toEqual({ issue_id: "aqqua-482" });
  });
});
