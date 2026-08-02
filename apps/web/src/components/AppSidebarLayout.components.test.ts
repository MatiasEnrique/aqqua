import { describe, expect, it, vi } from "vite-plus/test";

const sidebarMocks = vi.hoisted(() => ({
  settings: function SettingsSidebarMock() {
    return null;
  },
  regular: function RegularSidebarMock() {
    return null;
  },
  v2: function SidebarV2Mock() {
    return null;
  },
}));

vi.mock("./Sidebar", () => ({
  default: sidebarMocks.settings,
}));
vi.mock("./SidebarWorktree", () => ({
  default: sidebarMocks.regular,
}));
vi.mock("./SidebarV2", () => ({
  default: sidebarMocks.v2,
}));

describe("APP_SIDEBAR_COMPONENTS", () => {
  it("maps regular and v2 to their intended sidebar implementations", async () => {
    const { APP_SIDEBAR_COMPONENTS } = await import("./AppSidebarLayout");

    expect(APP_SIDEBAR_COMPONENTS.settings).toBe(sidebarMocks.settings);
    expect(APP_SIDEBAR_COMPONENTS.regular).toBe(sidebarMocks.regular);
    expect(APP_SIDEBAR_COMPONENTS.v2).toBe(sidebarMocks.v2);
  });
});
