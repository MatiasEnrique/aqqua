/**
 * Server-owned worktree deletion saga.
 *
 * Resolves live + archived membership at execution time, archives every live
 * conversation family (cascade owned by the decider), then removes the
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
  selectTopLevelThreadsForBatchAction,
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
  selectTopLevelThreadsForBatchAction,
} from "../threadDeletion.ts";

export type WorktreeDeletionStepError = {
  readonly message: string;
};

type WorktreeRemovalInspection = VcsInspectWorktreeRemovalResult & {
  /** Internal registered-worktree identity; intentionally absent from the wire contract. */
  readonly worktreeIdentity?: string | undefined;
};

export interface WorktreeDeletionDeps {
  readonly inspectWorktreeRemoval: (
    input: Pick<VcsDeleteWorktreeInput, "cwd" | "path">,
  ) => Effect.Effect<WorktreeRemovalInspection, GitCommandError>;
  readonly removeWorktree: (input: VcsDeleteWorktreeInput) => Effect.Effect<void, GitCommandError>;
  readonly deleteLocalBranch?: (input: {
    readonly cwd: string;
    readonly refName: string;
    readonly expectedHeadCommit: string;
  }) => Effect.Effect<void, GitCommandError>;
  /**
   * Authoritative membership snapshot: live + archived, non-deleted shells.
   * Re-read after each archive wave. Already archived members remain as durable
   * history and are ignored by the drain.
   */
  readonly listMemberThreads: (
    worktreePath: string,
  ) => Effect.Effect<ReadonlyArray<WorktreeMemberThread>, WorktreeDeletionStepError>;
  readonly dispatchThreadArchive: (input: {
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
  archivedThreadIds: ReadonlyArray<ThreadId>,
  detail: string,
  worktreeRemoval: "not_attempted" | "removed",
): VcsDeleteWorktreeResult => ({
  status: "partial",
  stage: "conversation",
  archivedThreadIds: [...archivedThreadIds],
  retryable: true,
  detail,
  worktreeRemoval,
});

const sameRemovalInspection = (
  confirmed: WorktreeRemovalInspection,
  current: WorktreeRemovalInspection,
): boolean =>
  confirmed.availability === current.availability &&
  confirmed.refName === current.refName &&
  confirmed.headCommit === current.headCommit &&
  confirmed.baseRef === current.baseRef &&
  confirmed.mergeStatus === current.mergeStatus &&
  confirmed.workingTreeStatus === current.workingTreeStatus &&
  confirmed.worktreeIdentity === current.worktreeIdentity;

/**
 * Archive every live conversation for a worktree path, then remove the worktree.
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
  let worktreeRemoved = false;

  return yield* deps.pathCoordination.withDeletion(
    input.path,
    Effect.gen(function* () {
      const archivedThreadIds: ThreadId[] = [];
      const archivedSet = new Set<string>();

      const drainMembers = Effect.fn("deleteWorktreeOwned.drainMembers")(function* (
        allocateTag: string,
        worktreeRemoval: "not_attempted" | "removed",
      ) {
        for (;;) {
          const membersResult = yield* deps.listMemberThreads(input.path).pipe(Effect.result);
          if (Result.isFailure(membersResult)) {
            return conversationPartial(
              archivedThreadIds,
              membersResult.failure.message,
              worktreeRemoval,
            );
          }
          const remaining = membersResult.success.filter(
            (thread) => thread.archivedAt === null && !archivedSet.has(thread.id),
          );
          if (remaining.length === 0) return null;

          const roots = selectTopLevelThreadsForBatchAction(remaining);
          for (const root of roots) {
            if (archivedSet.has(root.id)) continue;
            const commandIdResult = yield* deps.allocateCommandId(allocateTag).pipe(Effect.result);
            if (Result.isFailure(commandIdResult)) {
              return conversationPartial(
                archivedThreadIds,
                commandIdResult.failure.message,
                worktreeRemoval,
              );
            }
            const archiveResult = yield* deps
              .dispatchThreadArchive({
                commandId: commandIdResult.success,
                threadId: root.id,
              })
              .pipe(Effect.result);
            if (Result.isFailure(archiveResult)) {
              return conversationPartial(
                archivedThreadIds,
                archiveResult.failure.message,
                worktreeRemoval,
              );
            }
            archivedSet.add(root.id);
            archivedThreadIds.push(root.id);
          }
        }
      });

      // Drain until empty while the path fence is held so same-path creates
      // cannot become durable until we release.
      const preRemovePartial = yield* drainMembers("worktree-thread-archive", "not_attempted");
      if (preRemovePartial !== null) return preRemovePartial;

      if (inspection.availability !== "available") {
        return {
          status: "completed" as const,
          archivedThreadIds,
          worktreeRemoval: "already_missing" as const,
          ...(inspection.availability === "not_worktree"
            ? { preservedUnverifiedPath: true as const }
            : {}),
          ...(input.deleteBranch ? { branchRemoval: "unavailable" as const } : {}),
        };
      }

      const reinspectionResult = yield* deps
        .inspectWorktreeRemoval({
          cwd: input.cwd,
          path: input.path,
        })
        .pipe(Effect.result);
      if (Result.isFailure(reinspectionResult)) {
        return {
          status: "partial" as const,
          stage: "worktree" as const,
          archivedThreadIds,
          retryable: true,
          detail: reinspectionResult.failure.message,
          worktreeRemoval: "not_attempted" as const,
        };
      }
      if (!sameRemovalInspection(inspection, reinspectionResult.success)) {
        return {
          status: "partial" as const,
          stage: "worktree" as const,
          archivedThreadIds,
          retryable: true,
          detail: "Worktree changed after deletion confirmation; inspect it again before retrying.",
          worktreeRemoval: "not_attempted" as const,
        };
      }

      const removeResult = yield* deps
        .removeWorktree({
          cwd: input.cwd,
          path: input.path,
          force: input.force ?? true,
        })
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              worktreeRemoved = true;
            }),
          ),
          Effect.result,
          Effect.uninterruptible,
        );

      if (Result.isFailure(removeResult)) {
        return {
          status: "partial" as const,
          stage: "worktree" as const,
          archivedThreadIds,
          retryable: true,
          detail: removeResult.failure.message,
          worktreeRemoval: "failed" as const,
        };
      }

      let branchFailure: GitCommandError | null = null;
      let branchRemoval: "removed" | "unavailable" | null = null;
      if (input.deleteBranch) {
        if (
          reinspectionResult.success.refName === null ||
          reinspectionResult.success.headCommit === null ||
          deps.deleteLocalBranch === undefined
        ) {
          branchRemoval = "unavailable";
        } else {
          const branchResult = yield* deps
            .deleteLocalBranch({
              cwd: input.cwd,
              refName: reinspectionResult.success.refName,
              expectedHeadCommit: reinspectionResult.success.headCommit,
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
      const postRemovePartial = yield* drainMembers("worktree-thread-archive-straggler", "removed");
      if (postRemovePartial !== null) return postRemovePartial;

      if (branchFailure !== null) {
        return {
          status: "partial" as const,
          stage: "branch" as const,
          archivedThreadIds,
          retryable: false,
          detail: branchFailure.message,
          worktreeRemoval: "removed" as const,
          branchRemoval: "failed" as const,
        };
      }

      return {
        status: "completed" as const,
        archivedThreadIds,
        worktreeRemoval: "removed" as const,
        ...(branchRemoval === null ? {} : { branchRemoval }),
      };
    }),
    (result): WorktreePathDeletionRelease => releaseOutcomeForDeleteResult(result),
    {
      releaseOnFailure: () => (worktreeRemoved ? "removed" : "kept"),
    },
  );
});
