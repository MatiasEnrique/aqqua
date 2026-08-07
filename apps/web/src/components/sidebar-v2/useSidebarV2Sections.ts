import { useAtomValue } from "@effect/atom-react";
import type { AtomCommand, AtomCommandResult } from "@aqqua/client-runtime/state/runtime";
import { effectiveSettled, effectiveSnoozed } from "@aqqua/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@aqqua/client-runtime/environment";
import type { ServerConfig, SidebarProjectGroupingMode } from "@aqqua/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../../keybindings";
import {
  EMPTY_PROJECT_SCOPE_SELECTION,
  type ProjectScopeSelection,
  projectScopeSelectionFromKeys,
  projectScopeSelectionKey,
  pruneProjectScopeSelection,
  resolveSelectedProjectGroups,
  resolveSoleScopedProjectGroup,
} from "./projectScopeSelection";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  resolveThreadExpanded,
  useUiStateStore,
} from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { openCommandPalette } from "../../commandPaletteBus";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import {
  environmentServerConfigsAtom,
  primaryServerKeybindingsAtom,
  primaryServerProvidersAtom,
} from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../../threadRoutes";
import {
  firstValidTimestampMs,
  orderItemsByPreferredIds,
  selectSidebarDraftRows,
  sortLogicalProjectsForSidebar,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
} from "../Sidebar.logic";
import {
  buildSidebarThreadFamilyBands,
  buildSidebarThreadSubAgentStateCounts,
  buildSidebarThreadTree,
  filterVisibleSidebarThreadEntries,
  inheritSettledFromOrchestrators,
  selectSidebarThreadFamilyPage,
  shouldReserveThreadExpandGutter,
} from "../Sidebar.threadTree";
import { resolveSidebarConversationSummaryState } from "../Sidebar.summaryState";
import {
  buildProjectRootByProjectKey,
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  canReorderSidebarWorktrees,
  filterExpandedSidebarWorktreeGroups,
  filterHiddenSidebarWorktreeGroups,
  sidebarProjectKey,
} from "../Sidebar.worktreeGroups";
import { resolveActiveWorktreeKey } from "./activeWorktree";
import { resolveSidebarGroupingMode } from "./groupingMode";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSidebar } from "../ui/sidebar";
import { useComposerDraftStore } from "../../composerDraftStore";
import { SETTLED_TAIL_INITIAL_COUNT, SETTLED_TAIL_PAGE_COUNT } from "./constants";
import {
  addEphemeralHiddenWorktreeKey,
  nextEphemeralHiddenWorktreeKeys,
} from "./ephemeralHiddenWorktrees";
import { useFlowOwnedThreadKeys } from "./useFlowOwnedThreads";
import type {
  SidebarProjectsSection,
  SidebarRouteSection,
  SidebarThreadsSection,
  SidebarWorktreesSection,
} from "./models";

export type {
  SidebarProjectsSection,
  SidebarRouteSection,
  SidebarThreadsSection,
  SidebarWorktreesSection,
} from "./models";

/** Runner shape produced by `useAtomCommand` for a given atom command. */
type AtomCommandRunner<C> =
  C extends AtomCommand<infer W, infer A, infer E>
    ? (value: W) => Promise<AtomCommandResult<A, E>>
    : never;

export type SidebarV2SectionsOptions = {
  /**
   * Pins how conversations are grouped. Omitted, grouping follows
   * `sidebarThreadGroupingMode` — the worktree view's own preference.
   */
  readonly groupingMode?: SidebarThreadsSection["sidebarThreadGroupingMode"];
  /** The worktree-card entry is the only surface that exposes persisted drag ordering. */
  readonly enableManualWorktreeOrdering?: boolean;
};

export type SidebarV2Sections = {
  readonly route: SidebarRouteSection;
  readonly projects: SidebarProjectsSection;
  readonly threads: SidebarThreadsSection;
  readonly worktrees: SidebarWorktreesSection;
  /** Shared runtime for controllers (not passed to the view). */
  readonly runtime: SidebarV2Runtime;
};

export type SidebarV2Runtime = {
  readonly router: ReturnType<typeof useRouter>;
  /** Canonical value of `primaryServerKeybindingsAtom`. */
  readonly keybindings: ServerConfig["keybindings"];
  readonly newThreadContext: ReturnType<typeof useHandleNewThread>;
  readonly settleThread: ReturnType<typeof useThreadActions>["settleThread"];
  readonly settleThreads: ReturnType<typeof useThreadActions>["settleThreads"];
  readonly deleteWorktree: ReturnType<typeof useThreadActions>["deleteWorktree"];
  readonly unsettleThread: ReturnType<typeof useThreadActions>["unsettleThread"];
  readonly snoozeThread: ReturnType<typeof useThreadActions>["snoozeThread"];
  readonly unsnoozeThread: ReturnType<typeof useThreadActions>["unsnoozeThread"];
  readonly deleteThreads: ReturnType<typeof useThreadActions>["deleteThreads"];
  readonly updateThreadMetadata: AtomCommandRunner<typeof threadEnvironment.updateMetadata>;
  readonly clearSelection: () => void;
  readonly setSelectionAnchor: (threadKey: string) => void;
  readonly markThreadUnread: (
    threadId: string,
    latestTurnCompletedAt: string | null | undefined,
  ) => void;
  readonly handleNewThreadRef: {
    current: ReturnType<typeof useHandleNewThread>["handleNewThread"];
  };
  readonly copyProjectPath: (text: string, payload: { path: string }) => void;
  readonly openAddProjectCommandPalette: () => void;
  readonly deleteProject: AtomCommandRunner<typeof projectEnvironment.delete>;
  readonly updateProject: AtomCommandRunner<typeof projectEnvironment.update>;
  readonly updateSettings: ReturnType<typeof useUpdateClientSettings>;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectGroupingSettings: SidebarProjectsSection["projectGroupingSettings"];
  readonly routeTargetRef: { current: ReturnType<typeof resolveThreadRouteTarget> };
  /** Shared across thread settle and worktree settle-all to block double-dispatch. */
  readonly settlingThreadKeysRef: { current: Set<string> };
};

/**
 * Owns sidebar read-model derivation, split into cohesive domain sections.
 * Controllers consume `runtime` + the sections they need; the view never sees
 * the flat bag of every intermediate binding.
 */
export function useSidebarV2Sections(options: SidebarV2SectionsOptions = {}): SidebarV2Sections {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const worktreeOrder = useUiStateStore((store) => store.worktreeOrder);
  const reorderWorktrees = useUiStateStore((store) => store.reorderWorktrees);
  const rememberWorktreeOrder = useUiStateStore((store) => store.rememberWorktreeOrder);
  const threads = useThreadShells();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const autoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const settingsThreadGroupingMode = useClientSettings((s) => s.sidebarThreadGroupingMode);
  // The entry component owns grouping: the regular sidebar is flat by
  // definition, so it pins the mode rather than reading a setting that only
  // the worktree view exposes.
  // `worktree_cards` buckets exactly like `worktree`; only the renderer differs,
  // so it normalizes here rather than forking every `=== "worktree"` check below.
  const sidebarThreadGroupingMode =
    options.groupingMode ?? resolveSidebarGroupingMode(settingsThreadGroupingMode);
  const {
    settleThread,
    settleThreads,
    deleteWorktree,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    deleteThreads,
  } = useThreadActions();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const updateSettings = useUpdateClientSettings();
  const { copyToClipboard: copyProjectPath } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const [projectActionsTarget, setProjectActionsTarget] = useState<SidebarProjectSnapshot | null>(
    null,
  );
  const newThreadContext = useHandleNewThread();
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const selectedThreadKeys = useThreadSelectionStore((s) => s.selectedThreadKeys);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  // Shared with sidebar v1: collapsing an orchestrator in one sidebar keeps it
  // collapsed in the other, and the preference survives a reload.
  const threadExpandedById = useUiStateStore((s) => s.threadExpandedById);
  const setThreadExpanded = useUiStateStore((s) => s.setThreadExpanded);
  const projectExpandedById = useUiStateStore((s) => s.projectExpandedById);
  const setProjectExpanded = useUiStateStore((s) => s.setProjectExpanded);
  const worktreeExpandedByKey = useUiStateStore((s) => s.worktreeExpandedByKey);
  const setWorktreeExpanded = useUiStateStore((s) => s.setWorktreeExpanded);
  const activeWorktreeOverrideKey = useUiStateStore((s) => s.activeWorktreeOverrideKey);
  const setActiveWorktreeOverrideKey = useUiStateStore((s) => s.setActiveWorktreeOverrideKey);
  const [hiddenWorktreeKeys, setHiddenWorktreeKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [removingWorktreeKey, setRemovingWorktreeKey] = useState<string | null>(null);
  const [settlingWorktreeKey, setSettlingWorktreeKey] = useState<string | null>(null);
  const [deletingSettledSelection, setDeletingSettledSelection] = useState(false);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const routeTargetRef = useRef(routeTarget);
  routeTargetRef.current = routeTarget;
  // Post-settle navigation validates against the CURRENT route, not the one
  // captured when the settle started: if the user navigated elsewhere while
  // the command was in flight, completing it must not yank them away.
  const routeThreadKeyRef = useRef(routeThreadKey);
  routeThreadKeyRef.current = routeThreadKey;

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
    ],
  );
  const projectGroups = useMemo(
    () => sortLogicalProjectsForSidebar(unsortedProjectGroups, threads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const providerEntryByInstanceId = useMemo(
    () =>
      new Map(
        deriveProviderInstanceEntries(serverProviders).map(
          (entry) => [entry.instanceId as string, entry] as const,
        ),
      ),
    [serverProviders],
  );
  const projectCwdByKey = useMemo(() => buildProjectRootByProjectKey(projects), [projects]);
  const worktreeProjectsByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          sidebarProjectKey(project.environmentId, project.id),
          {
            workspaceRoot: project.workspaceRoot,
            environmentLabel: environmentLabelById.get(project.environmentId) ?? null,
          },
        ]),
      ),
    [environmentLabelById, projects],
  );
  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );

  // now is quantized to the minute so effectiveSettled memoization doesn't
  // churn on every render; auto-settle thresholds are day-granular anyway.
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute. The
  // tick is a plain counter bumped exactly at the next wake boundary (armed
  // below, after the partition knows the boundary); the partition reads a
  // fresh clock whenever it recomputes.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);

  // PR states stream in per-row (rows own the VCS subscriptions); a merged or
  // closed PR auto-settles its thread on the next partition.
  const [changeRequestStateByKey, setChangeRequestStateByKey] = useState<
    ReadonlyMap<string, "open" | "closed" | "merged">
  >(() => new Map());
  const handleChangeRequestState = useCallback(
    (threadKey: string, state: "open" | "closed" | "merged" | null) => {
      setChangeRequestStateByKey((current) => {
        if ((current.get(threadKey) ?? null) === state) return current;
        const next = new Map(current);
        if (state === null) {
          next.delete(threadKey);
        } else {
          next.set(threadKey, state);
        }
        return next;
      });
    },
    [],
  );
  // Project scope: a chip row above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  // The selection is a set — someone working across two repositories wants both
  // registries at once, and one-at-a-time forced a round trip through a menu to
  // see either.
  const [projectScopeSelection, setProjectScopeSelection] = useState<ProjectScopeSelection>(
    EMPTY_PROJECT_SCOPE_SELECTION,
  );
  const scopedProjectGroups = useMemo(
    () => resolveSelectedProjectGroups(projectScopeSelection, projectGroups),
    [projectGroups, projectScopeSelection],
  );
  const scopedProjectGroup = useMemo(
    () => resolveSoleScopedProjectGroup(scopedProjectGroups),
    [scopedProjectGroups],
  );
  const setProjectScope = useCallback((keys: readonly string[]) => {
    setProjectScopeSelection(projectScopeSelectionFromKeys(keys));
  }, []);
  const clearProjectScope = useCallback(() => {
    setProjectScopeSelection(EMPTY_PROJECT_SCOPE_SELECTION);
  }, []);
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroups.length === 0
        ? null
        : new Set(
            scopedProjectGroups.flatMap((group) =>
              group.memberProjectRefs.map(
                (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
              ),
            ),
          ),
    [scopedProjectGroups],
  );
  // Rows can unmount while they remain visible (for example when the settled
  // shelf collapses), so row cleanup must not erase the PR state that put them
  // there. Forget state only when a thread leaves the current scope; returning
  // rows then render active once, resubscribe to VCS, and report fresh state.
  useEffect(() => {
    const visibleThreadKeys = new Set(
      threads.flatMap((thread) =>
        thread.archivedAt === null &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`))
          ? [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))]
          : [],
      ),
    );
    setChangeRequestStateByKey((current) => {
      let changed = false;
      const next = new Map(current);
      for (const threadKey of current.keys()) {
        if (visibleThreadKeys.has(threadKey)) continue;
        next.delete(threadKey);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [scopedProjectKeys, threads]);
  // A project that disappears — deleted, or regrouped under a new key by
  // Settings → General — must not keep filtering the list from a chip that is
  // no longer rendered.
  useEffect(() => {
    setProjectScopeSelection((current) => pruneProjectScopeSelection(current, projectGroups));
  }, [projectGroups]);
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  const projectScopeKey = useMemo(
    () => projectScopeSelectionKey(projectScopeSelection),
    [projectScopeSelection],
  );
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKey]);

  // Settled threads stay in the live shell stream (settled ≠ archived), so
  // the partition works directly off live shells: no archived-snapshot
  // merging, no optimistic holds. Archived threads remain hidden here —
  // archive keeps its original "remove from sidebar" meaning.
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const {
    activeThreads,
    snoozedThreads,
    settledThreads,
    unscopedActiveThreads,
    unscopedSnoozedThreads,
    unscopedSettledThreads,
    snoozeNow,
  } = useMemo(() => {
    const now = `${nowMinute}:00.000Z`;
    // Snooze classification uses a REAL clock, not the quantized minute:
    // wake times are second-precise and a woken thread must not linger on
    // the shelf for the rest of the minute. snoozeWakeTick re-runs this
    // memo exactly at the next wake boundary.
    void snoozeWakeTick;
    const preciseNow = new Date().toISOString();
    // Partitioned before the project scope is applied, not after. The route can
    // point at a conversation the scope hides, and "which worktree am I in"
    // must still have an answer — the chat header names that worktree and fills
    // its tab strip from it. Orchestrator inheritance also reads truer over the
    // whole set: a scope that hides an orchestrator should not change how its
    // sub-agents classify.
    const unarchived = threads.filter((thread) => thread.archivedAt === null);
    const inScope = (thread: EnvironmentThreadShell) =>
      scopedProjectKeys === null ||
      scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`);
    const sectionById = inheritSettledFromOrchestrators({
      threads: unarchived,
      classify: (thread) => {
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        const changeRequestState = changeRequestStateByKey.get(threadKey) ?? null;
        if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) return "snoozed";
        if (
          supportsSettlement &&
          effectiveSettled(thread, { now, autoSettleAfterDays, changeRequestState })
        ) {
          return "settled";
        }
        return "active";
      },
    });
    const active: EnvironmentThreadShell[] = [];
    const snoozed: EnvironmentThreadShell[] = [];
    const settled: EnvironmentThreadShell[] = [];
    for (const thread of unarchived) {
      const section = sectionById.get(thread.id) ?? "active";
      if (section === "snoozed") {
        snoozed.push(thread);
      } else if (section === "settled") {
        settled.push(thread);
      } else {
        active.push(thread);
      }
    }
    // Soonest wake first: "what comes back next" is the shelf's question.
    const bySoonestWake = (left: EnvironmentThreadShell, right: EnvironmentThreadShell) =>
      firstValidTimestampMs(left.snoozedUntil ?? null) -
      firstValidTimestampMs(right.snoozedUntil ?? null);
    const unscopedActive = sortThreadsForSidebarV2(active);
    const unscopedSnoozed = snoozed.toSorted(bySoonestWake);
    const unscopedSettled = sortSettledThreadsForSidebarV2(settled);
    return {
      // Filtering after the sort keeps both views in one order.
      activeThreads: unscopedActive.filter(inScope),
      snoozedThreads: unscopedSnoozed.filter(inScope),
      settledThreads: unscopedSettled.filter(inScope),
      unscopedActiveThreads: unscopedActive,
      unscopedSnoozedThreads: unscopedSnoozed,
      unscopedSettledThreads: unscopedSettled,
      snoozeNow: preciseNow,
    };
  }, [
    autoSettleAfterDays,
    changeRequestStateByKey,
    nowMinute,
    scopedProjectKeys,
    serverConfigs,
    snoozeWakeTick,
    threads,
  ]);
  const selectedSettledThreads = useMemo(
    () =>
      settledThreads.filter((thread) =>
        selectedThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      ),
    [selectedThreadKeys, settledThreads],
  );

  // Arm a timeout for the earliest upcoming wake so the shelf empties the
  // moment a snooze expires instead of on the next minute tick. Sorted
  // soonest-first, so entry 0 is the boundary.
  useEffect(() => {
    const nextWakeAtMs =
      snoozedThreads.length > 0 && snoozedThreads[0]?.snoozedUntil != null
        ? Date.parse(snoozedThreads[0].snoozedUntil)
        : Number.NaN;
    if (Number.isNaN(nextWakeAtMs)) return;
    // setTimeout delays are signed 32-bit: anything larger overflows and
    // fires immediately, turning a far-future wake (event-condition snoozes
    // synced from elsewhere) into a tight re-arm loop. Clamped, the timer
    // just re-arms every ~24.8 days until the wake is in range.
    const delayMs = Math.min(Math.max(0, nextWakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = window.setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delayMs);
    return () => window.clearTimeout(id);
  }, [snoozedThreads]);

  // Sub-agents render nested under the orchestrator that spawned them, in the
  // inbox only: the partition runs first, so a settled or snoozed orchestrator
  // leaves its still-active sub-agents to render as roots rather than following
  // it out of the inbox.
  const activeThreadEntries = useMemo(
    () =>
      sidebarThreadGroupingMode === "worktree"
        ? buildSidebarWorktreeGroups({
            active: activeThreads,
            snoozed: [],
            drafts: [],
            projectsByKey: worktreeProjectsByKey,
          }).flatMap((group) => buildSidebarThreadTree({ threads: group.active }))
        : buildSidebarThreadTree({ threads: activeThreads }),
    [activeThreads, sidebarThreadGroupingMode, worktreeProjectsByKey],
  );
  const activeSubAgentStateCountsByKey = useMemo(() => {
    const settledKeys = new Set(
      settledThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    return buildSidebarThreadSubAgentStateCounts({
      entries: buildSidebarThreadTree({
        threads: [...activeThreads, ...snoozedThreads, ...settledThreads],
      }),
      getKey: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      classify: (thread) =>
        settledKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
          ? "settled"
          : resolveSidebarConversationSummaryState(thread),
    });
  }, [activeThreads, settledThreads, snoozedThreads]);
  const {
    activeFamilyBandByKey,
    activeTreeMetaByKey,
    expandedThreadKeys,
    reserveSubAgentGutter,
    visibleActiveThreads,
  } = useMemo(() => {
    const entryKey = (entry: { thread: EnvironmentThreadShell }) =>
      scopedThreadKey(scopeThreadRef(entry.thread.environmentId, entry.thread.id));
    const isEntryExpanded = (entry: { thread: EnvironmentThreadShell }) => {
      const key = entryKey(entry);
      // Sub-agents start collapsed here: the inbox is a list of
      // conversations, and one delegation fan-out shouldn't push everything
      // else below the fold. The user can keep the branch collapsed even
      // while its active descendant remains open in chat.
      return resolveThreadExpanded(threadExpandedById, [key], { fallback: false });
    };
    const visible = filterVisibleSidebarThreadEntries({
      entries: activeThreadEntries,
      isExpanded: isEntryExpanded,
    });
    // Bands come off the same visible list the meta map is built from, so a
    // conversation and its sub-agents always agree on where the panel closes.
    const bands = buildSidebarThreadFamilyBands({ entries: visible });
    return {
      activeFamilyBandByKey: new Map(
        visible.map((entry, index) => [entryKey(entry), bands[index] ?? "single"]),
      ),
      activeTreeMetaByKey: new Map(
        visible.map((entry) => [
          entryKey(entry),
          { childCount: entry.childCount, depth: entry.depth },
        ]),
      ),
      // Chevron direction has to match what actually rendered, not just the
      // stored preference, or a route-forced branch shows a closed chevron.
      expandedThreadKeys: new Set(
        visible.filter((entry) => entry.childCount > 0 && isEntryExpanded(entry)).map(entryKey),
      ),
      // Cards carry their own toggle in the card body, so only the nested rows
      // share a column — and only when one of them actually owns a toggle.
      reserveSubAgentGutter: shouldReserveThreadExpandGutter(visible, { minDepth: 1 }),
      visibleActiveThreads: visible.map((entry) => entry.thread),
    };
  }, [activeThreadEntries, threadExpandedById]);
  // New worktree conversations are client-local until the first message
  // creates the server thread, so the shell stream can't show them. They
  // render from the draft store instead, above the inbox, and disappear the
  // moment their real shell arrives.
  const draftThreadsByDraftId = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const shellThreadIdKeys = useMemo(
    () => new Set(threads.map((thread) => `${thread.environmentId}:${thread.id}`)),
    [threads],
  );
  const groupedDraftRows = useMemo(
    () =>
      selectSidebarDraftRows({
        draftsByDraftId: draftThreadsByDraftId,
        existingThreadKeys: shellThreadIdKeys,
        scopedProjectKeys,
        includeLocal: true,
      }),
    [draftThreadsByDraftId, scopedProjectKeys, shellThreadIdKeys],
  );
  // Same reason as the thread partition: the route can name a draft the scope
  // hides, and its worktree still has to resolve.
  const unscopedDraftRows = useMemo(
    () =>
      selectSidebarDraftRows({
        draftsByDraftId: draftThreadsByDraftId,
        existingThreadKeys: shellThreadIdKeys,
        scopedProjectKeys: null,
        includeLocal: true,
      }),
    [draftThreadsByDraftId, shellThreadIdKeys],
  );
  const draftRows = useMemo(
    () => groupedDraftRows.filter((draft) => draft.envMode === "worktree"),
    [groupedDraftRows],
  );

  // The settled tail renders in pages: history shouldn't dominate the
  // sidebar, and the common lookups are recent. Expansion resets when the
  // filter context changes so a scope/search flip never inherits a deep
  // page state.
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  const settledResetKey = projectScopeKey;
  const lastSettledResetKeyRef = useRef(settledResetKey);
  if (lastSettledResetKeyRef.current !== settledResetKey) {
    lastSettledResetKeyRef.current = settledResetKey;
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }
  const settledThreadEntries = useMemo(
    () => buildSidebarThreadTree({ threads: settledThreads }),
    [settledThreads],
  );
  const {
    hiddenSettledCount,
    settledExpandedThreadKeys,
    settledFamilyBandByKey,
    settledRootCount,
    settledTreeMetaByKey,
    visibleSettledThreads,
  } = useMemo(() => {
    const threadKeyOf = (thread: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const page = selectSidebarThreadFamilyPage({
      entries: settledThreadEntries,
      isExpanded: (entry) =>
        resolveThreadExpanded(threadExpandedById, [threadKeyOf(entry.thread)], {
          fallback: false,
        }),
      rootLimit: settledVisibleCount,
      pinnedThreadId: routeThreadKey,
      getThreadId: threadKeyOf,
    });
    const settledBands = buildSidebarThreadFamilyBands({ entries: page.rows });
    return {
      hiddenSettledCount: page.hiddenRootCount,
      settledExpandedThreadKeys: page.expandedThreadIds,
      settledFamilyBandByKey: new Map(
        page.rows.map((entry, index) => [
          threadKeyOf(entry.thread),
          settledBands[index] ?? "single",
        ]),
      ),
      settledRootCount: page.rootCount,
      settledTreeMetaByKey: new Map(
        page.rows.map((entry) => [
          threadKeyOf(entry.thread),
          { childCount: entry.childCount, depth: entry.depth },
        ]),
      ),
      visibleSettledThreads: page.rows.map((entry) => entry.thread),
    };
  }, [routeThreadKey, settledThreadEntries, settledVisibleCount, threadExpandedById]);
  const showMoreSettled = useCallback(
    () => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT),
    [],
  );
  const [settledShelfExpanded, setSettledShelfExpanded] = useState(true);
  const toggleSettledShelf = useCallback(() => setSettledShelfExpanded((value) => !value), []);
  const renderedSettledThreads = useMemo(() => {
    if (settledShelfExpanded) return visibleSettledThreads;
    return [];
  }, [settledShelfExpanded, visibleSettledThreads]);

  // The snoozed shelf is collapsed by default: out of the way, never gone.
  // Collapsed threads don't render (and so don't participate in jump
  // shortcuts or multi-select), matching the settled tail's paging model.
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useState(false);
  const toggleSnoozedShelf = useCallback(() => setSnoozedShelfExpanded((value) => !value), []);
  const visibleSnoozedThreads = useMemo(() => {
    if (snoozedShelfExpanded) return snoozedThreads;
    return [];
  }, [snoozedShelfExpanded, snoozedThreads]);
  const unfilteredWorktreeGroups = useMemo(
    () =>
      buildSidebarWorktreeGroups({
        active: activeThreads,
        renderedActive: visibleActiveThreads,
        snoozed: snoozedThreads,
        settled: settledThreads,
        drafts: groupedDraftRows,
        projectsByKey: worktreeProjectsByKey,
      }),
    [
      activeThreads,
      groupedDraftRows,
      settledThreads,
      snoozedThreads,
      visibleActiveThreads,
      worktreeProjectsByKey,
    ],
  );
  useEffect(() => {
    setHiddenWorktreeKeys((current) => {
      const next = nextEphemeralHiddenWorktreeKeys(current, unfilteredWorktreeGroups);
      return next ?? current;
    });
  }, [unfilteredWorktreeGroups]);
  const visibleWorktreeGroups = useMemo(
    () => filterHiddenSidebarWorktreeGroups(unfilteredWorktreeGroups, hiddenWorktreeKeys),
    [hiddenWorktreeKeys, unfilteredWorktreeGroups],
  );
  useEffect(() => {
    if (options.enableManualWorktreeOrdering !== true) return;
    rememberWorktreeOrder(visibleWorktreeGroups.map((worktree) => worktree.key));
  }, [options.enableManualWorktreeOrdering, rememberWorktreeOrder, visibleWorktreeGroups]);
  const worktreeGroups = useMemo(
    () =>
      options.enableManualWorktreeOrdering === true
        ? orderItemsByPreferredIds({
            items: visibleWorktreeGroups,
            preferredIds: worktreeOrder,
            getId: (worktree) => worktree.key,
          })
        : visibleWorktreeGroups,
    [options.enableManualWorktreeOrdering, visibleWorktreeGroups, worktreeOrder],
  );
  const repositoryGroups = useMemo(
    () => buildSidebarRepositoryGroups({ projects: projectGroups, worktrees: worktreeGroups }),
    [projectGroups, worktreeGroups],
  );
  const reorderWorktree = useCallback(
    (draggedWorktreeKey: string, targetWorktreeKey: string) => {
      if (options.enableManualWorktreeOrdering !== true) return;
      if (
        !canReorderSidebarWorktrees({
          repositories: repositoryGroups,
          worktrees: worktreeGroups,
          draggedWorktreeKey,
          targetWorktreeKey,
        })
      ) {
        return;
      }
      reorderWorktrees(
        worktreeGroups.map((worktree) => worktree.key),
        draggedWorktreeKey,
        targetWorktreeKey,
      );
    },
    [options.enableManualWorktreeOrdering, reorderWorktrees, repositoryGroups, worktreeGroups],
  );
  const scopedProjectState = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : (repositoryGroups.find(
            (repository) => repository.project.projectKey === scopedProjectGroup.projectKey,
          )?.state ?? "idle"),
    [repositoryGroups, scopedProjectGroup],
  );
  const repositoryHierarchyVisible =
    sidebarThreadGroupingMode === "worktree" && projectScopeSelection.size === 0;
  const expandedWorktreeGroups = useMemo(
    () =>
      filterExpandedSidebarWorktreeGroups({
        worktrees: worktreeGroups,
        repositories: repositoryGroups,
        repositoryHierarchyVisible,
        getRepositoryWorktrees: (repository) => repository.worktrees,
        isRepositoryExpanded: (repository) =>
          resolveProjectExpanded(projectExpandedById, [repository.project.projectKey]),
        isWorktreeExpanded: (worktree) => worktreeExpandedByKey[worktree.key] !== false,
      }),
    [
      projectExpandedById,
      repositoryGroups,
      repositoryHierarchyVisible,
      worktreeExpandedByKey,
      worktreeGroups,
    ],
  );

  // Visual order is the source of order everywhere else: jump hints, shift-range
  // selection and up/down traversal all follow the nesting. Threads inside any
  // collapsed repository, worktree, shelf, or sub-agent branch participate in
  // none of them even when one remains open in chat.
  const orderedThreads = useMemo(
    () => [
      ...(sidebarThreadGroupingMode === "worktree"
        ? expandedWorktreeGroups.flatMap((group) => [
            ...group.active,
            ...(snoozedShelfExpanded ? group.snoozed : []),
          ])
        : [...visibleActiveThreads, ...visibleSnoozedThreads]),
      ...renderedSettledThreads,
    ],
    [
      expandedWorktreeGroups,
      renderedSettledThreads,
      sidebarThreadGroupingMode,
      snoozedShelfExpanded,
      visibleActiveThreads,
      visibleSnoozedThreads,
    ],
  );
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
  // Rows call back into the click handler without carrying the ordered list as
  // a prop — a fresh array identity per shell update would defeat every row's
  // memoization. The ref keeps shift-range-select working against the list as
  // rendered at click time.
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;
  const threadByKey = useMemo(
    () =>
      new Map(
        orderedThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [orderedThreads],
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  // handleNewThread is inherently unstable (depends on the projects list);
  // a ref keeps it out of attemptSettle's dependency array.
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;
  const settlingThreadKeysRef = useRef(new Set<string>());
  const settledThreadKeys = useMemo(
    () =>
      new Set(
        settledThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [settledThreads],
  );
  const settledThreadKeysRef = useRef(settledThreadKeys);
  settledThreadKeysRef.current = settledThreadKeys;
  const snoozedThreadKeys = useMemo(
    () =>
      new Set(
        snoozedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [snoozedThreads],
  );
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  snoozedThreadKeysRef.current = snoozedThreadKeys;
  const flowOwnedThreadKeys = useFlowOwnedThreadKeys(threads);
  const flowOwnedThreadKeysRef = useRef(flowOwnedThreadKeys);
  flowOwnedThreadKeysRef.current = flowOwnedThreadKeys;

  const jumpLabelByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  }, [keybindings, orderedThreadKeys]);
  const [showJumpHints, setShowJumpHints] = useState(false);

  // Settled threads are live shells, so opening one is plain navigation:
  // history stays readable without un-settling, and sending a message or
  // starting a session un-settles server-side.

  const route: SidebarRouteSection = {
    routeThreadKey,
    routeDraftId,
    routeThreadRef,
    routeThreadKeyRef,
    isMobile,
    setOpenMobile,
  };

  const projectsSection: SidebarProjectsSection = {
    projects,
    projectGroups,
    projectScopeSelection,
    setProjectScope,
    clearProjectScope,
    scopedProjectGroups,
    scopedProjectGroup,
    scopedProjectKeys,
    scopedProjectState,
    projectExpandedById,
    setProjectExpanded,
    projectActionsTarget,
    setProjectActionsTarget,
    projectGroupingSettings,
    projectCwdByKey,
    projectDisplayNameByKey,
    environmentLabelById,
    worktreeProjectsByKey,
  };

  const threadsSection: SidebarThreadsSection = {
    activeThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
    visibleActiveThreads,
    visibleSnoozedThreads,
    renderedSettledThreads,
    selectedSettledThreads,
    activeTreeMetaByKey,
    activeFamilyBandByKey,
    activeSubAgentStateCountsByKey,
    settledFamilyBandByKey,
    settledTreeMetaByKey,
    expandedThreadKeys,
    settledExpandedThreadKeys,
    reserveSubAgentGutter,
    draftRows,
    groupedDraftRows,
    orderedThreads,
    orderedThreadKeys,
    orderedThreadKeysRef,
    threadByKey,
    threadByKeyRef,
    settledThreadKeysRef,
    snoozedThreadKeysRef,
    flowOwnedThreadKeys,
    flowOwnedThreadKeysRef,
    jumpLabelByKey,
    showJumpHints,
    setShowJumpHints,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    settledShelfExpanded,
    toggleSettledShelf,
    hiddenSettledCount,
    settledRootCount,
    showMoreSettled,
    sidebarThreadGroupingMode,
    handleChangeRequestState,
    setThreadExpanded,
    providerEntryByInstanceId,
    serverConfigs,
  };

  const hideWorktreeKey = useCallback((key: string) => {
    setHiddenWorktreeKeys((current) => addEphemeralHiddenWorktreeKey(current, key));
  }, []);

  // Built WITHOUT `renderedActive`: that argument filters and orders by what
  // the sidebar currently renders, so a collapsed orchestrator would drop its
  // sub-agents. Both the header strip and the route→worktree match need the
  // complete set — a tab you cannot see is a conversation you cannot reach, and
  // deep-linking straight to a collapsed sub-agent must still select its card.
  // Also built from UNSCOPED conversations: `worktreeGroups` above is what the
  // sidebar renders, but this one answers the route. Narrowing the project
  // filter must not make the routed conversation's worktree unresolvable, which
  // would blank the chat header's name and its tab strip.
  const completeWorktreeGroups = useMemo(
    () =>
      filterHiddenSidebarWorktreeGroups(
        buildSidebarWorktreeGroups({
          active: unscopedActiveThreads,
          snoozed: unscopedSnoozedThreads,
          settled: unscopedSettledThreads,
          drafts: unscopedDraftRows,
          projectsByKey: worktreeProjectsByKey,
        }),
        hiddenWorktreeKeys,
      ),
    [
      hiddenWorktreeKeys,
      unscopedActiveThreads,
      unscopedDraftRows,
      unscopedSettledThreads,
      unscopedSnoozedThreads,
      worktreeProjectsByKey,
    ],
  );
  // One source of truth for "which worktree am I in", shared by the card list
  // and the header tab strip so the two surfaces can never disagree.
  const activeWorktreeKey = useMemo(
    () =>
      resolveActiveWorktreeKey({
        routeThreadKey,
        routeDraftId,
        worktreeGroups: completeWorktreeGroups,
        overrideKey: activeWorktreeOverrideKey,
      }),
    [activeWorktreeOverrideKey, completeWorktreeGroups, routeDraftId, routeThreadKey],
  );
  const activeWorktreeGroup = useMemo(
    () => completeWorktreeGroups.find((group) => group.key === activeWorktreeKey) ?? null,
    [activeWorktreeKey, completeWorktreeGroups],
  );

  const worktreesSection: SidebarWorktreesSection = {
    worktreeGroups,
    expandedWorktreeGroups,
    repositoryGroups,
    repositoryHierarchyVisible,
    activeWorktreeKey,
    activeWorktreeGroup,
    setActiveWorktreeOverrideKey,
    worktreeExpandedByKey,
    setWorktreeExpanded,
    reorderWorktree,
    removingWorktreeKey,
    settlingWorktreeKey,
    setRemovingWorktreeKey,
    setSettlingWorktreeKey,
    hideWorktreeKey,
  };

  return {
    route,
    projects: projectsSection,
    threads: threadsSection,
    worktrees: worktreesSection,
    runtime: {
      router,
      keybindings,
      newThreadContext,
      settleThread,
      settleThreads,
      deleteWorktree,
      unsettleThread,
      snoozeThread,
      unsnoozeThread,
      deleteThreads,
      updateThreadMetadata,
      clearSelection,
      setSelectionAnchor,
      markThreadUnread,
      handleNewThreadRef,
      copyProjectPath,
      openAddProjectCommandPalette,
      deleteProject,
      updateProject,
      updateSettings,
      threads,
      projectGroupingSettings,
      routeTargetRef,
      settlingThreadKeysRef,
    },
  };
}
