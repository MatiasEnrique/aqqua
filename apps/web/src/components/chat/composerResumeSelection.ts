import type { ProviderExternalSession } from "@aqqua/contracts";

export function resumeSessionDraftContext(
  projectRoot: string,
  session: Pick<ProviderExternalSession, "cwd" | "gitBranch">,
) {
  return {
    worktreePath: session.cwd === projectRoot ? null : session.cwd,
    envMode: "local" as const,
    branch: session.gitBranch ?? null,
    startFromOrigin: false,
    worktreeBranchName: null,
    worktreeSetupScriptId: null,
  };
}
