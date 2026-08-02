import { CommandId, GitCommandError, ThreadId } from "@aqqua/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { describe, expect, it } from "@effect/vitest";

import type { WorktreeMemberThread } from "../threadDeletion.ts";
import { deleteWorktreeOwned } from "./WorktreeDeletion.ts";
import {
  layer as WorktreePathCoordinationLive,
  releaseOutcomeForDeleteResult,
  WorktreePathCoordination,
} from "./WorktreePathCoordination.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asCommandId = (value: string): CommandId => CommandId.make(value);

function member(input: {
  readonly id: string;
  readonly worktreePath: string | null;
  readonly parentThreadId?: string | null;
  readonly deletedAt?: string | null;
  readonly archivedAt?: string | null;
}): WorktreeMemberThread {
  return {
    id: asThreadId(input.id),
    parentThreadId:
      input.parentThreadId === undefined || input.parentThreadId === null
        ? null
        : asThreadId(input.parentThreadId),
    worktreePath: input.worktreePath,
    deletedAt: input.deletedAt ?? null,
    archivedAt: input.archivedAt ?? null,
  };
}

const availableInspection = {
  availability: "available" as const,
  refName: "feature/a",
  headCommit: "abc",
  baseRef: "main",
  mergeStatus: "merged" as const,
  workingTreeStatus: "clean" as const,
};

describe("deleteWorktreeOwned", () => {
  it.effect("deletes live and archived membership roots before filesystem removal", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const calls: string[] = [];
      const members = [
        member({ id: "live", worktreePath: "/tmp/wt" }),
        member({
          id: "archived",
          worktreePath: "/tmp/wt",
          archivedAt: "2026-01-02T00:00:00.000Z",
        }),
        member({ id: "child", worktreePath: "/tmp/wt", parentThreadId: "live" }),
      ];
      const deleted = yield* Ref.make(new Set<string>());

      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () =>
            Effect.sync(() => {
              calls.push("worktree");
            }),
          listMemberThreads: () =>
            Effect.gen(function* () {
              const gone = yield* Ref.get(deleted);
              return members.filter((thread) => !gone.has(thread.id));
            }),
          dispatchThreadDelete: ({ threadId }) =>
            Effect.gen(function* () {
              calls.push(`delete:${threadId}`);
              yield* Ref.update(deleted, (current) => {
                const next = new Set(current);
                next.add(threadId);
                if (threadId === asThreadId("live")) {
                  next.add(asThreadId("child"));
                }
                return next;
              });
            }),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result).toEqual({
        status: "completed",
        deletedThreadIds: [asThreadId("live"), asThreadId("archived")],
        worktreeRemoval: "removed",
      });
      expect(calls).toEqual(["delete:live", "delete:archived", "worktree"]);
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("includes a concurrent member that appears during the pre-remove drain", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const calls: string[] = [];
      const deleted = yield* Ref.make(new Set<string>());
      const wave = yield* Ref.make(0);

      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-pre", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () =>
            Effect.sync(() => {
              calls.push("worktree");
            }),
          listMemberThreads: () =>
            Effect.gen(function* () {
              const currentWave = yield* Ref.updateAndGet(wave, (value) => value + 1);
              const gone = yield* Ref.get(deleted);
              const base = [
                member({ id: "initial", worktreePath: "/tmp/wt-pre" }),
                ...(currentWave >= 2
                  ? [member({ id: "concurrent", worktreePath: "/tmp/wt-pre" })]
                  : []),
              ];
              return base.filter((thread) => !gone.has(thread.id));
            }),
          dispatchThreadDelete: ({ threadId }) =>
            Effect.gen(function* () {
              calls.push(`delete:${threadId}`);
              yield* Ref.update(deleted, (current) => new Set(current).add(threadId));
            }),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.deletedThreadIds).toEqual([asThreadId("initial"), asThreadId("concurrent")]);
      }
      expect(calls).toEqual(["delete:initial", "delete:concurrent", "worktree"]);
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect(
    "post-remove drain deletes a member that appears only after the pre-remove empty read",
    () =>
      Effect.gen(function* () {
        const coordination = yield* WorktreePathCoordination;
        const calls: string[] = [];
        const deleted = yield* Ref.make(new Set<string>());
        const lateMember = yield* Ref.make<WorktreeMemberThread | null>(null);

        const result = yield* deleteWorktreeOwned(
          { cwd: "/tmp/repo", path: "/tmp/wt-post", force: true },
          {
            pathCoordination: coordination,
            inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
            removeWorktree: () =>
              Effect.gen(function* () {
                calls.push("worktree");
                yield* Ref.set(
                  lateMember,
                  member({ id: "post-empty-create", worktreePath: "/tmp/wt-post" }),
                );
              }),
            listMemberThreads: () =>
              Effect.gen(function* () {
                const gone = yield* Ref.get(deleted);
                const late = yield* Ref.get(lateMember);
                const base = [
                  member({ id: "initial", worktreePath: "/tmp/wt-post" }),
                  ...(late === null ? [] : [late]),
                ];
                return base.filter((thread) => !gone.has(thread.id));
              }),
            dispatchThreadDelete: ({ threadId }) =>
              Effect.gen(function* () {
                calls.push(`delete:${threadId}`);
                yield* Ref.update(deleted, (current) => new Set(current).add(threadId));
              }),
            allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
          },
        );

        expect(result).toEqual({
          status: "completed",
          deletedThreadIds: [asThreadId("initial"), asThreadId("post-empty-create")],
          worktreeRemoval: "removed",
        });
        expect(calls).toEqual(["delete:initial", "worktree", "delete:post-empty-create"]);
      }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("same-path create waiting across deletion cannot be accepted after removal", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const deleted = yield* Ref.make(new Set<string>());
      const path = "/tmp/wt-race";
      const deletionHolds = yield* Deferred.make<void>();
      const createRegistered = yield* Deferred.make<void>();

      const [deleteResult, createResult] = yield* Effect.all(
        [
          deleteWorktreeOwned(
            { cwd: "/tmp/repo", path, force: true },
            {
              pathCoordination: coordination,
              inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
              removeWorktree: () =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(deletionHolds, undefined);
                  yield* Deferred.await(createRegistered);
                }),
              listMemberThreads: () =>
                Ref.get(deleted).pipe(
                  Effect.map((gone) =>
                    [member({ id: "only", worktreePath: path })].filter(
                      (thread) => !gone.has(thread.id),
                    ),
                  ),
                ),
              dispatchThreadDelete: ({ threadId }) =>
                Ref.update(deleted, (current) => new Set(current).add(threadId)),
              allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
            },
          ),
          Effect.gen(function* () {
            yield* Deferred.await(deletionHolds);
            return yield* coordination
              .awaitCreateAllowed(path, {
                onWaiting: Deferred.succeed(createRegistered, undefined),
              })
              .pipe(Effect.result);
          }),
        ],
        { concurrency: 2 },
      );

      expect(deleteResult).toEqual({
        status: "completed",
        deletedThreadIds: [asThreadId("only")],
        worktreeRemoval: "removed",
      });
      expect(Result.isFailure(createResult)).toBe(true);
      if (Result.isFailure(createResult)) {
        expect(createResult.failure.message).toContain("being deleted or was removed");
      }
      // After settle, a create lease is available again (path not owned).
      yield* coordination.withCreateLease(path, Effect.succeed("ok"));
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("unrelated-path create stays independent during deletion", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const deleted = yield* Ref.make(new Set<string>());
      const unrelatedOk = yield* Ref.make(false);

      yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-a", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () =>
            Effect.gen(function* () {
              yield* coordination.awaitCreateAllowed("/tmp/wt-b");
              yield* coordination.withCreateLease("/tmp/wt-b", Effect.succeed("ok"));
              yield* Ref.set(unrelatedOk, true);
            }).pipe(Effect.orDie),
          listMemberThreads: () =>
            Ref.get(deleted).pipe(
              Effect.map((gone) =>
                [member({ id: "a", worktreePath: "/tmp/wt-a" })].filter(
                  (thread) => !gone.has(thread.id),
                ),
              ),
            ),
          dispatchThreadDelete: ({ threadId }) =>
            Ref.update(deleted, (current) => new Set(current).add(threadId)),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(yield* Ref.get(unrelatedOk)).toBe(true);
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect(
    "post-remove conversation failure reports worktreeRemoval removed (filesystem already gone)",
    () =>
      Effect.gen(function* () {
        const coordination = yield* WorktreePathCoordination;
        const deleted = yield* Ref.make(new Set<string>());
        const lateMember = yield* Ref.make<WorktreeMemberThread | null>(null);
        const removeCalls = yield* Ref.make(0);

        const result = yield* deleteWorktreeOwned(
          { cwd: "/tmp/repo", path: "/tmp/wt-straggler", force: true },
          {
            pathCoordination: coordination,
            inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
            removeWorktree: () =>
              Effect.gen(function* () {
                yield* Ref.update(removeCalls, (count) => count + 1);
                yield* Ref.set(
                  lateMember,
                  member({ id: "straggler", worktreePath: "/tmp/wt-straggler" }),
                );
              }),
            listMemberThreads: () =>
              Effect.gen(function* () {
                const gone = yield* Ref.get(deleted);
                const late = yield* Ref.get(lateMember);
                const base = [
                  member({ id: "initial", worktreePath: "/tmp/wt-straggler" }),
                  ...(late === null ? [] : [late]),
                ];
                return base.filter((thread) => !gone.has(thread.id));
              }),
            dispatchThreadDelete: ({ threadId }) =>
              Effect.gen(function* () {
                if (threadId === asThreadId("straggler")) {
                  return yield* Effect.fail({ message: "straggler delete rejected" });
                }
                yield* Ref.update(deleted, (current) => new Set(current).add(threadId));
              }),
            allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
          },
        );

        expect(yield* Ref.get(removeCalls)).toBe(1);
        expect(result).toEqual({
          status: "partial",
          stage: "conversation",
          deletedThreadIds: [asThreadId("initial")],
          retryable: true,
          detail: "straggler delete rejected",
          worktreeRemoval: "removed",
        });
        expect(releaseOutcomeForDeleteResult(result)).toBe("removed");
      }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("is safe when membership is already empty and the worktree is missing", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const removeCalls = yield* Ref.make(0);
      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-missing", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () =>
            Effect.succeed({
              availability: "missing",
              refName: null,
              headCommit: null,
              baseRef: null,
              mergeStatus: "unknown",
              workingTreeStatus: "unknown",
            }),
          removeWorktree: () => Ref.update(removeCalls, (count) => count + 1),
          listMemberThreads: () => Effect.succeed([]),
          dispatchThreadDelete: () => Effect.die("should not delete threads"),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result).toEqual({
        status: "completed",
        deletedThreadIds: [],
        worktreeRemoval: "already_missing",
      });
      expect(yield* Ref.get(removeCalls)).toBe(0);
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("returns a typed partial when filesystem removal fails after thread deletes", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const deleted = yield* Ref.make(new Set<string>());
      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-fs-fail", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () =>
            Effect.fail(
              new GitCommandError({
                operation: "removeWorktree",
                command: "git worktree remove",
                cwd: "/tmp/repo",
                detail: "device busy",
              }),
            ),
          listMemberThreads: () =>
            Ref.get(deleted).pipe(
              Effect.map((gone) =>
                [member({ id: "only", worktreePath: "/tmp/wt-fs-fail" })].filter(
                  (thread) => !gone.has(thread.id),
                ),
              ),
            ),
          dispatchThreadDelete: ({ threadId }) =>
            Ref.update(deleted, (current) => new Set(current).add(threadId)),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result.status).toBe("partial");
      if (result.status === "partial") {
        expect(result.stage).toBe("worktree");
        expect(result.worktreeRemoval).toBe("failed");
        expect(result.deletedThreadIds).toEqual([asThreadId("only")]);
        expect(result.retryable).toBe(true);
        expect(result.detail).toContain("device busy");
      }
      expect(releaseOutcomeForDeleteResult(result)).toBe("kept");
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("is idempotent when membership is already empty after prior deletes", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const deleteCalls = yield* Ref.make(0);
      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-empty", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () => Effect.void,
          listMemberThreads: () => Effect.succeed([]),
          dispatchThreadDelete: () => Ref.update(deleteCalls, (count) => count + 1),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result).toEqual({
        status: "completed",
        deletedThreadIds: [],
        worktreeRemoval: "removed",
      });
      expect(yield* Ref.get(deleteCalls)).toBe(0);
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );

  it.effect("pre-remove conversation failure reports worktreeRemoval not_attempted", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const result = yield* deleteWorktreeOwned(
        { cwd: "/tmp/repo", path: "/tmp/wt-blocked", force: true },
        {
          pathCoordination: coordination,
          inspectWorktreeRemoval: () => Effect.succeed(availableInspection),
          removeWorktree: () => Effect.die("should not remove worktree"),
          listMemberThreads: () =>
            Effect.succeed([member({ id: "blocked", worktreePath: "/tmp/wt-blocked" })]),
          dispatchThreadDelete: () => Effect.fail({ message: "delete blocked" }),
          allocateCommandId: (tag) => Effect.succeed(asCommandId(`cmd-${tag}`)),
        },
      );

      expect(result).toEqual({
        status: "partial",
        stage: "conversation",
        deletedThreadIds: [],
        retryable: true,
        detail: "delete blocked",
        worktreeRemoval: "not_attempted",
      });
      expect(releaseOutcomeForDeleteResult(result)).toBe("kept");
    }).pipe(Effect.provide(WorktreePathCoordinationLive)),
  );
});
