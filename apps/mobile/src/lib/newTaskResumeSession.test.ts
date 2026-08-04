import { describe, expect, it } from "@effect/vitest";

import { resolveResumeSessionWorkspace } from "./newTaskResumeSession";

const BRANCHES = [
  { name: "main", worktreePath: null },
  { name: "feature", worktreePath: "/repo/.aqqua/worktrees/feature" },
];

describe("resolveResumeSessionWorkspace", () => {
  it("targets the project root as a local checkout", () => {
    expect(
      resolveResumeSessionWorkspace({
        projectRoot: "/repo",
        branches: BRANCHES,
        selectedBranchName: "main",
        sessionCwd: "/repo",
      }),
    ).toEqual({ mode: "local", branch: "main", worktreePath: null });
  });

  it("targets an existing managed worktree without preparing a new one", () => {
    expect(
      resolveResumeSessionWorkspace({
        projectRoot: "/repo",
        branches: BRANCHES,
        selectedBranchName: "main",
        sessionCwd: "/repo/.aqqua/worktrees/feature",
      }),
    ).toEqual({
      mode: "local",
      branch: "feature",
      worktreePath: "/repo/.aqqua/worktrees/feature",
    });
  });

  it("refuses a cwd outside the project and its managed worktrees", () => {
    expect(
      resolveResumeSessionWorkspace({
        projectRoot: "/repo",
        branches: BRANCHES,
        selectedBranchName: "main",
        sessionCwd: "/other/repo",
      }),
    ).toBeNull();
  });
});
