import { renderToStaticMarkup } from "react-dom/server";
import type { PropsWithChildren, ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { readonly render: ReactElement }) => render,
  PopoverContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

import { TabFamilyPopover } from "./TabFamilyPopover";

describe("TabFamilyPopover", () => {
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
    expect(markup).toContain("text-xs");
    expect(markup).not.toContain("text-sm");
    expect(markup).toContain("font-semibold text-foreground");
    expect(markup).toContain("text-muted-foreground");
    expect(markup).not.toContain("font-medium");
  });
});
