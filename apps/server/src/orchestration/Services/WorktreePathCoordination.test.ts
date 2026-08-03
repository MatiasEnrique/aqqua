import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { describe, expect, it } from "@effect/vitest";

import {
  layer as WorktreePathCoordinationLive,
  releaseOutcomeForDeleteResult,
  WorktreePathCoordination,
} from "./WorktreePathCoordination.ts";

const testLayer = WorktreePathCoordinationLive;

describe("WorktreePathCoordination", () => {
  it.effect("create lease blocks deletion body until durable work finishes", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/lease-before-delete";
      const createAcquired = yield* Deferred.make<void>();
      const createMayFinish = yield* Deferred.make<void>();
      const deletionMarked = yield* Deferred.make<void>();
      const deletionEnteredBody = yield* Deferred.make<void>();
      const bodyEnteredBeforeCreateDone = yield* Ref.make(false);

      const create = coordination.withCreateLease(
        path,
        Effect.gen(function* () {
          yield* Deferred.await(createMayFinish);
          return "created" as const;
        }),
        {
          onAcquired: Deferred.succeed(createAcquired, undefined),
        },
      );

      const deletion = coordination.withDeletion(
        path,
        Effect.gen(function* () {
          const state = yield* coordination.pathStateForTest(path);
          if (state && state.createLeases > 0) {
            yield* Ref.set(bodyEnteredBeforeCreateDone, true);
          }
          yield* Deferred.succeed(deletionEnteredBody, undefined);
          return { status: "completed", worktreeRemoval: "removed" } as const;
        }),
        (result) => releaseOutcomeForDeleteResult(result),
        {
          onOwnershipMarked: Deferred.succeed(deletionMarked, undefined),
        },
      );

      const driver = Effect.gen(function* () {
        yield* Deferred.await(createAcquired);
        const delFiber = yield* Effect.forkChild(deletion);
        yield* Deferred.await(deletionMarked);
        const mid = yield* coordination.pathStateForTest(path);
        expect(mid?.createLeases).toBe(1);
        expect(mid?.deletionHolders).toBeGreaterThanOrEqual(1);
        yield* Deferred.succeed(createMayFinish, undefined);
        yield* Deferred.await(deletionEnteredBody);
        yield* Fiber.join(delFiber);
      });

      const [createResult] = yield* Effect.all([create, driver], { concurrency: 2 });
      expect(createResult).toBe("created");
      expect(yield* Ref.get(bodyEnteredBeforeCreateDone)).toBe(false);
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("worker-side create fails immediately after deletion ownership begins", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/lease-blocked";
      const deletionMarked = yield* Deferred.make<void>();
      const deletionMayFinish = yield* Deferred.make<void>();

      const deletion = coordination.withDeletion(
        path,
        Effect.gen(function* () {
          yield* Deferred.await(deletionMayFinish);
          return { status: "completed", worktreeRemoval: "removed" } as const;
        }),
        (result) => releaseOutcomeForDeleteResult(result),
        {
          onOwnershipMarked: Deferred.succeed(deletionMarked, undefined),
        },
      );

      const [, createResult] = yield* Effect.all(
        [
          deletion,
          Effect.gen(function* () {
            yield* Deferred.await(deletionMarked);
            const result = yield* coordination
              .withCreateLease(path, Effect.succeed("should-not-run"))
              .pipe(Effect.result);
            yield* Deferred.succeed(deletionMayFinish, undefined);
            return result;
          }),
        ],
        { concurrency: 2 },
      );

      expect(Result.isFailure(createResult)).toBe(true);
      if (Result.isFailure(createResult)) {
        expect(createResult.failure.message).toContain("being deleted or was removed");
      }
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a dispatch waiter when deletion releases as removed", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/coord-removed";
      const deletionHolds = yield* Deferred.make<void>();
      const createRegistered = yield* Deferred.make<void>();

      const [deleteResult, createResult] = yield* Effect.all(
        [
          coordination.withDeletion(
            path,
            Effect.gen(function* () {
              yield* Deferred.succeed(deletionHolds, undefined);
              yield* Deferred.await(createRegistered);
              return { status: "completed", worktreeRemoval: "removed" } as const;
            }),
            (result) => releaseOutcomeForDeleteResult(result),
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

      expect(deleteResult).toEqual({ status: "completed", worktreeRemoval: "removed" });
      expect(Result.isFailure(createResult)).toBe(true);
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("allows dispatch waiter after deletion releases as kept", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/coord-kept";
      const deletionHolds = yield* Deferred.make<void>();
      const createRegistered = yield* Deferred.make<void>();

      const [, createResult] = yield* Effect.all(
        [
          coordination.withDeletion(
            path,
            Effect.gen(function* () {
              yield* Deferred.succeed(deletionHolds, undefined);
              yield* Deferred.await(createRegistered);
              return { status: "partial", worktreeRemoval: "failed" } as const;
            }),
            (result) => releaseOutcomeForDeleteResult(result),
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

      expect(Result.isSuccess(createResult)).toBe(true);
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("unrelated creates do not allocate gates or block during deletion", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      yield* coordination.withDeletion(
        "/tmp/coord-deleting",
        Effect.gen(function* () {
          expect(yield* coordination.gateCountForTest).toBe(1);
          yield* coordination.awaitCreateAllowed("/tmp/coord-other");
          yield* coordination.withCreateLease("/tmp/coord-other", Effect.succeed("ok"));
          expect(yield* coordination.gateCountForTest).toBe(1);
          return { status: "completed", worktreeRemoval: "removed" } as const;
        }),
        (result) => releaseOutcomeForDeleteResult(result),
      );
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("overlapping same-path deletions keep ownership until both settle", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/coord-overlap";
      const firstHolds = yield* Deferred.make<void>();
      const firstMayFinish = yield* Deferred.make<void>();
      const secondMayFinish = yield* Deferred.make<void>();
      const createRegistered = yield* Deferred.make<void>();

      const first = coordination.withDeletion(
        path,
        Effect.gen(function* () {
          yield* Deferred.succeed(firstHolds, undefined);
          yield* Deferred.await(firstMayFinish);
          return { status: "completed", worktreeRemoval: "removed" } as const;
        }),
        (result) => releaseOutcomeForDeleteResult(result),
      );

      const second = Effect.gen(function* () {
        yield* Deferred.await(firstHolds);
        return yield* coordination.withDeletion(
          path,
          Effect.gen(function* () {
            yield* Deferred.await(secondMayFinish);
            return { status: "partial", worktreeRemoval: "failed" } as const;
          }),
          (result) => releaseOutcomeForDeleteResult(result),
        );
      });

      const create = Effect.gen(function* () {
        yield* Deferred.await(firstHolds);
        return yield* coordination
          .awaitCreateAllowed(path, {
            onWaiting: Deferred.succeed(createRegistered, undefined),
          })
          .pipe(Effect.result);
      });

      const driver = Effect.gen(function* () {
        yield* Deferred.await(createRegistered);
        yield* Deferred.succeed(firstMayFinish, undefined);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(yield* coordination.gateCountForTest).toBe(1);
        yield* Deferred.succeed(secondMayFinish, undefined);
      });

      const [, , createResult] = yield* Effect.all([first, second, create, driver], {
        concurrency: 4,
      });
      expect(Result.isSuccess(createResult)).toBe(true);
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("idle awaitCreateAllowed and create lease leave no persistent gates", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      expect(yield* coordination.gateCountForTest).toBe(0);
      yield* coordination.awaitCreateAllowed("/tmp/never-deleted");
      yield* coordination.withCreateLease("/tmp/idle-create", Effect.succeed(1));
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("create registering at deletion release never hangs", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/coord-release-race";
      const deletion = coordination.withDeletion(
        path,
        Effect.succeed({ status: "completed", worktreeRemoval: "removed" } as const),
        (result) => releaseOutcomeForDeleteResult(result),
      );
      const creates = Effect.all(
        Array.from({ length: 8 }, () =>
          coordination.awaitCreateAllowed(path).pipe(
            Effect.as("allowed" as const),
            Effect.catchTag("OrchestrationCommandInvariantError", () =>
              Effect.succeed("rejected" as const),
            ),
          ),
        ),
        { concurrency: "unbounded" },
      );
      const [, outcomes] = yield* Effect.all([deletion, creates], { concurrency: 2 });
      expect(outcomes.every((o) => o === "allowed" || o === "rejected")).toBe(true);
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("interrupting deletion while waiting for create-lease drain releases ownership", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/interrupt-deletion-drain";
      const createAcquired = yield* Deferred.make<void>();
      const createMayFinish = yield* Deferred.make<void>();
      const deletionMarked = yield* Deferred.make<void>();

      const create = coordination.withCreateLease(
        path,
        Effect.gen(function* () {
          yield* Deferred.await(createMayFinish);
          return "created" as const;
        }),
        {
          onAcquired: Deferred.succeed(createAcquired, undefined),
        },
      );

      const deletion = coordination.withDeletion(
        path,
        Effect.succeed({ status: "completed", worktreeRemoval: "removed" } as const),
        (result) => releaseOutcomeForDeleteResult(result),
        {
          onOwnershipMarked: Deferred.succeed(deletionMarked, undefined),
        },
      );

      const createFiber = yield* Effect.forkChild(create);
      yield* Deferred.await(createAcquired);
      const deletionFiber = yield* Effect.forkChild(deletion);
      // Deletion owns the path and is blocked on create-lease drain.
      yield* Deferred.await(deletionMarked);
      expect((yield* coordination.pathStateForTest(path))?.deletionHolders).toBeGreaterThanOrEqual(
        1,
      );

      yield* Fiber.interrupt(deletionFiber);
      yield* Fiber.await(deletionFiber);

      // Create still holds its lease; deletion holder must already be gone.
      const mid = yield* coordination.pathStateForTest(path);
      expect(mid?.deletionHolders ?? 0).toBe(0);
      expect(mid?.createLeases).toBe(1);

      yield* Deferred.succeed(createMayFinish, undefined);
      expect(yield* Fiber.join(createFiber)).toBe("created");
      expect(yield* coordination.gateCountForTest).toBe(0);

      // Later same-path operations can proceed.
      yield* coordination.withCreateLease(path, Effect.succeed("again"));
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("interrupting deletion while waiting for same-path body mutex releases ownership", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/interrupt-deletion-mutex";
      const firstInBody = yield* Deferred.make<void>();
      const firstMayFinish = yield* Deferred.make<void>();
      const secondReadyForBody = yield* Deferred.make<void>();

      const first = coordination.withDeletion(
        path,
        Effect.gen(function* () {
          yield* Deferred.succeed(firstInBody, undefined);
          yield* Deferred.await(firstMayFinish);
          return { status: "completed", worktreeRemoval: "removed" } as const;
        }),
        (result) => releaseOutcomeForDeleteResult(result),
      );

      const second = coordination.withDeletion(
        path,
        Effect.succeed({ status: "partial", worktreeRemoval: "failed" } as const),
        (result) => releaseOutcomeForDeleteResult(result),
        {
          onReadyForBody: Deferred.succeed(secondReadyForBody, undefined),
        },
      );

      const firstFiber = yield* Effect.forkChild(first);
      yield* Deferred.await(firstInBody);
      const secondFiber = yield* Effect.forkChild(second);
      // Second has drained creates and is waiting on the same-path body mutex.
      yield* Deferred.await(secondReadyForBody);
      expect((yield* coordination.pathStateForTest(path))?.deletionHolders).toBe(2);

      yield* Fiber.interrupt(secondFiber);
      yield* Fiber.await(secondFiber);

      // First still owns the body; second's holder must be released.
      const mid = yield* coordination.pathStateForTest(path);
      expect(mid?.deletionHolders).toBe(1);

      yield* Deferred.succeed(firstMayFinish, undefined);
      yield* Fiber.join(firstFiber);
      expect(yield* coordination.gateCountForTest).toBe(0);

      yield* coordination.withDeletion(
        path,
        Effect.succeed({ status: "completed", worktreeRemoval: "already_missing" } as const),
        (result) => releaseOutcomeForDeleteResult(result),
      );
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("interrupting a create body while holding a lease releases the lease", () =>
    Effect.gen(function* () {
      const coordination = yield* WorktreePathCoordination;
      const path = "/tmp/interrupt-create-lease";
      const createAcquired = yield* Deferred.make<void>();
      const createMayFinish = yield* Deferred.make<void>();

      const create = coordination.withCreateLease(
        path,
        Effect.gen(function* () {
          yield* Deferred.await(createMayFinish);
          return "created" as const;
        }),
        {
          onAcquired: Deferred.succeed(createAcquired, undefined),
        },
      );

      const createFiber = yield* Effect.forkChild(create);
      yield* Deferred.await(createAcquired);
      expect((yield* coordination.pathStateForTest(path))?.createLeases).toBe(1);

      yield* Fiber.interrupt(createFiber);
      yield* Fiber.await(createFiber);

      expect(yield* coordination.gateCountForTest).toBe(0);
      yield* coordination.withCreateLease(path, Effect.succeed("after-interrupt"));
      expect(yield* coordination.gateCountForTest).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("releaseOutcomeForDeleteResult maps filesystem outcomes", () =>
    Effect.sync(() => {
      expect(
        releaseOutcomeForDeleteResult({ status: "completed", worktreeRemoval: "removed" }),
      ).toBe("removed");
      expect(
        releaseOutcomeForDeleteResult({
          status: "completed",
          worktreeRemoval: "already_missing",
        }),
      ).toBe("removed");
      expect(
        releaseOutcomeForDeleteResult({
          status: "completed",
          worktreeRemoval: "already_missing",
          preservedUnverifiedPath: true,
        }),
      ).toBe("kept");
      expect(releaseOutcomeForDeleteResult({ status: "partial", worktreeRemoval: "removed" })).toBe(
        "removed",
      );
      expect(releaseOutcomeForDeleteResult({ status: "partial", worktreeRemoval: "failed" })).toBe(
        "kept",
      );
    }),
  );
});
