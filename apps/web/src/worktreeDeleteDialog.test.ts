import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeWorktreeDeleteDialogClose,
  readWorktreeDeleteDialogState,
  requestWorktreeDeleteConfirmation,
  resetWorktreeDeleteDialogForTests,
  respondToWorktreeDeleteConfirmation,
  setWorktreeDeleteBranchSelection,
  WorktreeDeleteConfirmationConflictError,
} from "./worktreeDeleteDialog";

const request = {
  label: "feature/cleanup",
  path: "/repo/worktrees/cleanup",
  conversationCount: 2,
  archivedCount: 1,
  inspection: {
    availability: "available",
    refName: "feature/cleanup",
    headCommit: "abc123",
    baseRef: "origin/main",
    mergeStatus: "merged",
    workingTreeStatus: "clean",
  },
} as const;

describe("worktree delete dialog coordinator", () => {
  beforeEach(() => {
    resetWorktreeDeleteDialogForTests();
  });

  it("returns the explicit local-branch decision", async () => {
    const confirmation = requestWorktreeDeleteConfirmation(request);
    expect(readWorktreeDeleteDialogState()).toMatchObject({
      status: "confirming",
      deleteBranch: false,
    });

    setWorktreeDeleteBranchSelection(true);
    respondToWorktreeDeleteConfirmation({ deleteBranch: true });

    await expect(confirmation).resolves.toEqual({ deleteBranch: true });
    expect(readWorktreeDeleteDialogState().status).toBe("closing");
    completeWorktreeDeleteDialogClose();
    expect(readWorktreeDeleteDialogState()).toEqual({ status: "idle" });

    const nextConfirmation = requestWorktreeDeleteConfirmation({ ...request, label: "next" });
    expect(readWorktreeDeleteDialogState()).toMatchObject({
      status: "confirming",
      deleteBranch: false,
    });
    respondToWorktreeDeleteConfirmation(null);
    await expect(nextConfirmation).resolves.toBeNull();
  });

  it("resolves cancellation and rejects a concurrent request", async () => {
    const confirmation = requestWorktreeDeleteConfirmation(request);
    await expect(
      requestWorktreeDeleteConfirmation({ ...request, label: "other" }),
    ).rejects.toBeInstanceOf(WorktreeDeleteConfirmationConflictError);

    respondToWorktreeDeleteConfirmation(null);
    await expect(confirmation).resolves.toBeNull();
  });
});
