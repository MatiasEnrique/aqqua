import { describe, expect, it, vi } from "vite-plus/test";

// The two sidebar entries share one implementation; grouping is the whole
// difference between them, so it is what these tests pin down.
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
});
