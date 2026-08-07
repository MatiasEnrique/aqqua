import { renderToStaticMarkup } from "react-dom/server";
import type { PropsWithChildren, ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { readonly render: ReactElement }) => render,
  PopoverContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

import { TabFamilyCountTrigger, TabFamilyPopover } from "./TabFamilyPopover";

describe("TabFamilyPopover", () => {
  it("carries the popover trigger's own props onto the count button", () => {
    const markup = renderToStaticMarkup(
      <TabFamilyPopover
        title="Plan details"
        trigger={
          <TabFamilyCountTrigger
            label="Open 1 sub-agent of Plan details"
            count={1}
            active={false}
            markerAttributes={{ "data-sub-agent-count": true }}
            data-testid="sub-agent-trigger"
            aria-expanded={false}
            className="ring-offset-2"
          />
        }
        items={[]}
      />,
    );

    // The trigger the popover renders must keep the props the popover hands it
    // — otherwise its open/close wiring is silently dropped.
    expect(markup).toContain('data-testid="sub-agent-trigger"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Open 1 sub-agent of Plan details"');
    expect(markup).toContain("data-sub-agent-count");
    expect(markup).toContain("ring-offset-2");
    expect(markup).toContain('type="button"');
  });

  it("renders descendants directly in the shared popover", () => {
    const markup = renderToStaticMarkup(
      <TabFamilyPopover
        title="Plan details"
        trigger={<button type="button">2</button>}
        items={[
          {
            key: "subagent:review",
            label: "Review the plan",
            leading: <span>agent</span>,
            trailing: "4s",
            active: true,
            onSelect: () => {},
          },
          {
            key: "artifact:plan",
            label: "Plan.md",
            leading: <span>file</span>,
            trailing: "1.2 KB",
            active: false,
            onSelect: () => {},
          },
        ]}
      />,
    );

    expect(markup).not.toContain("autocomplete");
    expect(markup).not.toContain("placeholder=");
    expect(markup).toContain("Review the plan");
    expect(markup).toContain("Plan.md");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-tab-family-popover-item="subagent:review"');
    expect(markup).toContain('data-tab-family-popover-item="artifact:plan"');
  });
});
