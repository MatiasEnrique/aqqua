import { describe, expect, it, vi } from "vite-plus/test";

const sidebarMocks = vi.hoisted(() => ({
  settings: function SettingsSidebarMock() {
    return null;
  },
  regular: function RegularSidebarMock() {
    return null;
  },
  worktree: function WorktreeSidebarMock() {
    return null;
  },
  worktreeCards: function WorktreeCardSidebarMock() {
    return null;
  },
}));

vi.mock("./Sidebar", () => ({
  default: sidebarMocks.settings,
}));
vi.mock("./SidebarV2", () => ({
  default: sidebarMocks.regular,
}));
vi.mock("./SidebarWorktree", () => ({
  default: sidebarMocks.worktree,
}));
vi.mock("./SidebarWorktreeCards", () => ({
  default: sidebarMocks.worktreeCards,
}));

describe("APP_SIDEBAR_COMPONENTS", () => {
  it("maps regular and worktree to their intended sidebar implementations", async () => {
    const { APP_SIDEBAR_COMPONENTS } = await import("./AppSidebarLayout");

    expect(APP_SIDEBAR_COMPONENTS.settings).toBe(sidebarMocks.settings);
    expect(APP_SIDEBAR_COMPONENTS.regular).toBe(sidebarMocks.regular);
    expect(APP_SIDEBAR_COMPONENTS.worktree).toBe(sidebarMocks.worktree);
    expect(APP_SIDEBAR_COMPONENTS["worktree-cards"]).toBe(sidebarMocks.worktreeCards);
  });
});
