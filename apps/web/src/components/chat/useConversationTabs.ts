import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { useWorktreeHeaderStore } from "../../worktreeHeaderStore";
import { selectSidebarDraftRows } from "../Sidebar.logic";
import { buildProjectRootByProjectKey } from "../Sidebar.worktreeGroups";
import {
  buildConversationTabs,
  type ConversationTab,
  closeConversationTab,
  conversationTabKey,
  openConversationTab,
  resolveConversationTabCloseTarget,
  retainKnownConversationTabs,
} from "./openConversationTabs";

/**
 * The header tab strip's state: which conversations are open, and what closing
 * one does.
 *
 * Opening is implicit — routing to a conversation puts it in the strip, so
 * every existing way in (sidebar, command palette, deep link, notification,
 * new-thread) fills the strip without knowing it exists. Only the close control
 * takes one back out.
 */
export function useConversationTabs(input: {
  /** The scoped thread key of the routed conversation, draft routes included. */
  readonly routeThreadKey: string | null;
  /** Off in breadcrumb mode: nothing subscribes and nothing is written. */
  readonly enabled: boolean;
}): {
  readonly tabs: readonly ConversationTab[];
  readonly closeTab: (tabKey: string) => void;
} {
  const navigate = useNavigate();
  const openKeys = useUiStateStore((store) => store.openConversationTabKeys);
  const setOpenKeys = useUiStateStore((store) => store.setOpenConversationTabKeys);
  const threads = useThreadShells();
  const projects = useProjects();
  // Every environment has to have reported before a missing key means anything.
  // Pruning mid-bootstrap would wipe the restored strip on every cold start.
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const draftsByDraftId = useComposerDraftStore((store) => store.draftThreadsByThreadKey);

  const existingThreadKeys = useMemo(
    () => new Set(threads.map((thread) => `${thread.environmentId}:${thread.id}`)),
    [threads],
  );
  // Unscoped on purpose: the strip is not filtered by the sidebar's project
  // scope. Narrowing the sidebar must not silently close tabs.
  const drafts = useMemo(
    () =>
      selectSidebarDraftRows({
        draftsByDraftId,
        existingThreadKeys,
        scopedProjectKeys: null,
        includeLocal: true,
      }),
    [draftsByDraftId, existingThreadKeys],
  );

  const { routeThreadKey, enabled } = input;

  useEffect(() => {
    if (!enabled || routeThreadKey === null) return;
    setOpenKeys(
      openConversationTab(useUiStateStore.getState().openConversationTabKeys, routeThreadKey),
    );
  }, [enabled, routeThreadKey, setOpenKeys]);

  // Keys outlive their conversation when a thread is deleted or a draft
  // discarded. Rendering already skips them; this keeps the persisted list from
  // growing forever. The routed key is exempt because its detail may still be
  // loading — pruning it would close the tab the user is looking at.
  const knownKeys = useMemo(() => {
    const keys = new Set(
      threads.map((thread) => conversationTabKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    for (const draft of drafts) {
      keys.add(conversationTabKey(scopeThreadRef(draft.environmentId, draft.threadId)));
    }
    if (routeThreadKey !== null) keys.add(routeThreadKey);
    return keys;
  }, [drafts, routeThreadKey, threads]);

  useEffect(() => {
    if (!enabled || !bootstrapped) return;
    const current = useUiStateStore.getState().openConversationTabKeys;
    const retained = retainKnownConversationTabs({ keys: current, knownKeys });
    if (retained.length !== current.length) setOpenKeys(retained);
  }, [bootstrapped, enabled, knownKeys, setOpenKeys]);

  // The strip belongs to one worktree: switching checkouts is switching the set
  // of conversations you are holding open, not adding to a global pile. Open
  // keys stay unscoped in the store, so returning to a worktree brings its own
  // tabs back exactly as they were.
  const activeWorktreeKey = useWorktreeHeaderStore(
    (store) => store.activeWorktreeGroup?.key ?? null,
  );
  const projectRootByProjectKey = useMemo(() => buildProjectRootByProjectKey(projects), [projects]);

  const tabs = useMemo(
    () =>
      enabled
        ? buildConversationTabs({
            openKeys,
            threads,
            drafts,
            activeKey: routeThreadKey,
            worktreeKey: activeWorktreeKey,
            projectRootByProjectKey,
          })
        : [],
    [
      activeWorktreeKey,
      drafts,
      enabled,
      openKeys,
      projectRootByProjectKey,
      routeThreadKey,
      threads,
    ],
  );

  const closeTab = useCallback(
    (tabKey: string) => {
      const current = useUiStateStore.getState().openConversationTabKeys;
      const target = resolveConversationTabCloseTarget({
        keys: current,
        closingKey: tabKey,
        activeKey: routeThreadKey,
      });
      setOpenKeys(closeConversationTab(current, tabKey));
      if (routeThreadKey !== tabKey) return;
      const nextTab = target === null ? undefined : tabs.find((tab) => tab.key === target);
      if (nextTab === undefined) {
        // Nothing left to fall back to: the index route starts a fresh draft
        // rather than stranding the user on a closed conversation.
        void navigate({ to: "/" });
        return;
      }
      if (nextTab._tag === "draft") {
        void navigate({
          to: "/draft/$draftId",
          params: { draftId: nextTab.draftId },
        });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: nextTab.threadRef.environmentId,
          threadId: nextTab.threadRef.threadId,
        },
      });
    },
    [navigate, routeThreadKey, setOpenKeys, tabs],
  );

  return { tabs, closeTab };
}
