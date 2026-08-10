import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import { normalizeProjectPathForComparison } from "../lib/projectPaths";
import {
  createEmptySidebarConversationStateCounts,
  hasUnacknowledgedDoneState,
  hasUnseenFailure,
  resolveSidebarConversationAggregateState,
  resolveSidebarConversationSummaryState,
  type SidebarConversationStateCounts,
  type ThreadPresentationInput,
} from "./Sidebar.summaryState";

export interface WorktreeDraftRow {
  readonly draftId: string;
  readonly environmentId: EnvironmentId;
  /** The thread this draft becomes once its first message lands. */
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly envMode: "local" | "worktree";
  readonly title: string;
  readonly baseBranch: string | null;
  /** Set when the draft targets a worktree that already exists. */
  readonly worktreePath: string | null;
  readonly createdAt: string;
}

export interface SidebarWorktreeGroup {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string | null;
  readonly projectRoot: string | null;
  readonly environmentLabel: string | null;
  readonly label: string;
  readonly isProjectCheckout: boolean;
  readonly stateCounts: SidebarWorktreeStateCounts;
  /**
   * The single state the worktree card reports, or null when the worktree
   * holds no conversation to report on.
   */
  readonly summaryState: SidebarWorktreeSummaryState | null;
  /** Pull request that most recently merged this worktree, when known. */
  readonly mergedChangeRequestNumber: number | null;
  /** Earliest conversation or draft creation in this worktree. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly drafts: readonly WorktreeDraftRow[];
  readonly active: readonly EnvironmentThreadShell[];
  readonly snoozed: readonly EnvironmentThreadShell[];
  readonly unsettled: readonly EnvironmentThreadShell[];
  readonly conversationCount: number;
  readonly workingConversationCount: number;
}

export type SidebarWorktreeStateCounts = SidebarConversationStateCounts;

/**
 * The one state a worktree reports, in the order it is resolved. An
 * unacknowledged failure outranks everything: it is the only state that needs
 * a human *and* says something already went wrong.
 */
export type SidebarWorktreeSummaryState = "failed" | "needsInput" | "working" | "done" | "settled";

/** The live half of the priority — settled is a fallback, not a conversation state. */
const WORKTREE_LIVE_SUMMARY_PRIORITY = ["failed", "needsInput", "working", "done"] as const;

/**
 * The worktree's single state, or null when it has nothing to report.
 *
 * Null is the deliberate answer for a worktree holding only drafts, or nothing
 * at all: the alternative is inventing a sixth "empty" state or lying with one
 * of the five. The card simply shows no state.
 */
export function resolveSidebarWorktreeSummaryState(input: {
  /** Every unsettled conversation in the worktree, snoozed included. */
  readonly conversations: readonly ThreadPresentationInput[];
  readonly settledCount: number;
}): SidebarWorktreeSummaryState | null {
  const states = new Set<SidebarWorktreeSummaryState>();
  for (const conversation of input.conversations) {
    const state = resolveSidebarConversationAggregateState(conversation);
    if (state === "failed" && !hasUnseenFailure(conversation)) continue;
    if (state === "done" && !hasUnacknowledgedDoneState(conversation)) continue;
    states.add(state);
  }
  for (const state of WORKTREE_LIVE_SUMMARY_PRIORITY) {
    if (states.has(state)) return state;
  }
  return input.settledCount > 0 ? "settled" : null;
}

export type SidebarProjectState = SidebarWorktreeSummaryState | "idle";

const PROJECT_STATE_PRIORITY = [
  ...WORKTREE_LIVE_SUMMARY_PRIORITY,
  "settled",
] as const satisfies readonly SidebarWorktreeSummaryState[];

/**
 * A project reports the most urgent state among its worktrees, using the same
 * priority — so a repository row and the worktree row inside it can never
 * disagree about which conversation is shouting loudest.
 */
export function resolveSidebarProjectState(
  worktrees: readonly Pick<SidebarWorktreeGroup, "summaryState">[],
): SidebarProjectState {
  for (const state of PROJECT_STATE_PRIORITY) {
    if (worktrees.some((worktree) => worktree.summaryState === state)) return state;
  }
  return "idle";
}

export interface SidebarWorktreeActionAvailability {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export function resolveSidebarWorktreeDeleteAction(input: {
  readonly isProjectCheckout: boolean;
  readonly worktreeCreated: boolean;
  readonly isRemoving: boolean;
  readonly isSettling: boolean;
}): SidebarWorktreeActionAvailability {
  if (input.isProjectCheckout) {
    return {
      enabled: false,
      disabledReason: "The current checkout cannot be deleted.",
    };
  }
  if (!input.worktreeCreated) {
    return {
      enabled: false,
      disabledReason: "This worktree has not been created yet.",
    };
  }
  if (input.isRemoving) {
    return {
      enabled: false,
      disabledReason: "Another worktree is being deleted.",
    };
  }
  if (input.isSettling) {
    return { enabled: false, disabledReason: "A worktree is being settled." };
  }
  return { enabled: true, disabledReason: null };
}

export type SidebarWorktreeConversationLocation = {
  readonly branch: string;
  readonly worktreePath: string | null;
  readonly envMode: "local" | "worktree";
  readonly startFromOrigin: false;
};

export function sidebarLocationContextMenuItems(input: {
  readonly isProjectLocation: boolean;
}): ReadonlyArray<{
  readonly id: "new-conversation" | "new-worktree";
  readonly label: string;
}> {
  return [
    { id: "new-conversation", label: "New conversation here" },
    ...(input.isProjectLocation
      ? ([{ id: "new-worktree", label: "New worktree here" }] as const)
      : []),
  ];
}

export interface SidebarRepositoryGroup<
  TProject extends {
    readonly projectKey: string;
    readonly memberProjectRefs: readonly {
      readonly environmentId: string;
      readonly projectId: string;
    }[];
  },
> {
  readonly project: TProject;
  readonly worktrees: readonly SidebarWorktreeGroup[];
  readonly state: SidebarProjectState;
  readonly conversationCount: number;
  readonly workingConversationCount: number;
}

interface ProjectWorkspace {
  readonly workspaceRoot: string;
  readonly environmentLabel: string | null;
}

export function sidebarWorkspaceKey(environmentId: string, workspaceRoot: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(workspaceRoot)}`;
}

/**
 * The key every project-keyed lookup in the sidebar and the tab strip uses.
 *
 * Exported because the lookups are built in several places while
 * `resolveSidebarConversationWorktreeKey` reads them here: a divergence in the
 * format would hide conversations rather than fail, so there is one spelling.
 */
export function sidebarProjectKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

/** The `sidebarProjectKey` → checkout-root map that key resolution reads. */
export function buildProjectRootByProjectKey(
  projects: readonly {
    readonly environmentId: string;
    readonly id: string;
    readonly workspaceRoot: string;
  }[],
): ReadonlyMap<string, string> {
  return new Map(
    projects.map((project) => [
      sidebarProjectKey(project.environmentId, project.id),
      project.workspaceRoot,
    ]),
  );
}

/**
 * Which worktree group a single conversation belongs to.
 *
 * `buildSidebarWorktreeGroups` answers this by bucketing everything at once,
 * which is the wrong shape for a caller holding one conversation and asking
 * "is this one mine" — the chat header's tab strip, for instance. The two must
 * agree, so the key derivation lives here beside the grouping that defines it.
 *
 * Null means the conversation's project is unknown, which is also the condition
 * under which grouping drops it.
 */
export function resolveSidebarConversationWorktreeKey(input: {
  readonly environmentId: string;
  readonly projectId: string;
  /** The tree it lives in. Null falls back to the project's own checkout. */
  readonly worktreePath: string | null;
  readonly projectRootByProjectKey: ReadonlyMap<string, string>;
}): string | null {
  const projectRoot = input.projectRootByProjectKey.get(
    sidebarProjectKey(input.environmentId, input.projectId),
  );
  if (projectRoot === undefined) return null;
  return sidebarWorkspaceKey(input.environmentId, input.worktreePath ?? projectRoot);
}

/**
 * The same answer for a draft, which has one case a thread cannot have.
 *
 * A worktree draft with no path is asking for a tree that does not exist yet,
 * so grouping gives it a placeholder group of its own rather than filing it
 * under the project checkout. Mirrors the draft branches of
 * `buildSidebarWorktreeGroups`.
 */
export function resolveSidebarDraftWorktreeKey(input: {
  /** Narrower than `WorktreeDraftRow` so callers holding a tab can ask too. */
  readonly draft: Pick<
    WorktreeDraftRow,
    "draftId" | "environmentId" | "projectId" | "envMode" | "worktreePath"
  >;
  readonly projectRootByProjectKey: ReadonlyMap<string, string>;
}): string | null {
  const { draft } = input;
  if (draft.envMode === "worktree" && draft.worktreePath == null) {
    return `new-worktree:${draft.environmentId}:${draft.projectId}:${draft.draftId}`;
  }
  return resolveSidebarConversationWorktreeKey({
    environmentId: draft.environmentId,
    projectId: draft.projectId,
    worktreePath: draft.envMode === "local" ? null : draft.worktreePath,
    projectRootByProjectKey: input.projectRootByProjectKey,
  });
}

function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSidebarWorktreeGroups(input: {
  readonly active: readonly EnvironmentThreadShell[];
  readonly renderedActive?: readonly EnvironmentThreadShell[];
  readonly snoozed: readonly EnvironmentThreadShell[];
  readonly settled?: readonly EnvironmentThreadShell[];
  readonly drafts: readonly WorktreeDraftRow[];
  readonly projectsByKey: ReadonlyMap<string, ProjectWorkspace>;
  readonly lastVisitedAtByThreadKey?: ReadonlyMap<string, string>;
}): SidebarWorktreeGroup[] {
  const groups = new Map<
    string,
    {
      environmentId: EnvironmentId;
      projectId: ProjectId;
      workspaceRoot: string | null;
      projectRoot: string | null;
      environmentLabel: string | null;
      label: string;
      isProjectCheckout: boolean;
      createdAt: number;
      updatedAt: number;
      drafts: WorktreeDraftRow[];
      active: EnvironmentThreadShell[];
      snoozed: EnvironmentThreadShell[];
      settledCount: number;
      mergedChangeRequestNumber: number | null;
      mergedChangeRequestUpdatedAt: number;
    }
  >();

  type PendingWorktreeGroup = NonNullable<ReturnType<typeof groups.get>>;

  /**
   * One place a worktree group starts life.
   *
   * There were three near-identical literals here, and they had already drifted:
   * two of them hardcoded `isProjectCheckout: false`, so a draft that landed in
   * the project's own checkout before any thread did created a group flagged as
   * a worktree — which then sorted below its true position, since project
   * checkouts sort first.
   */
  const startGroup = (seed: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly workspaceRoot: string | null;
    readonly project: ProjectWorkspace;
    readonly label: string;
  }): PendingWorktreeGroup => ({
    environmentId: seed.environmentId,
    projectId: seed.projectId,
    workspaceRoot: seed.workspaceRoot,
    projectRoot: seed.project.workspaceRoot,
    environmentLabel: seed.project.environmentLabel,
    label: seed.label,
    isProjectCheckout:
      seed.workspaceRoot !== null &&
      normalizeProjectPathForComparison(seed.workspaceRoot) ===
        normalizeProjectPathForComparison(seed.project.workspaceRoot),
    createdAt: Number.POSITIVE_INFINITY,
    updatedAt: 0,
    drafts: [],
    active: [],
    snoozed: [],
    settledCount: 0,
    mergedChangeRequestNumber: null,
    mergedChangeRequestUpdatedAt: 0,
  });

  const addThread = (thread: EnvironmentThreadShell, bucket: "active" | "snoozed" | "settled") => {
    if (bucket === "settled" && thread.providerSubagent != null) return;
    const project = input.projectsByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (!project) return;
    const workspaceRoot = thread.worktreePath ?? project.workspaceRoot;
    const key = sidebarWorkspaceKey(thread.environmentId, workspaceRoot);
    const current =
      groups.get(key) ??
      startGroup({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        workspaceRoot,
        project,
        label: thread.branch ?? basename(workspaceRoot),
      });
    if (bucket === "settled") {
      current.settledCount += 1;
    } else {
      current[bucket].push(thread);
    }
    current.createdAt = Math.min(current.createdAt, timestamp(thread.createdAt));
    const nextUpdatedAt = timestamp(thread.updatedAt);
    if (
      thread.settledChangeRequestNumber !== undefined &&
      nextUpdatedAt >= current.mergedChangeRequestUpdatedAt
    ) {
      current.mergedChangeRequestNumber = thread.settledChangeRequestNumber;
      current.mergedChangeRequestUpdatedAt = nextUpdatedAt;
    }
    if (nextUpdatedAt >= current.updatedAt) {
      current.updatedAt = nextUpdatedAt;
      current.label = thread.branch ?? basename(workspaceRoot);
    }
    groups.set(key, current);
  };

  for (const thread of input.active) addThread(thread, "active");
  for (const thread of input.snoozed) addThread(thread, "snoozed");
  for (const thread of input.settled ?? []) addThread(thread, "settled");

  for (const draft of input.drafts) {
    const project = input.projectsByKey.get(`${draft.environmentId}:${draft.projectId}`);
    if (!project) continue;
    if (draft.envMode === "local") {
      const key = sidebarWorkspaceKey(draft.environmentId, project.workspaceRoot);
      const current =
        groups.get(key) ??
        startGroup({
          environmentId: draft.environmentId,
          projectId: draft.projectId,
          workspaceRoot: project.workspaceRoot,
          project,
          label: draft.baseBranch ?? basename(project.workspaceRoot),
        });
      current.drafts.push(draft);
      current.createdAt = Math.min(current.createdAt, timestamp(draft.createdAt));
      current.updatedAt = Math.max(current.updatedAt, timestamp(draft.createdAt));
      groups.set(key, current);
      continue;
    }
    // A worktree draft pointed at an existing tree belongs to that tree's
    // group, not to a "New worktree" placeholder — otherwise starting a second
    // conversation in a worktree appears to leave it.
    if (draft.worktreePath != null) {
      const key = sidebarWorkspaceKey(draft.environmentId, draft.worktreePath);
      const current =
        groups.get(key) ??
        startGroup({
          environmentId: draft.environmentId,
          projectId: draft.projectId,
          workspaceRoot: draft.worktreePath,
          project,
          label: draft.baseBranch ?? basename(draft.worktreePath),
        });
      current.drafts.push(draft);
      current.createdAt = Math.min(current.createdAt, timestamp(draft.createdAt));
      current.updatedAt = Math.max(current.updatedAt, timestamp(draft.createdAt));
      groups.set(key, current);
      continue;
    }
    const key = `new-worktree:${draft.environmentId}:${draft.projectId}:${draft.draftId}`;
    groups.set(key, {
      ...startGroup({
        environmentId: draft.environmentId,
        projectId: draft.projectId,
        workspaceRoot: null,
        project,
        label: `New worktree · ${draft.title}`,
      }),
      createdAt: timestamp(draft.createdAt),
      updatedAt: timestamp(draft.createdAt),
      drafts: [draft],
    });
  }

  // `renderedActive` is the flattened thread tree: it decides both which active
  // threads render (collapsed sub-agents are absent) and in what order (each
  // orchestrator immediately followed by its sub-agents). Grouping is bucketing
  // only — re-emitting `group.active` in its own arrival order would put a
  // sub-agent row at its sort position instead of under its parent.
  const renderedActiveOrder =
    input.renderedActive === undefined
      ? null
      : new Map(
          input.renderedActive.map(
            (thread, index) => [`${thread.environmentId}:${thread.id}`, index] as const,
          ),
        );

  return [...groups.entries()]
    .map(([key, group]): SidebarWorktreeGroup => {
      // Native children remain in active/snoozed so a routed native transcript
      // can still resolve its worktree. They share their owner's session,
      // though, so they are not independent conversations for counts or status.
      const unsettled = [...group.active, ...group.snoozed].filter(
        (thread) => thread.providerSubagent == null,
      );
      const stateCounts = createEmptySidebarConversationStateCounts();
      stateCounts.stale = group.drafts.length;
      stateCounts.settled = group.settledCount;
      for (const thread of unsettled) {
        stateCounts[resolveSidebarConversationSummaryState(thread)] += 1;
      }
      const unsettledConversationCount = group.drafts.length + unsettled.length;
      const conversations = unsettled.map((thread) => ({
        ...thread,
        lastVisitedAt: input.lastVisitedAtByThreadKey?.get(`${thread.environmentId}:${thread.id}`),
      }));
      return {
        key,
        environmentId: group.environmentId,
        projectId: group.projectId,
        workspaceRoot: group.workspaceRoot,
        projectRoot: group.projectRoot,
        environmentLabel: group.environmentLabel,
        label: group.label,
        isProjectCheckout: group.isProjectCheckout,
        stateCounts,
        summaryState: resolveSidebarWorktreeSummaryState({
          conversations,
          settledCount: group.settledCount,
        }),
        mergedChangeRequestNumber: group.mergedChangeRequestNumber,
        createdAt: Number.isFinite(group.createdAt) ? group.createdAt : 0,
        updatedAt: group.updatedAt,
        drafts: group.drafts,
        active:
          renderedActiveOrder === null
            ? group.active
            : group.active
                .filter((thread) => renderedActiveOrder.has(`${thread.environmentId}:${thread.id}`))
                .toSorted(
                  (left, right) =>
                    renderedActiveOrder.get(`${left.environmentId}:${left.id}`)! -
                    renderedActiveOrder.get(`${right.environmentId}:${right.id}`)!,
                ),
        snoozed: group.snoozed,
        unsettled,
        conversationCount: unsettledConversationCount + group.settledCount,
        workingConversationCount: stateCounts.working,
      };
    })
    .toSorted(
      (left, right) => left.createdAt - right.createdAt || left.label.localeCompare(right.label),
    );
}

export function buildSidebarRepositoryGroups<
  TProject extends {
    readonly projectKey: string;
    readonly memberProjectRefs: readonly {
      readonly environmentId: string;
      readonly projectId: string;
    }[];
  },
>(input: {
  readonly projects: readonly TProject[];
  readonly worktrees: readonly SidebarWorktreeGroup[];
}): SidebarRepositoryGroup<TProject>[] {
  const repositoryKeyByProjectRef = new Map(
    input.projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}:${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const worktreesByRepositoryKey = new Map<string, SidebarWorktreeGroup[]>();
  for (const worktree of input.worktrees) {
    const repositoryKey = repositoryKeyByProjectRef.get(
      `${worktree.environmentId}:${worktree.projectId}`,
    );
    if (repositoryKey === undefined) continue;
    const repositoryWorktrees = worktreesByRepositoryKey.get(repositoryKey);
    if (repositoryWorktrees) {
      repositoryWorktrees.push(worktree);
    } else {
      worktreesByRepositoryKey.set(repositoryKey, [worktree]);
    }
  }

  return input.projects.map((project) => {
    const worktrees = worktreesByRepositoryKey.get(project.projectKey) ?? [];
    return {
      project,
      worktrees,
      state: resolveSidebarProjectState(worktrees),
      conversationCount: worktrees.reduce(
        (total, worktree) => total + worktree.conversationCount,
        0,
      ),
      workingConversationCount: worktrees.reduce(
        (total, worktree) => total + worktree.workingConversationCount,
        0,
      ),
    };
  });
}

/** Manual ordering stays inside one logical repository, or one ungrouped physical project. */
export function canReorderSidebarWorktrees(input: {
  readonly repositories: readonly {
    readonly worktrees: readonly Pick<SidebarWorktreeGroup, "key">[];
  }[];
  readonly worktrees: readonly {
    readonly key: string;
    readonly environmentId: string;
    readonly projectId: string;
  }[];
  readonly draggedWorktreeKey: string;
  readonly targetWorktreeKey: string;
}): boolean {
  for (const repository of input.repositories) {
    let includesDragged = false;
    let includesTarget = false;
    for (const worktree of repository.worktrees) {
      includesDragged ||= worktree.key === input.draggedWorktreeKey;
      includesTarget ||= worktree.key === input.targetWorktreeKey;
    }
    if (includesDragged && includesTarget) return true;
  }

  const dragged = input.worktrees.find((worktree) => worktree.key === input.draggedWorktreeKey);
  const target = input.worktrees.find((worktree) => worktree.key === input.targetWorktreeKey);
  return (
    dragged !== undefined &&
    target !== undefined &&
    dragged.environmentId === target.environmentId &&
    dragged.projectId === target.projectId
  );
}
export function sidebarWorktreeHasVisibleChildren(
  worktree: Pick<SidebarWorktreeGroup, "drafts" | "active" | "snoozed">,
): boolean {
  return worktree.drafts.length + worktree.active.length + worktree.snoozed.length > 0;
}

/**
 * Filters worktrees hidden by an ephemeral optimistic-delete set.
 *
 * Hide only while the authoritative projection still surfaces a settled-only
 * (or empty) group for the same key. Visible children unhide immediately so a
 * recreated path is never stuck behind a stale hide.
 */
export function filterHiddenSidebarWorktreeGroups(
  worktrees: readonly SidebarWorktreeGroup[],
  hiddenWorktreeKeys: ReadonlySet<string>,
): SidebarWorktreeGroup[] {
  return worktrees.filter((worktree) => {
    if (!hiddenWorktreeKeys.has(worktree.key)) return true;
    return sidebarWorktreeHasVisibleChildren(worktree);
  });
}

/** @deprecated Use filterHiddenSidebarWorktreeGroups with a Set. */
export function filterRemovedSidebarWorktreeGroups(
  worktrees: readonly SidebarWorktreeGroup[],
  removedWorktreeAtByKey: Readonly<Record<string, string>> | ReadonlySet<string>,
): SidebarWorktreeGroup[] {
  const hidden =
    removedWorktreeAtByKey instanceof Set
      ? removedWorktreeAtByKey
      : new Set(Object.keys(removedWorktreeAtByKey));
  return filterHiddenSidebarWorktreeGroups(worktrees, hidden);
}

export function resolveSidebarWorktreeConversationLocation(
  group: Pick<SidebarWorktreeGroup, "isProjectCheckout" | "label" | "workspaceRoot">,
): SidebarWorktreeConversationLocation | null {
  if (group.isProjectCheckout) {
    return {
      branch: group.label,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    };
  }
  if (group.workspaceRoot === null) {
    return null;
  }
  return {
    branch: group.label,
    worktreePath: group.workspaceRoot,
    envMode: "worktree",
    startFromOrigin: false,
  };
}
