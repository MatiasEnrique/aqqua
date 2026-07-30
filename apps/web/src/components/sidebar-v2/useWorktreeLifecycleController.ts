import { canSettle } from "@t3tools/client-runtime/state/thread-settled";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { openCommandPalette } from "../../commandPaletteBus";
import { readLocalApi } from "../../localApi";
import {
  resolveSidebarWorktreeConversationLocation,
  sidebarLocationContextMenuItems,
  type SidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { WorktreeLifecycleController } from "./models";
import type { SidebarNavigationController } from "./models";
import type { SidebarV2Sections } from "./useSidebarV2Sections";

export function useWorktreeLifecycleController(input: {
  readonly sections: Pick<SidebarV2Sections, "route" | "threads" | "worktrees" | "runtime">;
  readonly planForwardNavigation: (
    parkedThreadKey: string,
    alsoLeavingKeys?: ReadonlySet<string>,
  ) => (() => void) | null;
}): WorktreeLifecycleController {
  const { sections, planForwardNavigation } = input;
  const { route, threads: threadSection, worktrees, runtime } = sections;
  const { routeThreadKeyRef } = route;
  const { serverConfigs } = threadSection;
  const {
    removingWorktreeKey,
    settlingWorktreeKey,
    setRemovingWorktreeKey,
    setSettlingWorktreeKey,
    hideWorktreeKey,
  } = worktrees;
  const { settleThreads, deleteWorktree, handleNewThreadRef, threads, settlingThreadKeysRef } =
    runtime;

  const attemptSettleWorktree = useCallback(
    (group: SidebarWorktreeGroup) => {
      if (group.unsettled.length === 0 || settlingWorktreeKey !== null) return;
      const threadKeys = new Set(
        group.unsettled.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      if ([...threadKeys].some((threadKey) => settlingThreadKeysRef.current.has(threadKey))) {
        return;
      }

      void (async () => {
        setSettlingWorktreeKey(group.key);
        for (const threadKey of threadKeys) settlingThreadKeysRef.current.add(threadKey);
        const activeRouteKey = routeThreadKeyRef.current;
        const navigateAfterSettle =
          activeRouteKey !== null && threadKeys.has(activeRouteKey)
            ? planForwardNavigation(activeRouteKey, threadKeys)
            : null;
        try {
          const result = await settleThreads(group.unsettled);
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: `Could not settle ${group.label}`,
                  description:
                    error instanceof Error
                      ? error.message
                      : "A conversation is still working or needs attention.",
                }),
              );
            }
            return;
          }
          toastManager.add({
            type: "success",
            title: `${group.label} settled`,
            description: `${group.unsettled.length} conversation${group.unsettled.length === 1 ? "" : "s"} moved to Settled.`,
          });
          if (activeRouteKey !== null && routeThreadKeyRef.current === activeRouteKey) {
            navigateAfterSettle?.();
          }
        } finally {
          for (const threadKey of threadKeys) settlingThreadKeysRef.current.delete(threadKey);
          setSettlingWorktreeKey(null);
        }
      })();
    },
    [planForwardNavigation, settleThreads, settlingWorktreeKey],
  );

  const attemptDeleteWorktree = useCallback(
    (group: SidebarWorktreeGroup) => {
      if (
        group.isProjectCheckout ||
        group.workspaceRoot === null ||
        group.projectRoot === null ||
        removingWorktreeKey !== null
      ) {
        return;
      }
      const workspaceRoot = group.workspaceRoot;
      const projectRoot = group.projectRoot;

      void (async () => {
        setRemovingWorktreeKey(group.key);
        try {
          const removed = await deleteWorktree({
            environmentId: group.environmentId,
            projectCwd: projectRoot,
            worktreePath: workspaceRoot,
            label: group.label,
            threads,
          });
          if (removed) {
            hideWorktreeKey(group.key);
          }
        } finally {
          setRemovingWorktreeKey(null);
        }
      })();
    },
    [deleteWorktree, hideWorktreeKey, removingWorktreeKey, threads],
  );

  const handleLocationContextMenu = useCallback(
    (
      event: ReactMouseEvent,
      input: {
        projectRef: ReturnType<typeof scopeProjectRef>;
        location?: SidebarWorktreeConversationLocation;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const position = { x: event.clientX, y: event.clientY };

      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            sidebarLocationContextMenuItems({
              isProjectLocation: input.location === undefined,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value === "new-worktree") {
          if (input.location !== undefined) return;
          openCommandPalette({
            open: "new-worktree",
            context: {
              projectRef: input.projectRef,
            },
          });
          return;
        }
        if (clicked.value !== "new-conversation") return;

        const result = await settlePromise(() =>
          handleNewThreadRef.current(input.projectRef, input.location),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create conversation",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [],
  );

  return {
    attemptSettleWorktree,
    attemptDeleteWorktree,
    handleLocationContextMenu,
  };
}
