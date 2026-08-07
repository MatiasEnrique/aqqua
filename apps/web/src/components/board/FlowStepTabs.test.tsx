import { ThreadId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

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
      leaves: [],
    },
  ],
  done: { reached: false, trailing: "not reached" },
};

describe("FlowStepTabs", () => {
  it("replaces the flow rail with horizontal step tabs", () => {
    const markup = renderToStaticMarkup(
      <FlowStepTabs
        model={model}
        selection={{ kind: "step", stepIndex: 1 }}
        onSelect={() => {}}
        onOpenDiff={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Flow steps"');
    expect(markup).toContain('data-flow-step-tabbar="true"');
    expect(markup).toContain("1 · Plan");
    expect(markup).toContain("2 · Implement");
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
        onOpenDiff={() => {}}
      />,
    );

    expect(markup).toContain("Plan.md");
    expect(markup).toContain('data-active-flow-step="true"');
  });
});
