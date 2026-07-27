import type { ProjectScript } from "@t3tools/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/**
 * Resolve the script to run after a worktree is created.
 *
 * With an explicit `scriptId` the caller asked for one specific script; when
 * that script is gone we return null rather than falling back to the project
 * default, because running a different command than the one requested is worse
 * than running nothing.
 */
export function resolveWorktreeSetupScript(
  scripts: readonly ProjectScript[],
  scriptId?: string | null,
): ProjectScript | null {
  if (scriptId) {
    return scripts.find((script) => script.id === scriptId) ?? null;
  }
  return setupProjectScript(scripts);
}
