import { useAtomValue } from "@effect/atom-react";
import type { AtomCommand, AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { effectiveSettled, effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { ServerConfig, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "@tanstack/react-router";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../../keybindings";
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
  buildSidebarThreadTree,
  filterVisibleSidebarThreadEntries,
  shouldReserveThreadExpandGutter,
} from "../Sidebar.threadTree";
import {
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  filterExpandedSidebarWorktreeGroups,
  filterHiddenSidebarWorktreeGroups,
} from "../Sidebar.worktreeGroups";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSidebar } from "../ui/sidebar";
import { useComposerDraftStore } from "../../composerDraftStore";
import { SETTLED_TAIL_INITIAL_COUNT, SETTLED_TAIL_PAGE_COUNT } from "./constants";
import {
  addEphemeralHiddenWorktreeKey,
  nextEphemeralHiddenWorktreeKeys,
} from "./ephemeralHiddenWorktrees";
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
export function useSidebarV2Sections(): SidebarV2Sections {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = useThreadShells();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const autoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sidebarThreadGroupingMode = useClientSettings((s) => s.sidebarThreadGroupingMode);
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
  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
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
  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );
  const worktreeProjectsByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
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

  // Project scope: one menu above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  const [projectScopeKey, setProjectScopeKey] = useState<string | null>(null);
  const scopedProjectGroup = useMemo(
    () =>
      projectScopeKey === null
        ? null
        : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null),
    [projectGroups, projectScopeKey],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : new Set(
            scopedProjectGroup.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
    [scopedProjectGroup],
  );
  useEffect(() => {
    if (projectScopeKey !== null && scopedProjectGroup === null) {
      setProjectScopeKey(null);
    }
  }, [projectScopeKey, scopedProjectGroup]);
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKey]);

  // Settled threads stay in the live shell stream (settled ≠ archived), so
  // the partition works directly off live shells: no archived-snapshot
  // merging, no optimistic holds. Archived threads remain hidden here —
  // archive keeps its original "remove from sidebar" meaning.
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { activeThreads, snoozedThreads, settledThreads, snoozeNow } = useMemo(() => {
    const now = `${nowMinute}:00.000Z`;
    // Snooze classification uses a REAL clock, not the quantized minute:
    // wake times are second-precise and a woken thread must not linger on
    // the shelf for the rest of the minute. snoozeWakeTick re-runs this
    // memo exactly at the next wake boundary.
    void snoozeWakeTick;
    const preciseNow = new Date().toISOString();
    const visible = threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
    );
    const active: EnvironmentThreadShell[] = [];
    const snoozed: EnvironmentThreadShell[] = [];
    const settled: EnvironmentThreadShell[] = [];
    for (const thread of visible) {
      // Threads on servers without the settlement capability (old server,
      // or descriptor not loaded yet) never classify as settled: the user
      // could neither un-settle nor pin them, so auto-settling them would
      // strand rows in a tail with no working affordances.
      const supportsSettlement =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement === true;
      const supportsSnooze =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const changeRequestState = changeRequestStateByKey.get(threadKey) ?? null;
      // Snooze outranks settled classification: an explicitly snoozed thread
      // belongs to the shelf even if it would also auto-settle (the shelf's
      // wake time is a stronger statement about when it matters again).
      if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) {
        snoozed.push(thread);
      } else if (
        supportsSettlement &&
        effectiveSettled(thread, { now, autoSettleAfterDays, changeRequestState })
      ) {
        settled.push(thread);
      } else {
        active.push(thread);
      }
    }
    return {
      activeThreads: sortThreadsForSidebarV2(active),
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozedThreads: snoozed.toSorted(
        (left, right) =>
          firstValidTimestampMs(left.snoozedUntil ?? null) -
          firstValidTimestampMs(right.snoozedUntil ?? null),
      ),
      settledThreads: sortSettledThreadsForSidebarV2(settled),
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
  const { activeTreeMetaByKey, expandedThreadKeys, reserveSubAgentGutter, visibleActiveThreads } =
    useMemo(() => {
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
      return {
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
  const draftRows = useMemo(
    () => groupedDraftRows.filter((draft) => draft.envMode === "worktree"),
    [groupedDraftRows],
  );

  // The settled tail renders in pages: history shouldn't dominate the
  // sidebar, and the common lookups are recent. Expansion resets when the
  // filter context changes so a scope/search flip never inherits a deep
  // page state.
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  const settledResetKey = projectScopeKey ?? "all";
  const lastSettledResetKeyRef = useRef(settledResetKey);
  if (lastSettledResetKeyRef.current !== settledResetKey) {
    lastSettledResetKeyRef.current = settledResetKey;
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }
  const visibleSettledThreads = useMemo(() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    // The open thread must never hide under "Show more": navigating into a
    // deep settled thread (search, deep link) pulls its row into the visible
    // tail so the highlight and the un-settle affordance stay reachable.
    if (routeThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find(
          (thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
        );
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  }, [routeThreadKey, settledThreads, settledVisibleCount]);
  const hiddenSettledCount = settledThreads.length - visibleSettledThreads.length;
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
  const worktreeGroups = useMemo(
    () => filterHiddenSidebarWorktreeGroups(unfilteredWorktreeGroups, hiddenWorktreeKeys),
    [hiddenWorktreeKeys, unfilteredWorktreeGroups],
  );
  const repositoryGroups = useMemo(
    () => buildSidebarRepositoryGroups({ projects: projectGroups, worktrees: worktreeGroups }),
    [projectGroups, worktreeGroups],
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
    sidebarThreadGroupingMode === "worktree" && projectScopeKey === null;
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
    projectScopeKey,
    setProjectScopeKey,
    scopedProjectGroup,
    scopedProjectKeys,
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
    expandedThreadKeys,
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
    jumpLabelByKey,
    showJumpHints,
    setShowJumpHints,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    settledShelfExpanded,
    toggleSettledShelf,
    hiddenSettledCount,
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

  const worktreesSection: SidebarWorktreesSection = {
    worktreeGroups,
    expandedWorktreeGroups,
    repositoryGroups,
    repositoryHierarchyVisible,
    worktreeExpandedByKey,
    setWorktreeExpanded,
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
