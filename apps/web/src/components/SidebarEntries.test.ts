import { describe, expect, it, vi } from "vite-plus/test";

// The sidebar entries share one implementation; these options pin each entry's
// supported presentation behavior at the boundary.
const sidebarModel = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("./sidebar-v2/useSidebarV2Model", () => ({
  useSidebarV2Model: sidebarModel,
}));
vi.mock("./sidebar-v2/SidebarV2View", () => ({
  SidebarV2View: function SidebarV2ViewMock() {
    return null;
  },
}));

describe("sidebar entry components", () => {
  it("pins the regular sidebar to a flat conversation list", async () => {
    sidebarModel.mockClear();
    const { default: SidebarV2 } = await import("./SidebarV2");

    SidebarV2();

    expect(sidebarModel).toHaveBeenCalledWith({ groupingMode: "flat" });
  });

  it("leaves the worktree view on its own grouping preference", async () => {
    sidebarModel.mockClear();
    const { default: SidebarWorktree } = await import("./SidebarWorktree");

    SidebarWorktree();

    expect(sidebarModel).toHaveBeenCalledWith();
  });

  it("enables manual worktree ordering only for the worktree-card view", async () => {
    sidebarModel.mockClear();
    const { default: SidebarWorktreeCards } = await import("./SidebarWorktreeCards");

    SidebarWorktreeCards();

    expect(sidebarModel).toHaveBeenCalledWith({
      groupingMode: "worktree",
      enableManualWorktreeOrdering: true,
    });
  });
});
