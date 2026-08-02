/**
 * Per-path coordination between worktree deletion and thread.create.
 *
 * Reader/writer-style ownership (this server process only):
 * - `withCreateLease` acquires a short-lived create lease only when no deletion
 *   owns/is pending the path, holds it through durable decide+append, then
 *   releases on every exit (including interruption) via acquireUseRelease.
 * - `withDeletion` marks deletion ownership first (blocking new create leases),
 *   waits for existing create leases to drain, then runs membership/FS work.
 *   Ownership release is installed immediately after mark and runs on every exit.
 * - Worker-side creates that arrive after deletion ownership begins fail
 *   immediately with a typed invariant (do not wait on FS work).
 * - Dispatch-time `awaitCreateAllowed` may wait outside the command worker so
 *   clients do not enqueue during a long deletion; it is not the durability
 *   boundary.
 *
 * All state transitions use Ref.modify on immutable path entries. Idle paths
 * never retain tombstones: entries are removed when holders, leases, and
 * waiters are all empty.
 *
 * @module WorktreePathCoordination
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { comparableWorktreePath } from "../threadDeletion.ts";

export type WorktreePathDeletionRelease = "removed" | "kept";

type CreateWaiter = Deferred.Deferred<void, OrchestrationCommandInvariantError>;
type DrainWaiter = Deferred.Deferred<void, never>;

/**
 * Immutable snapshot of one path's fence. Replaced only via Ref.modify.
 */
interface PathEntry {
  /** Active deletion owners (including those waiting for create-lease drain). */
  readonly deletionHolders: number;
  /** Active create leases held through durable commit. */
  readonly createLeases: number;
  /** Dispatch-time creates waiting for deletion ownership to end. */
  readonly createWaiters: ReadonlyArray<CreateWaiter>;
  /** Deletions waiting for createLeases to reach 0. */
  readonly drainWaiters: ReadonlyArray<DrainWaiter>;
  /** Serializes deletion bodies for the same path. */
  readonly bodyMutex: Semaphore.Semaphore;
}

type GateMap = ReadonlyMap<string, PathEntry>;

/**
 * Deterministic instrumentation hooks for race tests. Yielded immediately at the
 * named transition; pass `Deferred.succeed(...)` from Effect tests (no runSync).
 */
export interface CreateLeaseOptions {
  /** After the create lease is atomically acquired. */
  readonly onAcquired?: Effect.Effect<void>;
}

/**
 * Deterministic instrumentation hooks for race tests. Yielded immediately at the
 * named transition; pass `Deferred.succeed(...)` from Effect tests (no runSync).
 */
export interface DeletionOptions {
  /** After deletion ownership is marked (blocks new leases), before lease drain. */
  readonly onOwnershipMarked?: Effect.Effect<void>;
  /** After create leases have drained, immediately before the deletion body. */
  readonly onReadyForBody?: Effect.Effect<void>;
}

/**
 * Deterministic instrumentation for dispatch-time wait registration.
 * Yielded immediately after this create is atomically registered as a waiter.
 */
export interface AwaitCreateAllowedOptions {
  readonly onWaiting?: Effect.Effect<void>;
}

export interface WorktreePathCoordinationShape {
  /**
   * Hold a create lease for `worktreePath` only while `body` runs. Fails with
   * OrchestrationCommandInvariantError if deletion already owns/is pending the
   * path. No-op (no lease) for null/empty paths. Lease release is interruption-safe.
   */
  readonly withCreateLease: <A, E, R>(
    worktreePath: string | null | undefined,
    body: Effect.Effect<A, E, R>,
    options?: CreateLeaseOptions,
  ) => Effect.Effect<A, E | OrchestrationCommandInvariantError, R>;

  /**
   * Mark deletion ownership, wait for create leases to drain, then run body
   * under a same-path body mutex. Ownership release (and waiter completion) is
   * interruption-safe. Release outcome applies to dispatch waiters when the last
   * deletion holder settles.
   */
  readonly withDeletion: <A, E, R>(
    worktreePath: string,
    body: Effect.Effect<A, E, R>,
    releaseOf: (value: A) => WorktreePathDeletionRelease,
    options?: DeletionOptions,
  ) => Effect.Effect<A, E, R>;

  /**
   * Dispatch-time wait (outside the command worker). Waits while deletion
   * owns the path; fails if the last release was "removed". Lookup-only when
   * idle (does not allocate). Does not acquire a create lease.
   */
  readonly awaitCreateAllowed: (
    worktreePath: string | null | undefined,
    options?: AwaitCreateAllowedOptions,
  ) => Effect.Effect<void, OrchestrationCommandInvariantError>;

  /** Test-only: number of live path entries. */
  readonly gateCountForTest: Effect.Effect<number>;

  /** Test-only: snapshot of create leases / deletion holders for a path. */
  readonly pathStateForTest: (worktreePath: string) => Effect.Effect<{
    readonly createLeases: number;
    readonly deletionHolders: number;
  } | null>;
}

export class WorktreePathCoordination extends Context.Service<
  WorktreePathCoordination,
  WorktreePathCoordinationShape
>()("aqqua/orchestration/Services/WorktreePathCoordination") {}

const createBlockedError = (path: string): OrchestrationCommandInvariantError =>
  new OrchestrationCommandInvariantError({
    commandType: "thread.create",
    detail: `Cannot create a thread for worktree path '${path}' because that worktree is being deleted or was removed.`,
  });

const processGates = Effect.runSync(Ref.make<GateMap>(new Map()));

const emptyEntry = (bodyMutex: Semaphore.Semaphore): PathEntry => ({
  deletionHolders: 0,
  createLeases: 0,
  createWaiters: [],
  drainWaiters: [],
  bodyMutex,
});

const isIdle = (entry: PathEntry): boolean =>
  entry.deletionHolders === 0 &&
  entry.createLeases === 0 &&
  entry.createWaiters.length === 0 &&
  entry.drainWaiters.length === 0;

const putOrDelete = (map: GateMap, key: string, entry: PathEntry): GateMap => {
  const nextMap = new Map<string, PathEntry>(map);
  if (isIdle(entry)) {
    nextMap.delete(key);
  } else {
    nextMap.set(key, entry);
  }
  return nextMap;
};

const completeCreateWaiters = (
  path: string,
  waiters: ReadonlyArray<CreateWaiter>,
  release: WorktreePathDeletionRelease,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const waiter of waiters) {
      if (release === "removed") {
        yield* Deferred.fail(waiter, createBlockedError(path));
      } else {
        yield* Deferred.succeed(waiter, undefined);
      }
    }
  });

const completeDrainWaiters = (waiters: ReadonlyArray<DrainWaiter>): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const waiter of waiters) {
      yield* Deferred.succeed(waiter, undefined);
    }
  });

// --- Create lease -----------------------------------------------------------

type AcquireCreateLeaseResult = { readonly tag: "acquired" } | { readonly tag: "blocked" };

const tryAcquireCreateLease = (key: string): Effect.Effect<AcquireCreateLeaseResult> =>
  Effect.gen(function* () {
    const first = yield* Ref.modify(
      processGates,
      (map): readonly [AcquireCreateLeaseResult | "needMutex", GateMap] => {
        const existing = map.get(key);
        if (!existing) {
          return ["needMutex", map];
        }
        if (existing.deletionHolders > 0) {
          return [{ tag: "blocked" }, map];
        }
        const next: PathEntry = {
          ...existing,
          createLeases: existing.createLeases + 1,
        };
        return [{ tag: "acquired" }, putOrDelete(map, key, next)];
      },
    );
    if (first !== "needMutex") {
      return first;
    }

    const bodyMutex = yield* Semaphore.make(1);
    return yield* Ref.modify(processGates, (map): readonly [AcquireCreateLeaseResult, GateMap] => {
      const existing = map.get(key);
      if (existing) {
        if (existing.deletionHolders > 0) {
          return [{ tag: "blocked" }, map];
        }
        const next: PathEntry = {
          ...existing,
          createLeases: existing.createLeases + 1,
        };
        return [{ tag: "acquired" }, putOrDelete(map, key, next)];
      }
      const created: PathEntry = {
        ...emptyEntry(bodyMutex),
        createLeases: 1,
      };
      return [{ tag: "acquired" }, putOrDelete(map, key, created)];
    });
  });

type ReleaseCreateLeaseResult = {
  readonly drainWaiters: ReadonlyArray<DrainWaiter>;
};

const releaseCreateLease = (key: string): Effect.Effect<ReleaseCreateLeaseResult> =>
  Ref.modify(processGates, (map): readonly [ReleaseCreateLeaseResult, GateMap] => {
    const existing = map.get(key);
    if (!existing || existing.createLeases <= 0) {
      return [{ drainWaiters: [] }, map];
    }
    const createLeases = existing.createLeases - 1;
    if (createLeases > 0) {
      const next: PathEntry = { ...existing, createLeases };
      return [{ drainWaiters: [] }, putOrDelete(map, key, next)];
    }
    const next: PathEntry = {
      ...existing,
      createLeases: 0,
      drainWaiters: [],
    };
    return [{ drainWaiters: existing.drainWaiters }, putOrDelete(map, key, next)];
  });

const finalizeCreateLease = (key: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const released = yield* releaseCreateLease(key);
    if (released.drainWaiters.length > 0) {
      yield* completeDrainWaiters(released.drainWaiters);
    }
  });

const withCreateLease = <A, E, R>(
  worktreePath: string | null | undefined,
  body: Effect.Effect<A, E, R>,
  options?: CreateLeaseOptions,
): Effect.Effect<A, E | OrchestrationCommandInvariantError, R> => {
  const key = comparableWorktreePath(worktreePath);
  if (key === null) {
    return body;
  }
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const acquired = yield* tryAcquireCreateLease(key);
      if (acquired.tag === "blocked") {
        return yield* createBlockedError(key);
      }
      if (options?.onAcquired) {
        yield* options.onAcquired;
      }
      return key;
    }),
    () => body,
    // Release runs uninterruptibly on success, failure, and interruption.
    (heldKey) => finalizeCreateLease(heldKey),
  );
};

// --- Deletion ownership -----------------------------------------------------

const markDeletionOwnership = (
  key: string,
  drainWaiter: DrainWaiter,
  bodyMutex: Semaphore.Semaphore,
): Effect.Effect<{ readonly bodyMutex: Semaphore.Semaphore; readonly mustWait: boolean }> =>
  Ref.modify(
    processGates,
    (
      map,
    ): readonly [
      { readonly bodyMutex: Semaphore.Semaphore; readonly mustWait: boolean },
      GateMap,
    ] => {
      const existing = map.get(key);
      if (!existing) {
        const created: PathEntry = {
          ...emptyEntry(bodyMutex),
          deletionHolders: 1,
        };
        return [{ bodyMutex, mustWait: false }, putOrDelete(map, key, created)];
      }
      const next: PathEntry = {
        ...existing,
        deletionHolders: existing.deletionHolders + 1,
        drainWaiters:
          existing.createLeases > 0
            ? [...existing.drainWaiters, drainWaiter]
            : existing.drainWaiters,
      };
      return [
        {
          bodyMutex: existing.bodyMutex,
          mustWait: existing.createLeases > 0,
        },
        putOrDelete(map, key, next),
      ];
    },
  );

/**
 * After waking from drain, re-check createLeases; re-register if still non-zero
 * (new leases cannot start once deletionHolders > 0, so this is brief).
 */
const waitForCreateLeasesDrained = (key: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (;;) {
      const probe = yield* Ref.get(processGates);
      const entry = probe.get(key);
      if (!entry || entry.createLeases === 0) {
        return;
      }
      const drainWaiter = yield* Deferred.make<void, never>();
      const stillWaiting = yield* Ref.modify(processGates, (map): readonly [boolean, GateMap] => {
        const cur = map.get(key);
        if (!cur || cur.createLeases === 0) {
          return [false, map];
        }
        const next: PathEntry = {
          ...cur,
          drainWaiters: [...cur.drainWaiters, drainWaiter],
        };
        return [true, putOrDelete(map, key, next)];
      });
      if (!stillWaiting) {
        return;
      }
      yield* Deferred.await(drainWaiter);
    }
  });

type ReleaseDeletionResult =
  | { readonly kind: "stillHeld" }
  | {
      readonly kind: "released";
      readonly createWaiters: ReadonlyArray<CreateWaiter>;
    };

const releaseDeletionOwnership = (key: string): Effect.Effect<ReleaseDeletionResult> =>
  Ref.modify(processGates, (map): readonly [ReleaseDeletionResult, GateMap] => {
    const existing = map.get(key);
    if (!existing || existing.deletionHolders <= 0) {
      return [{ kind: "stillHeld" }, map];
    }
    const deletionHolders = existing.deletionHolders - 1;
    if (deletionHolders > 0) {
      const next: PathEntry = { ...existing, deletionHolders };
      return [{ kind: "stillHeld" }, putOrDelete(map, key, next)];
    }
    const next: PathEntry = {
      ...existing,
      deletionHolders: 0,
      createWaiters: [],
    };
    return [
      { kind: "released", createWaiters: existing.createWaiters },
      putOrDelete(map, key, next),
    ];
  });

const finalizeDeletionOwnership = (
  key: string,
  release: WorktreePathDeletionRelease,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const released = yield* releaseDeletionOwnership(key);
    if (released.kind === "released") {
      // Waiters were extracted atomically; complete them so none are stranded.
      yield* completeCreateWaiters(key, released.createWaiters, release);
    }
  });

type DeletionAcquired = {
  readonly bodyMutex: Semaphore.Semaphore;
  readonly mustWait: boolean;
  readonly drainWaiter: DrainWaiter;
};

const withDeletion = <A, E, R>(
  worktreePath: string,
  body: Effect.Effect<A, E, R>,
  releaseOf: (value: A) => WorktreePathDeletionRelease,
  options?: DeletionOptions,
): Effect.Effect<A, E, R> => {
  const key = comparableWorktreePath(worktreePath);
  if (key === null) {
    return body;
  }
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const freshMutex = yield* Semaphore.make(1);
      const drainWaiter = yield* Deferred.make<void, never>();
      const marked = yield* markDeletionOwnership(key, drainWaiter, freshMutex);
      if (options?.onOwnershipMarked) {
        yield* options.onOwnershipMarked;
      }
      return {
        bodyMutex: marked.bodyMutex,
        mustWait: marked.mustWait,
        drainWaiter,
      } satisfies DeletionAcquired;
    }),
    (acquired) =>
      Effect.gen(function* () {
        if (acquired.mustWait) {
          yield* Deferred.await(acquired.drainWaiter);
        }
        yield* waitForCreateLeasesDrained(key);
        if (options?.onReadyForBody) {
          yield* options.onReadyForBody;
        }
        return yield* acquired.bodyMutex.withPermits(1)(body);
      }),
    // Uninterruptible finalizer: release holder and complete extracted waiters
    // even if interrupted while draining leases or waiting on the body mutex.
    (_acquired, exit) => {
      const release: WorktreePathDeletionRelease = Exit.isSuccess(exit)
        ? releaseOf(exit.value)
        : "kept";
      return finalizeDeletionOwnership(key, release);
    },
  );
};

// --- Dispatch-time wait (not the durability boundary) -----------------------

type RegisterDispatchWaiterResult =
  | { readonly tag: "allow" }
  | { readonly tag: "wait"; readonly waiter: CreateWaiter };

const registerDispatchWaiter = (
  key: string,
  waiter: CreateWaiter,
): Effect.Effect<RegisterDispatchWaiterResult> =>
  Ref.modify(processGates, (map): readonly [RegisterDispatchWaiterResult, GateMap] => {
    const existing = map.get(key);
    if (!existing || existing.deletionHolders === 0) {
      return [{ tag: "allow" }, map];
    }
    const next: PathEntry = {
      ...existing,
      createWaiters: [...existing.createWaiters, waiter],
    };
    return [{ tag: "wait", waiter }, putOrDelete(map, key, next)];
  });

const awaitCreateAllowed = (
  worktreePath: string | null | undefined,
  options?: AwaitCreateAllowedOptions,
): Effect.Effect<void, OrchestrationCommandInvariantError> =>
  Effect.gen(function* () {
    const key = comparableWorktreePath(worktreePath);
    if (key === null) return;

    for (;;) {
      const probe = yield* Ref.get(processGates);
      const live = probe.get(key);
      if (!live || live.deletionHolders === 0) {
        return;
      }

      const waiter = yield* Deferred.make<void, OrchestrationCommandInvariantError>();
      const registration = yield* registerDispatchWaiter(key, waiter);
      if (registration.tag === "allow") {
        return;
      }
      if (options?.onWaiting) {
        yield* options.onWaiting;
      }
      yield* Deferred.await(registration.waiter);
    }
  });

const gateCountForTest: Effect.Effect<number> = Ref.get(processGates).pipe(
  Effect.map((map) => map.size),
);

const pathStateForTest = (
  worktreePath: string,
): Effect.Effect<{ readonly createLeases: number; readonly deletionHolders: number } | null> =>
  Effect.gen(function* () {
    const key = comparableWorktreePath(worktreePath);
    if (key === null) return null;
    const map = yield* Ref.get(processGates);
    const entry = map.get(key);
    if (!entry) return null;
    return {
      createLeases: entry.createLeases,
      deletionHolders: entry.deletionHolders,
    };
  });

const service: WorktreePathCoordinationShape = {
  withCreateLease,
  withDeletion,
  awaitCreateAllowed,
  gateCountForTest,
  pathStateForTest,
};

export const layer = Layer.succeed(WorktreePathCoordination, WorktreePathCoordination.of(service));

/**
 * Map a typed worktree-deletion result to the create-gate release outcome.
 * Paths that are gone on disk (or already missing) reject waiting creates.
 */
export function releaseOutcomeForDeleteResult(result: {
  readonly status: string;
  readonly worktreeRemoval?: string;
}): WorktreePathDeletionRelease {
  if (result.status === "completed") {
    return result.worktreeRemoval === "removed" || result.worktreeRemoval === "already_missing"
      ? "removed"
      : "kept";
  }
  if (result.status === "partial" && result.worktreeRemoval === "removed") {
    return "removed";
  }
  return "kept";
}
