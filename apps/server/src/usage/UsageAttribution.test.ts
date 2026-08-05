import { describe, expect, it } from "@effect/vitest";

import {
  attributeUsagePath,
  usageProjectAttributionKey,
  type UsageAttributionRoot,
} from "./UsageAttribution.ts";

const roots = [
  {
    projectId: "project-a",
    projectTitle: "Aqqua",
    path: "/workspace/aqqua",
  },
  {
    projectId: "project-a",
    projectTitle: "Aqqua",
    path: "/workspace/aqqua/.aqqua/worktrees/usage",
  },
  {
    projectId: "project-b",
    projectTitle: "Website",
    path: "/workspace/site",
  },
] satisfies ReadonlyArray<UsageAttributionRoot>;

describe("UsageAttribution", () => {
  it("uses the longest path-segment match for nested aqqua worktrees", () => {
    expect(
      attributeUsagePath("/workspace/aqqua/.aqqua/worktrees/usage/apps/server", roots),
    ).toEqual({
      kind: "aqqua",
      projectId: "project-a",
      projectTitle: "Aqqua",
      rootPath: "/workspace/aqqua/.aqqua/worktrees/usage",
    });
  });

  it("does not treat a sibling path with a shared string prefix as a project", () => {
    expect(attributeUsagePath("/workspace/aqqua-copy", roots)).toEqual({
      kind: "external",
    });
    expect(usageProjectAttributionKey("/workspace/aqqua-copy", roots)).toBe("external");
  });

  it("emits a stable aqqua project key and handles missing cwd as external", () => {
    expect(usageProjectAttributionKey("/workspace/site/src", roots)).toBe("aqqua:project-b");
    expect(usageProjectAttributionKey(null, roots)).toBe("external");
  });
});
