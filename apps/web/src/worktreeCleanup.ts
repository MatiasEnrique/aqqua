import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  VcsInspectWorktreeRemovalResult,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadShell } from "./types";

export interface WorktreeDeletionThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly worktreePath: string | null;
}

export interface WorktreeDeletionProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
}

export interface WorktreeDeletionCandidate {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectCwd: string;
  readonly path: string;
  readonly displayPath: string;
}

export interface WorktreeDeletionPlan {
  readonly candidates: ReadonlyArray<WorktreeDeletionCandidate>;
  readonly hasUnverifiableWorktrees: boolean;
}

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function selectThreadsForWorktree<
  T extends Pick<WorktreeDeletionThread, "environmentId" | "worktreePath">,
>(input: {
  readonly environmentId: EnvironmentId;
  readonly worktreePath: string;
  readonly threads: ReadonlyArray<T>;
}): T[] {
  const comparablePath = (path: string | null): string | null => {
    const normalized = normalizeWorktreePath(path);
    if (normalized === null) return null;
    return normalized.replace(/[\\/]+$/, "") || normalized;
  };
  const targetPath = comparablePath(input.worktreePath);
  if (targetPath === null) return [];
  return input.threads.filter(
    (thread) =>
      thread.environmentId === input.environmentId &&
      comparablePath(thread.worktreePath) === targetPath,
  );
}

export function selectThreadDeletionRoots<
  T extends {
    readonly id: ThreadId;
    readonly parentThreadId?: ThreadId | null | undefined;
  },
>(threads: ReadonlyArray<T>): T[] {
  const selectedThreadIds = new Set(threads.map((thread) => thread.id));
  return threads.filter((thread) => {
    const parentThreadId = thread.parentThreadId;
    return parentThreadId == null || !selectedThreadIds.has(parentThreadId);
  });
}

type TaggedCommandResult = { readonly _tag: "Success" } | { readonly _tag: "Failure" };

export type WorktreeResourceDeletionResult<TDeleteResult, TRemoveResult> =
  | { readonly _tag: "Success" }
  | {
      readonly _tag: "Failure";
      readonly stage: "conversation";
      readonly result: Extract<TDeleteResult, { readonly _tag: "Failure" }>;
    }
  | {
      readonly _tag: "Failure";
      readonly stage: "worktree";
      readonly result: Extract<TRemoveResult, { readonly _tag: "Failure" }>;
    };

export async function deleteWorktreeResourcesInOrder<
  TThread,
  TDeleteResult extends TaggedCommandResult,
  TRemoveResult extends TaggedCommandResult,
>(input: {
  readonly threadRoots: ReadonlyArray<TThread>;
  readonly deleteThread: (thread: TThread) => Promise<TDeleteResult>;
  readonly removeWorktree: (() => Promise<TRemoveResult>) | null;
}): Promise<WorktreeResourceDeletionResult<TDeleteResult, TRemoveResult>> {
  for (const thread of input.threadRoots) {
    const result = await input.deleteThread(thread);
    if (result._tag === "Failure") {
      return {
        _tag: "Failure",
        stage: "conversation",
        result: result as Extract<TDeleteResult, { readonly _tag: "Failure" }>,
      };
    }
  }
  if (input.removeWorktree !== null) {
    const result = await input.removeWorktree();
    if (result._tag === "Failure") {
      return {
        _tag: "Failure",
        stage: "worktree",
        result: result as Extract<TRemoveResult, { readonly _tag: "Failure" }>,
      };
    }
  }
  return { _tag: "Success" };
}

export function getOrphanedWorktreePathForThread(
  threads: ReadonlyArray<Pick<ThreadShell, "id" | "worktreePath">>,
  threadId: ThreadShell["id"],
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}

function scopedThreadId(thread: Pick<WorktreeDeletionThread, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function worktreeKey(environmentId: EnvironmentId, worktreePath: string): string {
  return `${environmentId}\u001f${worktreePath}`;
}

export function buildWorktreeDeletionPlan(input: {
  readonly targets: ReadonlyArray<WorktreeDeletionThread>;
  readonly threads: ReadonlyArray<WorktreeDeletionThread>;
  readonly projects: ReadonlyArray<WorktreeDeletionProject>;
  readonly completeEnvironmentIds: ReadonlySet<EnvironmentId>;
}): WorktreeDeletionPlan {
  const selectedThreadIds = new Set(input.targets.map(scopedThreadId));
  const candidates = new Map<string, WorktreeDeletionCandidate>();
  let hasUnverifiableWorktrees = false;

  for (const target of input.targets) {
    const path = normalizeWorktreePath(target.worktreePath);
    if (!path) continue;

    if (!input.completeEnvironmentIds.has(target.environmentId)) {
      hasUnverifiableWorktrees = true;
      continue;
    }

    const isStillReferenced = input.threads.some(
      (thread) =>
        thread.environmentId === target.environmentId &&
        normalizeWorktreePath(thread.worktreePath) === path &&
        !selectedThreadIds.has(scopedThreadId(thread)),
    );
    if (isStillReferenced) continue;

    const project = input.projects.find(
      (entry) => entry.environmentId === target.environmentId && entry.id === target.projectId,
    );
    if (!project) {
      hasUnverifiableWorktrees = true;
      continue;
    }

    const key = worktreeKey(target.environmentId, path);
    candidates.set(key, {
      key,
      environmentId: target.environmentId,
      projectCwd: project.workspaceRoot,
      path,
      displayPath: formatWorktreePathForDisplay(path),
    });
  }

  return {
    candidates: [...candidates.values()],
    hasUnverifiableWorktrees,
  };
}

export function isFinalWorktreeReferenceAfterDeletion(input: {
  readonly candidate: WorktreeDeletionCandidate;
  readonly current: Pick<WorktreeDeletionThread, "environmentId" | "id">;
  readonly catalogThreads: ReadonlyArray<WorktreeDeletionThread>;
  readonly deletedThreadKeys: ReadonlySet<string>;
}): boolean {
  const currentKey = scopedThreadId(input.current);
  return !input.catalogThreads.some((thread) => {
    const key = scopedThreadId(thread);
    return (
      thread.environmentId === input.candidate.environmentId &&
      normalizeWorktreePath(thread.worktreePath) === input.candidate.path &&
      key !== currentKey &&
      !input.deletedThreadKeys.has(key)
    );
  });
}

export function worktreeRemovalInspectionUnchanged(
  before: VcsInspectWorktreeRemovalResult | undefined,
  after: VcsInspectWorktreeRemovalResult,
): boolean {
  return (
    before !== undefined &&
    before.availability === after.availability &&
    before.headCommit === after.headCommit &&
    before.baseRef === after.baseRef &&
    before.mergeStatus === after.mergeStatus &&
    before.workingTreeStatus === after.workingTreeStatus
  );
}
