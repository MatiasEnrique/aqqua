import type { scopeProjectRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type {
  EnvironmentId,
  ProjectIcon,
  ProjectId,
  ScopedThreadRef,
  SidebarProjectGroupingMode,
} from "@aqqua/contracts";
import type { MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type {
  SidebarProjectState,
  SidebarRepositoryGroup,
  SidebarWorktreeConversationLocation,
  SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import type { ProjectScopeSelection } from "./projectScopeSelection";

/** Active route identity the list and controllers share. */
export type SidebarRouteSection = {
  readonly routeThreadKey: string | null;
  readonly routeDraftId: string | null;
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly routeThreadKeyRef: MutableRefObject<string | null>;
  readonly isMobile: boolean;
  readonly setOpenMobile: (open: boolean) => void;
};

/** Logical projects, scope filter, expansion, and display maps. */
export type SidebarProjectsSection = {
  readonly projects: readonly {
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly title: string;
    readonly workspaceRoot: string;
  }[];
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  /** The projects the list is filtered to. Empty means every project. */
  readonly projectScopeSelection: ProjectScopeSelection;
  readonly setProjectScope: (projectKeys: readonly string[]) => void;
  readonly clearProjectScope: () => void;
  readonly scopedProjectGroups: readonly SidebarProjectSnapshot[];
  /** The one project in scope, or null when the scope is zero or many. */
  readonly scopedProjectGroup: SidebarProjectSnapshot | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly scopedProjectState: SidebarProjectState | null;
  readonly projectExpandedById: Readonly<Record<string, boolean>>;
  readonly setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  readonly projectActionsTarget: SidebarProjectSnapshot | null;
  readonly setProjectActionsTarget: (target: SidebarProjectSnapshot | null) => void;
  readonly projectGroupingSettings: {
    readonly sidebarProjectGroupingMode: SidebarProjectGroupingMode;
    readonly sidebarProjectGroupingOverrides?: Readonly<Record<string, SidebarProjectGroupingMode>>;
  };
  readonly projectCwdByKey: ReadonlyMap<string, string>;
  readonly projectDisplayNameByKey: ReadonlyMap<string, string>;
  readonly environmentLabelById: ReadonlyMap<string, string>;
  readonly worktreeProjectsByKey: ReadonlyMap<
    string,
    { readonly workspaceRoot: string; readonly environmentLabel: string | null }
  >;
};

/** Conversation order used by global navigation shortcuts. */
export type SidebarThreadsSection = {
  readonly orderedThreadKeys: readonly string[];
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
};

/** Worktree/repository grouping and ephemeral delete hide. */
export type SidebarWorktreesSection = {
  readonly worktreeGroups: readonly SidebarWorktreeGroup[];
  readonly repositoryGroups: readonly SidebarRepositoryGroup<SidebarProjectSnapshot>[];
  /** Derived from the route, with a persisted fallback for empty worktrees. */
  readonly activeWorktreeKey: string | null;
  readonly activeWorktreeGroup: SidebarWorktreeGroup | null;
  readonly setActiveWorktreeOverrideKey: (key: string | null) => void;
  readonly reorderWorktree: (draggedWorktreeKey: string, targetWorktreeKey: string) => void;
  readonly removingWorktreeKey: string | null;
  readonly setRemovingWorktreeKey: (key: string | null) => void;
  readonly hideWorktreeKey: (key: string) => void;
};

export type WorktreeLifecycleController = {
  readonly attemptDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly handleLocationContextMenu: (
    event: ReactMouseEvent,
    input: {
      projectRef: ReturnType<typeof scopeProjectRef>;
      location?: SidebarWorktreeConversationLocation;
    },
  ) => void;
};

export type ProjectActionsController = {
  readonly handleRemoveProjectMembers: (
    projectGroup: SidebarProjectSnapshot,
    members: readonly SidebarProjectGroupMember[],
  ) => void | Promise<void>;
  readonly renameProjectMember: (
    member: SidebarProjectGroupMember,
    title: string,
  ) => void | Promise<void>;
  readonly updateProjectMemberIcon: (
    member: SidebarProjectGroupMember,
    icon: ProjectIcon | null,
  ) => void | Promise<void>;
  readonly updateProjectGroupingPreference: (
    member: SidebarProjectGroupMember,
    value: "inherit" | SidebarProjectGroupingMode,
  ) => void;
  readonly handleProjectActions: (
    event: ReactMouseEvent<HTMLButtonElement>,
    projectGroup: SidebarProjectSnapshot,
  ) => void;
  readonly copyProjectPath: (text: string, payload: { path: string }) => void;
  readonly openAddProjectCommandPalette: () => void;
};

export type SidebarNavigationController = {
  readonly navigateToThread: (threadRef: ScopedThreadRef) => void;
  readonly navigateToDraft: (draftId: string) => void;
  readonly discardDraft: (draftId: string) => void;
  readonly handleNewThreadClick: () => void;
  readonly attachListAutoAnimateRef: (node: HTMLUListElement | null) => void;
  readonly commandPaletteShortcutLabel: string | null;
  readonly newThreadShortcutLabel: string | null;
};

/** Everything the view needs, grouped by domain ownership. */
export type SidebarV2ViewModel = {
  readonly route: SidebarRouteSection;
  readonly projects: SidebarProjectsSection;
  readonly threads: SidebarThreadsSection;
  readonly worktrees: SidebarWorktreesSection;
  readonly worktreeLifecycle: WorktreeLifecycleController;
  readonly projectActions: ProjectActionsController;
  readonly navigation: SidebarNavigationController;
};
