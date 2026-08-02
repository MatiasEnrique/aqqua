import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type { scopeProjectRef } from "@aqqua/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  ServerConfig,
  SidebarProjectGroupingMode,
} from "@aqqua/contracts";
import type { MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { SidebarDraftRow } from "../Sidebar.logic";
import type { SnoozePreset } from "../Sidebar.snooze";
import type {
  SidebarProjectState,
  SidebarRepositoryGroup,
  SidebarWorktreeConversationLocation,
  SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";

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
  readonly projectScopeKey: string | null;
  readonly setProjectScopeKey: (key: string | null) => void;
  readonly scopedProjectGroup: SidebarProjectSnapshot | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly scopedProjectState: SidebarProjectState | null;
  readonly projectExpandedById: Readonly<Record<string, boolean>>;
  readonly setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  readonly projectScopeMenuOpen: boolean;
  readonly setProjectScopeMenuOpen: (open: boolean) => void;
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

/** Partitioned threads, tree visibility, shelves, and visual order. */
export type SidebarThreadsSection = {
  readonly activeThreads: readonly EnvironmentThreadShell[];
  readonly snoozedThreads: readonly EnvironmentThreadShell[];
  readonly settledThreads: readonly EnvironmentThreadShell[];
  readonly snoozeNow: string;
  readonly visibleActiveThreads: readonly EnvironmentThreadShell[];
  readonly visibleSnoozedThreads: readonly EnvironmentThreadShell[];
  readonly renderedSettledThreads: readonly EnvironmentThreadShell[];
  readonly selectedSettledThreads: readonly EnvironmentThreadShell[];
  readonly activeTreeMetaByKey: ReadonlyMap<string, { childCount: number; depth: number }>;
  readonly expandedThreadKeys: ReadonlySet<string>;
  readonly reserveSubAgentGutter: boolean;
  readonly draftRows: readonly SidebarDraftRow[];
  readonly groupedDraftRows: readonly SidebarDraftRow[];
  readonly orderedThreads: readonly EnvironmentThreadShell[];
  readonly orderedThreadKeys: readonly string[];
  readonly orderedThreadKeysRef: MutableRefObject<readonly string[]>;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly threadByKeyRef: MutableRefObject<ReadonlyMap<string, EnvironmentThreadShell>>;
  readonly settledThreadKeysRef: MutableRefObject<ReadonlySet<string>>;
  readonly snoozedThreadKeysRef: MutableRefObject<ReadonlySet<string>>;
  readonly jumpLabelByKey: ReadonlyMap<string, string>;
  readonly showJumpHints: boolean;
  readonly setShowJumpHints: (show: boolean) => void;
  readonly snoozedShelfExpanded: boolean;
  readonly toggleSnoozedShelf: () => void;
  readonly settledShelfExpanded: boolean;
  readonly toggleSettledShelf: () => void;
  readonly hiddenSettledCount: number;
  readonly showMoreSettled: () => void;
  readonly sidebarThreadGroupingMode: "flat" | "worktree";
  readonly handleChangeRequestState: (
    threadKey: string,
    state: "open" | "closed" | "merged" | null,
  ) => void;
  readonly setThreadExpanded: (threadIds: string | readonly string[], expanded: boolean) => void;
  readonly providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  /** Canonical atom value from `environmentServerConfigsAtom`. */
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
};

/** Worktree/repository grouping and ephemeral delete hide. */
export type SidebarWorktreesSection = {
  readonly worktreeGroups: readonly SidebarWorktreeGroup[];
  readonly expandedWorktreeGroups: readonly SidebarWorktreeGroup[];
  readonly repositoryGroups: readonly SidebarRepositoryGroup<SidebarProjectSnapshot>[];
  readonly repositoryHierarchyVisible: boolean;
  readonly worktreeExpandedByKey: Readonly<Record<string, boolean>>;
  readonly setWorktreeExpanded: (worktreeKey: string, expanded: boolean) => void;
  readonly removingWorktreeKey: string | null;
  readonly settlingWorktreeKey: string | null;
  readonly setRemovingWorktreeKey: (key: string | null) => void;
  readonly setSettlingWorktreeKey: (key: string | null) => void;
  readonly hideWorktreeKey: (key: string) => void;
};

export type ThreadLifecycleController = {
  readonly renamingThreadKey: string | null;
  readonly renamingTitle: string;
  readonly setRenamingTitle: (title: string) => void;
  readonly startThreadRename: (threadRef: ScopedThreadRef, title: string) => void;
  readonly cancelThreadRename: () => void;
  readonly commitThreadRename: (
    threadRef: ScopedThreadRef,
    title: string,
    originalTitle: string,
  ) => void;
  readonly handleThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  readonly toggleThreadExpanded: (threadRef: ScopedThreadRef, expanded: boolean) => void;
  readonly attemptSettle: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnsettle: (threadRef: ScopedThreadRef) => void;
  readonly attemptSnooze: (threadRef: ScopedThreadRef, preset: SnoozePreset) => void;
  readonly attemptUnsnooze: (threadRef: ScopedThreadRef) => void;
  readonly attemptDeleteThread: (threadRef: ScopedThreadRef) => void;
  readonly deleteSelectedSettledThreads: () => void;
  readonly deletingSettledSelection: boolean;
  readonly handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => void;
  readonly handleMultiSelectContextMenu: (position: { x: number; y: number }) => void;
};

export type WorktreeLifecycleController = {
  readonly attemptSettleWorktree: (group: SidebarWorktreeGroup) => void;
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
  readonly threadLifecycle: ThreadLifecycleController;
  readonly worktreeLifecycle: WorktreeLifecycleController;
  readonly projectActions: ProjectActionsController;
  readonly navigation: SidebarNavigationController;
};
