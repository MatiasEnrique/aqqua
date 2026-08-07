import { scopeThreadRef } from "@aqqua/client-runtime/environment";
import { useEffect, useMemo, useRef } from "react";
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
  conversationTabKey,
  openConversationTab,
  openNewSubAgentConversationTabs,
  retainKnownConversationTabs,
} from "./openConversationTabs";

/**
 * The header tab strip's state: which conversations are open.
 *
 * Opening is implicit — routing to a conversation puts it in the strip, so
 * every existing way in (sidebar, command palette, deep link, notification,
 * new-thread) fills the strip without knowing it exists.
 */
export function useConversationTabs(input: {
  /** The scoped thread key of the routed conversation, draft routes included. */
  readonly routeThreadKey: string | null;
  /** Off in breadcrumb mode: nothing subscribes and nothing is written. */
  readonly enabled: boolean;
}): {
  readonly tabs: readonly ConversationTab[];
} {
  const openKeys = useUiStateStore((store) => store.openConversationTabKeys);
  const setOpenKeys = useUiStateStore((store) => store.setOpenConversationTabKeys);
  const threads = useThreadShells();
  const projects = useProjects();
  // Every environment has to have reported before a missing key means anything.
  // Pruning mid-bootstrap would wipe the restored strip on every cold start.
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const draftsByDraftId = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const previousThreadsRef = useRef<typeof threads | null>(null);

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

  useEffect(() => {
    if (!bootstrapped) return;
    const previousThreads = previousThreadsRef.current;
    previousThreadsRef.current = threads;
    if (!enabled || previousThreads === null) return;
    const current = useUiStateStore.getState().openConversationTabKeys;
    const next = openNewSubAgentConversationTabs({
      openKeys: current,
      previousThreads,
      threads,
    });
    if (next.length !== current.length) setOpenKeys(next);
  }, [bootstrapped, enabled, setOpenKeys, threads]);

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

  return { tabs };
}
