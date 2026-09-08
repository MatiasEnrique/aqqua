import { describe, expect, it } from "vite-plus/test";

import { resolveRenderedSidebarThreadKeys } from "./renderedThreadOrder";

describe("readRenderedSidebarThreadKeys", () => {
  it("uses the logical order when the sidebar is showing another surface", () => {
    expect(
      resolveRenderedSidebarThreadKeys({
        conversationListPresent: false,
        fallback: ["first", "second"],
        renderedKeys: [],
      }),
    ).toEqual(["first", "second"]);
  });

  it("returns the visible row order from the conversation list", () => {
    expect(
      resolveRenderedSidebarThreadKeys({
        conversationListPresent: true,
        fallback: ["first", "second"],
        renderedKeys: ["second", "first"],
      }),
    ).toEqual(["second", "first"]);
  });

  it("keeps an intentionally empty conversation list empty", () => {
    expect(
      resolveRenderedSidebarThreadKeys({
        conversationListPresent: true,
        fallback: ["hidden"],
        renderedKeys: [],
      }),
    ).toEqual([]);
  });
});
