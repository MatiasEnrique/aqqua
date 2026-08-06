/**
 * Pure helpers for batch thread deletion root selection and worktree membership.
 *
 * Kept free of Effect services so the orchestration decider can reuse them
 * without coupling to Git/RPC sagas.
 *
 * @module threadDeletion
 */
import type { OrchestrationThread, ThreadId } from "@aqqua/contracts";
import { normalizeProjectPathForComparison } from "@aqqua/shared/path";

export type WorktreeMemberThread = Pick<
  OrchestrationThread,
  "id" | "parentThreadId" | "worktreePath" | "deletedAt" | "archivedAt"
>;

/**
 * Canonical comparison for worktree membership. Trailing separators and
 * platform path variants must not split one worktree into two keys.
 */
export function comparableWorktreePath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return normalizeProjectPathForComparison(trimmed);
}

/**
 * Live and archived non-deleted threads rooted at the canonical worktree path.
 * Deleted threads are excluded so retries stay idempotent.
 */
export function listActiveThreadsForWorktreePath<T extends WorktreeMemberThread>(
  threads: ReadonlyArray<T>,
  worktreePath: string,
): T[] {
  const target = comparableWorktreePath(worktreePath);
  if (target === null) return [];
  return threads.filter((thread) => {
    if (thread.deletedAt !== null) return false;
    return comparableWorktreePath(thread.worktreePath) === target;
  });
}

/**
 * Select only roots whose parent is not itself in the batch, so one cascading
 * command can own each family without dispatching a duplicate child command.
 */
export function selectTopLevelThreadsForBatchAction<
  T extends { readonly id: ThreadId; readonly parentThreadId?: ThreadId | null | undefined },
>(threads: ReadonlyArray<T>): T[] {
  const activeThreadIds = new Set(threads.map((thread) => thread.id));
  return threads.filter((thread) => {
    const parentThreadId = thread.parentThreadId ?? null;
    return (
      parentThreadId === null ||
      parentThreadId === thread.id ||
      !activeThreadIds.has(parentThreadId)
    );
  });
}
