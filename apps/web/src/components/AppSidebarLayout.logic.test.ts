import { describe, expect, it } from "vite-plus/test";

import { resolveAppSidebarVariant } from "./AppSidebarLayout.logic";

describe("resolveAppSidebarVariant", () => {
  it("uses T3 Code's original sidebar as the regular sidebar", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: false,
      }),
    ).toBe("regular");
  });

  it("uses the worktree-aware sidebar when the worktree view is enabled", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        worktreeViewEnabled: true,
      }),
    ).toBe("worktree");
  });

  it("keeps the settings navigation on settings routes", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        worktreeViewEnabled: true,
      }),
    ).toBe("settings");
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        worktreeViewEnabled: false,
      }),
    ).toBe("settings");
  });
});
