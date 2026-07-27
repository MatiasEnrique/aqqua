import type { ProjectScript, VcsRef } from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import { setupProjectScript } from "@t3tools/shared/projectScripts";

import { NO_WORKTREE_SETUP_SCRIPT_ID } from "~/projectScripts";

export interface WorktreeSetupActionOption {
  readonly value: string;
  readonly label: string;
}

// A name has to survive sanitization with something addressable left over.
// "///" and "!!!" both sanitize to git-legal-but-meaningless output, so they
// are rejected up front rather than silently becoming a fallback branch.
const BRANCH_NAME_CONTENT_PATTERN = /[a-z0-9]/;

/**
 * Normalize a typed worktree name into a git ref name.
 *
 * Unlike `sanitizeFeatureBranchName` this does not force a `feature/` prefix:
 * the user named this worktree deliberately, so `fix-login` stays `fix-login`
 * and `release/2026-01` keeps its own namespace. Returns "" when nothing
 * usable remains, which callers surface as a validation error.
 */
export function normalizeWorktreeBranchName(value: string): string {
  const trimmed = value.trim();
  if (!BRANCH_NAME_CONTENT_PATTERN.test(trimmed.toLowerCase())) {
    return "";
  }
  return sanitizeBranchFragment(trimmed);
}

/**
 * User-facing validation message for the worktree name field, or null when the
 * name is usable.
 *
 * Collisions are reported rather than auto-suffixed: the user typed this name
 * on purpose, so landing them on `fix-login-2` without saying so would be worse
 * than asking them to pick again.
 */
export function validateWorktreeBranchName(input: {
  value: string;
  existingBranchNames: readonly string[];
}): string | null {
  if (input.value.trim().length === 0) {
    return "Enter a name for the new worktree.";
  }
  const normalized = normalizeWorktreeBranchName(input.value);
  if (normalized.length === 0) {
    return "Use letters or numbers so this can become a branch name.";
  }
  const isTaken = input.existingBranchNames.some(
    (name) => name.toLowerCase() === normalized.toLowerCase(),
  );
  if (isTaken) {
    return `A branch named "${normalized}" already exists.`;
  }
  return null;
}

/**
 * Setup actions offered for one worktree, ending with an explicit opt-out.
 * The project's `runOnWorktreeCreate` script is labelled so the user can tell
 * which one they would get by doing nothing.
 */
export function buildSetupActionOptions(
  scripts: readonly ProjectScript[],
): readonly WorktreeSetupActionOption[] {
  const defaultScript = setupProjectScript(scripts);
  return [
    ...scripts.map((script) => ({
      value: script.id,
      label: script.id === defaultScript?.id ? `${script.name} (default)` : script.name,
    })),
    { value: NO_WORKTREE_SETUP_SCRIPT_ID, label: "No action" },
  ];
}

export function resolveDefaultSetupActionValue(scripts: readonly ProjectScript[]): string {
  return setupProjectScript(scripts)?.id ?? NO_WORKTREE_SETUP_SCRIPT_ID;
}

/**
 * Base branch to preselect: the repository default, else whatever is checked
 * out, else the first local branch. Remote-only refs are never preselected —
 * they would need a local tracking branch first.
 */
export function resolveDefaultBaseBranch(refs: readonly VcsRef[]): string | null {
  const localRefs = refs.filter((ref) => ref.isRemote !== true);
  return (
    localRefs.find((ref) => ref.isDefault)?.name ??
    localRefs.find((ref) => ref.current)?.name ??
    localRefs[0]?.name ??
    null
  );
}
