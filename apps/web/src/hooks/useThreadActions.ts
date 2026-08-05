import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@aqqua/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@aqqua/client-runtime/state/models";
import {
  executeAtomQuery,
  settlePromise,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import { findFlowOwnedThread } from "@aqqua/client-runtime/state/boards";
import { canSettle, canSnooze, effectiveSnoozed } from "@aqqua/client-runtime/state/thread-settled";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";

import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { useNewThreadHandler } from "./useHandleNewThread";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { environmentBoards } from "../state/boards";
import { orchestrationEnvironment } from "../state/orchestration";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentThreadRefs,
  readProject,
  readThreadShell,
} from "../state/entities";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useRightPanelStore } from "../rightPanelStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import {
  buildWorktreeDeletionPlan,
  isFinalWorktreeReferenceAfterDeletion,
  selectThreadsForWorktree,
  type WorktreeDeletionCandidate,
  worktreeRemovalInspectionUnchanged,
} from "../worktreeCleanup";
import { requestThreadDeleteConfirmation, type ThreadDeleteDecision } from "../threadDeleteDialog";
import { requestWorktreeDeleteConfirmation } from "../worktreeDeleteDialog";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "./useSettings";
import { useAtomCommand } from "../state/use-atom-command";

export class ThreadArchiveBlockedError extends Schema.TaggedErrorClass<ThreadArchiveBlockedError>()(
  "ThreadArchiveBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Cannot archive a running thread.";
  }
}

export class ThreadDeleteFlowOwnedError extends Schema.TaggedErrorClass<ThreadDeleteFlowOwnedError>()(
  "ThreadDeleteFlowOwnedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This conversation belongs to a flow card. Delete the card from the flow, or settle the conversation to file it away.";
  }
}

export class ThreadSettlementUnsupportedError extends Schema.TaggedErrorClass<ThreadSettlementUnsupportedError>()(
  "ThreadSettlementUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support settling yet. Update the server to use Settle.";
  }
}

export class ThreadSettleBlockedError extends Schema.TaggedErrorClass<ThreadSettleBlockedError>()(
  "ThreadSettleBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This thread still needs attention. Resolve or interrupt it first, then try again.";
  }
}

export class ThreadSnoozeUnsupportedError extends Schema.TaggedErrorClass<ThreadSnoozeUnsupportedError>()(
  "ThreadSnoozeUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support snoozing yet. Update the server to use Snooze.";
  }
}

export class ThreadSnoozeBlockedError extends Schema.TaggedErrorClass<ThreadSnoozeBlockedError>()(
  "ThreadSnoozeBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This thread is waiting on you. Respond to the pending request before snoozing it.";
  }
}

export interface ThreadDeletionExecutionPlan {
  readonly catalogThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly candidates: ReadonlyArray<WorktreeDeletionCandidate>;
  readonly decision: ThreadDeleteDecision;
}

export interface DeleteWorktreeInput {
  readonly environmentId: EnvironmentId;
  readonly projectCwd: string;
  readonly worktreePath: string;
  readonly label: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

/**
 * Ownership boundary for thread deletion.
 *
 * Conversation delete is a single server command. Provider session stop and
 * terminal close (with history deletion) are owned solely by the server
 * `ThreadDeletionReactor` reacting to `thread.deleted` — best-effort and not
 * awaited by the client. Optional worktree removal after a single-thread
 * delete remains client best-effort. Whole-worktree deletion is a separate
 * server-owned `vcs.deleteWorktree` operation (see WORKTREE_DELETION_BOUNDARY).
 */
export const THREAD_DELETION_CLEANUP_BOUNDARY = {
  conversationDelete: "server-command",
  providerSessionStop: "thread-deletion-reactor",
  terminalCloseWithHistory: "thread-deletion-reactor",
  worktreeRemoval: "client-best-effort-after-delete",
} as const;

/**
 * Ownership boundary for sidebar worktree deletion.
 *
 * Membership, thread cascade via `thread.delete`, and filesystem removal are
 * decided and executed by one server operation. The client only confirms and
 * invokes that operation.
 */
export const WORKTREE_DELETION_BOUNDARY = {
  membership: "server-at-execution-time",
  threadDelete: "server-thread-delete",
  worktreeRemoval: "server-after-thread-delete",
  localBranchRemoval: "server-after-worktree-removal",
} as const;

function readFlowOwnedTarget(
  targets: ReadonlyArray<EnvironmentThreadShell>,
): EnvironmentThreadShell | null {
  const byEnvironment = new Map<EnvironmentId, EnvironmentThreadShell[]>();
  for (const target of targets) {
    const bucket = byEnvironment.get(target.environmentId);
    if (bucket === undefined) byEnvironment.set(target.environmentId, [target]);
    else bucket.push(target);
  }
  for (const [environmentId, environmentTargets] of byEnvironment) {
    const cards = appAtomRegistry.get(environmentBoards.environmentCardsAtom(environmentId));
    if (cards.length === 0) continue;
    const threads = readEnvironmentThreadRefs(environmentId).flatMap((ref) => {
      const shell = readThreadShell(ref);
      return shell === null ? [] : [shell];
    });
    const owned = findFlowOwnedThread({ targets: environmentTargets, cards, threads });
    if (owned !== null) return owned;
  }
  return null;
}

export function useThreadActions() {
  const archiveThreadMutation = useAtomCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const unarchiveThreadMutation = useAtomCommand(threadEnvironment.unarchive, {
    reportFailure: false,
  });
  const deleteThreadMutation = useAtomCommand(threadEnvironment.delete, {
    reportFailure: false,
  });
  const settleThreadMutation = useAtomCommand(threadEnvironment.settle, {
    reportFailure: false,
  });
  const unsettleThreadMutation = useAtomCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  const snoozeThreadMutation = useAtomCommand(threadEnvironment.snooze, {
    reportFailure: false,
  });
  const unsnoozeThreadMutation = useAtomCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, {
    reportFailure: false,
  });
  const deleteWorktreeCommand = useAtomCommand(vcsEnvironment.deleteWorktree, {
    reportFailure: false,
  });
  const inspectWorktreeRemoval = useAtomCommand(vcsEnvironment.inspectWorktreeRemoval, {
    reportFailure: false,
  });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalUiState = useTerminalUiStateStore((state) => state.clearTerminalUiState);
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;

  const resolveThreadTarget = useCallback((target: ScopedThreadRef) => {
    const thread = readThreadShell(target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  }, []);
  const getCurrentRouteThreadRef = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteRef(currentRouteParams);
  }, [router]);

  const archiveThread = useCallback(
    async (target: ScopedThreadRef, opts: { onArchived?: () => void } = {}) => {
      const resolved = resolveThreadTarget(target);
      if (!resolved) return AsyncResult.success(undefined);
      const { thread, threadRef } = resolved;
      if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadArchiveBlockedError({
              environmentId: threadRef.environmentId,
              threadId: threadRef.threadId,
            }),
          ),
        );
      }

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToDraft =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const archiveResult = await archiveThreadMutation({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (archiveResult._tag === "Failure") {
        return archiveResult;
      }
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      useRightPanelStore.getState().removeThread(threadRef);
      opts.onArchived?.();

      if (shouldNavigateToDraft) {
        const navigationResult = await settlePromise(() =>
          handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId)),
        );
        if (navigationResult._tag === "Failure") {
          return navigationResult;
        }
        return archiveResult;
      }

      return archiveResult;
    },
    [archiveThreadMutation, getCurrentRouteThreadRef, resolveThreadTarget],
  );

  const unarchiveThread = useCallback(
    async (target: ScopedThreadRef) => {
      const result = await unarchiveThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") {
        refreshArchivedThreadsForEnvironment(target.environmentId);
      }
      return result;
    },
    [unarchiveThreadMutation],
  );

  const confirmThreadDeletion = useCallback(
    async (targets: ReadonlyArray<EnvironmentThreadShell>) => {
      if (targets.length === 0) return AsyncResult.success(null);
      if (
        !confirmThreadDelete &&
        targets.every((thread) => (thread.worktreePath?.trim() ?? "") === "")
      ) {
        return AsyncResult.success({
          catalogThreads: targets,
          candidates: [],
          decision: {
            deleteWorktrees: false,
            selectionSource: "none",
            inspections: {},
          },
        } satisfies ThreadDeletionExecutionPlan);
      }

      const environmentIds = [...new Set(targets.map((thread) => thread.environmentId))];
      const threadCatalog = new Map<string, EnvironmentThreadShell>();
      const projectCatalog = new Map<string, EnvironmentProject>();
      const completeEnvironmentIds = new Set<EnvironmentId>();

      for (const environmentId of environmentIds) {
        for (const ref of readEnvironmentThreadRefs(environmentId)) {
          const thread = readThreadShell(ref);
          if (thread) threadCatalog.set(scopedThreadKey(ref), thread);
        }

        const atom = orchestrationEnvironment.archivedShellSnapshot({
          environmentId,
          input: {},
        });
        appAtomRegistry.refresh(atom);
        const archivedResult = await executeAtomQuery(appAtomRegistry, atom, {
          reportFailure: false,
        });
        if (archivedResult._tag === "Success") {
          completeEnvironmentIds.add(environmentId);
          for (const thread of archivedResult.value.threads) {
            const scoped = { ...thread, environmentId };
            const key = scopedThreadKey(scopeThreadRef(environmentId, thread.id));
            if (!threadCatalog.has(key)) threadCatalog.set(key, scoped);
          }
          for (const project of archivedResult.value.projects) {
            projectCatalog.set(scopedProjectKey(scopeProjectRef(environmentId, project.id)), {
              ...project,
              environmentId,
            });
          }
        }
      }

      for (const target of targets) {
        threadCatalog.set(scopedThreadKey(scopeThreadRef(target.environmentId, target.id)), target);
      }
      for (const thread of threadCatalog.values()) {
        const project = readProject({
          environmentId: thread.environmentId,
          projectId: thread.projectId,
        });
        if (project) {
          projectCatalog.set(
            scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
            project,
          );
        }
      }

      const cleanupPlan = buildWorktreeDeletionPlan({
        targets,
        threads: [...threadCatalog.values()],
        projects: [...projectCatalog.values()],
        completeEnvironmentIds,
      });
      const requiresDialog =
        confirmThreadDelete ||
        cleanupPlan.candidates.length > 0 ||
        cleanupPlan.hasUnverifiableWorktrees;
      let decision: ThreadDeleteDecision = {
        deleteWorktrees: false,
        selectionSource: "none",
        inspections: {},
      };

      if (requiresDialog) {
        const confirmationResult = await settlePromise(() =>
          requestThreadDeleteConfirmation({
            title: targets[0]?.title ?? "Untitled",
            threadCount: targets.length,
            candidates: cleanupPlan.candidates,
            hasUnverifiableWorktrees: cleanupPlan.hasUnverifiableWorktrees,
          }),
        );
        if (confirmationResult._tag === "Failure") return confirmationResult;
        if (confirmationResult.value === null) return AsyncResult.success(null);
        decision = confirmationResult.value;
      }

      return AsyncResult.success({
        catalogThreads: [...threadCatalog.values()],
        candidates: cleanupPlan.candidates,
        decision,
      } satisfies ThreadDeletionExecutionPlan);
    },
    [confirmThreadDelete],
  );

  // Client delete flow: confirm → dispatch `thread.delete` → local UI cleanup →
  // optional worktree removal. Provider session stop and terminal close are
  // deliberately not issued here; ThreadDeletionReactor owns those after
  // `thread.deleted`. Worktree removal is best-effort after a successful delete
  // and never rolls the conversation back (see THREAD_DELETION_CLEANUP_BOUNDARY).
  const deleteThread = useCallback(
    async (
      target: EnvironmentThreadShell,
      opts: {
        deletedThreadKeys?: ReadonlySet<string>;
        removedWorktreeKeys?: Set<string>;
        deletionPlan?: ThreadDeletionExecutionPlan;
      } = {},
    ) => {
      const threadRef = scopeThreadRef(target.environmentId, target.id);
      const thread = readThreadShell(threadRef) ?? target;
      if (readFlowOwnedTarget([thread]) !== null) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadDeleteFlowOwnedError({
              environmentId: threadRef.environmentId,
              threadId: threadRef.threadId,
            }),
          ),
        );
      }
      const threads = readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
        const shell = readThreadShell(ref);
        return shell === null ? [] : [shell];
      });
      const deletedThreadIds = new Set(
        [...(opts.deletedThreadKeys ?? [])].flatMap((threadKey) => {
          const deleted = opts.deletionPlan?.catalogThreads.find(
            (entry) =>
              scopedThreadKey(scopeThreadRef(entry.environmentId, entry.id)) === threadKey &&
              entry.environmentId === threadRef.environmentId,
          );
          return deleted ? [deleted.id] : [];
        }),
      );

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToFallback =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads,
        deletedThreadId: threadRef.threadId,
        deletedThreadIds,
        sortOrder: sidebarThreadSortOrder,
      });
      const deleteResult = await deleteThreadMutation({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (deleteResult._tag === "Failure") return deleteResult;

      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      useRightPanelStore.getState().removeThread(threadRef);
      clearComposerDraftForThread(threadRef);
      clearProjectDraftThreadById(
        scopeProjectRef(threadRef.environmentId, thread.projectId),
        threadRef,
      );
      clearTerminalUiState(threadRef);

      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          const fallbackThread = readThreadShell(
            scopeThreadRef(threadRef.environmentId, fallbackThreadId),
          );
          const navigationResult = await settlePromise(() =>
            fallbackThread
              ? router.navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(
                    scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
                  ),
                  replace: true,
                })
              : router.navigate({ to: "/", replace: true }),
          );
          if (navigationResult._tag === "Failure") return navigationResult;
        } else {
          const navigationResult = await settlePromise(() =>
            router.navigate({ to: "/", replace: true }),
          );
          if (navigationResult._tag === "Failure") return navigationResult;
        }
      }

      const worktreePath = thread.worktreePath?.trim() || null;
      const candidate = opts.deletionPlan?.candidates.find(
        (entry) => entry.environmentId === thread.environmentId && entry.path === worktreePath,
      );
      const candidateInspection = candidate
        ? opts.deletionPlan?.decision.inspections[candidate.key]
        : undefined;
      const alreadyRemoved = candidate
        ? opts.removedWorktreeKeys?.has(candidate.key) === true
        : false;
      const hasRemainingReference =
        candidate && opts.deletionPlan
          ? !isFinalWorktreeReferenceAfterDeletion({
              candidate,
              current: thread,
              catalogThreads: opts.deletionPlan.catalogThreads,
              deletedThreadKeys: opts.deletedThreadKeys ?? new Set(),
            })
          : false;
      if (
        !candidate ||
        !opts.deletionPlan?.decision.deleteWorktrees ||
        alreadyRemoved ||
        hasRemainingReference ||
        candidateInspection?.availability !== "available"
      ) {
        return deleteResult;
      }

      if (opts.deletionPlan.decision.selectionSource === "smart-default") {
        const reinspection = await inspectWorktreeRemoval({
          environmentId: candidate.environmentId,
          input: { cwd: candidate.projectCwd, path: candidate.path },
        });
        if (
          reinspection._tag === "Failure" ||
          !worktreeRemovalInspectionUnchanged(candidateInspection, reinspection.value)
        ) {
          toastManager.add(
            stackedThreadToast({
              type: "warning",
              title: "Thread deleted, but worktree was kept",
              description: `${candidate.displayPath} changed after it was checked, so it was not removed.`,
            }),
          );
          return deleteResult;
        }
      }

      const removeResult = await removeWorktree({
        environmentId: candidate.environmentId,
        input: { cwd: candidate.projectCwd, path: candidate.path, force: true },
      });
      if (removeResult._tag === "Success") opts.removedWorktreeKeys?.add(candidate.key);
      const refreshResult = await refreshVcsStatus({
        environmentId: candidate.environmentId,
        input: { cwd: candidate.projectCwd },
      });
      if (removeResult._tag === "Failure") {
        const error = squashAtomCommandFailure(removeResult);
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId: threadRef.threadId,
          projectCwd: candidate.projectCwd,
          worktreePath: candidate.path,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Thread deleted, but worktree removal failed",
            description: `Could not remove ${candidate.displayPath}. ${message}`,
          }),
        );
        return deleteResult;
      }
      if (refreshResult._tag === "Failure") {
        const error = squashAtomCommandFailure(refreshResult);
        console.warn("Worktree removed after thread deletion, but VCS refresh failed", {
          threadId: threadRef.threadId,
          projectCwd: candidate.projectCwd,
          worktreePath: candidate.path,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Worktree removed, but status refresh failed",
            description:
              error instanceof Error
                ? error.message
                : "Refresh the project to update its Git status.",
          }),
        );
      }
      return deleteResult;
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalUiState,
      deleteThreadMutation,
      getCurrentRouteThreadRef,
      inspectWorktreeRemoval,
      refreshVcsStatus,
      removeWorktree,
      router,
      sidebarThreadSortOrder,
    ],
  );

  const settleThread = useCallback(
    async (target: ScopedThreadRef) => {
      // Version skew: never send the command to a server that predates it —
      // the raw protocol rejection would read as a random failure.
      if (!readEnvironmentSupportsSettlement(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettlementUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      const resolved = resolveThreadTarget(target);
      // Settle may only target what effectiveSettled could classify as
      // settled: not starting/running sessions, not threads waiting on
      // approvals or user input. Anything else would hide live work.
      if (resolved && !canSettle(resolved.thread, { now: new Date().toISOString() })) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettleBlockedError({
              environmentId: resolved.threadRef.environmentId,
              threadId: resolved.threadRef.threadId,
            }),
          ),
        );
      }
      // Settle is a high-frequency lifecycle action and stays silent — no
      // toast.
      return settleThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
    },
    [resolveThreadTarget, settleThreadMutation],
  );

  const unsettleThread = useCallback(
    async (target: ScopedThreadRef) => {
      if (!readEnvironmentSupportsSettlement(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettlementUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      // reason "user" pins the thread active: auto-settle (PR merged /
      // inactivity) stays suppressed until real activity clears the pin.
      return unsettleThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, reason: "user" },
      });
    },
    [unsettleThreadMutation],
  );

  const snoozeThread = useCallback(
    async (target: ScopedThreadRef, snoozedUntil: string) => {
      // Version skew: never send the command to a server that predates it.
      if (!readEnvironmentSupportsSnooze(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      const resolved = resolveThreadTarget(target);
      // Blocked-on-you work and queued turns can't be snoozed away —
      // client-side twin of the server invariants so the UI rejects before
      // a round trip.
      if (resolved && !canSnooze(resolved.thread, { now: new Date().toISOString() })) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeBlockedError({
              environmentId: resolved.threadRef.environmentId,
              threadId: resolved.threadRef.threadId,
            }),
          ),
        );
      }
      return snoozeThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, snoozedUntil },
      });
    },
    [resolveThreadTarget, snoozeThreadMutation],
  );

  const unsnoozeThread = useCallback(
    async (target: ScopedThreadRef) => {
      if (!readEnvironmentSupportsSnooze(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      return unsnoozeThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, reason: "user" },
      });
    },
    [unsnoozeThreadMutation],
  );

  const settleThreads = useCallback(
    async (targets: ReadonlyArray<EnvironmentThreadShell>) => {
      if (targets.length === 0) return AsyncResult.success(undefined);
      const now = new Date().toISOString();
      const unsupported = targets.find(
        (thread) => !readEnvironmentSupportsSettlement(thread.environmentId),
      );
      if (unsupported) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettlementUnsupportedError({
              environmentId: unsupported.environmentId,
              threadId: unsupported.id,
            }),
          ),
        );
      }
      const blocked = targets.find((thread) => !canSettle(thread, { now }));
      if (blocked) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettleBlockedError({
              environmentId: blocked.environmentId,
              threadId: blocked.id,
            }),
          ),
        );
      }

      for (const thread of targets) {
        if (!effectiveSnoozed(thread, { now })) continue;
        const result = await unsnoozeThread(scopeThreadRef(thread.environmentId, thread.id));
        if (result._tag === "Failure") return result;
      }
      for (const thread of targets) {
        const result = await settleThread(scopeThreadRef(thread.environmentId, thread.id));
        if (result._tag === "Failure") return result;
      }
      return AsyncResult.success(undefined);
    },
    [settleThread, unsnoozeThread],
  );

  const deleteWorktree = useCallback(
    async (input: DeleteWorktreeInput): Promise<boolean> => {
      // Confirmation copy uses the client's last-known membership. Authoritative
      // membership and deletion are decided only on the server at execution time.
      const archivedAtom = orchestrationEnvironment.archivedShellSnapshot({
        environmentId: input.environmentId,
        input: {},
      });
      appAtomRegistry.refresh(archivedAtom);
      const archivedResult = await executeAtomQuery(appAtomRegistry, archivedAtom, {
        reportFailure: false,
      });
      if (archivedResult._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Worktree kept because archived conversations could not be checked",
            description: "Reconnect to the environment and try again.",
          }),
        );
        return false;
      }
      const archivedThreads = archivedResult.value.threads.map((thread) => ({
        ...thread,
        environmentId: input.environmentId,
      }));
      const worktreeThreads = selectThreadsForWorktree({
        environmentId: input.environmentId,
        worktreePath: input.worktreePath,
        threads: [...input.threads, ...archivedThreads],
      });

      const inspectionResult = await inspectWorktreeRemoval({
        environmentId: input.environmentId,
        input: { cwd: input.projectCwd, path: input.worktreePath },
      });
      if (inspectionResult._tag === "Failure") {
        const error = squashAtomCommandFailure(inspectionResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to inspect worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      }
      const inspection = inspectionResult.value;
      const archivedCount = worktreeThreads.filter((thread) => thread.archivedAt !== null).length;
      const decision = await settlePromise(() =>
        requestWorktreeDeleteConfirmation({
          label: input.label,
          path: input.worktreePath,
          conversationCount: worktreeThreads.length,
          archivedCount,
          inspection,
        }),
      );
      if (decision._tag === "Failure" || decision.value === null) return false;

      const deletionResult = await deleteWorktreeCommand({
        environmentId: input.environmentId,
        input: {
          cwd: input.projectCwd,
          path: input.worktreePath,
          force: true,
          deleteBranch: decision.value.deleteBranch,
        },
      });
      if (deletionResult._tag === "Failure") {
        const error = squashAtomCommandFailure(deletionResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Worktree kept because deletion failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      }

      const outcome = deletionResult.value;
      if (outcome.status === "rejected") {
        toastManager.add({
          type: "warning",
          title: "Worktree is not available",
          description: "The selected path is not a Git worktree.",
        });
        return false;
      }
      if (outcome.status === "partial") {
        const worktreeAlreadyRemoved = outcome.worktreeRemoval === "removed";
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              outcome.stage === "branch"
                ? "Worktree deleted, but the local branch was kept"
                : worktreeAlreadyRemoved
                  ? "Worktree removed, but some conversations could not be cleaned up"
                  : outcome.stage === "conversation"
                    ? "Worktree kept because conversation history could not be deleted"
                    : "Conversation history deleted, but worktree removal failed",
            description:
              outcome.detail ||
              (worktreeAlreadyRemoved
                ? "Retry to finish conversation cleanup. The worktree is already gone from disk."
                : outcome.stage === "conversation"
                  ? "No worktree files were removed."
                  : "The worktree remains on disk. Retry to finish removal."),
          }),
        );
        // Filesystem already gone: still refresh archived/VCS so the UI does not
        // keep showing a path that no longer exists.
        if (worktreeAlreadyRemoved) {
          refreshArchivedThreadsForEnvironment(input.environmentId);
          await refreshVcsStatus({
            environmentId: input.environmentId,
            input: { cwd: input.projectCwd },
          });
        }
        return false;
      }

      refreshArchivedThreadsForEnvironment(input.environmentId);
      const refreshResult = await refreshVcsStatus({
        environmentId: input.environmentId,
        input: { cwd: input.projectCwd },
      });
      toastManager.add({
        type: refreshResult._tag === "Success" ? "success" : "warning",
        title:
          outcome.worktreeRemoval === "already_missing"
            ? "Unavailable worktree removed from sidebar"
            : outcome.branchRemoval === "removed"
              ? "Worktree and local branch deleted"
              : refreshResult._tag === "Success"
                ? "Worktree deleted"
                : "Worktree deleted, but status refresh failed",
        description: input.worktreePath,
      });
      return true;
    },
    [deleteWorktreeCommand, inspectWorktreeRemoval, refreshVcsStatus],
  );

  const deleteThreads = useCallback(
    async (targets: ReadonlyArray<EnvironmentThreadShell>) => {
      const flowOwned = readFlowOwnedTarget(targets);
      if (flowOwned !== null) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadDeleteFlowOwnedError({
              environmentId: flowOwned.environmentId,
              threadId: flowOwned.id,
            }),
          ),
        );
      }
      const planResult = await confirmThreadDeletion(targets);
      if (planResult._tag === "Failure") return planResult;
      if (planResult.value === null) return AsyncResult.success(null);

      const deletedThreadKeys = new Set<string>();
      const removedWorktreeKeys = new Set<string>();
      for (const target of targets) {
        const result = await deleteThread(target, {
          deletedThreadKeys,
          removedWorktreeKeys,
          deletionPlan: planResult.value,
        });
        if (result._tag === "Failure") return result;
        deletedThreadKeys.add(scopedThreadKey(scopeThreadRef(target.environmentId, target.id)));
      }
      return AsyncResult.success(deletedThreadKeys as ReadonlySet<string>);
    },
    [confirmThreadDeletion, deleteThread],
  );

  const confirmAndDeleteThread = useCallback(
    async (target: EnvironmentThreadShell) => {
      const result = await deleteThreads([target]);
      return result._tag === "Success" ? AsyncResult.success(undefined) : result;
    },
    [deleteThreads],
  );

  return useMemo(
    () => ({
      archiveThread,
      unarchiveThread,
      deleteThreads,
      confirmAndDeleteThread,
      settleThread,
      settleThreads,
      deleteWorktree,
      unsettleThread,
      snoozeThread,
      unsnoozeThread,
    }),
    [
      archiveThread,
      confirmAndDeleteThread,
      deleteWorktree,
      deleteThreads,
      settleThread,
      settleThreads,
      snoozeThread,
      unarchiveThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );
}
