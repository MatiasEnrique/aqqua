import { BoardId } from "@aqqua/contracts";
import type { OrchestrationCard } from "@aqqua/contracts";
import { Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BoardSelector, FlowNewCardButton, FlowSlimRow, InFlightCardRow } from "./SidebarBoardRows";

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
} as unknown as OrchestrationCard;

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

describe("FlowNewCardButton", () => {
  it("exposes card creation beside the flow selector", () => {
    const onClick = vi.fn();
    const element = FlowNewCardButton({ projectTitle: "aqqua", onClick }) as ReactElement<{
      readonly children: ReactNode;
    }>;
    const [trigger, popup] = Children.toArray(element.props.children) as ReadonlyArray<
      ReactElement<{ readonly render?: ReactElement; readonly children?: ReactNode }>
    >;
    const button = trigger?.props.render as ReactElement<{
      readonly "aria-label": string;
      readonly onClick: () => void;
    }>;

    button.props.onClick();

    expect(button.props["aria-label"]).toBe("New card in aqqua");
    expect(popup?.props.children).toBe("New card");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("InFlightCardRow", () => {
  it("uses the compact worktree-card row language", () => {
    const markup = renderToStaticMarkup(
      <InFlightCardRow
        card={card}
        projectIcon={<span data-project-icon="aqqua" />}
        projectName="aqqua"
        flowName="Delivery"
        selected={false}
        onOpen={() => {}}
        onDelete={() => {}}
        pending={false}
      />,
    );
    const rowClassName = markup.match(/class="(group\/v2-row[^"]+)"/)?.[1] ?? "";

    expect(markup).toContain("h-11");
    expect(markup).toContain("rounded-lg");
    expect(markup).toContain("text-xs font-semibold");
    expect(markup).not.toContain("h-[3.25rem]");
    expect(markup).not.toContain("rounded-2xl border");
    expect(rowClassName).toContain("hover:bg-sidebar-control-surface/60");
    expect(rowClassName).not.toContain("hover:bg-sidebar-row-hover");
    expect(markup).toContain('data-project-icon="aqqua"');
    expect(markup).toContain('data-flow-name="Delivery"');
  });

  it("keeps the idle status from intercepting the delete action on hover", () => {
    const markup = renderToStaticMarkup(
      <InFlightCardRow
        card={{ ...card, status: "cancelled" } as never}
        projectIcon={<span data-project-icon="aqqua" />}
        projectName="aqqua"
        flowName="Delivery"
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

describe("FlowSlimRow", () => {
  it("keeps the project and flow identity on compact lifecycle rows", () => {
    const markup = renderToStaticMarkup(
      <FlowSlimRow
        card={card}
        projectIcon={<span data-project-icon="aqqua" />}
        projectName="aqqua"
        flowName="Delivery"
        selected={false}
        onOpen={() => {}}
        trailing={<span>Start</span>}
      />,
    );

    expect(markup).toContain('data-project-icon="aqqua"');
    expect(markup).toContain('data-flow-name="Delivery"');
  });
});
