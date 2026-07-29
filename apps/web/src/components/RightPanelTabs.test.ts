import { describe, expect, it } from "vite-plus/test";

import { rightPanelSurfaceTitle } from "./RightPanelTabs";

describe("rightPanelSurfaceTitle", () => {
  it("labels the singleton History surface", () => {
    expect(rightPanelSurfaceTitle({ id: "history", kind: "history" }, {}, new Map())).toBe(
      "History",
    );
  });
});
