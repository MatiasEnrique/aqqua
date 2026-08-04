import { describe, expect, it } from "vite-plus/test";

import { rightPanelSurfaceTitle } from "./RightPanelTabs";

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
