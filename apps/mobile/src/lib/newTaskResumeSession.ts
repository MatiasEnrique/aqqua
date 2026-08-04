export interface ResumeSessionWorkspaceBranch {
  readonly name: string | null;
  readonly worktreePath?: string | null;
}

export interface ResumeSessionWorkspaceSelection {
  readonly mode: "local";
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

/** Resolves the only safe local workspace for an external provider session. */
export function resolveResumeSessionWorkspace(input: {
  readonly projectRoot: string;
  readonly branches: ReadonlyArray<ResumeSessionWorkspaceBranch>;
  readonly selectedBranchName: string | null;
  readonly sessionCwd: string;
}): ResumeSessionWorkspaceSelection | null {
  if (input.sessionCwd === input.projectRoot) {
    return {
      mode: "local",
      branch: input.selectedBranchName,
      worktreePath: null,
    };
  }
  const matchingWorktree = input.branches.find(
    (branch) => branch.worktreePath === input.sessionCwd,
  );
  return matchingWorktree
    ? {
        mode: "local",
        branch: matchingWorktree.name,
        worktreePath: input.sessionCwd,
      }
    : null;
}
