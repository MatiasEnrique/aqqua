import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { useLocation } from "@tanstack/react-router";
import {
  EllipsisIcon,
  FolderPlusIcon,
  ListFilterIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  Fragment,
  lazy,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { isElectron } from "../../env";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { buildSidebarThreadFamilies, sidebarThreadKey } from "./sidebarThreadFamilies";
import { SidebarConversationGroups } from "./SidebarConversationGroups";
import { useThreadActions } from "../../hooks/useThreadActions";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { useWorktreeHeaderStore } from "../../worktreeHeaderStore";
import { SidebarSurfaceSwitcher } from "../board/SidebarSurfaceSwitcher";
import { resolveWorktreeSelectionTarget } from "../chat/openConversationTabs";
import {
  resolveSidebarConversationWorktreeKey,
  resolveSidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { CommandDialogTrigger } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { readRenderedSidebarThreadKeys } from "./renderedThreadOrder";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import type { SidebarV2ViewModel } from "./models";
import { ProjectNewWorktreeButton } from "./ProjectNewWorktreeButton";
import { ProjectSettingsPopover } from "./ProjectSettingsPopover";
import { SidebarFlowScopeRow, SidebarFlowsProvider } from "../board/SidebarFlowsProvider";
import { SidebarProjectScopeChips } from "./SidebarProjectScopeChips";
import { SidebarSettledSection } from "./SidebarSettledSection";
import {
  buildThreadContextMenuItems,
  resolveConversationClickAction,
  type SidebarThreadSection,
  SortableWorktreeCardList,
} from "./WorktreeCard";
import { WorktreeProjectFolder } from "./WorktreeProjectFolder";
import { buildWorktreeCardGroups } from "./worktreeCardGroups";
import { resolveActiveWorktreeProjectKey } from "./activeWorktree";

// The card list is the weight, so it stays lazy; the flow scope row and the
// selection it shares with the list sit in the sidebar header and load with it.
const loadSidebarBoardPanel = () =>
  import("../board/SidebarBoardPanel").then((module) => ({
    default: module.SidebarBoardPanel,
  }));
const SidebarBoardPanel = lazy(loadSidebarBoardPanel);

/**
 * Flows scope: the header's flow picker and the body's card list are one
 * selection, so the surface wraps both halves of the sidebar rather than
 * living inside either.
 */
function FlowsSurfaceScope(props: {
  readonly active: boolean;
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly children: ReactNode;
}) {
  if (!props.active) return props.children;
  return <SidebarFlowsProvider projects={props.projects}>{props.children}</SidebarFlowsProvider>;
}

/** Sidebar scope-row action that starts adding a project. Both surfaces carry
 * it: a project can be added from Flows as well as from Threads. */
function NewProjectButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            onClick={onClick}
            type="button"
            aria-label="New project"
          />
        }
      >
        <FolderPlusIcon />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </TooltipTrigger>
      <TooltipPopup side="right">New project</TooltipPopup>
    </Tooltip>
  );
}

function HeaderTabScopeQuickAction() {
  const headerTabScope = useClientSettings((settings) => settings.headerTabScope);
  const updateSettings = useUpdateClientSettings();
  const scopeLabel =
    headerTabScope === "all"
      ? "All worktrees"
      : headerTabScope === "project"
        ? "Selected project"
        : "Selected worktree";

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  type="button"
                  className="size-7 rounded-md focus-visible:ring-offset-2"
                  aria-label="Filter header tabs"
                  isActive={headerTabScope !== "all"}
                />
              }
            />
          }
        >
          <ListFilterIcon />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Header tabs: {scopeLabel}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" sideOffset={6} className="min-w-44">
        <MenuRadioGroup
          value={headerTabScope}
          onValueChange={(value) => {
            if (value === "all" || value === "project" || value === "worktree") {
              updateSettings({ headerTabScope: value });
            }
          }}
        >
          <MenuRadioItem value="all">All worktrees</MenuRadioItem>
          <MenuRadioItem value="project">Selected project</MenuRadioItem>
          <MenuRadioItem value="worktree">Selected worktree</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

export function SidebarV2View(props: { model: SidebarV2ViewModel }) {
  const {
    route,
    projects: projectsSection,
    threads: threadsSection,
    worktrees: worktreesSection,
    worktreeLifecycle,
    projectActions,
    navigation,
  } = props.model;

  const { routeThreadKey, isMobile } = route;
  const conversationGrouping = useClientSettings(
    (settings) => settings.sidebarConversationGrouping,
  );

  const {
    projects,
    projectGroups,
    projectScopeSelection,
    setProjectScope,
    scopedProjectGroups,
    scopedProjectGroup,
    projectExpandedById,
    setProjectExpanded,
    projectActionsTarget,
    setProjectActionsTarget,
    projectGroupingSettings,
    projectCwdByKey,
    projectDisplayNameByKey,
  } = projectsSection;
  const projectSettingsPopoverHandle = useMemo(
    () => PopoverCreateHandle<SidebarProjectSnapshot>(),
    [],
  );

  const { orderedThreadKeys, threadByKey, settledThreads } = threadsSection;

  const activeThread = routeThreadKey ? (threadByKey.get(routeThreadKey) ?? null) : null;
  const boardProjectRef = scopedProjectGroup
    ? scopeProjectRef(scopedProjectGroup.environmentId, scopedProjectGroup.id)
    : activeThread
      ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
      : projectGroups[0]
        ? scopeProjectRef(projectGroups[0].environmentId, projectGroups[0].id)
        : null;

  const {
    worktreeGroups,
    repositoryGroups,
    activeWorktreeKey,
    activeWorktreeGroup,
    setActiveWorktreeOverrideKey,
    reorderWorktree,
    removingWorktreeKey,
  } = worktreesSection;

  const { attemptDeleteWorktree, handleLocationContextMenu } = worktreeLifecycle;
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    confirmAndDeleteThread,
    deleteThreadsWithoutConfirmation,
  } = useThreadActions();
  const {
    handleRemoveProjectMembers,
    renameProjectMember,
    updateProjectMemberIcon,
    updateProjectMemberOriginBranch,
    updateProjectGroupingPreference,
    copyProjectPath,
    openAddProjectCommandPalette,
  } = projectActions;

  const {
    navigateToThread,
    navigateToDraft,
    createThreadInWorktree,
    discardDraft,
    handleNewThreadClick,
    attachListAutoAnimateRef,
    commandPaletteShortcutLabel,
    newThreadShortcutLabel,
  } = navigation;

  const pathname = useLocation({ select: (location) => location.pathname });
  const isBoardSurface = pathname.startsWith("/board/");
  // Flows read the same project scope the thread list does. An empty selection
  // means every project, matching the chip row's own "All projects" reading.
  const scopedFlowProjects = projectScopeSelection.size === 0 ? projectGroups : scopedProjectGroups;
  const openConversationTabKeys = useUiStateStore((store) => store.openConversationTabKeys);
  const worktreeConversationExpandedByKey = useUiStateStore(
    (store) => store.worktreeConversationExpandedByKey,
  );
  const setWorktreeConversationExpanded = useUiStateStore(
    (store) => store.setWorktreeConversationExpanded,
  );

  // Publish the selection so the chat header's tab strip reads the same group
  // this list renders, rather than re-deriving the settled/snoozed partition.
  const setHeaderWorktree = useWorktreeHeaderStore((store) => store.setActiveWorktree);
  const worktreeCount = worktreeGroups.length;
  const worktreeCardGroups = useMemo(
    () =>
      buildWorktreeCardGroups({
        repositories: repositoryGroups,
        worktrees: worktreeGroups,
        selection: projectScopeSelection,
      }),
    [projectScopeSelection, repositoryGroups, worktreeGroups],
  );
  const hasVisibleWorktrees = worktreeCardGroups.some((group) => group.worktrees.length > 0);
  const threadSectionByKey = useMemo(() => {
    const sections = new Map<string, SidebarThreadSection>();
    for (const group of worktreeGroups) {
      for (const thread of group.active) {
        sections.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), "active");
      }
      for (const thread of group.snoozed) {
        sections.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), "snoozed");
      }
    }
    for (const threadKey of threadByKey.keys()) {
      if (!sections.has(threadKey)) sections.set(threadKey, "settled");
    }
    return sections;
  }, [threadByKey, worktreeGroups]);
  const threadFamilies = useMemo(
    () => buildSidebarThreadFamilies([...threadByKey.values()]),
    [threadByKey],
  );
  // Settled conversations answer to the shelf at the foot of the list, not to
  // every project group in turn — one place to look for finished work.
  const isSettledThread = useCallback(
    (thread: EnvironmentThreadShell) =>
      threadSectionByKey.get(sidebarThreadKey(thread)) === "settled",
    [threadSectionByKey],
  );
  const threadsByWorktreeKey = useMemo(() => {
    const grouped = new Map<string, EnvironmentThreadShell[]>();
    for (const thread of threadFamilies.roots) {
      const key = resolveSidebarConversationWorktreeKey({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        worktreePath: thread.worktreePath,
        projectRootByProjectKey: projectsSection.projectCwdByKey,
      });
      if (key === null) continue;
      const current = grouped.get(key);
      if (current) {
        current.push(thread);
      } else {
        grouped.set(key, [thread]);
      }
    }
    return grouped;
  }, [projectsSection.projectCwdByKey, threadFamilies]);
  const statusThreads = useMemo(
    () =>
      worktreeCardGroups
        .flatMap((cardGroup) =>
          cardGroup.worktrees.flatMap((worktree) => threadsByWorktreeKey.get(worktree.key) ?? []),
        )
        .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [threadsByWorktreeKey, worktreeCardGroups],
  );
  const statusDrafts = useMemo(
    () =>
      worktreeCardGroups.flatMap((cardGroup) =>
        cardGroup.worktrees.flatMap((worktree) => worktree.drafts),
      ),
    [worktreeCardGroups],
  );
  const showEmptyState =
    conversationGrouping === "status"
      ? statusThreads.length === 0 && statusDrafts.length === 0
      : !hasVisibleWorktrees;
  const activeProjectKey = useMemo(
    () =>
      resolveActiveWorktreeProjectKey({
        activeWorktree: activeWorktreeGroup,
        projects: projectGroups,
      }),
    [activeWorktreeGroup, projectGroups],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, thread: EnvironmentThreadShell) => {
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const threadKey = scopedThreadKey(threadRef);
      const action = resolveConversationClickAction({
        platform: navigator.platform,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        detail: event.detail,
      });
      if (action === "toggle-selection") {
        event.preventDefault();
        useThreadSelectionStore.getState().toggleThread(threadKey);
        return;
      }
      if (action === "range-selection") {
        event.preventDefault();
        useThreadSelectionStore
          .getState()
          .rangeSelectTo(threadKey, readRenderedSidebarThreadKeys(orderedThreadKeys));
        return;
      }
      if (action === "navigate") navigateToThread(threadRef);
    },
    [navigateToThread, orderedThreadKeys],
  );

  const handleToggleThreadSettled = useCallback(
    (thread: EnvironmentThreadShell, section: SidebarThreadSection) => {
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const action = section === "settled" ? unsettleThread(threadRef) : settleThread(threadRef);
      void action.then((result) => {
        if (result._tag === "Success") return;
        toastManager.add({
          type: "error",
          title:
            section === "settled"
              ? "Could not un-settle conversation"
              : "Could not settle conversation",
        });
      });
    },
    [settleThread, unsettleThread],
  );

  /** Settled work is already filed away, so its shelf deletes without another prompt. */
  const handleDeleteThreads = useCallback(
    (threads: readonly EnvironmentThreadShell[]) => {
      if (threads.length === 0) return;
      void deleteThreadsWithoutConfirmation(threads).then((result) => {
        if (result._tag !== "Success") {
          toastManager.add({
            type: "error",
            title:
              threads.length === 1
                ? "Could not delete conversation"
                : "Could not delete conversations",
          });
          return;
        }
        if (result.value !== null) {
          useThreadSelectionStore.getState().removeFromSelection([...result.value]);
        }
      });
    },
    [deleteThreadsWithoutConfirmation],
  );

  const handleThreadContextMenu = useCallback(
    (event: ReactMouseEvent, thread: EnvironmentThreadShell, section: SidebarThreadSection) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const presets = [
        {
          id: "one-hour",
          label: "For 1 hour",
          snoozedUntil: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        },
        {
          id: "tomorrow",
          label: "Until tomorrow",
          snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        },
      ] as const;
      const items = buildThreadContextMenuItems(section, presets);
      const position = { x: event.clientX, y: event.clientY };
      void api.contextMenu.show(items, position).then(async (action) => {
        if (action === null || action === "snooze") return;
        const runAction = async (): Promise<boolean> => {
          if (action.startsWith("snooze:")) {
            const preset = presets.find((candidate) => `snooze:${candidate.id}` === action);
            return preset
              ? (await snoozeThread(threadRef, preset.snoozedUntil))._tag === "Success"
              : true;
          }
          if (action === "settle") return (await settleThread(threadRef))._tag === "Success";
          if (action === "unsettle") return (await unsettleThread(threadRef))._tag === "Success";
          if (action === "unsnooze") return (await unsnoozeThread(threadRef))._tag === "Success";
          return section === "settled"
            ? (await deleteThreadsWithoutConfirmation([thread]))._tag === "Success"
            : (await confirmAndDeleteThread(thread))._tag === "Success";
        };
        if (!(await runAction())) {
          toastManager.add({ type: "error", title: "Thread action failed" });
        }
      });
    },
    [
      confirmAndDeleteThread,
      deleteThreadsWithoutConfirmation,
      settleThread,
      snoozeThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );

  const handleDraftContextMenu = useCallback(
    (event: ReactMouseEvent, draft: { readonly draftId: string }) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;
      const position = { x: event.clientX, y: event.clientY };
      void api.contextMenu
        .show([{ id: "discard", label: "Discard draft", destructive: true }], position)
        .then((action) => {
          if (action === "discard") discardDraft(draft.draftId);
        });
    },
    [discardDraft],
  );
  useEffect(() => {
    setHeaderWorktree({ group: activeWorktreeGroup, worktreeCount });
    return () => setHeaderWorktree({ group: null, worktreeCount: 0 });
  }, [activeWorktreeGroup, setHeaderWorktree, worktreeCount]);
  useEffect(() => {
    if (activeProjectKey !== null) {
      setProjectExpanded(activeProjectKey, true);
    }
  }, [activeProjectKey, route.routeDraftId, routeThreadKey, setProjectExpanded]);

  // Selecting a worktree means routing into it: the active worktree is derived
  // from the route, so navigation *is* the selection. The override is only for
  // a worktree with nothing to route to yet.
  const selectWorktree = (group: SidebarWorktreeGroup) => {
    const target = resolveWorktreeSelectionTarget({
      worktree: group,
      openKeys: new Set(openConversationTabKeys),
    });
    if (target._tag === "thread") {
      setActiveWorktreeOverrideKey(null);
      navigateToThread(target.threadRef);
      return;
    }
    if (target._tag === "draft") {
      setActiveWorktreeOverrideKey(null);
      navigateToDraft(target.draftId);
      return;
    }
    if (target._tag === "new-thread") {
      setActiveWorktreeOverrideKey(group.key);
      createThreadInWorktree(group);
      return;
    }
    setActiveWorktreeOverrideKey(group.key);
  };

  const renderWorktreeCards = (groups: readonly SidebarWorktreeGroup[]) => (
    <SortableWorktreeCardList
      groups={groups}
      activeWorktreeKey={activeWorktreeKey}
      worktreeConversationExpandedByKey={worktreeConversationExpandedByKey}
      removingWorktreeKey={removingWorktreeKey}
      onSelect={selectWorktree}
      onWorktreeConversationExpandedChange={setWorktreeConversationExpanded}
      onDeleteWorktree={attemptDeleteWorktree}
      onContextMenu={(event, target) => {
        const location = resolveSidebarWorktreeConversationLocation(target);
        if (location === null) return;
        handleLocationContextMenu(event, {
          projectRef: scopeProjectRef(target.environmentId, target.projectId),
          location,
        });
      }}
      onReorder={reorderWorktree}
      threadsByWorktreeKey={threadsByWorktreeKey}
      descendantsByRoot={threadFamilies.descendantsByRoot}
      threadSectionByKey={threadSectionByKey}
      isMobile={isMobile}
      selectedThreadKey={routeThreadKey}
      selectedDraftId={route.routeDraftId}
      onSelectThread={handleThreadClick}
      onSelectDraft={(draft) => navigateToDraft(draft.draftId)}
      onThreadContextMenu={handleThreadContextMenu}
      onToggleThreadSettled={handleToggleThreadSettled}
      onDraftContextMenu={handleDraftContextMenu}
    />
  );

  // Keep project actions anchored to their keyboard-accessible trigger.
  const renderProjectActionsButton = (project: SidebarProjectSnapshot) => (
    <PopoverTrigger
      handle={projectSettingsPopoverHandle}
      payload={project}
      render={
        <button
          type="button"
          aria-label={`Project actions for ${project.displayName}`}
          title={`Project actions for ${project.displayName}`}
          onClickCapture={() => setProjectActionsTarget(project)}
          onClick={(event) => event.stopPropagation()}
          className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-row-hover hover:text-foreground active:scale-[0.96] data-popup-open:bg-sidebar-row-hover data-popup-open:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"
        />
      }
    >
      <EllipsisIcon aria-hidden className="size-3.5" />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,2.75rem)] -translate-1/2 pointer-fine:hidden"
      />
    </PopoverTrigger>
  );

  return (
    <>
      <SidebarChromeHeader
        isElectron={isElectron}
        trailing={
          <>
            <CommandDialogTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  type="button"
                  aria-label="Search threads and commands"
                  className="size-7 rounded-md focus-visible:ring-offset-2"
                  data-testid="command-palette-trigger"
                />
              }
            >
              <SearchIcon />
              {commandPaletteShortcutLabel ? (
                <span className="sr-only">{commandPaletteShortcutLabel}</span>
              ) : null}
            </CommandDialogTrigger>
            <HeaderTabScopeQuickAction />
          </>
        }
      />
      <FlowsSurfaceScope active={isBoardSurface} projects={scopedFlowProjects}>
        <SidebarContent
          className="@container/sidebar-conversations gap-0"
          fixedHeader={
            <div className="px-2 pb-2 pt-2">
              <SidebarGroup className="gap-0.5 p-0">
                <SidebarMenuButton
                  type="button"
                  onClick={handleNewThreadClick}
                  disabled={projects.length === 0}
                  aria-label="New thread"
                  className="h-8 gap-1.5 rounded-md px-1 text-[13px] font-medium leading-5 text-sidebar-foreground/80 [&_svg]:stroke-[1.5]"
                >
                  <SquarePenIcon />
                  <span className="flex-1">New thread</span>
                  {newThreadShortcutLabel ? (
                    <Kbd className="h-4 rounded-sm bg-sidebar-control-surface px-1.5 text-[11px] font-normal text-sidebar-muted-foreground ring-1 ring-sidebar-border">
                      {newThreadShortcutLabel}
                    </Kbd>
                  ) : null}
                </SidebarMenuButton>
                <SidebarSurfaceSwitcher
                  orientation="rows"
                  scopedProjectRef={boardProjectRef}
                  onFlowsIntent={loadSidebarBoardPanel}
                />
              </SidebarGroup>
              <div className="h-3" />
              {/* The project filter heads both surfaces. Threads narrow their
                list with it; Flows narrow which projects' flows the picker
                below offers, so the two surfaces answer to one scope. */}
              {isBoardSurface || projectGroups.length > 0 ? (
                <>
                  <div className="mt-1 flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <SidebarProjectScopeChips
                        ariaLabel={isBoardSurface ? "Filter flows by project" : undefined}
                        projectGroups={projectGroups}
                        scopedProjectGroups={scopedProjectGroups}
                        selectedProjectKeys={[...projectScopeSelection]}
                        onSelectionChange={setProjectScope}
                        onProjectContextMenu={(event, project) => {
                          handleLocationContextMenu(event, {
                            projectRef: scopeProjectRef(project.environmentId, project.id),
                          });
                        }}
                      />
                    </div>
                    {scopedProjectGroup ? (
                      <>
                        {renderProjectActionsButton(scopedProjectGroup)}
                        {/* Worktrees are thread work; Flows start theirs from a
                          card, so the button stays on Threads. */}
                        {isBoardSurface ? null : (
                          <ProjectNewWorktreeButton
                            projectRef={scopeProjectRef(
                              scopedProjectGroup.environmentId,
                              scopedProjectGroup.id,
                            )}
                            projectName={scopedProjectGroup.displayName}
                          />
                        )}
                      </>
                    ) : null}
                    <NewProjectButton onClick={openAddProjectCommandPalette} />
                  </div>
                  {isBoardSurface ? (
                    <div className="mt-1 flex items-center gap-1">
                      <SidebarFlowScopeRow />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          }
        >
          {isBoardSurface ? (
            <Suspense fallback={null}>
              <SidebarBoardPanel />
            </Suspense>
          ) : (
            <SidebarGroup data-sidebar-thread-list className="px-2 pb-1 pt-0">
              <TooltipProvider
                key="sidebar-thread-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                {conversationGrouping === "status" ? (
                  <SidebarConversationGroups
                    grouping="status"
                    threads={statusThreads}
                    drafts={statusDrafts}
                    descendantsByRoot={threadFamilies.descendantsByRoot}
                    threadSectionByKey={threadSectionByKey}
                    isMobile={isMobile}
                    selectedThreadKey={routeThreadKey}
                    selectedDraftId={route.routeDraftId}
                    onSelectThread={handleThreadClick}
                    onThreadContextMenu={handleThreadContextMenu}
                    onToggleThreadSettled={handleToggleThreadSettled}
                    onSelectDraft={(draft) => navigateToDraft(draft.draftId)}
                    onDraftContextMenu={handleDraftContextMenu}
                  />
                ) : (
                  <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-1">
                    {worktreeCardGroups.map((cardGroup) => {
                      const { project } = cardGroup;
                      const conversations =
                        conversationGrouping === "project" ? (
                          <li className="list-none">
                            <SidebarConversationGroups
                              grouping="project"
                              threads={cardGroup.worktrees
                                .flatMap((worktree) => threadsByWorktreeKey.get(worktree.key) ?? [])
                                .filter((thread) => !isSettledThread(thread))
                                .toSorted(
                                  (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
                                )}
                              drafts={cardGroup.worktrees.flatMap((worktree) => worktree.drafts)}
                              descendantsByRoot={threadFamilies.descendantsByRoot}
                              threadSectionByKey={threadSectionByKey}
                              isMobile={isMobile}
                              selectedThreadKey={routeThreadKey}
                              selectedDraftId={route.routeDraftId}
                              onSelectThread={handleThreadClick}
                              onThreadContextMenu={handleThreadContextMenu}
                              onToggleThreadSettled={handleToggleThreadSettled}
                              onSelectDraft={(draft) => navigateToDraft(draft.draftId)}
                              onDraftContextMenu={handleDraftContextMenu}
                            />
                          </li>
                        ) : (
                          renderWorktreeCards(cardGroup.worktrees)
                        );
                      if (project === null) {
                        return (
                          <Fragment key={`worktree-folder:${cardGroup.key}`}>
                            {conversations}
                          </Fragment>
                        );
                      }
                      const projectRef = scopeProjectRef(project.environmentId, project.id);
                      const expanded = resolveProjectExpanded(projectExpandedById, [
                        project.projectKey,
                      ]);
                      const projectState =
                        repositoryGroups.find(
                          (repository) => repository.project.projectKey === project.projectKey,
                        )?.state ?? "idle";
                      return (
                        <WorktreeProjectFolder
                          key={`worktree-folder:${cardGroup.key}`}
                          displayName={project.displayName}
                          environmentId={project.environmentId}
                          workspaceRoot={project.workspaceRoot}
                          projectKey={project.projectKey}
                          worktreeCount={cardGroup.worktrees.length}
                          state={projectState === "settled" ? "idle" : projectState}
                          expanded={expanded}
                          onToggle={() => setProjectExpanded(project.projectKey, !expanded)}
                          onContextMenu={(event) =>
                            handleLocationContextMenu(event, { projectRef })
                          }
                          actions={
                            <>
                              {renderProjectActionsButton(project)}
                              <ProjectNewWorktreeButton
                                projectRef={projectRef}
                                projectName={project.displayName}
                              />
                            </>
                          }
                        >
                          {conversations}
                        </WorktreeProjectFolder>
                      );
                    })}
                  </ul>
                )}
              </TooltipProvider>
              {showEmptyState ? (
                <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-[13px] text-muted-foreground/60">
                  {projects.length === 0 ? (
                    <>
                      <span>No projects yet</span>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={openAddProjectCommandPalette}
                        className="border-sidebar-border bg-transparent text-[13px] text-sidebar-muted-foreground shadow-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                      >
                        <PlusIcon className="size-3" />
                        Add project
                      </Button>
                    </>
                  ) : scopedProjectGroup ? (
                    `No threads in ${scopedProjectGroup.displayName} yet`
                  ) : (
                    "No threads yet"
                  )}
                </div>
              ) : null}
              {/* Status grouping already collects settled work into its own
                section at the foot of the list, so the shelf would only say
                the same thing twice there. */}
              {conversationGrouping === "status" ? null : (
                <SidebarSettledSection
                  threads={settledThreads}
                  projectCwdByKey={projectCwdByKey}
                  projectDisplayNameByKey={projectDisplayNameByKey}
                  selectedThreadKey={routeThreadKey}
                  onSelectThread={handleThreadClick}
                  onThreadContextMenu={(event, thread) =>
                    handleThreadContextMenu(event, thread, "settled")
                  }
                  onRestoreThread={(thread) => handleToggleThreadSettled(thread, "settled")}
                  onDeleteThreads={handleDeleteThreads}
                />
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
      </FlowsSurfaceScope>
      <ProjectSettingsPopover
        handle={projectSettingsPopoverHandle}
        target={projectActionsTarget}
        onClose={() => setProjectActionsTarget(null)}
        projectGroupingMode={projectGroupingSettings.sidebarProjectGroupingMode}
        projectGroupingOverrides={projectGroupingSettings.sidebarProjectGroupingOverrides}
        copyProjectPath={copyProjectPath}
        renameProjectMember={renameProjectMember}
        updateProjectMemberIcon={updateProjectMemberIcon}
        updateProjectMemberOriginBranch={updateProjectMemberOriginBranch}
        updateProjectGroupingPreference={updateProjectGroupingPreference}
        onRemoveMembers={handleRemoveProjectMembers}
      />
      <SidebarChromeFooter />
    </>
  );
}
