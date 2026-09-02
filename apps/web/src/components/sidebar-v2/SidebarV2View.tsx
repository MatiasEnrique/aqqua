import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, FolderPlusIcon, PlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { Fragment, lazy, Suspense, useEffect, useMemo } from "react";
import { isElectron } from "../../env";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { resolveProjectExpanded, useUiStateStore } from "../../uiStateStore";
import { useWorktreeHeaderStore } from "../../worktreeHeaderStore";
import { SidebarSurfaceSwitcher } from "../board/SidebarSurfaceSwitcher";
import { resolveWorktreeFocusTarget } from "../chat/openConversationTabs";
import {
  resolveSidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { CommandDialogTrigger } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import type { SidebarV2ViewModel } from "./models";
import { ProjectNewWorktreeButton } from "./ProjectNewWorktreeButton";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { resolveProjectScopeAddition } from "./projectScopeSelection";
import { SidebarProjectScopeChips } from "./SidebarProjectScopeChips";
import { SortableWorktreeCardList } from "./WorktreeCard";
import { WorktreeProjectFolder } from "./WorktreeProjectFolder";
import { buildWorktreeCardGroups } from "./worktreeCardGroups";

const loadSidebarBoardPanel = () =>
  import("../board/SidebarBoardPanel").then((module) => ({
    default: module.SidebarBoardPanel,
  }));
const SidebarBoardPanel = lazy(loadSidebarBoardPanel);

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

  const { threadByKey } = threadsSection;

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
    handleRemoveProjectMembers,
    renameProjectMember,
    updateProjectMemberIcon,
    updateProjectMemberOriginBranch,
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
  const openConversationTabKeys = useUiStateStore((store) => store.openConversationTabKeys);

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
  useEffect(() => {
    setHeaderWorktree({ group: activeWorktreeGroup, worktreeCount });
    return () => setHeaderWorktree({ group: null, worktreeCount: 0 });
  }, [activeWorktreeGroup, setHeaderWorktree, worktreeCount]);

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

  const renderWorktreeCards = (groups: readonly SidebarWorktreeGroup[]) => (
    <SortableWorktreeCardList
      groups={groups}
      activeWorktreeKey={activeWorktreeKey}
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
      onReorder={reorderWorktree}
    />
  );

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
                        params: {
                          environmentId: group.environmentId,
                          projectId: group.id,
                        },
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
              <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-1">
                {worktreeCardGroups.map((cardGroup) => {
                  const { project } = cardGroup;
                  if (project === null) {
                    return (
                      <Fragment key={`worktree-folder:${cardGroup.key}`}>
                        {renderWorktreeCards(cardGroup.worktrees)}
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
                      onContextMenu={(event) => handleLocationContextMenu(event, { projectRef })}
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
                      {renderWorktreeCards(cardGroup.worktrees)}
                    </WorktreeProjectFolder>
                  );
                })}
              </ul>
            </TooltipProvider>
            {!hasVisibleWorktrees ? (
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
        updateProjectMemberOriginBranch={updateProjectMemberOriginBranch}
        updateProjectGroupingPreference={updateProjectGroupingPreference}
        onRemoveMembers={handleRemoveProjectMembers}
      />
      <SidebarChromeFooter />
    </>
  );
}
