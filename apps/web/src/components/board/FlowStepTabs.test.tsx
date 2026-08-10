import { ThreadId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createTabFamilyPopoverMock } from "../TabFamilyPopover.test-utils";

vi.mock("../TabFamilyPopover", () => createTabFamilyPopoverMock());

import type { CardTreeModel } from "./CardDetail.logic";
import { FlowStepTabs } from "./FlowStepTabs";

const model: CardTreeModel = {
  steps: [
    {
      stepIndex: 0,
      name: "Plan",
      label: "1 · Plan",
      state: "complete",
      status: "done",
      threadId: ThreadId.make("thread-plan"),
      trailing: "12s",
      leaves: [
        {
          kind: "subagent",
          stepIndex: 0,
          threadId: ThreadId.make("thread-plan-reviewer"),
          title: "Review the plan",
          status: "done",
          elapsed: "4s",
        },
        {
          kind: "artifact",
          stepIndex: 0,
          stepName: "Plan",
          fileName: "Plan.md",
          trailing: "1.2 KB",
        },
      ],
    },
    {
      stepIndex: 1,
      name: "Implement",
      label: "2 · Implement",
      state: "current",
      status: "working",
      threadId: ThreadId.make("thread-implement"),
      trailing: "28s",
      leaves: [
        {
          kind: "subagent",
          stepIndex: 1,
          threadId: ThreadId.make("thread-implement-code"),
          title: "Implement the changes",
          status: "working",
          elapsed: "8s",
        },
      ],
    },
    {
      stepIndex: 2,
      name: "Review",
      label: "3 · Review",
      state: "pending",
      status: "idle",
      threadId: null,
      trailing: null,
      leaves: [],
    },
  ],
  done: { reached: false, trailing: "not reached" },
};

describe("FlowStepTabs", () => {
  it("replaces the flow rail with horizontal step tabs", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs model={model} selection={{ kind: "step", stepIndex: 1 }} onSelect={() => {}} />,
    );

    expect(markup).toContain('aria-label="Flow steps"');
    expect(markup).toContain('data-flow-step-tabbar="true"');
    expect(markup).toContain("1 · Plan");
    expect(markup).toContain("2 · Implement");
    expect(markup).toContain("3 · Review");
    expect(markup).toContain('<span aria-disabled="true" aria-label="3 · Review: Not started"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("animate-status-pulse");
    expect(markup).not.toContain("Open conversations");
    expect(markup).not.toContain("Card pipeline");
  });

  it("names the selected artifact on its owning step", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs
        model={model}
        selection={{ kind: "artifact", stepIndex: 0 }}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Plan.md");
    expect(markup).toContain('data-active-flow-step="true"');
  });

  it("names the current leaf on its owning step trigger", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs
        model={model}
        selection={{
          kind: "subagent",
          stepIndex: 0,
          threadId: ThreadId.make("thread-plan-reviewer"),
        }}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Open 2 details of Plan, current Review the plan"');
    expect(markup).toContain(
      'data-tab-family-popover-item="subagent:thread-plan-reviewer" aria-current="page"',
    );
  });

  it("keeps card-level recovery actions visible while a sub-agent is selected", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs
        model={model}
        selection={{
          kind: "subagent",
          stepIndex: 1,
          threadId: ThreadId.make("thread-implement-code"),
        }}
        onSelect={() => {}}
        actions={<button type="button">Force advance</button>}
      />,
    );

    expect(markup).toContain("Force advance");
  });

  it("keeps step details out of the tab strip behind a compact picker", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs model={model} selection={{ kind: "step", stepIndex: 0 }} onSelect={() => {}} />,
    );

    expect(markup).not.toContain("data-flow-step-family");
    expect(markup).not.toContain("data-flow-step-leaf");
    expect(markup).toContain('data-tab-family-popover-item="subagent:thread-plan-reviewer"');
    expect(markup).toContain('data-tab-family-popover-item="artifact:0"');
    expect(markup).toContain('data-tab-family-popover-item="subagent:thread-implement-code"');
    expect(markup.match(/data-tab-family-popover(?!-item)/g) ?? []).toHaveLength(2);
    expect(markup.match(/data-flow-step-count/g) ?? []).toHaveLength(2);
    expect(markup).toContain('aria-label="Open 2 details of Plan"');
    expect(markup).toContain('aria-label="Open 1 detail of Implement"');
  });
});
