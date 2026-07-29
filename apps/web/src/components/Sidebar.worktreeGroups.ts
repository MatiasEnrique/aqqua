import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { normalizeProjectPathForComparison } from "../lib/projectPaths";
import { resolveSidebarConversationSummaryState } from "./Sidebar.summaryState";

export interface WorktreeDraftRow {
  readonly draftId: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly envMode: "local" | "worktree";
  readonly title: string;
  readonly baseBranch: string | null;
  readonly createdAt: string;
}

export interface SidebarWorktreeGroup {
  readonly key: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly workspaceRoot: string | null;
  readonly projectRoot: string | null;
  readonly label: string;
  readonly tooltip: string;
  readonly isProjectCheckout: boolean;
  readonly status: "working" | "done" | "stale";
  readonly updatedAt: number;
  readonly drafts: readonly WorktreeDraftRow[];
  readonly active: readonly EnvironmentThreadShell[];
  readonly snoozed: readonly EnvironmentThreadShell[];
  readonly conversationCount: number;
  readonly workingConversationCount: number;
}

export type SidebarWorktreeConversationLocation = {
  readonly branch: string;
  readonly worktreePath: string | null;
  readonly envMode: "local" | "worktree";
  readonly startFromOrigin: false;
};

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
}): SidebarWorktreeGroup[] {
  const groups = new Map<
    string,
    {
      environmentId: string;
      projectId: string;
      workspaceRoot: string | null;
      projectRoot: string | null;
      environmentLabel: string | null;
      label: string;
      isProjectCheckout: boolean;
      updatedAt: number;
      drafts: WorktreeDraftRow[];
      active: EnvironmentThreadShell[];
      snoozed: EnvironmentThreadShell[];
      settledCount: number;
    }
  >();

  const addThread = (thread: EnvironmentThreadShell, bucket: "active" | "snoozed" | "settled") => {
    const project = input.projectsByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (!project) return;
    const workspaceRoot = thread.worktreePath ?? project.workspaceRoot;
    const key = sidebarWorkspaceKey(thread.environmentId, workspaceRoot);
    const current = groups.get(key) ?? {
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      workspaceRoot,
      projectRoot: project.workspaceRoot,
      environmentLabel: project.environmentLabel,
      label: thread.branch ?? basename(workspaceRoot),
      isProjectCheckout:
        normalizeProjectPathForComparison(workspaceRoot) ===
        normalizeProjectPathForComparison(project.workspaceRoot),
      updatedAt: 0,
      drafts: [],
      active: [],
      snoozed: [],
      settledCount: 0,
    };
    if (bucket === "settled") {
      current.settledCount += 1;
    } else {
      current[bucket].push(thread);
    }
    const nextUpdatedAt = timestamp(thread.updatedAt);
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
      const current = groups.get(key) ?? {
        environmentId: draft.environmentId,
        projectId: draft.projectId,
        workspaceRoot: project.workspaceRoot,
        projectRoot: project.workspaceRoot,
        environmentLabel: project.environmentLabel,
        label: draft.baseBranch ?? basename(project.workspaceRoot),
        isProjectCheckout: true,
        updatedAt: 0,
        drafts: [],
        active: [],
        snoozed: [],
        settledCount: 0,
      };
      current.drafts.push(draft);
      current.updatedAt = Math.max(current.updatedAt, timestamp(draft.createdAt));
      groups.set(key, current);
      continue;
    }
    const key = `new-worktree:${draft.environmentId}:${draft.projectId}:${draft.draftId}`;
    groups.set(key, {
      environmentId: draft.environmentId,
      projectId: draft.projectId,
      workspaceRoot: null,
      projectRoot: project.workspaceRoot,
      environmentLabel: project.environmentLabel,
      label: `New worktree · ${draft.title}`,
      isProjectCheckout: false,
      updatedAt: timestamp(draft.createdAt),
      drafts: [draft],
      active: [],
      snoozed: [],
      settledCount: 0,
    });
  }

  const renderedActiveKeys =
    input.renderedActive === undefined
      ? null
      : new Set(input.renderedActive.map((thread) => `${thread.environmentId}:${thread.id}`));

  return [...groups.entries()]
    .map(([key, group]): SidebarWorktreeGroup => {
      const conversationStates = [...group.active, ...group.snoozed].map(
        resolveSidebarConversationSummaryState,
      );
      const workingConversationCount = conversationStates.filter(
        (state) => state === "working",
      ).length;
      const unsettledConversationCount =
        group.drafts.length + group.active.length + group.snoozed.length;
      return {
        key,
        environmentId: group.environmentId,
        projectId: group.projectId,
        workspaceRoot: group.workspaceRoot,
        projectRoot: group.projectRoot,
        label: group.label,
        tooltip: `${group.workspaceRoot ?? group.projectRoot ?? "New worktree"}${
          group.environmentLabel ? ` · ${group.environmentLabel}` : ""
        }`,
        isProjectCheckout: group.isProjectCheckout,
        status:
          workingConversationCount > 0
            ? "working"
            : conversationStates.includes("done")
              ? "done"
              : "stale",
        updatedAt: group.updatedAt,
        drafts: group.drafts,
        active:
          renderedActiveKeys === null
            ? group.active
            : group.active.filter((thread) =>
                renderedActiveKeys.has(`${thread.environmentId}:${thread.id}`),
              ),
        snoozed: group.snoozed,
        conversationCount: unsettledConversationCount + group.settledCount,
        workingConversationCount,
      };
    })
    .toSorted(
      (left, right) =>
        Number(right.isProjectCheckout) - Number(left.isProjectCheckout) ||
        right.updatedAt - left.updatedAt ||
        left.label.localeCompare(right.label),
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

  return input.projects.flatMap((project) => {
    const worktrees = worktreesByRepositoryKey.get(project.projectKey);
    if (worktrees === undefined || worktrees.length === 0) return [];
    return [
      {
        project,
        worktrees,
        conversationCount: worktrees.reduce(
          (total, worktree) => total + worktree.conversationCount,
          0,
        ),
        workingConversationCount: worktrees.reduce(
          (total, worktree) => total + worktree.workingConversationCount,
          0,
        ),
      },
    ];
  });
}

export function filterExpandedSidebarWorktreeGroups<TWorktree, TRepository>(input: {
  readonly worktrees: readonly TWorktree[];
  readonly repositories: readonly TRepository[];
  readonly repositoryHierarchyVisible: boolean;
  readonly getRepositoryWorktrees: (repository: TRepository) => readonly TWorktree[];
  readonly isRepositoryExpanded: (repository: TRepository) => boolean;
  readonly isWorktreeExpanded: (worktree: TWorktree) => boolean;
}): TWorktree[] {
  const repositoryVisibleWorktrees = input.repositoryHierarchyVisible
    ? input.repositories
        .filter(input.isRepositoryExpanded)
        .flatMap((repository) => input.getRepositoryWorktrees(repository))
    : input.worktrees;
  return repositoryVisibleWorktrees.filter(input.isWorktreeExpanded);
}

export function filterRemovedSidebarWorktreeGroups(
  worktrees: readonly SidebarWorktreeGroup[],
  removedWorktreeAtByKey: Readonly<Record<string, string>>,
): SidebarWorktreeGroup[] {
  return worktrees.filter((worktree) => {
    if (removedWorktreeAtByKey[worktree.key] === undefined) return true;
    return worktree.drafts.length + worktree.active.length + worktree.snoozed.length > 0;
  });
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
