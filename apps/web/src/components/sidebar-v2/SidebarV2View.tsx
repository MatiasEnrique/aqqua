import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { canSettle, threadWokeAt } from "@aqqua/client-runtime/state/thread-settled";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";
import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import { resolveProjectExpanded } from "../../uiStateStore";
import { SidebarSurfaceSwitcher } from "../board/SidebarSurfaceSwitcher";
import { ProjectFavicon } from "../ProjectFavicon";
import { snoozeWakeLabel } from "../Sidebar.snooze";
import {
  resolveSidebarWorktreeConversationLocation,
  resolveSidebarWorktreeDeleteAction,
  resolveSidebarWorktreeSettleAction,
  type SidebarWorktreeGroup,
  sidebarWorktreeHasVisibleChildren,
} from "../Sidebar.worktreeGroups";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { CommandDialogTrigger } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { SETTLED_TAIL_PAGE_COUNT } from "./constants";
import type { SidebarV2ViewModel } from "./models";
import { ProjectNewWorktreeButton } from "./ProjectNewWorktreeButton";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { SidebarConversationRow } from "./SidebarConversationRow";
import { SidebarDraftRow } from "./SidebarDraftRow";
import {
  SidebarProjectStateIndicator,
  SidebarWorktreeStateCounters,
} from "./SidebarStatusPresentations";

const SidebarBoardPanel = lazy(() =>
  import("../board/SidebarBoardPanel").then((module) => ({
    default: module.SidebarBoardPanel,
  })),
);

export function SidebarV2View(props: { model: SidebarV2ViewModel }) {
  const {
    route,
    projects: projectsSection,
    threads: threadsSection,
    worktrees: worktreesSection,
    threadLifecycle,
    worktreeLifecycle,
    projectActions,
    navigation,
  } = props.model;

  const { routeThreadKey, routeDraftId } = route;

  const {
    projects,
    projectGroups,
    projectScopeKey,
    setProjectScopeKey,
    scopedProjectGroup,
    scopedProjectState,
    projectExpandedById,
    setProjectExpanded,
    projectScopeMenuOpen,
    setProjectScopeMenuOpen,
    projectActionsTarget,
    setProjectActionsTarget,
    projectGroupingSettings,
    projectCwdByKey,
    projectDisplayNameByKey,
    environmentLabelById,
  } = projectsSection;

  const {
    activeThreads,
    snoozedThreads,
    settledThreads,
    threadByKey,
    snoozeNow,
    visibleActiveThreads,
    visibleSnoozedThreads,
    renderedSettledThreads,
    selectedSettledThreads,
    activeTreeMetaByKey,
    expandedThreadKeys,
    reserveSubAgentGutter,
    draftRows,
    groupedDraftRows,
    jumpLabelByKey,
    showJumpHints,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    settledShelfExpanded,
    toggleSettledShelf,
    hiddenSettledCount,
    showMoreSettled,
    sidebarThreadGroupingMode,
    handleChangeRequestState,
    providerEntryByInstanceId,
    serverConfigs,
  } = threadsSection;

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
    repositoryHierarchyVisible,
    worktreeExpandedByKey,
    setWorktreeExpanded,
    removingWorktreeKey,
    settlingWorktreeKey,
  } = worktreesSection;

  const {
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
  } = threadLifecycle;

  const { attemptSettleWorktree, attemptDeleteWorktree, handleLocationContextMenu } =
    worktreeLifecycle;

  const {
    handleRemoveProjectMembers,
    renameProjectMember,
    updateProjectGroupingPreference,
    handleProjectActions,
    copyProjectPath,
    openAddProjectCommandPalette,
  } = projectActions;

  const {
    navigateToThread,
    navigateToDraft,
    discardDraft,
    handleNewThreadClick,
    attachListAutoAnimateRef,
    commandPaletteShortcutLabel,
    newThreadShortcutLabel,
  } = navigation;

  const pathname = useLocation({ select: (location) => location.pathname });
  const isBoardSurface = pathname.startsWith("/board/");
  const boardNavigate = useNavigate();

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="@container/sidebar-conversations gap-0"
        fixedHeader={
          <SidebarGroup className="gap-1 p-2">
            <SidebarSurfaceSwitcher scopedProjectRef={boardProjectRef} />
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <CommandDialogTrigger
                  render={
                    <SidebarMenuButton
                      type="button"
                      aria-label="Search threads and commands"
                      className="focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                      data-testid="command-palette-trigger"
                    />
                  }
                >
                  <SearchIcon />
                  <div className="flex-1 truncate text-left">Search</div>
                  {commandPaletteShortcutLabel ? (
                    <Kbd className="mr-px h-4 min-w-0 rounded-sm bg-sidebar-control-surface px-1.5 text-[10px] text-sidebar-muted-foreground ring-1 ring-sidebar-border">
                      {commandPaletteShortcutLabel}
                    </Kbd>
                  ) : null}
                </CommandDialogTrigger>
              </div>
              <div className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={handleNewThreadClick}
                        disabled={projects.length === 0}
                        aria-label="New thread"
                      />
                    }
                  >
                    <SquarePenIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {newThreadShortcutLabel
                      ? `New thread (${newThreadShortcutLabel})`
                      : "New thread"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            {projectGroups.length > 0 ? (
              <div className="flex items-center gap-1">
                <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        aria-label="Filter threads by project"
                        className="min-w-0 flex-1 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onContextMenu={(event) => {
                          if (scopedProjectGroup === null) return;
                          handleLocationContextMenu(event, {
                            projectRef: scopeProjectRef(
                              scopedProjectGroup.environmentId,
                              scopedProjectGroup.id,
                            ),
                          });
                        }}
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <ProjectFavicon
                        environmentId={scopedProjectGroup.environmentId}
                        cwd={scopedProjectGroup.workspaceRoot}
                        className="size-4 shrink-0"
                      />
                    ) : (
                      <FolderIcon className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {scopedProjectGroup?.displayName ?? "All projects"}
                    </span>
                    {scopedProjectState ? (
                      <SidebarProjectStateIndicator state={scopedProjectState} />
                    ) : null}
                    <ChevronDownIcon className="-mr-px size-4 shrink-0" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="w-(--anchor-width)">
                    <MenuRadioGroup
                      value={projectScopeKey ?? "all"}
                      onValueChange={(value) => {
                        setProjectScopeKey(value === "all" ? null : (value as string));
                        // In board mode the scope menu doubles as the board's
                        // project switcher — the surface is per-project, so
                        // picking a project has to move the route with it.
                        if (!isBoardSurface || value === "all") return;
                        const group = projectGroups.find((project) => project.projectKey === value);
                        if (group === undefined) return;
                        void boardNavigate({
                          to: "/board/$environmentId/$projectId",
                          params: {
                            environmentId: group.environmentId,
                            projectId: group.id,
                          },
                        });
                      }}
                    >
                      <MenuRadioItem
                        value="all"
                        closeOnClick
                        className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                      >
                        <FolderIcon className="size-4 shrink-0" />
                        <span className="min-w-0 truncate text-sm">All projects</span>
                      </MenuRadioItem>
                      {projectGroups.map((project) => {
                        const scopeKey = project.projectKey;
                        return (
                          <MenuRadioItem
                            key={scopeKey}
                            value={scopeKey}
                            closeOnClick
                            className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                          >
                            <ProjectFavicon
                              environmentId={project.environmentId}
                              cwd={project.workspaceRoot}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                            <button
                              type="button"
                              aria-label={`Project actions for ${project.displayName}`}
                              title={`Project actions for ${project.displayName}`}
                              className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                void handleProjectActions(event, project);
                              }}
                            >
                              <EllipsisIcon className="size-3.5" />
                            </button>
                          </MenuRadioItem>
                        );
                      })}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
                {scopedProjectGroup ? (
                  <ProjectNewWorktreeButton
                    projectRef={scopeProjectRef(
                      scopedProjectGroup.environmentId,
                      scopedProjectGroup.id,
                    )}
                    projectName={scopedProjectGroup.displayName}
                  />
                ) : null}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
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
              </div>
            ) : null}
          </SidebarGroup>
        }
      >
        {isBoardSurface ? (
          <Suspense fallback={null}>
            <SidebarBoardPanel
              scopedProjectRef={
                scopedProjectGroup
                  ? scopeProjectRef(scopedProjectGroup.environmentId, scopedProjectGroup.id)
                  : null
              }
              projects={projectGroups}
            />
          </Suspense>
        ) : (
          <SidebarGroup className="px-2 pb-1 pt-0">
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
                {(() => {
                  const renderThreadRow = (
                    thread: EnvironmentThreadShell,
                    section: "active" | "snoozed" | "settled",
                  ) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    const treeMeta = activeTreeMetaByKey.get(threadKey);
                    const depth = section === "active" ? (treeMeta?.depth ?? 0) : 0;
                    // Settled, snoozed and sub-agent rows are the ONLY things
                    // that collapse a row: every other thread is a full card.
                    // Density comes from users (or the auto rules) actually
                    // parking work, and from delegation nesting under its
                    // orchestrator — not from the sidebar second-guessing what
                    // still matters.
                    const rowVariant = section !== "active" ? "slim" : depth > 0 ? "sub" : "card";
                    return (
                      <SidebarConversationRow
                        // Keyed per variant on purpose: when a thread settles,
                        // the card fades out in place and the slim row fades
                        // in at its settled position instead of one element
                        // FLIP-sliding through every row in between (rows here
                        // are translucent, so a crossing row reads as text
                        // painted over text).
                        key={`${threadKey}:${rowVariant}`}
                        thread={thread}
                        variant={rowVariant}
                        depth={depth}
                        childCount={section === "active" ? (treeMeta?.childCount ?? 0) : 0}
                        reserveExpandGutter={reserveSubAgentGutter}
                        isExpanded={expandedThreadKeys.has(threadKey)}
                        onToggleExpanded={toggleThreadExpanded}
                        // Snoozed rows wake; settled rows un-settle (explicit
                        // settles clear the override, auto-settled rows get
                        // pinned active); cards settle.
                        variantAction={
                          section === "snoozed"
                            ? "unsnooze"
                            : section === "settled"
                              ? "unsettle"
                              : "settle"
                        }
                        settlementSupported={
                          serverConfigs.get(thread.environmentId)?.environment.capabilities
                            .threadSettlement === true
                        }
                        snoozeSupported={
                          serverConfigs.get(thread.environmentId)?.environment.capabilities
                            .threadSnooze === true
                        }
                        snoozeWakeLabelText={
                          section === "snoozed" && thread.snoozedUntil != null
                            ? snoozeWakeLabel(thread.snoozedUntil, new Date())
                            : null
                        }
                        // All sections: a woken thread can classify straight
                        // into the settled tail (PR merged while snoozed), and
                        // the wake signal must survive the trip. Still-snoozed
                        // rows resolve to null on their own.
                        wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                        isActive={routeThreadKey === threadKey}
                        jumpLabel={showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null}
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        projectCwd={
                          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectTitle={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        showProjectIdentity={
                          section !== "settled" && sidebarThreadGroupingMode !== "worktree"
                        }
                        providerEntryByInstanceId={providerEntryByInstanceId}
                        onThreadClick={handleThreadClick}
                        onThreadActivate={navigateToThread}
                        onStartRename={startThreadRename}
                        onRenameTitleChange={setRenamingTitle}
                        onCommitRename={commitThreadRename}
                        onCancelRename={cancelThreadRename}
                        isRenaming={renamingThreadKey === threadKey}
                        renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                        onContextMenu={handleThreadContextMenu}
                        onSettle={attemptSettle}
                        onUnsettle={attemptUnsettle}
                        onSnooze={attemptSnooze}
                        onUnsnooze={attemptUnsnooze}
                        onDelete={attemptDeleteThread}
                        onChangeRequestState={handleChangeRequestState}
                      />
                    );
                  };
                  const renderDraftRow = (row: (typeof groupedDraftRows)[number]) => {
                    const projectKey = `${row.environmentId}:${row.projectId}`;
                    return (
                      <SidebarDraftRow
                        key={`draft:${row.draftId}`}
                        draftId={row.draftId}
                        title={row.title}
                        environmentId={row.environmentId}
                        projectCwd={projectCwdByKey.get(projectKey) ?? null}
                        projectTitle={projectDisplayNameByKey.get(projectKey) ?? null}
                        showProjectIdentity={sidebarThreadGroupingMode !== "worktree"}
                        isActive={routeDraftId === row.draftId}
                        onClick={navigateToDraft}
                        onDiscard={discardDraft}
                      />
                    );
                  };
                  const items: ReactNode[] = [];
                  if (sidebarThreadGroupingMode === "worktree") {
                    const renderWorktreeGroup = (group: SidebarWorktreeGroup): ReactNode[] => {
                      const groupItems: ReactNode[] = [];
                      const settlementSupported =
                        serverConfigs.get(group.environmentId)?.environment.capabilities
                          .threadSettlement === true;
                      const worktreeSettlementBlocked = group.unsettled.some(
                        (thread) => !canSettle(thread, { now: new Date().toISOString() }),
                      );
                      const settleAction = resolveSidebarWorktreeSettleAction({
                        conversationCount: group.unsettled.length,
                        settlementSupported,
                        hasBlockedConversation: worktreeSettlementBlocked,
                        isSettling: settlingWorktreeKey !== null,
                        isRemoving: removingWorktreeKey !== null,
                      });
                      const deleteAction = resolveSidebarWorktreeDeleteAction({
                        isProjectCheckout: group.isProjectCheckout,
                        worktreeCreated: group.workspaceRoot !== null && group.projectRoot !== null,
                        isRemoving: removingWorktreeKey !== null,
                        isSettling: settlingWorktreeKey !== null,
                      });
                      const hasVisibleChildren = sidebarWorktreeHasVisibleChildren(group);
                      // A routed descendant does not override the user's collapse:
                      // the conversation remains open in chat while its sidebar
                      // container is allowed to stay closed.
                      const expanded =
                        hasVisibleChildren && worktreeExpandedByKey[group.key] !== false;
                      groupItems.push(
                        <div
                          key={`${group.key}:header`}
                          data-thread-selection-safe
                          className="mb-1 mt-1 flex items-center gap-1 rounded-lg"
                        >
                          <button
                            type="button"
                            aria-expanded={hasVisibleChildren ? expanded : undefined}
                            onClick={
                              hasVisibleChildren
                                ? () => setWorktreeExpanded(group.key, !expanded)
                                : undefined
                            }
                            onContextMenu={(event) => {
                              const location = resolveSidebarWorktreeConversationLocation(group);
                              if (location === null) return;
                              handleLocationContextMenu(event, {
                                projectRef: scopeProjectRef(group.environmentId, group.projectId),
                                location,
                              });
                            }}
                            className={cn(
                              "flex min-h-14 min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left text-sidebar-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover motion-reduce:transform-none",
                              hasVisibleChildren
                                ? "cursor-pointer active:scale-[0.96]"
                                : "cursor-default",
                            )}
                          >
                            {hasVisibleChildren ? (
                              expanded ? (
                                <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0" />
                              ) : (
                                <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0" />
                              )
                            ) : (
                              <span aria-hidden className="size-3.5 shrink-0" />
                            )}
                            <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {group.label}
                              </span>
                              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/65">
                                <SidebarWorktreeStateCounters counts={group.stateCounts} />
                                <span aria-hidden>·</span>
                                <span className="truncate">
                                  {group.isProjectCheckout ? "Current checkout" : "Worktree"}
                                </span>
                              </span>
                            </span>
                          </button>
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label={`Worktree actions for ${group.label}`}
                                  className="mr-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-foreground active:scale-[0.96] motion-reduce:transform-none"
                                />
                              }
                            >
                              <EllipsisIcon aria-hidden className="size-4" />
                            </PopoverTrigger>
                            <PopoverPopup
                              side="right"
                              align="start"
                              className="w-56"
                              viewportClassName="p-1"
                            >
                              <div className="grid gap-1">
                                <div>
                                  <PopoverClose
                                    render={
                                      <Button
                                        size="lg"
                                        variant="outline"
                                        disabled={!settleAction.enabled}
                                        title={settleAction.disabledReason ?? undefined}
                                        onClick={() => attemptSettleWorktree(group)}
                                        className="h-10 w-full justify-start px-3"
                                      />
                                    }
                                  >
                                    <CheckCheckIcon aria-hidden />
                                    Settle all
                                  </PopoverClose>
                                </div>
                                <div>
                                  <PopoverClose
                                    render={
                                      <Button
                                        size="lg"
                                        variant="destructive-outline"
                                        disabled={!deleteAction.enabled}
                                        title={deleteAction.disabledReason ?? undefined}
                                        onClick={() => attemptDeleteWorktree(group)}
                                        className="h-10 w-full justify-start px-3"
                                      />
                                    }
                                  >
                                    <Trash2Icon aria-hidden />
                                    Delete worktree
                                  </PopoverClose>
                                </div>
                              </div>
                            </PopoverPopup>
                          </Popover>
                        </div>,
                      );
                      if (!expanded) {
                        return [
                          <li
                            key={`worktree:${group.key}`}
                            data-thread-selection-safe
                            className="list-none"
                          >
                            {groupItems}
                          </li>,
                        ];
                      }
                      for (const draft of group.drafts) {
                        groupItems.push(renderDraftRow(draft));
                      }
                      for (const thread of group.active) {
                        groupItems.push(renderThreadRow(thread, "active"));
                      }
                      const visibleGroupSnoozed = snoozedShelfExpanded ? group.snoozed : [];
                      if (group.snoozed.length > 0) {
                        groupItems.push(
                          <li
                            key={`${group.key}:snoozed`}
                            data-thread-selection-safe
                            className="list-none"
                          >
                            <button
                              type="button"
                              onClick={toggleSnoozedShelf}
                              aria-expanded={snoozedShelfExpanded}
                              className="mb-1 mt-2 flex w-full items-center gap-2 px-2.5 text-left"
                            >
                              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                                {snoozedShelfExpanded
                                  ? "Snoozed"
                                  : `Snoozed (${group.snoozed.length})`}
                              </span>
                              <span className="h-px flex-1 bg-blue-500/20" />
                            </button>
                          </li>,
                        );
                      }
                      for (const thread of visibleGroupSnoozed) {
                        groupItems.push(renderThreadRow(thread, "snoozed"));
                      }
                      return [
                        <li
                          key={`worktree:${group.key}`}
                          data-thread-selection-safe
                          className="list-none"
                        >
                          {groupItems[0]}
                          <ul className="ml-2 border-l border-sidebar-border/60 pl-1.5">
                            {groupItems.slice(1)}
                          </ul>
                        </li>,
                      ];
                    };

                    if (repositoryHierarchyVisible) {
                      for (const repository of repositoryGroups) {
                        const { project } = repository;
                        const expanded = resolveProjectExpanded(projectExpandedById, [
                          project.projectKey,
                        ]);
                        items.push(
                          <li
                            key={`repository:${project.projectKey}`}
                            data-thread-selection-safe
                            className="list-none"
                          >
                            {/* biome-ignore lint/a11y/noStaticElementInteractions: the context menu belongs to the composite repository row. */}
                            <div
                              onContextMenu={(event) =>
                                handleLocationContextMenu(event, {
                                  projectRef: scopeProjectRef(project.environmentId, project.id),
                                })
                              }
                              className="mt-2 flex h-10 w-full min-w-0 items-center rounded-lg text-sidebar-foreground transition-[background-color] hover:bg-sidebar-row-hover"
                            >
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-label={`${expanded ? "Collapse" : "Expand"} repository ${project.displayName}`}
                                onClick={() => setProjectExpanded(project.projectKey, !expanded)}
                                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold transition-[color,scale] active:scale-[0.98] motion-reduce:transform-none"
                              >
                                {expanded ? (
                                  <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
                                ) : (
                                  <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
                                )}
                                <ProjectFavicon
                                  environmentId={project.environmentId}
                                  cwd={project.workspaceRoot}
                                  className="size-4 shrink-0"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {project.displayName}
                                </span>
                                <SidebarProjectStateIndicator state={repository.state} />
                                <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-normal tabular-nums text-muted-foreground/60">
                                  <span>
                                    {repository.worktrees.length} branch
                                    {repository.worktrees.length === 1 ? "" : "es"}
                                  </span>
                                  {!expanded ? (
                                    <>
                                      <span aria-hidden>·</span>
                                      <MessageSquareIcon aria-hidden className="size-3" />
                                      <span>{repository.conversationCount}</span>
                                    </>
                                  ) : null}
                                </span>
                              </button>
                              <ProjectNewWorktreeButton
                                projectRef={scopeProjectRef(project.environmentId, project.id)}
                                projectName={project.displayName}
                                className="mr-1"
                              />
                            </div>
                            {expanded ? (
                              <ul className="ml-2 border-l border-sidebar-border/60 pl-1.5">
                                {repository.worktrees.flatMap(renderWorktreeGroup)}
                              </ul>
                            ) : null}
                          </li>,
                        );
                      }
                    } else {
                      for (const group of worktreeGroups) {
                        items.push(...renderWorktreeGroup(group));
                      }
                    }
                  } else {
                    items.push(
                      ...draftRows.map(renderDraftRow),
                      ...visibleActiveThreads.map((thread) => renderThreadRow(thread, "active")),
                    );
                    // Snoozed shelf: between the inbox and Settled — out of the
                    // way, never gone. The header always renders while anything
                    // is snoozed (the count is the whole footprint when
                    // collapsed); rows only when expanded. Vanishes entirely at
                    // count 0.
                    if (snoozedThreads.length > 0) {
                      items.push(
                        <li
                          key="snoozed-shelf-header"
                          data-thread-selection-safe
                          className="list-none"
                        >
                          <button
                            type="button"
                            onClick={toggleSnoozedShelf}
                            aria-expanded={snoozedShelfExpanded}
                            data-testid="sidebar-v2-snoozed-shelf-toggle"
                            className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                          >
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                              {snoozedShelfExpanded
                                ? "Snoozed"
                                : `Snoozed (${snoozedThreads.length})`}
                            </span>
                            <span className="h-px flex-1 bg-blue-500/20 dark:bg-blue-400/15" />
                            <ChevronDownIcon
                              aria-hidden
                              className={cn(
                                "size-3 text-blue-600 transition-transform dark:text-blue-400",
                                snoozedShelfExpanded && "rotate-180",
                              )}
                            />
                          </button>
                        </li>,
                      );
                      for (const thread of visibleSnoozedThreads) {
                        items.push(renderThreadRow(thread, "snoozed"));
                      }
                    }
                  }
                  if (settledThreads.length > 0) {
                    items.push(
                      <li
                        key="settled-shelf-header"
                        data-thread-selection-safe
                        className="list-none"
                      >
                        <div className="mb-1 mt-3 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={toggleSettledShelf}
                            aria-expanded={settledShelfExpanded}
                            data-testid="sidebar-v2-settled-shelf-toggle"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 text-left"
                          >
                            <span className="text-xs font-medium text-muted-foreground/50">
                              {settledShelfExpanded
                                ? "Settled"
                                : `Settled (${settledThreads.length})`}
                            </span>
                            <span className="h-px flex-1 bg-sidebar-border/60" />
                            <ChevronDownIcon
                              aria-hidden
                              className={cn(
                                "size-3 text-muted-foreground/50 transition-transform",
                                settledShelfExpanded && "rotate-180",
                              )}
                            />
                          </button>
                          {selectedSettledThreads.length > 0 ? (
                            <button
                              type="button"
                              disabled={deletingSettledSelection}
                              onClick={deleteSelectedSettledThreads}
                              className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-50"
                              aria-label={`Delete ${selectedSettledThreads.length} selected settled conversation${selectedSettledThreads.length === 1 ? "" : "s"}`}
                            >
                              <Trash2Icon aria-hidden className="size-3" />
                              <span className="tabular-nums">
                                Delete {selectedSettledThreads.length}
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </li>,
                    );
                  }
                  for (const thread of renderedSettledThreads) {
                    items.push(renderThreadRow(thread, "settled"));
                  }
                  return items;
                })()}
                {settledShelfExpanded && hiddenSettledCount > 0 ? (
                  <li className="list-none">
                    <button
                      type="button"
                      onClick={showMoreSettled}
                      className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    >
                      <PlusIcon aria-hidden className="size-4 shrink-0" />
                      Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                    </button>
                  </li>
                ) : null}
              </ul>
            </TooltipProvider>
            {activeThreads.length + snoozedThreads.length + settledThreads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
                {projects.length === 0 ? (
                  <>
                    <span>No projects yet</span>
                    <button
                      type="button"
                      onClick={openAddProjectCommandPalette}
                      className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    >
                      <PlusIcon className="-mx-0.5 size-3" />
                      Add project
                    </button>
                  </>
                ) : scopedProjectGroup ? (
                  `No threads in ${scopedProjectGroup.displayName} yet`
                ) : (
                  "No threads yet"
                )}
              </div>
            ) : null}
          </SidebarGroup>
        )}
      </SidebarContent>
      <ProjectSettingsDialog
        target={projectActionsTarget}
        onClose={() => setProjectActionsTarget(null)}
        projectGroupingMode={projectGroupingSettings.sidebarProjectGroupingMode}
        projectGroupingOverrides={projectGroupingSettings.sidebarProjectGroupingOverrides}
        copyProjectPath={copyProjectPath}
        renameProjectMember={renameProjectMember}
        updateProjectGroupingPreference={updateProjectGroupingPreference}
        onRemoveMembers={handleRemoveProjectMembers}
      />
      <SidebarChromeFooter />
    </>
  );
}
