import { describe, expect, it } from "vite-plus/test";

import { resolveAppSidebarVariant } from "./AppSidebarLayout.logic";

describe("resolveAppSidebarVariant", () => {
  it("uses the worktree-aware sidebar as the regular sidebar", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        sidebarV2Enabled: false,
      }),
    ).toBe("regular");
  });

  it("uses aqqua's original v2 sidebar when v2 is enabled", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: false,
        sidebarV2Enabled: true,
      }),
    ).toBe("v2");
  });

  it("keeps the settings navigation on settings routes", () => {
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        sidebarV2Enabled: true,
      }),
    ).toBe("settings");
    expect(
      resolveAppSidebarVariant({
        isOnSettings: true,
        sidebarV2Enabled: false,
      }),
    ).toBe("settings");
  });
});
