import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { resolveRightPanelActivityIntent } from "./RightPanelSidebar";

describe("right panel activity intent", () => {
  const filesSurface = {
    id: "files",
    kind: "files",
    relativePath: null,
    revealLine: null,
    revealRequestId: 0,
  } satisfies RightPanelSurface;

  it("adds each available tool when that surface is not open", () => {
    for (const kind of [
      "files",
      "diff",
      "history",
      "pullRequest",
      "terminal",
      "preview",
    ] as const) {
      expect(
        resolveRightPanelActivityIntent({
          available: true,
          surfaces: [],
          kind,
          preferredId: undefined,
          collapsed: true,
          activeSurfaceId: null,
        }),
      ).toEqual({ kind: "add" });
    }
  });

  it("activates an existing surface and hides the active one", () => {
    expect(
      resolveRightPanelActivityIntent({
        available: true,
        surfaces: [filesSurface],
        kind: "files",
        preferredId: undefined,
        collapsed: true,
        activeSurfaceId: "files",
      }),
    ).toEqual({ kind: "activate", surface: filesSurface });
    expect(
      resolveRightPanelActivityIntent({
        available: true,
        surfaces: [filesSurface],
        kind: "files",
        preferredId: undefined,
        collapsed: false,
        activeSurfaceId: "files",
      }),
    ).toEqual({ kind: "hide" });
  });

  it("does not act when a tool is unavailable", () => {
    expect(
      resolveRightPanelActivityIntent({
        available: false,
        surfaces: [],
        kind: "terminal",
        preferredId: undefined,
        collapsed: true,
        activeSurfaceId: null,
      }),
    ).toEqual({ kind: "no_action" });
  });
});
