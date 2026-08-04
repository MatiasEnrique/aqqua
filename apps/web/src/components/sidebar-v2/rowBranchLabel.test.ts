import { describe, expect, it } from "vite-plus/test";
import { rowBranchLabel } from "./rowBranchLabel";

describe("rowBranchLabel", () => {
  it("shows the branch and keeps the worktree path for the tooltip", () => {
    expect(
      rowBranchLabel({ branch: "feat/sidebar", worktreePath: "/tmp/wt/feat-sidebar" }),
    ).toEqual({
      label: "feat/sidebar",
      title: "Branch: feat/sidebar\nWorktree: /tmp/wt/feat-sidebar",
      isWorktree: true,
    });
  });

  it("marks a branch on the project's own checkout as not a worktree", () => {
    expect(rowBranchLabel({ branch: "main", worktreePath: null })).toEqual({
      label: "main",
      title: "Branch: main\nProject checkout",
      isWorktree: false,
    });
  });

  it("falls back to the worktree folder when the branch is unknown", () => {
    expect(rowBranchLabel({ branch: null, worktreePath: "/tmp/wt/detached/" })).toEqual({
      label: "detached",
      title: "Worktree: /tmp/wt/detached/",
      isWorktree: true,
    });
  });

  it("has nothing to say for an unbranched local thread", () => {
    expect(rowBranchLabel({ branch: null, worktreePath: null })).toBeNull();
    expect(rowBranchLabel({ branch: "  ", worktreePath: "  " })).toBeNull();
  });
});
