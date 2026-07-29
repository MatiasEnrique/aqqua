import type { FileDiffMetadata } from "@pierre/diffs/types";

/**
 * A working-tree diff file the user can include in (or exclude from) a commit
 * started from the diff panel.
 */
export interface DiffCommitFile {
  readonly fileKey: string;
  readonly path: string;
  /**
   * Paths to send to `git.runStackedAction` for this entry. Renames contribute
   * both the previous and the current path so the deletion side is staged too.
   */
  readonly commitPaths: ReadonlyArray<string>;
}

export interface DiffCommitSelection {
  readonly scopeKey: string | null;
  readonly excludedPaths: ReadonlySet<string>;
}

export const EMPTY_EXCLUDED_COMMIT_PATHS: ReadonlySet<string> = new Set();

function normalizeCommitPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
  const trimmed = stripped.trim();
  if (trimmed.length === 0 || trimmed === "dev/null" || trimmed === "/dev/null") {
    return null;
  }
  return trimmed;
}

export function resolveDiffCommitPaths(fileDiff: FileDiffMetadata): string[] {
  const paths: string[] = [];
  for (const candidate of [fileDiff.name, fileDiff.prevName]) {
    const normalized = normalizeCommitPath(candidate);
    if (normalized !== null && !paths.includes(normalized)) {
      paths.push(normalized);
    }
  }
  return paths;
}

export function isCommitFileIncluded(
  excludedPaths: ReadonlySet<string>,
  filePath: string,
): boolean {
  return !excludedPaths.has(filePath);
}

export function toggleCommitFileExcluded(
  excludedPaths: ReadonlySet<string>,
  filePath: string,
): ReadonlySet<string> {
  const next = new Set(excludedPaths);
  if (next.has(filePath)) {
    next.delete(filePath);
  } else {
    next.add(filePath);
  }
  return next;
}

export function setAllCommitFilesIncluded(
  files: ReadonlyArray<DiffCommitFile>,
  included: boolean,
): ReadonlySet<string> {
  return included ? new Set() : new Set(files.map((file) => file.path));
}

export interface DiffCommitSelectionSummary {
  readonly totalCount: number;
  readonly includedCount: number;
  readonly allIncluded: boolean;
  readonly noneIncluded: boolean;
  /**
   * `filePaths` argument for `git.runStackedAction`. `undefined` means "commit
   * every change", matching the chat-header git control: the server only resets
   * and re-stages a subset when an explicit list is sent.
   */
  readonly filePaths: string[] | undefined;
}

export function summarizeCommitSelection(
  files: ReadonlyArray<DiffCommitFile>,
  excludedPaths: ReadonlySet<string>,
): DiffCommitSelectionSummary {
  const included = files.filter((file) => isCommitFileIncluded(excludedPaths, file.path));
  const allIncluded = included.length === files.length;
  return {
    totalCount: files.length,
    includedCount: included.length,
    allIncluded,
    noneIncluded: included.length === 0,
    filePaths: allIncluded ? undefined : included.flatMap((file) => [...file.commitPaths]),
  };
}

/**
 * Commit controls only make sense for the uncommitted working-tree scope; turn
 * diffs and branch-range comparisons are history views.
 *
 * Deliberately independent of how many files are changed: the controls stay
 * mounted once the working tree is clean again so the result of the commit that
 * cleaned it remains visible.
 */
export function shouldShowDiffCommitControls(input: {
  readonly isGitRepo: boolean;
  readonly selectedTurnId: string | null;
  readonly gitScope: "branch" | "unstaged";
  readonly hasCwd: boolean;
}): boolean {
  return (
    input.isGitRepo &&
    input.selectedTurnId === null &&
    input.gitScope === "unstaged" &&
    input.hasCwd
  );
}
