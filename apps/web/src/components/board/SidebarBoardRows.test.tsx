import { BoardId, EnvironmentId, ProjectId } from "@aqqua/contracts";
import type { OrchestrationBoard, OrchestrationCard } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { FlowGroup, FlowProject } from "./flowSelection";
import {
  FlowEditButton,
  FlowNewCardButton,
  FlowNewFlowButton,
  FlowPicker,
  FlowSlimRow,
  InFlightCardRow,
} from "./SidebarBoardRows";

const project: FlowProject = {
  environmentId: EnvironmentId.make("env-1"),
  id: ProjectId.make("project-1"),
  projectKey: "project-1",
  displayName: "aqqua",
  workspaceRoot: "/tmp/aqqua",
};

const flow = (id: string, name: string): OrchestrationBoard => ({
  id: BoardId.make(id),
  projectId: project.id,
  name,
  steps: [],
  createdAt: "2026-08-07T12:00:00.000Z",
  updatedAt: "2026-08-07T12:00:00.000Z",
  deletedAt: null,
});

const groups: ReadonlyArray<FlowGroup> = [
  { project, flows: [flow("flow-a", "Delivery"), flow("flow-b", "Release")] },
];

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

describe("FlowPicker", () => {
  it("wears the selected flow's project so no separate project filter is needed", () => {
    const markup = renderToStaticMarkup(
      <FlowPicker
        groups={groups}
        selected={{ project, flow: groups[0]!.flows[0]! }}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Select flow"');
    expect(markup).toContain('title="aqqua · Delivery"');
    expect(markup).toContain("Delivery");
    // One flow at a time: the trigger names it instead of listing chips.
    expect(markup).not.toContain("Release");
  });

  it("says so when no project holds a flow yet", () => {
    const markup = renderToStaticMarkup(
      <FlowPicker groups={[{ project, flows: [] }]} selected={null} onSelect={() => {}} />,
    );

    expect(markup).toContain("No flow yet");
  });
});

describe("flow header actions", () => {
  it("names the flow they act on", () => {
    const onNewCard = vi.fn();
    const onEdit = vi.fn();
    const newCard = renderToStaticMarkup(
      <FlowNewCardButton flowName="Delivery" onClick={onNewCard} />,
    );
    const edit = renderToStaticMarkup(<FlowEditButton flowName="Delivery" onClick={onEdit} />);

    const newFlow = renderToStaticMarkup(
      <FlowNewFlowButton projectName="aqqua" onClick={() => {}} />,
    );

    expect(newCard).toContain('aria-label="New card in Delivery"');
    expect(edit).toContain('aria-label="Edit Delivery"');
    // Creating a flow names the project it lands in, not a flow.
    expect(newFlow).toContain('aria-label="New flow in aqqua"');
  });
});

describe("InFlightCardRow", () => {
  it("uses the conversation row's language", () => {
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

    // The same geometry and type scale a conversation row uses, so the two
    // surfaces read as one sidebar.
    expect(markup).toContain("min-h-10");
    expect(markup).toContain("rounded-md");
    expect(markup).toContain("text-[13px] leading-5");
    expect(markup).toContain("text-[11px] leading-4");
    expect(markup).not.toContain("h-11");
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
