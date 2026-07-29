import { describe, expect, it } from "vite-plus/test";

import { rightPanelSurfaceButtonKindOf } from "./PanelLayoutControls";

describe("rightPanelSurfaceButtonKindOf", () => {
  it("treats the explorer and an individual file as the same header button", () => {
    expect(rightPanelSurfaceButtonKindOf("files")).toBe("files");
    expect(rightPanelSurfaceButtonKindOf("file")).toBe("files");
  });

  it("maps the remaining surfaces onto their header buttons", () => {
    expect(rightPanelSurfaceButtonKindOf("diff")).toBe("diff");
    expect(rightPanelSurfaceButtonKindOf("history")).toBe("history");
    expect(rightPanelSurfaceButtonKindOf("terminal")).toBe("terminal");
    expect(rightPanelSurfaceButtonKindOf("preview")).toBe("browser");
  });

  it("has no header button for the plan surface or a closed panel", () => {
    expect(rightPanelSurfaceButtonKindOf("plan")).toBe(null);
    expect(rightPanelSurfaceButtonKindOf(null)).toBe(null);
  });
});
