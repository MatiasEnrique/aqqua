import { BoardId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BoardSelector, InFlightCardRow } from "./SidebarBoardRows";

const boards = [
  { id: BoardId.make("flow-a"), name: "Delivery" },
  { id: BoardId.make("flow-b"), name: "Release" },
] as never;

const card = {
  id: "card-1",
  title: "Ship flow tabs",
  boardId: BoardId.make("flow-a"),
  position: { kind: "step", stepIndex: 0 },
  status: "running",
  operation: null,
  branch: "board/ship-flow-tabs",
  worktreePath: "/tmp/ship-flow-tabs",
  archivedAt: null,
  settledAt: null,
  lastError: null,
} as never;

describe("BoardSelector", () => {
  it("uses the same empty-is-all multi-select model as project scope", () => {
    const markup = renderToStaticMarkup(
      <BoardSelector
        boards={boards}
        selectedBoardIds={[]}
        projectTitle="aqqua"
        onSelectionChange={() => {}}
        onNewCard={() => {}}
        onEditBoard={() => {}}
        onNewBoard={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Filter flows in aqqua"');
    expect(markup).toContain('placeholder="All flows"');
  });

  it("renders every selected flow as a removable chip", () => {
    const markup = renderToStaticMarkup(
      <BoardSelector
        boards={boards}
        selectedBoardIds={[BoardId.make("flow-a"), BoardId.make("flow-b")]}
        projectTitle="aqqua"
        onSelectionChange={() => {}}
        onNewCard={() => {}}
        onEditBoard={() => {}}
        onNewBoard={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Delivery"');
    expect(markup).toContain('aria-label="Release"');
    expect(markup).toContain("Delivery");
    expect(markup).toContain("Release");
  });
});

describe("InFlightCardRow", () => {
  it("uses the compact worktree-card row language", () => {
    const markup = renderToStaticMarkup(
      <InFlightCardRow
        card={card}
        boardName={null}
        selected={false}
        onOpen={() => {}}
        onDelete={() => {}}
        pending={false}
      />,
    );

    expect(markup).toContain("h-8");
    expect(markup).toContain("rounded-lg");
    expect(markup).toContain("text-xs font-semibold");
    expect(markup).not.toContain("h-[3.25rem]");
    expect(markup).not.toContain("rounded-2xl border");
  });

  it("keeps the idle status from intercepting the delete action on hover", () => {
    const markup = renderToStaticMarkup(
      <InFlightCardRow
        card={{ ...card, status: "cancelled" } as never}
        boardName={null}
        selected={false}
        onOpen={() => {}}
        onDelete={() => {}}
        pending={false}
      />,
    );

    expect(markup).toContain(">Stale</span>");
    expect(markup).toContain("grid-cols-[1fr]");
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("group-hover/v2-row:pointer-events-auto");
    expect(markup).not.toContain("group-hover/v2-row:static");
  });
});
