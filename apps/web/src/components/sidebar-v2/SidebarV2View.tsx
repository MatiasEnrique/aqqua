import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@aqqua/client-runtime/environment";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, lazy, type ReactNode, Suspense, useEffect } from "react";
import { cn } from "~/lib/utils";
import { isElectron } from "../../env";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { useWorktreeHeaderStore } from "../../worktreeHeaderStore";
import { SidebarSurfaceSwitcher } from "../board/SidebarSurfaceSwitcher";
import { resolveWorktreeFocusTarget } from "../chat/openConversationTabs";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  resolveSidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
  sidebarWorktreeHasVisibleChildren,
} from "../Sidebar.worktreeGroups";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { CommandDialogTrigger } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { SidebarProjectScopeChips } from "./SidebarProjectScopeChips";
import { WorktreeProjectFolder } from "./WorktreeProjectFolder";
import { buildWorktreeCardGroups } from "./worktreeCardGroups";
import { resolveProjectScopeAddition } from "./projectScopeSelection";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { SETTLED_TAIL_PAGE_COUNT } from "./constants";
import type { SidebarV2ViewModel } from "./models";
import { ProjectNewWorktreeButton } from "./ProjectNewWorktreeButton";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { SidebarProjectStateIndicator, SidebarStateCounters } from "./SidebarStatusPresentations";
import { useSidebarRowRenderers } from "./useSidebarRowRenderers";
import { WorktreeActionsPopover } from "./WorktreeActionsPopover";
import { WorktreeCard } from "./WorktreeCard";

const loadSidebarBoardPanel = () =>
  import("../board/SidebarBoardPanel").then((module) => ({
    default: module.SidebarBoardPanel,
  }));
const SidebarBoardPanel = lazy(loadSidebarBoardPanel);

/**
 * How the conversation list is presented.
 *
 * `list` is the original: worktree/repository group headers with every
 * conversation as its own card. `cards` collapses each worktree into a single
 * card and hands the conversation list to the chat header's tab strip.
 *
 * Both share this view because they share everything above the list — surface
 * switcher, search, project scope, footer. Only the list block differs.
 */
export type SidebarV2Presentation = "list" | "cards";

export function SidebarV2View(props: {
  model: SidebarV2ViewModel;
  presentation?: SidebarV2Presentation;
}) {
  const presentation = props.presentation ?? "list";
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

  const { routeThreadKey } = route;

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
  } = projectsSection;

  const {
    activeThreads,
    snoozedThreads,
    settledThreads,
    threadByKey,
    visibleActiveThreads,
    visibleSnoozedThreads,
    renderedSettledThreads,
    selectedSettledThreads,
    flowOwnedThreadKeys,
    draftRows,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    settledShelfExpanded,
    toggleSettledShelf,
    hiddenSettledCount,
    settledRootCount,
    showMoreSettled,
    sidebarThreadGroupingMode,
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
    activeWorktreeKey,
    activeWorktreeGroup,
    setActiveWorktreeOverrideKey,
    worktreeExpandedByKey,
    setWorktreeExpanded,
    removingWorktreeKey,
    settlingWorktreeKey,
  } = worktreesSection;

  const { deleteSelectedSettledThreads, deletingSettledSelection } = threadLifecycle;

  const { attemptSettleWorktree, attemptDeleteWorktree, handleLocationContextMenu } =
    worktreeLifecycle;

  const {
    handleRemoveProjectMembers,
    renameProjectMember,
    updateProjectMemberIcon,
    updateProjectGroupingPreference,
    handleProjectActions,
    copyProjectPath,
    openAddProjectCommandPalette,
  } = projectActions;

  const {
    navigateToThread,
    navigateToDraft,
    handleNewThreadClick,
    attachListAutoAnimateRef,
    commandPaletteShortcutLabel,
    newThreadShortcutLabel,
  } = navigation;

  const pathname = useLocation({ select: (location) => location.pathname });
  const isBoardSurface = pathname.startsWith("/board/");
  const boardNavigate = useNavigate();
  const { renderThreadRow, renderDraftRow } = useSidebarRowRenderers(props.model);
  const openConversationTabKeys = useUiStateStore((store) => store.openConversationTabKeys);

  // Publish the selection so the chat header's tab strip reads the same group
  // this list renders, rather than re-deriving the settled/snoozed partition.
  const setHeaderWorktree = useWorktreeHeaderStore((store) => store.setActiveWorktree);
  const worktreeCount = worktreeGroups.length;
  useEffect(() => {
    if (presentation !== "cards") return;
    setHeaderWorktree({ group: activeWorktreeGroup, worktreeCount });
    return () => setHeaderWorktree({ group: null, worktreeCount: 0 });
  }, [activeWorktreeGroup, presentation, setHeaderWorktree, worktreeCount]);

  // Selecting a worktree means routing into it: the active worktree is derived
  // from the route, so navigation *is* the selection. The override is only for
  // a worktree with nothing to route to yet.
  const selectWorktree = (group: SidebarWorktreeGroup) => {
    const target = resolveWorktreeFocusTarget({
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
    setActiveWorktreeOverrideKey(group.key);
  };

  // A tab-reachable way into project actions. The copy inside the project
  // combobox sits in a listbox, where arrow keys move between options and Tab
  // never lands on a nested control — so on its own it left the action
  // mouse-only.
  const renderProjectActionsButton = (project: SidebarProjectSnapshot) => (
    <button
      type="button"
      aria-label={`Project actions for ${project.displayName}`}
      title={`Project actions for ${project.displayName}`}
      onClick={(event) => {
        void handleProjectActions(event, project);
      }}
      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <EllipsisIcon className="size-3.5" />
    </button>
  );

  return (
    <>
      <SidebarChromeHeader
        isElectron={isElectron}
        trailing={
          <SidebarSurfaceSwitcher
            scopedProjectRef={boardProjectRef}
            onFlowsIntent={loadSidebarBoardPanel}
          />
        }
      />
      <SidebarContent
        className="@container/sidebar-conversations gap-0"
        fixedHeader={
          <SidebarGroup className="gap-1 p-2">
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
                <div className="min-w-0 flex-1">
                  <SidebarProjectScopeChips
                    projectGroups={projectGroups}
                    scopedProjectGroups={scopedProjectGroups}
                    onSelectionChange={(projectKeys) => {
                      // In board mode the scope filter doubles as the board's
                      // project switcher — the surface is per-project, so
                      // adding a project has to move the route with it.
                      // Removals leave the route alone: there is no single
                      // project left to point at.
                      const addedKey = resolveProjectScopeAddition(projectScopeSelection, [
                        ...projectKeys,
                      ]);
                      setProjectScope(projectKeys);
                      if (!isBoardSurface || addedKey === null) return;
                      const group = projectGroups.find(
                        (project) => project.projectKey === addedKey,
                      );
                      if (group === undefined) return;
                      void boardNavigate({
                        to: "/board/$environmentId/$projectId",
                        params: { environmentId: group.environmentId, projectId: group.id },
                      });
                    }}
                    onProjectActions={handleProjectActions}
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
                    <ProjectNewWorktreeButton
                      projectRef={scopeProjectRef(
                        scopedProjectGroup.environmentId,
                        scopedProjectGroup.id,
                      )}
                      projectName={scopedProjectGroup.displayName}
                    />
                  </>
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
              projects={scopedProjectGroups.length > 0 ? scopedProjectGroups : projectGroups}
            />
          </Suspense>
        ) : (
          // The scope chips are a control, not a heading for the list below:
          // the extra top pad keeps the multiselect from reading as the first
          // row of the project registry.
          <SidebarGroup className="px-2 pb-1 pt-2">
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              {/* Panels need air between them to read as separate objects; the
                  gap is cancelled again inside a family band so one
                  conversation and its sub-agents stay a single surface. */}
              <ul
                ref={attachListAutoAnimateRef}
                className={cn(
                  "flex flex-col",
                  // Cards are 32px lines in a registry, not panels: they read
                  // as one list at 4px and as scattered chips at 6px.
                  presentation === "cards" ? "gap-1" : "gap-1.5",
                )}
              >
                {(() => {
                  const items: ReactNode[] = [];
                  if (presentation === "cards") {
                    // Worktrees under their project, and nothing else.
                    // Conversations, the snoozed shelf and the settled tail are
                    // all reached from the header strip or the command palette
                    // in this mode, so the list stays a registry of checkouts.
                    const renderCard = (group: SidebarWorktreeGroup) => (
                      <WorktreeCard
                        key={`worktree-card:${group.key}`}
                        group={group}
                        isSelected={activeWorktreeKey === group.key}
                        removingWorktreeKey={removingWorktreeKey}
                        onSelect={selectWorktree}
                        onDeleteWorktree={attemptDeleteWorktree}
                        onContextMenu={(event, target) => {
                          const location = resolveSidebarWorktreeConversationLocation(target);
                          if (location === null) return;
                          handleLocationContextMenu(event, {
                            projectRef: scopeProjectRef(target.environmentId, target.projectId),
                            location,
                          });
                        }}
                      />
                    );
                    return buildWorktreeCardGroups({
                      repositories: repositoryGroups,
                      worktrees: worktreeGroups,
                      selection: projectScopeSelection,
                    }).map((cardGroup) => {
                      const { project } = cardGroup;
                      // The remainder bucket has no project to name, so its
                      // checkouts render bare rather than under a blank folder.
                      if (project === null) {
                        return (
                          <Fragment key={`worktree-folder:${cardGroup.key}`}>
                            {cardGroup.worktrees.map(renderCard)}
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
                          {cardGroup.worktrees.map(renderCard)}
                        </WorktreeProjectFolder>
                      );
                    });
                  }
                  if (sidebarThreadGroupingMode === "worktree") {
                    const renderWorktreeGroup = (group: SidebarWorktreeGroup): ReactNode[] => {
                      const groupItems: ReactNode[] = [];
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
                          className="mb-1 mt-1 flex items-start gap-1 rounded-lg"
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
                              "flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sidebar-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover motion-reduce:transform-none",
                              hasVisibleChildren
                                ? "cursor-pointer active:scale-[0.96]"
                                : "cursor-default",
                            )}
                          >
                            <span aria-hidden className="flex h-5 shrink-0 items-center">
                              {hasVisibleChildren ? (
                                expanded ? (
                                  <ChevronDownIcon className="size-3.5" />
                                ) : (
                                  <ChevronRightIcon className="size-3.5" />
                                )
                              ) : (
                                <span className="size-3.5" />
                              )}
                            </span>
                            <span aria-hidden className="flex h-5 shrink-0 items-center">
                              <GitBranchIcon className="size-4 text-muted-foreground" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm leading-5 font-medium">
                                {group.label}
                              </span>
                              <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 tabular-nums text-muted-foreground/65">
                                <SidebarStateCounters counts={group.stateCounts} />
                                {Object.values(group.stateCounts).some((count) => count > 0) ? (
                                  <span aria-hidden>·</span>
                                ) : null}
                                <span className="truncate">
                                  {group.isProjectCheckout ? "Current checkout" : "Worktree"}
                                </span>
                              </span>
                            </span>
                          </button>
                          <WorktreeActionsPopover
                            group={group}
                            serverConfigs={serverConfigs}
                            removingWorktreeKey={removingWorktreeKey}
                            settlingWorktreeKey={settlingWorktreeKey}
                            onSettleWorktree={attemptSettleWorktree}
                            onDeleteWorktree={attemptDeleteWorktree}
                            className="mr-1 mt-0.5"
                          />
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
                              {settledShelfExpanded ? "Settled" : `Settled (${settledRootCount})`}
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
                          {selectedSettledThreads.length > 0 &&
                          !selectedSettledThreads.some((thread) =>
                            flowOwnedThreadKeys.has(
                              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                            ),
                          ) ? (
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
                {presentation !== "cards" && settledShelfExpanded && hiddenSettledCount > 0 ? (
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
            {/* Gated on what the current presentation actually renders. Cards
                list worktrees, and a worktree can exist with no conversations
                at all — counting threads there would print "No threads yet"
                underneath a registry full of cards. */}
            {(
              presentation === "cards"
                ? worktreeGroups.length === 0
                : activeThreads.length + snoozedThreads.length + settledThreads.length === 0
            ) ? (
              <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
                {projects.length === 0 ? (
                  <>
                    <span>No projects yet</span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={openAddProjectCommandPalette}
                      className="border-sidebar-border bg-transparent text-[11px] text-sidebar-muted-foreground shadow-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
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
        updateProjectMemberIcon={updateProjectMemberIcon}
        updateProjectGroupingPreference={updateProjectGroupingPreference}
        onRemoveMembers={handleRemoveProjectMembers}
      />
      <SidebarChromeFooter />
    </>
  );
}
