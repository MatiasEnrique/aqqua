import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@aqqua/contracts";

vi.mock("~/components/ui/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/menu")>();
  return {
    ...actual,
    MenuPopup: (props: { readonly children?: ReactNode }) => props.children,
  };
});

import {
  RightPanelSidebar,
  resolveActivitySurface,
  rightPanelSelectionMemoryKey,
  rightPanelSurfaceTitle,
  shouldClosePanelItemFromAuxClick,
  shouldHideActivitySurface,
} from "./RightPanelSidebar";
import type { RightPanelSurface } from "~/rightPanelStore";

const noop = () => {};

describe("rightPanelSurfaceTitle", () => {
  it("labels the singleton History surface", () => {
    expect(rightPanelSurfaceTitle({ id: "history", kind: "history" }, {}, new Map())).toBe(
      "History",
    );
  });

  it("keeps the Explorer label while showing a file", () => {
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

describe("RightPanelSidebar", () => {
  const props: ComponentProps<typeof RightPanelSidebar> = {
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
    preferredSurfaceIdForKind: () => undefined,
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
    terminalAvailable: true,
    diffAvailable: true,
    historyAvailable: true,
    pullRequestAvailable: true,
    filesAvailable: true,
    children: createElement("div", null, "Panel body"),
  };

  it("renders directly selectable tabs alongside the vertical activity rail", () => {
    const markup = renderToStaticMarkup(createElement(RightPanelSidebar, props));

    expect(markup).toContain('aria-label="Right panel tools"');
    expect(markup).toContain("data-right-panel-activity-rail");
    expect(markup).toContain("data-right-panel-tab-list");
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(4);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain("Show open panel items");
    expect(markup).toContain('aria-label="Changes"');
    expect(markup).toContain('aria-label="Browser"');
    expect(markup).not.toContain("data-right-panel-tab-overflow");
    expect(markup).toContain("Panel body");
    expect(markup).toContain('aria-label="Close Files"');

    const collapsed = renderToStaticMarkup(
      createElement(RightPanelSidebar, { ...props, collapsed: true }),
    );
    expect(collapsed).toContain("data-right-panel-activity-rail");
    expect(collapsed).not.toContain("data-right-panel-toolbar");
    expect(collapsed).not.toContain('aria-pressed="true"');
    expect(collapsed).not.toContain("Panel body");

    const terminalUnavailable = renderToStaticMarkup(
      createElement(RightPanelSidebar, {
        ...props,
        collapsed: true,
        terminalAvailable: false,
      }),
    );
    expect(terminalUnavailable).toMatch(/aria-label="Terminal"[^>]*aria-disabled="true"/);

    const openTerminalUnavailable = renderToStaticMarkup(
      createElement(RightPanelSidebar, {
        ...props,
        collapsed: true,
        surfaces: [
          ...props.surfaces,
          {
            id: "terminal:terminal-1",
            kind: "terminal",
            resourceId: "terminal-1",
            terminalIds: ["terminal-1"],
            activeTerminalId: "terminal-1",
            terminalPanes: [{ terminalId: "terminal-1", originThreadId: "thread-1" }],
          },
        ],
        terminalAvailable: false,
      }),
    );
    expect(openTerminalUnavailable).not.toMatch(/aria-label="Terminal"[^>]*aria-disabled="true"/);
  });

  it("keeps the inline toolbar clear of the floating workspace controls", () => {
    const inline = renderToStaticMarkup(
      createElement(RightPanelSidebar, { ...props, mode: "inline" as const }),
    );

    expect(inline).toContain("pr-[var(--workspace-titlebar-controls-reserve)]");
    expect(inline).not.toContain("pr-12");
  });
});

describe("shouldHideActivitySurface", () => {
  it("hides only when the resolved surface is the active surface", () => {
    expect(
      shouldHideActivitySurface({ collapsed: false, surfaceId: undefined, activeSurfaceId: null }),
    ).toBe(false);
    expect(
      shouldHideActivitySurface({
        collapsed: false,
        surfaceId: "browser:second",
        activeSurfaceId: "browser:first",
      }),
    ).toBe(false);
    expect(
      shouldHideActivitySurface({
        collapsed: false,
        surfaceId: "browser:first",
        activeSurfaceId: "browser:first",
      }),
    ).toBe(true);
    expect(
      shouldHideActivitySurface({
        collapsed: true,
        surfaceId: "browser:first",
        activeSurfaceId: "browser:first",
      }),
    ).toBe(false);
  });
});

describe("rightPanelSelectionMemoryKey", () => {
  const environmentId = EnvironmentId.make("environment-a");
  const workspaceRef = { environmentId, workspaceRoot: "/workspace" };
  const contextA = {
    threadRef: scopeThreadRef(environmentId, ThreadId.make("thread-a")),
    workspaceRef,
  };
  const contextB = {
    threadRef: scopeThreadRef(environmentId, ThreadId.make("thread-b")),
    workspaceRef,
  };

  it("scopes thread activities to the thread and workspace activities to the workspace", () => {
    expect(rightPanelSelectionMemoryKey(contextA, "preview")).not.toBe(
      rightPanelSelectionMemoryKey(contextB, "preview"),
    );
    expect(rightPanelSelectionMemoryKey(contextA, "terminal")).toBe(
      rightPanelSelectionMemoryKey(contextB, "terminal"),
    );
  });
});

describe("shouldClosePanelItemFromAuxClick", () => {
  it("closes only for the middle mouse button", () => {
    expect(shouldClosePanelItemFromAuxClick(1)).toBe(true);
    expect(shouldClosePanelItemFromAuxClick(0)).toBe(false);
    expect(shouldClosePanelItemFromAuxClick(2)).toBe(false);
  });
});

describe("resolveActivitySurface", () => {
  const surfaces = [
    { id: "browser:first", kind: "preview", resourceId: "first" },
    { id: "browser:second", kind: "preview", resourceId: "second" },
    { id: "files", kind: "files", relativePath: "README.md", revealLine: null, revealRequestId: 1 },
  ] satisfies RightPanelSurface[];

  it("reopens the last selected browser when switching back to its activity", () => {
    expect(
      resolveActivitySurface({ surfaces, kind: "preview", preferredId: "browser:second" }),
    ).toBe(surfaces[1]);
  });

  it("falls back to an open browser when the remembered item was closed", () => {
    expect(
      resolveActivitySurface({ surfaces, kind: "preview", preferredId: "browser:closed" }),
    ).toBe(surfaces[0]);
  });

  it("never reuses an item from a different activity", () => {
    expect(
      resolveActivitySurface({ surfaces, kind: "terminal", preferredId: "browser:first" }),
    ).toBeUndefined();
  });
});
