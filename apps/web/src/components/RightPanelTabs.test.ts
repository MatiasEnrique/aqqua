import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/components/ui/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/menu")>();
  return {
    ...actual,
    MenuPopup: (props: { readonly children?: ReactNode }) => props.children,
  };
});

import { RightPanelTabs, rightPanelSurfaceTitle } from "./RightPanelTabs";

const noop = () => {};

describe("rightPanelSurfaceTitle", () => {
  it("labels the singleton History surface", () => {
    expect(rightPanelSurfaceTitle({ id: "history", kind: "history" }, {}, new Map())).toBe(
      "History",
    );
  });

  it("keeps the Explorer tab label while showing a file", () => {
    expect(
      rightPanelSurfaceTitle(
        {
          id: "files",
          kind: "files",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 1,
        },
        {},
        new Map(),
      ),
    ).toBe("Files");
  });
});

describe("RightPanelTabs", () => {
  it("offers a direct picker for panel tabs clipped by horizontal overflow", () => {
    const props: ComponentProps<typeof RightPanelTabs> = {
      mode: "sidebar",
      surfaces: [
        { id: "diff", kind: "diff" },
        { id: "pullRequest", kind: "pullRequest" },
        { id: "history", kind: "history" },
        {
          id: "files",
          kind: "files",
          relativePath: null,
          revealLine: null,
          revealRequestId: 0,
        },
      ],
      activeSurfaceId: "files",
      pendingSurfaceIds: new Set<string>(),
      previewSessions: {},
      terminalLabelsById: new Map(),
      onActivate: noop,
      onCloseSurface: noop,
      onCloseOtherSurfaces: noop,
      onCloseSurfacesToRight: noop,
      onCloseAllSurfaces: noop,
      onHide: noop,
      onCopyFilePath: noop,
      onAddBrowser: noop,
      onAddTerminal: noop,
      onAddDiff: noop,
      onAddHistory: noop,
      onAddPullRequest: noop,
      onAddFiles: noop,
      browserAvailable: true,
      diffAvailable: true,
      historyAvailable: true,
      pullRequestAvailable: true,
      filesAvailable: true,
      children: null,
    };
    const markup = renderToStaticMarkup(createElement(RightPanelTabs, props));

    expect(markup).toContain('aria-label="Show all panel tabs"');
    expect(markup).toContain("data-right-panel-tab-overflow");
    expect(markup).toContain("has-[[data-has-overflow-x]]");
  });
});
