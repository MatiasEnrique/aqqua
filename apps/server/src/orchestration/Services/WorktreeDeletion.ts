/**
 * Server-owned worktree deletion saga.
 *
 * Resolves live + archived membership at execution time, dispatches existing
 * `thread.delete` roots (cascade owned by the decider), then removes the
 * worktree filesystem path. Partial progress always reports the true filesystem
 * outcome so clients and cleanup can react correctly.
 *
 * Concurrency guarantee (this server process):
 * - Deletion marks path ownership first (blocks new create leases), waits for
 *   in-flight create leases to drain, then reads membership and removes the FS.
 * - Durable thread.create holds a create lease through event-store commit, so
 *   deletion cannot empty-read past a create that has not yet committed.
 * - Worker creates that arrive after ownership begins fail with a typed
 *   invariant without blocking the global command worker on FS work.
 * - Unrelated paths are independent; idle gate entries are cleaned up.
 *
 * @module WorktreeDeletion
 */
import {
  CommandId,
  type ThreadId,
  type VcsDeleteWorktreeInput,
  type VcsDeleteWorktreeResult,
  type VcsInspectWorktreeRemovalResult,
  type GitCommandError,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  selectTopLevelThreadsForBatchDelete,
  type WorktreeMemberThread,
} from "../threadDeletion.ts";
import {
  releaseOutcomeForDeleteResult,
  type WorktreePathCoordinationShape,
  type WorktreePathDeletionRelease,
} from "./WorktreePathCoordination.ts";

export type { WorktreeMemberThread } from "../threadDeletion.ts";
export {
  comparableWorktreePath,
  listActiveThreadsForWorktreePath,
  selectTopLevelThreadsForBatchDelete,
} from "../threadDeletion.ts";

export type WorktreeDeletionStepError = {
  readonly message: string;
};

export interface WorktreeDeletionDeps {
  readonly inspectWorktreeRemoval: (
    input: Pick<VcsDeleteWorktreeInput, "cwd" | "path">,
  ) => Effect.Effect<VcsInspectWorktreeRemovalResult, GitCommandError>;
  readonly removeWorktree: (input: VcsDeleteWorktreeInput) => Effect.Effect<void, GitCommandError>;
  readonly deleteLocalBranch?: (input: {
    readonly cwd: string;
    readonly refName: string;
    readonly expectedHeadCommit: string;
  }) => Effect.Effect<void, GitCommandError>;
  /**
   * Authoritative membership snapshot: live + archived, non-deleted shells.
   * Re-read after each delete wave. A successful saga ends only after a final
   * empty read (pre-remove and again post-remove when the filesystem was removed).
   */
  readonly listMemberThreads: (
    worktreePath: string,
  ) => Effect.Effect<ReadonlyArray<WorktreeMemberThread>, WorktreeDeletionStepError>;
  readonly dispatchThreadDelete: (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, WorktreeDeletionStepError>;
  readonly allocateCommandId: (tag: string) => Effect.Effect<CommandId, WorktreeDeletionStepError>;
  /**
   * Shared create/delete path fence. Required so thread.create cannot race past
   * the final membership check into a removed worktree.
   */
  readonly pathCoordination: Pick<WorktreePathCoordinationShape, "withDeletion">;
}

const conversationPartial = (
  deletedThreadIds: ReadonlyArray<ThreadId>,
  detail: string,
  worktreeRemoval: "not_attempted" | "removed",
): VcsDeleteWorktreeResult => ({
  status: "partial",
  stage: "conversation",
  deletedThreadIds: [...deletedThreadIds],
  retryable: true,
  detail,
  worktreeRemoval,
});

/**
 * Delete every conversation for a worktree path, then remove the worktree.
 *
 * Under deletion ownership: wait for create-lease drain → pre-remove membership
 * drain → filesystem remove → post-remove drain. Release outcome drives
 * dispatch-time create waiters when the path is gone.
 */
export const deleteWorktreeOwned = Effect.fn("deleteWorktreeOwned")(function* (
  input: VcsDeleteWorktreeInput,
  deps: WorktreeDeletionDeps,
): Effect.fn.Return<VcsDeleteWorktreeResult, GitCommandError> {
  const inspection = yield* deps.inspectWorktreeRemoval({
    cwd: input.cwd,
    path: input.path,
  });

  return yield* deps.pathCoordination.withDeletion(
    input.path,
    Effect.gen(function* () {
      const deletedThreadIds: ThreadId[] = [];
      const deletedSet = new Set<string>();

      const drainMembers = Effect.fn("deleteWorktreeOwned.drainMembers")(function* (
        allocateTag: string,
        worktreeRemoval: "not_attempted" | "removed",
      ) {
        for (;;) {
          const membersResult = yield* deps.listMemberThreads(input.path).pipe(Effect.result);
          if (Result.isFailure(membersResult)) {
            return conversationPartial(
              deletedThreadIds,
              membersResult.failure.message,
              worktreeRemoval,
            );
          }
          const remaining = membersResult.success.filter((thread) => !deletedSet.has(thread.id));
          if (remaining.length === 0) return null;

          const roots = selectTopLevelThreadsForBatchDelete(remaining);
          for (const root of roots) {
            if (deletedSet.has(root.id)) continue;
            const commandIdResult = yield* deps.allocateCommandId(allocateTag).pipe(Effect.result);
            if (Result.isFailure(commandIdResult)) {
              return conversationPartial(
                deletedThreadIds,
                commandIdResult.failure.message,
                worktreeRemoval,
              );
            }
            const deleteResult = yield* deps
              .dispatchThreadDelete({
                commandId: commandIdResult.success,
                threadId: root.id,
              })
              .pipe(Effect.result);
            if (Result.isFailure(deleteResult)) {
              return conversationPartial(
                deletedThreadIds,
                deleteResult.failure.message,
                worktreeRemoval,
              );
            }
            deletedSet.add(root.id);
            deletedThreadIds.push(root.id);
          }
        }
      });

      // Drain until empty while the path fence is held so same-path creates
      // cannot become durable until we release.
      const preRemovePartial = yield* drainMembers("worktree-thread-delete", "not_attempted");
      if (preRemovePartial !== null) return preRemovePartial;

      if (inspection.availability !== "available") {
        return {
          status: "completed" as const,
          deletedThreadIds,
          worktreeRemoval: "already_missing" as const,
          ...(inspection.availability === "not_worktree"
            ? { preservedUnverifiedPath: true as const }
            : {}),
          ...(input.deleteBranch ? { branchRemoval: "unavailable" as const } : {}),
        };
      }

      const removeResult = yield* deps
        .removeWorktree({
          cwd: input.cwd,
          path: input.path,
          force: input.force ?? true,
        })
        .pipe(Effect.result);

      if (Result.isFailure(removeResult)) {
        return {
          status: "partial" as const,
          stage: "worktree" as const,
          deletedThreadIds,
          retryable: true,
          detail: removeResult.failure.message,
          worktreeRemoval: "failed" as const,
        };
      }

      let branchFailure: GitCommandError | null = null;
      let branchRemoval: "removed" | "unavailable" | null = null;
      if (input.deleteBranch) {
        if (
          inspection.refName === null ||
          inspection.headCommit === null ||
          deps.deleteLocalBranch === undefined
        ) {
          branchRemoval = "unavailable";
        } else {
          const branchResult = yield* deps
            .deleteLocalBranch({
              cwd: input.cwd,
              refName: inspection.refName,
              expectedHeadCommit: inspection.headCommit,
            })
            .pipe(Effect.result);
          if (Result.isFailure(branchResult)) {
            branchFailure = branchResult.failure;
          } else {
            branchRemoval = "removed";
          }
        }
      }

      // Stragglers that were already durable before the fence are still drained
      // here; fence-held creates cannot become durable mid-saga.
      const postRemovePartial = yield* drainMembers("worktree-thread-delete-straggler", "removed");
      if (postRemovePartial !== null) return postRemovePartial;

      if (branchFailure !== null) {
        return {
          status: "partial" as const,
          stage: "branch" as const,
          deletedThreadIds,
          retryable: false,
          detail: branchFailure.message,
          worktreeRemoval: "removed" as const,
          branchRemoval: "failed" as const,
        };
      }

      return {
        status: "completed" as const,
        deletedThreadIds,
        worktreeRemoval: "removed" as const,
        ...(branchRemoval === null ? {} : { branchRemoval }),
      };
    }),
    (result): WorktreePathDeletionRelease => releaseOutcomeForDeleteResult(result),
  );
});
