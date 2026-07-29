import { describe, expect, it } from "vite-plus/test";

import {
  formatVcsPullOutcome,
  resolveDiffPanelCwd,
  shouldShowDiffPullControl,
} from "./diffPanelGitTarget";

describe("resolveDiffPanelCwd", () => {
  it("prefers the thread's worktree", () => {
    expect(
      resolveDiffPanelCwd({
        threadWorktreePath: "/repo/.worktrees/feature",
        projectWorkspaceRoot: "/repo",
        fallbackCwd: "/repo",
      }),
    ).toBe("/repo/.worktrees/feature");
  });

  it("falls back to the project workspace root when there is no worktree", () => {
    expect(
      resolveDiffPanelCwd({
        threadWorktreePath: null,
        projectWorkspaceRoot: "/repo",
        fallbackCwd: "/other",
      }),
    ).toBe("/repo");
  });

  it("uses the chat view's repository for a draft with no server thread", () => {
    expect(
      resolveDiffPanelCwd({
        threadWorktreePath: undefined,
        projectWorkspaceRoot: undefined,
        fallbackCwd: "/repo",
      }),
    ).toBe("/repo");
  });

  it("resolves to null when nothing points at a repository", () => {
    expect(
      resolveDiffPanelCwd({
        threadWorktreePath: null,
        projectWorkspaceRoot: null,
        fallbackCwd: null,
      }),
    ).toBeNull();
  });
});

describe("shouldShowDiffPullControl", () => {
  it("shows for the working-tree and branch scopes of a git repository", () => {
    expect(shouldShowDiffPullControl({ isGitRepo: true, selectedTurnId: null, hasCwd: true })).toBe(
      true,
    );
  });

  it("hides for turn diffs", () => {
    expect(
      shouldShowDiffPullControl({ isGitRepo: true, selectedTurnId: "turn_1", hasCwd: true }),
    ).toBe(false);
  });

  it("hides without a repository or a cwd", () => {
    expect(
      shouldShowDiffPullControl({ isGitRepo: false, selectedTurnId: null, hasCwd: true }),
    ).toBe(false);
    expect(
      shouldShowDiffPullControl({ isGitRepo: true, selectedTurnId: null, hasCwd: false }),
    ).toBe(false);
  });
});

describe("formatVcsPullOutcome", () => {
  it("names the branch and its upstream after a pull", () => {
    expect(
      formatVcsPullOutcome({ status: "pulled", refName: "main", upstreamRef: "origin/main" }),
    ).toBe("Pulled main from origin/main.");
  });

  it("falls back to a generic upstream when none is reported", () => {
    expect(formatVcsPullOutcome({ status: "pulled", refName: "main", upstreamRef: null })).toBe(
      "Pulled main from upstream.",
    );
  });

  it("reports an already-synchronized branch", () => {
    expect(
      formatVcsPullOutcome({
        status: "skipped_up_to_date",
        refName: "main",
        upstreamRef: "origin/main",
      }),
    ).toBe("main is already up to date.");
  });
});
