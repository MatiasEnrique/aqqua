import { describe, expect, it } from "vite-plus/test";

import { resolveChatHeaderMode } from "./chatHeaderMode";

describe("resolveChatHeaderMode", () => {
  it("grows the tab strip only for the worktree-card sidebar", () => {
    expect(
      resolveChatHeaderMode({ threadGroupingMode: "worktree_cards", worktreeViewEnabled: true }),
    ).toBe("worktree-tabs");
    expect(
      resolveChatHeaderMode({ threadGroupingMode: "worktree", worktreeViewEnabled: true }),
    ).toBe("breadcrumb");
    expect(resolveChatHeaderMode({ threadGroupingMode: "flat", worktreeViewEnabled: true })).toBe(
      "breadcrumb",
    );
  });

  it("keeps the beta flag in charge, so a stale preference cannot revive the strip", () => {
    expect(
      resolveChatHeaderMode({ threadGroupingMode: "worktree_cards", worktreeViewEnabled: false }),
    ).toBe("breadcrumb");
  });
});
