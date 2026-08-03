import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

describe("SETTINGS_NAV_ITEMS", () => {
  it("labels the retained local settings as backends instead of connections", () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.label)).toContain("Backends");
    expect(SETTINGS_NAV_ITEMS.map((item) => item.label)).not.toContain("Connections");
  });
});
