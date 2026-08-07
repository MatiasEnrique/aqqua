import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef } from "@aqqua/contracts";
import { autoAnimate } from "@formkit/auto-animate";
import { useCallback, useEffect } from "react";
import { openCommandPalette } from "../../commandPaletteBus";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../../keybindings";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { resolveAdjacentThreadId } from "../Sidebar.logic";
import type { SidebarNavigationController } from "./models";
import type { SidebarV2Sections } from "./useSidebarV2Sections";

export function useSidebarNavigationController(
  sections: Pick<SidebarV2Sections, "route" | "projects" | "threads" | "runtime">,
): SidebarNavigationController {
  const { route, projects, threads, runtime } = sections;
  const { routeThreadKey, routeDraftId, routeThreadRef, isMobile, setOpenMobile } = route;
  const { projectGroups } = projects;
  const { orderedThreadKeys, threadByKey } = threads;
  const { router, keybindings, newThreadContext, clearSelection, setSelectionAnchor } = runtime;

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const navigateToDraft = useCallback(
    (draftId: string) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/draft/$draftId",
        params: { draftId },
      });
    },
    [clearSelection, isMobile, router, setOpenMobile],
  );

  // Drafts are client-local, so discarding is a plain store removal — no
  // server command, no confirm. Leaving the routed draft's page after its
  // state is gone would strand the composer, so navigation falls back home.
  const discardDraft = useCallback(
    (draftId: string) => {
      useComposerDraftStore.getState().clearDraftThread(DraftId.make(draftId));
      if (routeDraftId === draftId) {
        void router.navigate({ to: "/" });
      }
    },
    [routeDraftId, router],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
  ]);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(() => {
    // One project: nothing to pick, create immediately.
    if (projectGroups.length <= 1) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  }, [isMobile, newThreadContext, projectGroups.length, setOpenMobile]);

  const commandPaletteShortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  // Same resolution as v1: prefer the local-thread binding, fall back to
  // chat.new, no platform gating — web users have working shortcuts too.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");

  return {
    navigateToThread,
    navigateToDraft,
    discardDraft,
    handleNewThreadClick,
    attachListAutoAnimateRef,
    commandPaletteShortcutLabel: commandPaletteShortcutLabel ?? null,
    newThreadShortcutLabel: newThreadShortcutLabel ?? null,
  };
}
