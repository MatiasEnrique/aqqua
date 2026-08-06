import { describe, expect, it } from "vite-plus/test";

import { resolveAppSidebarVariant } from "./AppSidebarLayout.logic";

describe("resolveAppSidebarVariant", () => {
  it("uses T3 Code's original sidebar as the regular sidebar", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: false,
        threadGroupingMode: "flat",
      }),
    ).toBe("regular");
  });

  it("uses the worktree-aware sidebar when the worktree view is enabled", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: true,
        threadGroupingMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("uses the card sidebar when grouping is set to worktree cards", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: true,
        threadGroupingMode: "worktree_cards",
      }),
    ).toBe("worktree-cards");
  });

  it("keeps the beta flag in charge of every worktree-aware sidebar", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: false,
        threadGroupingMode: "worktree_cards",
      }),
    ).toBe("regular");
  });

  it("keeps the settings navigation on settings routes", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        worktreeViewEnabled: true,
        threadGroupingMode: "worktree_cards",
      }),
    ).toBe("settings");
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        worktreeViewEnabled: false,
        threadGroupingMode: "flat",
      }),
    ).toBe("settings");
  });
});
