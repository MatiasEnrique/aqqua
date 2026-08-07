import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type { AtomCommand, AtomCommandResult } from "@aqqua/client-runtime/state/runtime";
import { effectiveSettled, effectiveSnoozed } from "@aqqua/client-runtime/state/thread-settled";
import type { ServerConfig } from "@aqqua/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { openCommandPalette } from "../../commandPaletteBus";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../../threadRoutes";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../../uiStateStore";
import {
  firstValidTimestampMs,
  orderItemsByPreferredIds,
  selectSidebarDraftRows,
  sortLogicalProjectsForSidebar,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
} from "../Sidebar.logic";
import { inheritSettledFromOrchestrators } from "../Sidebar.threadTree";
import {
  buildProjectRootByProjectKey,
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  canReorderSidebarWorktrees,
  filterHiddenSidebarWorktreeGroups,
  sidebarProjectKey,
} from "../Sidebar.worktreeGroups";
import { useSidebar } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { resolveActiveWorktreeKey } from "./activeWorktree";
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
import {
  EMPTY_PROJECT_SCOPE_SELECTION,
  type ProjectScopeSelection,
  projectScopeSelectionFromKeys,
  projectScopeSelectionKey,
  pruneProjectScopeSelection,
  resolveSelectedProjectGroups,
  resolveSoleScopedProjectGroup,
} from "./projectScopeSelection";

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
  readonly deleteWorktree: ReturnType<typeof useThreadActions>["deleteWorktree"];
  readonly clearSelection: () => void;
  readonly setSelectionAnchor: (threadKey: string) => void;
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
  readonly routeTargetRef: {
    current: ReturnType<typeof resolveThreadRouteTarget>;
  };
};

/**
 * Owns sidebar read-model derivation, split into cohesive domain sections.
 * Controllers consume `runtime` + the sections they need; the view never sees
 * the flat bag of every intermediate binding.
 */
export function useSidebarV2Sections(): SidebarV2Sections {
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
  const { deleteWorktree } = useThreadActions();
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const updateSettings = useUpdateClientSettings();
  const { copyToClipboard: copyProjectPath } = useCopyToClipboard<{
    path: string;
  }>({
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
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const threadLastVisitedAts = useUiStateStore(
    useShallow((state) =>
      threads.map(
        (thread) =>
          state.threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ] ?? null,
      ),
    ),
  );
  const lastVisitedAtByThreadKey = useMemo(
    () =>
      new Map(
        threads.flatMap((thread, index) => {
          const lastVisitedAt = threadLastVisitedAts[index];
          return lastVisitedAt === null || lastVisitedAt === undefined
            ? []
            : [
                [
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  lastVisitedAt,
                ] as const,
              ];
        }),
      ),
    [threadLastVisitedAts, threads],
  );
  const projectExpandedById = useUiStateStore((s) => s.projectExpandedById);
  const setProjectExpanded = useUiStateStore((s) => s.setProjectExpanded);
  const activeWorktreeOverrideKey = useUiStateStore((s) => s.activeWorktreeOverrideKey);
  const setActiveWorktreeOverrideKey = useUiStateStore((s) => s.setActiveWorktreeOverrideKey);
  const [hiddenWorktreeKeys, setHiddenWorktreeKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [removingWorktreeKey, setRemovingWorktreeKey] = useState<string | null>(null);
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
    void projectScopeKey;
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
        if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) return "snoozed";
        if (
          supportsSettlement &&
          effectiveSettled(thread, {
            now,
            autoSettleAfterDays,
            changeRequestState: null,
          })
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
    };
  }, [autoSettleAfterDays, nowMinute, scopedProjectKeys, serverConfigs, snoozeWakeTick, threads]);
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
  const unfilteredWorktreeGroups = useMemo(
    () =>
      buildSidebarWorktreeGroups({
        active: activeThreads,
        snoozed: snoozedThreads,
        settled: settledThreads,
        drafts: groupedDraftRows,
        projectsByKey: worktreeProjectsByKey,
        lastVisitedAtByThreadKey,
      }),
    [
      activeThreads,
      groupedDraftRows,
      lastVisitedAtByThreadKey,
      settledThreads,
      snoozedThreads,
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
    rememberWorktreeOrder(visibleWorktreeGroups.map((worktree) => worktree.key));
  }, [rememberWorktreeOrder, visibleWorktreeGroups]);
  const worktreeGroups = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: visibleWorktreeGroups,
        preferredIds: worktreeOrder,
        getId: (worktree) => worktree.key,
      }),
    [visibleWorktreeGroups, worktreeOrder],
  );
  const repositoryGroups = useMemo(
    () =>
      buildSidebarRepositoryGroups({
        projects: projectGroups,
        worktrees: worktreeGroups,
      }),
    [projectGroups, worktreeGroups],
  );
  const reorderWorktree = useCallback(
    (draggedWorktreeKey: string, targetWorktreeKey: string) => {
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
    [reorderWorktrees, repositoryGroups, worktreeGroups],
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
  const orderedThreads = useMemo(
    () => [...activeThreads, ...snoozedThreads, ...settledThreads],
    [activeThreads, settledThreads, snoozedThreads],
  );
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
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
  // handleNewThread is inherently unstable (depends on the projects list);
  // a ref keeps it out of attemptSettle's dependency array.
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;

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
    orderedThreadKeys,
    threadByKey,
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
          lastVisitedAtByThreadKey,
        }),
        hiddenWorktreeKeys,
      ),
    [
      hiddenWorktreeKeys,
      lastVisitedAtByThreadKey,
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
    repositoryGroups,
    activeWorktreeKey,
    activeWorktreeGroup,
    setActiveWorktreeOverrideKey,
    reorderWorktree,
    removingWorktreeKey,
    setRemovingWorktreeKey,
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
      deleteWorktree,
      clearSelection,
      setSelectionAnchor,
      handleNewThreadRef,
      copyProjectPath,
      openAddProjectCommandPalette,
      deleteProject,
      updateProject,
      updateSettings,
      threads,
      projectGroupingSettings,
      routeTargetRef,
    },
  };
}
