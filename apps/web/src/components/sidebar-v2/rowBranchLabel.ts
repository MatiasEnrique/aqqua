import { formatWorktreePathForDisplay } from "../../worktreeCleanup";

export interface RowBranchLabel {
  /** What the row shows: the branch name, or the worktree folder when unbranched. */
  readonly label: string;
  /** What the tooltip shows: the branch, and the worktree path when there is one. */
  readonly title: string;
  /** True when the thread runs in its own checkout rather than the project's. */
  readonly isWorktree: boolean;
}

/**
 * Where a thread's work lives, said the way a person thinks of it: the branch
 * name, with the worktree kept for the tooltip. A thread on the project's own
 * checkout still names its branch — only the icon distinguishes the two. Null
 * when there is neither, since an unbranched local thread has nothing to say
 * that the project row above it doesn't already.
 */
export function rowBranchLabel(thread: {
  readonly branch: string | null;
  readonly worktreePath: string | null;
}): RowBranchLabel | null {
  const branch = thread.branch?.trim() ?? "";
  const worktreePath = thread.worktreePath?.trim() ?? "";
  const isWorktree = worktreePath !== "";
  if (branch === "" && !isWorktree) return null;
  const label = branch === "" ? formatWorktreePathForDisplay(worktreePath) : branch;
  const title = [
    branch === "" ? null : `Branch: ${branch}`,
    isWorktree ? `Worktree: ${worktreePath}` : "Project checkout",
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { label, title, isWorktree };
}
