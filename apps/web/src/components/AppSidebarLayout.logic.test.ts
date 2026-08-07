import { describe, expect, it } from "vite-plus/test";

import { resolveAppSidebarSurface } from "./AppSidebarLayout.logic";

describe("resolveAppSidebarSurface", () => {
  it("keeps the dedicated settings sidebar on settings routes", () => {
    expect(resolveAppSidebarSurface("/settings")).toBe("settings");
    expect(resolveAppSidebarSurface("/settings/general")).toBe("settings");
    expect(resolveAppSidebarSurface("/settings/providers")).toBe("settings");
  });

  it("uses the worktree-card sidebar everywhere else", () => {
    expect(resolveAppSidebarSurface("/")).toBe("conversations");
    expect(resolveAppSidebarSurface("/board/environment/project")).toBe("conversations");
  });
});
