import { BoardId, CardId, CardOperationId, ProjectId } from "@aqqua/contracts";
import type { OrchestrationCard } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { FlowProjectGroupingToggle, TodoCardStateBadge } from "./SidebarBoardPanel";

const startingCard: OrchestrationCard = {
  id: CardId.make("card-1"),
  boardId: BoardId.make("board-1"),
  projectId: ProjectId.make("project-1"),
  title: "Define Flow Card Work",
  parameters: {},
  position: { kind: "todo" },
  status: null,
  operation: {
    kind: "starting",
    operationId: CardOperationId.make("operation-1"),
    requestedAt: "2026-08-07T12:00:00.000Z",
    threadId: null,
  },
  lastError: null,
  snapshot: null,
  branch: null,
  worktreePath: null,
  stepThreads: [],
  createdAt: "2026-08-07T12:00:00.000Z",
  updatedAt: "2026-08-07T12:00:00.000Z",
  releasedAt: null,
  completedAt: null,
  settledAt: null,
  archivedAt: null,
};

describe("TodoCardStateBadge", () => {
  it("shows Starting as the card's only state while release is claimed", () => {
    const markup = renderToStaticMarkup(
      <TodoCardStateBadge card={startingCard} isStarting={true} />,
    );

    expect(markup).toContain("Starting…");
    expect(markup).not.toContain(">Working</span>");
    expect(markup.match(/role="status"/g) ?? []).toHaveLength(1);
  });
});

describe("FlowProjectGroupingToggle", () => {
  it("offers the compact project grouping control used by the board sidebar", () => {
    const flat = renderToStaticMarkup(
      <FlowProjectGroupingToggle grouped={false} onToggle={() => {}} />,
    );
    const grouped = renderToStaticMarkup(
      <FlowProjectGroupingToggle grouped={true} onToggle={() => {}} />,
    );

    expect(flat).toContain('aria-label="Group flow cards by project"');
    expect(flat).toContain('aria-pressed="false"');
    expect(grouped).toContain('aria-label="Show flow cards without project groups"');
    expect(grouped).toContain('aria-pressed="true"');
  });
});
