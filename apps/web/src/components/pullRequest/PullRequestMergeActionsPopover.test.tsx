import { EnvironmentId, ThreadId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/state/git", () => ({
  gitEnvironment: {
    changeRequestMergeOptions: () => ({}),
    mergeChangeRequest: {},
    setAutoMerge: {},
    updateChangeRequestState: {},
  },
}));

vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      methods: ["merge", "squash", "rebase"],
      defaultMethod: "merge",
      autoMergeSupported: true,
      autoMergeEnabled: false,
    },
    error: null,
    isPending: false,
  }),
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(),
}));

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  PopoverPopup: ({
    align,
    children,
  }: PropsWithChildren<{ readonly align?: "start" | "center" | "end" }>) => (
    <div data-align={align}>{children}</div>
  ),
}));

import { PullRequestMergeActionsPopover } from "./PullRequestMergeActionsPopover";

describe("PullRequestMergeActionsPopover", () => {
  it("aligns the actions popup with the start edge of the full-width trigger", () => {
    const markup = renderToStaticMarkup(
      <PullRequestMergeActionsPopover
        threadRef={{
          environmentId: EnvironmentId.make("environment-1"),
          threadId: ThreadId.make("thread-1"),
        }}
        cwd="/repo"
        changeRequest={{
          number: 36,
          title: "Align merge options",
          url: "https://github.com/owner/repo/pull/36",
          baseRef: "main",
          headRef: "feature/align-merge-options",
          state: "open",
          checksStatus: "failure",
        }}
        sourceControlProvider={{
          kind: "github",
          name: "GitHub",
          baseUrl: "https://github.com",
        }}
      />,
    );

    expect(markup).toContain('data-align="start"');
  });
});
