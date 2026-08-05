/**
 * Which repository the diff panel points at, and which repository-level git
 * actions it offers for that repository.
 */

export interface DiffPanelCwdInput {
  /** Worktree the server checked out for the thread, when it has one. */
  readonly threadWorktreePath: string | null | undefined;
  /** Workspace root of the thread's project. */
  readonly projectWorkspaceRoot: string | null | undefined;
  /**
   * Repository the surrounding chat view is pointed at. This is what makes the
   * diff viewer work on conversations that have no messages yet: a client-local
   * draft has no server thread (so neither of the fields above resolves), and a
   * worktree draft's worktree only exists once the first message is sent, so
   * both fall back to the project's base repository.
   */
  readonly fallbackCwd: string | null | undefined;
}

export function resolveDiffPanelCwd(input: DiffPanelCwdInput): string | null {
  return input.threadWorktreePath ?? input.projectWorkspaceRoot ?? input.fallbackCwd ?? null;
}

/**
 * Pull updates the checked-out branch of whichever repository the diff is
 * showing, so it stays available while the working tree is clean — pulling into
 * a clean tree is the main reason to reach for it. It is hidden for historical
 * turn diffs and foreign-head comparisons, neither of which a pull should
 * change.
 */
export function shouldShowDiffPullControl(input: {
  readonly isGitRepo: boolean;
  readonly selectedTurnId: string | null;
  readonly hasCwd: boolean;
  readonly isViewingForeignHead: boolean;
}): boolean {
  return (
    input.isGitRepo && input.selectedTurnId === null && input.hasCwd && !input.isViewingForeignHead
  );
}

export function formatVcsPullOutcome(result: {
  readonly status: "pulled" | "skipped_up_to_date";
  readonly refName: string;
  readonly upstreamRef: string | null;
}): string {
  return result.status === "pulled"
    ? `Pulled ${result.refName} from ${result.upstreamRef ?? "upstream"}.`
    : `${result.refName} is already up to date.`;
}
