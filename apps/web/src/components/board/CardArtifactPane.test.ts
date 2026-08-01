import { describe, expect, it } from "vite-plus/test";

import { artifactContentBottomPadding } from "./CardArtifactPane";

describe("artifactContentBottomPadding", () => {
  it("reserves the measured composer height plus the document end gutter", () => {
    expect(artifactContentBottomPadding(144)).toBe(176);
    expect(artifactContentBottomPadding(280)).toBe(312);
  });
});
