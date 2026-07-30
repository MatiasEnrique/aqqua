import { canSettle, canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "../../localApi";
import { openCommandPalette } from "../../commandPaletteBus";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { buildMultiSelectThreadContextMenuItems, isTrailingDoubleClick } from "../Sidebar.logic";
import { resolveSnoozePresets, snoozeWakeDescription, type SnoozePreset } from "../Sidebar.snooze";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { ThreadLifecycleController } from "./models";
import type { SidebarNavigationController } from "./models";
import type { SidebarV2Sections } from "./useSidebarV2Sections";

export type ThreadLifecycleControllerWithPlan = ThreadLifecycleController & {
  readonly planForwardNavigation: (
    parkedThreadKey: string,
    alsoLeavingKeys?: ReadonlySet<string>,
  ) => (() => void) | null;
};

export function useThreadLifecycleController(input: {
  readonly sections: Pick<SidebarV2Sections, "route" | "threads" | "runtime">;
  readonly navigation: Pick<SidebarNavigationController, "navigateToThread">;
}): ThreadLifecycleControllerWithPlan {
  const { sections, navigation } = input;
  const { route, threads, runtime } = sections;
  const { routeThreadKey, routeThreadKeyRef, isMobile, setOpenMobile } = route;
  const {
    orderedThreadKeysRef,
    settledThreadKeysRef,
    snoozedThreadKeysRef,
    threadByKeyRef,
    selectedSettledThreads,
    setThreadExpanded,
    serverConfigs,
  } = threads;
  const {
    router,
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    deleteThreads,
    updateThreadMetadata,
    clearSelection,
    setSelectionAnchor,
    markThreadUnread,
    handleNewThreadRef,
    settlingThreadKeysRef,
  } = runtime;
  const { navigateToThread } = navigation;
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const [deletingSettledSelection, setDeletingSettledSelection] = useState(false);

  const toggleThreadExpanded = useCallback(
    (threadRef: ScopedThreadRef, expanded: boolean) => {
      const threadKey = scopedThreadKey(threadRef);
      setThreadExpanded(threadKey, expanded);
    },
    [setThreadExpanded],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const threadKey = scopedThreadKey(threadRef);
      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedThreadKeysRef.current);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }
      navigateToThread(threadRef);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  // Parking the thread you're looking at (settle or snooze) moves you
  // forward: the next remaining card (never a settled or snoozed row, never
  // one leaving in the same batch), or a fresh draft in this project when it
  // was the last active one. Callers snapshot the plan BEFORE the command
  // mutates the partition; background parks never navigate (null plan).
  const planForwardNavigation = useCallback(
    (threadKey: string, coParkingKeys?: ReadonlySet<string>): (() => void) | null => {
      if (routeThreadKeyRef.current !== threadKey) return null;
      const shell = threadByKeyRef.current.get(threadKey);
      const orderedKeys = orderedThreadKeysRef.current;
      const settledKeys = settledThreadKeysRef.current;
      const snoozedKeys = snoozedThreadKeysRef.current;
      const currentIndex = orderedKeys.indexOf(threadKey);
      const nextCardKey =
        currentIndex === -1
          ? null
          : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
              (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
            ) ?? null);
      const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
      return nextThread
        ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
        : shell
          ? () =>
              void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
          : () => void router.navigate({ to: "/" });
    },
    [navigateToThread, router],
  );

  const attemptSettle = useCallback(
    (threadRef: ScopedThreadRef, opts: { coSettlingKeys?: ReadonlySet<string> } = {}) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (settlingThreadKeysRef.current.has(threadKey)) return;
        settlingThreadKeysRef.current.add(threadKey);
        try {
          const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
          const result = await settleThread(threadRef);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not settle.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to settle thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Only move forward if the user is still on the settled thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSettle?.();
          }
        } finally {
          settlingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [planForwardNavigation, settleThread],
  );
  const attemptUnsettle = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsettleThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to un-settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsettleThread],
  );
  const attemptUnsnooze = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to wake thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsnoozeThread],
  );
  // One snooze per thread at a time — same double-dispatch guard as settle.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const attemptSnooze = useCallback(
    (
      threadRef: ScopedThreadRef,
      preset: SnoozePreset,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (snoozingThreadKeysRef.current.has(threadKey)) return;
        snoozingThreadKeysRef.current.add(threadKey);
        try {
          // Snoozing the open thread moves you forward, same as settle —
          // both park the thread you're done with for now.
          const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
          const result = await snoozeThread(threadRef, preset.snoozedUntil);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not snooze.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to snooze thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Snooze hides the row, so the toast is the only confirmation —
          // and the Undo is the escape hatch for a mis-click.
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date())}`,
              timeout: 5_000,
              actionProps: {
                children: "Undo",
                onClick: () => attemptUnsnooze(threadRef),
              },
            }),
          );
          // Only move forward if the user is still on the snoozed thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSnooze?.();
          }
        } finally {
          snoozingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [attemptUnsnooze, planForwardNavigation, snoozeThread],
  );

  const deleteThreadSelection = useCallback(
    async (selectedThreads: readonly EnvironmentThreadShell[]) => {
      if (selectedThreads.length === 0) return;
      const threadKeys = selectedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      const deletionResult = await deleteThreads(selectedThreads);
      if (deletionResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(deletionResult)) {
          const error = squashAtomCommandFailure(deletionResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete threads",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      if (deletionResult.value !== null) removeFromSelection(threadKeys);
    },
    [deleteThreads, removeFromSelection],
  );
  const deleteSelectedSettledThreads = useCallback(() => {
    if (deletingSettledSelection || selectedSettledThreads.length === 0) return;
    void (async () => {
      setDeletingSettledSelection(true);
      try {
        await deleteThreadSelection(selectedSettledThreads);
      } finally {
        setDeletingSettledSelection(false);
      }
    })();
  }, [deleteThreadSelection, deletingSettledSelection, selectedSettledThreads]);
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (settled-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys].filter(
        (threadKey) => threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // Snooze (N) is offered when every selected thread can actually take
      // it — a mixed selection with blocked-on-you work would half-apply.
      const selectionNow = new Date().toISOString();
      const snoozableThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const canSnoozeSelection = snoozableThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow }),
      );
      const snoozePresets = resolveSnoozePresets(new Date());
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            { id: "settle", label: `Settle (${count})` },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    children: snoozePresets.map((preset) => ({
                      id: `snooze:${preset.id}`,
                      label: `${preset.label} (${preset.whenLabel})`,
                    })),
                  },
                ]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset = snoozePresets.find(
          (candidate) => `snooze:${candidate.id}` === clicked.value,
        );
        if (preset) {
          // Post-snooze navigation must skip threads snoozing in this same
          // batch — they are all leaving the card block together.
          const coSnoozingKeys = new Set(threadKeys);
          for (const thread of snoozableThreads) {
            attemptSnooze(scopeThreadRef(thread.environmentId, thread.id), preset, {
              coSnoozingKeys,
            });
          }
          clearSelection();
        }
        return;
      }
      if (clicked.value === "settle") {
        // Post-settle navigation must skip threads settling in this same
        // batch — they are all leaving the card block together. Rows that
        // are already explicitly settled are skipped: nothing to do on a
        // valid mixed selection.
        const coSettlingKeys = new Set(threadKeys);
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread || thread.settledOverride === "settled") continue;
          attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      await deleteThreadSelection(selectedThreads);
    },
    [
      attemptSettle,
      attemptSnooze,
      clearSelection,
      deleteThreadSelection,
      markThreadUnread,
      serverConfigs,
    ],
  );

  // One deletion path for every entry point (context menu, settled row's trash
  // button): the confirm setting and the worktree-orphan handling inside
  // deleteThreads must not drift between them.
  const attemptDeleteThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const result = await deleteThreads([thread]);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [deleteThreads],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        // Un-settle works on every settled row: for explicit settles it
        // clears the override, for auto-settled rows it pins the thread
        // active until real activity clears the pin. Environments without
        // the settlement capability get no lifecycle items at all.
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        // Presets resolve at menu-open time (same as the popover).
        const snoozePresets = resolveSnoozePresets(new Date());
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      label: `New thread on ${thread.branch}`,
                    },
                  ]
                : []),
              ...(supportsSettlement
                ? [
                    isSettled
                      ? { id: "unsettle", label: "Un-settle thread" }
                      : { id: "settle", label: "Settle thread" },
                  ]
                : []),
              ...(supportsSnooze
                ? [
                    isSnoozed
                      ? { id: "unsnooze", label: "Wake thread" }
                      : {
                          id: "snooze",
                          label: "Snooze",
                          disabled: !canSnooze(thread, { now: new Date().toISOString() }),
                          children: snoozePresets.map((preset) => ({
                            id: `snooze:${preset.id}`,
                            label: `${preset.label} (${preset.whenLabel})`,
                          })),
                        },
                  ]
                : []),
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              { id: "delete", label: "Delete", destructive: true, icon: "trash" },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset = snoozePresets.find(
            (candidate) => `snooze:${candidate.id}` === clicked.value,
          );
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "new-thread-on-branch": {
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "mark-unread":
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
            return;
          case "delete":
            attemptDeleteThread(threadRef);
            return;
          default:
            return;
        }
      })();
    },
    [
      attemptDeleteThread,
      attemptSettle,
      attemptSnooze,
      attemptUnsettle,
      attemptUnsnooze,
      handleMultiSelectContextMenu,
      markThreadUnread,
      serverConfigs,
      startThreadRename,
    ],
  );

  return {
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    startThreadRename,
    cancelThreadRename,
    commitThreadRename,
    handleThreadClick,
    toggleThreadExpanded,
    attemptSettle,
    attemptUnsettle,
    attemptSnooze,
    attemptUnsnooze,
    attemptDeleteThread,
    deleteSelectedSettledThreads,
    deletingSettledSelection,
    handleThreadContextMenu,
    handleMultiSelectContextMenu,
    planForwardNavigation,
  };
}
