import type { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@aqqua/client-runtime/state/runtime";
import { type MouseEvent as ReactMouseEvent, useCallback } from "react";
import { openCommandPalette } from "../../commandPaletteBus";
import { readLocalApi } from "../../localApi";
import {
  type SidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
  sidebarLocationContextMenuItems,
} from "../Sidebar.worktreeGroups";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { WorktreeLifecycleController } from "./models";
import type { SidebarV2Sections } from "./useSidebarV2Sections";

export function useWorktreeLifecycleController(input: {
  readonly sections: Pick<SidebarV2Sections, "worktrees" | "runtime">;
}): WorktreeLifecycleController {
  const { worktrees, runtime } = input.sections;
  const { removingWorktreeKey, setRemovingWorktreeKey, hideWorktreeKey } = worktrees;
  const { deleteWorktree, handleNewThreadRef, threads } = runtime;

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
          if (removed) hideWorktreeKey(group.key);
        } finally {
          setRemovingWorktreeKey(null);
        }
      })();
    },
    [deleteWorktree, hideWorktreeKey, removingWorktreeKey, setRemovingWorktreeKey, threads],
  );

  const handleLocationContextMenu = useCallback(
    (
      event: ReactMouseEvent,
      locationInput: {
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
              isProjectLocation: locationInput.location === undefined,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value === "new-worktree") {
          if (locationInput.location !== undefined) return;
          openCommandPalette({
            open: "new-worktree",
            context: { projectRef: locationInput.projectRef },
          });
          return;
        }
        if (clicked.value !== "new-conversation") return;

        const result = await settlePromise(() =>
          handleNewThreadRef.current(locationInput.projectRef, locationInput.location),
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
    [handleNewThreadRef],
  );

  return { attemptDeleteWorktree, handleLocationContextMenu };
}
