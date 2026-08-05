import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, type WorkspacePanelRef } from "@aqqua/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aqqua/client-runtime/state/runtime";
import type { EnvironmentId, GitObjectId, ScopedThreadRef } from "@aqqua/contracts";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../../diffPanelStore";
import { useOpenInPreferredEditor } from "../../editorPreferences";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { buildBaseRefChoices, filterBaseRefChoices } from "../../lib/baseRefChoices";
import { useCheckpointDiff } from "../../lib/checkpointDiffState";
import { areAllDiffFilesCollapsed } from "../../lib/diffCollapse";
import {
  buildFileDiffRenderKey,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { workspacePanelOwner } from "../../panelOwner";
import { useProject, useThread } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { reviewEnvironment } from "../../state/review";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { resolveDiffPanelCwd } from "./diffPanelGitTarget";
import { EMPTY_COLLAPSED_DIFF_FILE_KEYS } from "./diffPanelViewConfig";

export const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
export const CURRENT_BRANCH_HEAD_REF = "__current_branch_head_ref__";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

interface CommitDiffSource {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly commitId: GitObjectId;
  readonly label: string;
}

interface UseDiffPanelSourceInput {
  readonly initialGitScope: "branch" | "unstaged";
  readonly commitTarget: CommitDiffSource | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRef: WorkspacePanelRef | null;
  readonly fallbackCwd: string | null;
  readonly ignoreWhitespace: boolean;
  readonly baseRefQuery: string;
  readonly headRefQuery: string;
  readonly collapsedDiffFiles: CollapsedDiffFilesState;
  readonly resolvedTheme: "light" | "dark";
}

type WorkspaceDiffSourceInput = Omit<UseDiffPanelSourceInput, "commitTarget"> & {
  readonly enabled: boolean;
  readonly environmentIdOverride: EnvironmentId | null;
  readonly cwdOverride: string | null;
};

function useCommitDiffSourceController(target: CommitDiffSource | null) {
  const query = useEnvironmentQuery(
    target
      ? vcsEnvironment.commitDiff({
          environmentId: target.environmentId,
          input: { cwd: target.cwd, commitId: target.commitId },
        })
      : null,
  );
  return {
    query,
    source: target
      ? {
          kind: "commit" as const,
          patch: query.data?.diff,
          truncated: query.data?.truncated === true,
          pending: query.isPending,
          error: query.error,
        }
      : null,
  };
}

function makeCheckpointDiffSourceAdapter(input: {
  readonly checkpointPatch: string | undefined;
  readonly checkpointPending: boolean;
  readonly checkpointError: string | null | undefined;
}) {
  return {
    kind: "workspace" as const,
    variant: "checkpoint" as const,
    patch: input.checkpointPatch,
    truncated: false,
    pending: input.checkpointPending,
    error: input.checkpointError,
  };
}

function makeGitDiffSourceAdapter(input: {
  readonly gitPatch: string | undefined;
  readonly gitTruncated: boolean;
  readonly gitPending: boolean;
  readonly gitError: string | null | undefined;
}) {
  return {
    kind: "workspace" as const,
    variant: "git" as const,
    patch: input.gitPatch,
    truncated: input.gitTruncated,
    pending: input.gitPending,
    error: input.gitError,
  };
}

function useCheckpointDiffSourceController(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ScopedThreadRef["threadId"] | null;
  readonly fromTurnCount: number | null;
  readonly toTurnCount: number | null;
  readonly ignoreWhitespace: boolean;
  readonly cacheScope: string | null;
}) {
  const query = useCheckpointDiff(
    {
      environmentId: input.environmentId,
      threadId: input.threadId,
      fromTurnCount: input.fromTurnCount,
      toTurnCount: input.toTurnCount,
      ignoreWhitespace: input.ignoreWhitespace,
      cacheScope: input.cacheScope,
    },
    { enabled: input.enabled },
  );
  return {
    query,
    source: makeCheckpointDiffSourceAdapter({
      checkpointPatch: query.data?.diff,
      checkpointPending: query.isPending,
      checkpointError: query.error,
    }),
  };
}

function useGitDiffSourceController(input: {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly activeCwd: string | undefined;
  readonly environmentCwd: string | undefined;
  readonly selectedBaseRef: string | null;
  readonly selectedHeadRef: string | null;
  readonly selectedGitScope: "branch" | "unstaged";
  readonly ignoreWhitespace: boolean;
  readonly baseRefQuery: string;
  readonly headRefQuery: string;
}) {
  const primaryPreview = useEnvironmentQuery(
    input.enabled && input.environmentId !== null && input.activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: input.environmentId,
          input: {
            cwd: input.activeCwd,
            ...(input.selectedBaseRef ? { baseRef: input.selectedBaseRef } : {}),
            ...(input.selectedHeadRef ? { headRef: input.selectedHeadRef } : {}),
            ignoreWhitespace: input.ignoreWhitespace,
          },
        })
      : null,
  );
  const shouldRetryAtEnvironmentCwd =
    input.enabled &&
    primaryPreview.error?.includes("configured workspace root") === true &&
    input.environmentCwd !== undefined &&
    input.environmentCwd !== input.activeCwd;
  const fallbackPreview = useEnvironmentQuery(
    shouldRetryAtEnvironmentCwd && input.environmentId !== null
      ? reviewEnvironment.diffPreview({
          environmentId: input.environmentId,
          input: {
            cwd: input.environmentCwd,
            ...(input.selectedBaseRef ? { baseRef: input.selectedBaseRef } : {}),
            ...(input.selectedHeadRef ? { headRef: input.selectedHeadRef } : {}),
            ignoreWhitespace: input.ignoreWhitespace,
          },
        })
      : null,
  );
  const query = shouldRetryAtEnvironmentCwd ? fallbackPreview : primaryPreview;
  const selectedSource = query.data?.sources.find(
    (source) =>
      source.kind === (input.selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const refsInput =
    input.enabled &&
    input.selectedGitScope === "branch" &&
    input.environmentId !== null &&
    query.data?.cwd
      ? {
          environmentId: input.environmentId,
          cwd: query.data.cwd,
          query: input.headRefQuery.trim() || input.baseRefQuery.trim(),
        }
      : null;
  const localBranchRefs = useEnvironmentQuery(
    refsInput
      ? vcsEnvironment.listRefs({
          environmentId: refsInput.environmentId,
          input: {
            cwd: refsInput.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(refsInput.query ? { query: refsInput.query } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    refsInput
      ? vcsEnvironment.listRefs({
          environmentId: refsInput.environmentId,
          input: {
            cwd: refsInput.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(refsInput.query ? { query: refsInput.query } : {}),
            limit: 100,
          },
        })
      : null,
  );
  return {
    localBranchRefs,
    remoteBranchRefs,
    query,
    selectedSource,
    source: makeGitDiffSourceAdapter({
      gitPatch: selectedSource?.diff,
      gitTruncated: selectedSource?.truncated === true,
      gitPending: query.isPending,
      gitError: query.error,
    }),
  };
}

type NormalizedDiffSource =
  | NonNullable<ReturnType<typeof useCommitDiffSourceController>["source"]>
  | ReturnType<typeof makeCheckpointDiffSourceAdapter>
  | ReturnType<typeof makeGitDiffSourceAdapter>;

function useRenderableDiffSource({
  source,
  selectedTurnId,
  collapseScopeKey,
  collapsedDiffFiles,
  resolvedTheme,
}: {
  readonly source: NormalizedDiffSource;
  readonly selectedTurnId: string | null;
  readonly collapseScopeKey: string | null;
  readonly collapsedDiffFiles: CollapsedDiffFilesState;
  readonly resolvedTheme: "light" | "dark";
}) {
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const selectedPatch = source.patch;
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
        compactPartialHunkOffsets: source.kind === "workspace" && selectedTurnId === null,
      }),
    [resolvedTheme, selectedPatch, selectedTurnId, source.kind],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") return [];
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const codeViewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        return {
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey,
          collapsed: collapsedDiffFileKeys.has(fileKey),
        };
      }),
    [collapsedDiffFileKeys, renderableFiles],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  return {
    allDiffFilesCollapsed: areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys),
    codeViewFiles,
    diffFileKeys,
    diffLineStat: getDiffLineStat(renderableFiles),
    renderableFiles,
    renderablePatch,
    selectedPatch,
    selectedPatchError: source.error,
  };
}

function useWorkspaceDiffSourceController({
  initialGitScope,
  threadRef: threadRefProp,
  workspaceRef,
  fallbackCwd,
  ignoreWhitespace: diffIgnoreWhitespace,
  baseRefQuery,
  headRefQuery,
  collapsedDiffFiles,
  resolvedTheme,
  enabled,
  environmentIdOverride,
  cwdOverride,
}: WorkspaceDiffSourceInput) {
  const paramsThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadRef = threadRefProp ?? paramsThreadRef;
  const workspaceOwner = workspacePanelOwner(workspaceRef);
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  // A client-local draft has no server thread to read an environment from, so
  // the thread ref (which drafts pre-allocate) carries it instead.
  const environmentId =
    environmentIdOverride ?? activeThread?.environmentId ?? routeThreadRef?.environmentId ?? null;
  const activeProject = useProject(
    environmentId !== null && activeProjectId
      ? {
          environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd =
    cwdOverride ??
    resolveDiffPanelCwd({
      threadWorktreePath: activeThread?.worktreePath,
      projectWorkspaceRoot: activeProject?.workspaceRoot,
      fallbackCwd,
    }) ??
    undefined;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    serverConfig?.availableEditors ?? [],
  );
  const gitStatusQuery = useEnvironmentQuery(
    enabled && environmentId !== null && activeCwd != null
      ? vcsEnvironment.status({
          environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) => {
    const threadSelection = selectThreadDiffPanelSelection(
      state.byThreadKey,
      routeThreadRef,
      initialGitScope === "unstaged",
    );
    const routeKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
    if (
      threadSelection.kind === "turn" &&
      routeKey !== null &&
      state.visibleTurnThreadKey === routeKey
    ) {
      return threadSelection;
    }
    return selectThreadDiffPanelSelection(
      state.byThreadKey,
      workspaceOwner ?? routeThreadRef,
      initialGitScope === "unstaged",
    );
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!enabled || !routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, enabled, orderedTurnDiffSummaries, routeThreadRef]);

  const selectedTurnId = diffSelection.kind === "turn" ? diffSelection.turnId : null;
  const selectedGitScope: "branch" | "unstaged" =
    diffSelection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedHeadRef = diffSelection.kind === "branch" ? diffSelection.headRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const latestTurn = orderedTurnDiffSummaries[0];
  const selectedScopeLabel =
    selectedTurnId === null
      ? selectedGitScope === "unstaged"
        ? "Working tree"
        : "Branch changes"
      : selectedTurn?.turnId === latestTurn?.turnId
        ? "Latest turn"
        : `Turn ${selectedCheckpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn
    ? `turn:${selectedTurn.turnId}`
    : selectedGitScope === "branch" && selectedHeadRef
      ? `branch@${selectedHeadRef}`
      : selectedGitScope;
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const reviewSectionTitle = selectedTurn
    ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
    : selectedGitScope === "unstaged"
      ? "Working tree"
      : "Branch changes";
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const checkpointController = useCheckpointDiffSourceController({
    enabled: enabled && isGitRepo && selectedTurn !== undefined,
    environmentId,
    threadId: activeThreadId,
    fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
    toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
    ignoreWhitespace: diffIgnoreWhitespace,
    cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
  });
  const activeCheckpointDiff = checkpointController.query;
  const gitController = useGitDiffSourceController({
    enabled: enabled && selectedTurnId === null,
    environmentId,
    activeCwd,
    environmentCwd: serverConfig?.cwd,
    selectedBaseRef,
    selectedHeadRef,
    selectedGitScope,
    ignoreWhitespace: diffIgnoreWhitespace,
    baseRefQuery,
    headRefQuery,
  });
  const branchDiffPreview = gitController.query;
  const selectedGitSource = gitController.selectedSource;
  const localBranchRefs = gitController.localBranchRefs;
  const remoteBranchRefs = gitController.remoteBranchRefs;
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const gitActionCwd = branchDiffPreview.data?.cwd ?? activeCwd ?? null;
  const refreshBranchDiffPreview = branchDiffPreview.refresh;
  const refreshDiff = useCallback(async () => {
    if (environmentId === null || gitActionCwd === null) return;
    const result = await refreshVcsStatus({
      environmentId,
      input: { cwd: gitActionCwd },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      throw failure instanceof Error ? failure : new Error("Unable to refresh repository.");
    }
    await Promise.all([
      localBranchRefs.refresh(),
      remoteBranchRefs.refresh(),
      selectedTurn ? activeCheckpointDiff.refresh() : refreshBranchDiffPreview(),
    ]);
  }, [
    activeCheckpointDiff,
    environmentId,
    gitActionCwd,
    localBranchRefs,
    refreshBranchDiffPreview,
    refreshVcsStatus,
    remoteBranchRefs,
    selectedTurn,
  ]);
  const currentBranchRef = gitStatusQuery.data?.refName ?? null;
  const effectiveHeadRef =
    selectedHeadRef ?? currentBranchRef ?? selectedGitSource?.headRef ?? null;
  const localRefs = localBranchRefs.data?.refs ?? [];
  const remoteRefs = remoteBranchRefs.data?.refs ?? [];
  const headRefChoices = buildBaseRefChoices(localRefs, remoteRefs);
  const baseRefChoices = buildBaseRefChoices(
    localRefs.filter((ref) => ref.name !== effectiveHeadRef),
    remoteRefs.filter((ref) => ref.name !== effectiveHeadRef),
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];
  const matchingHeadRefChoices = filterBaseRefChoices(headRefChoices, headRefQuery);
  const valueForHeadRefChoice = (choice: (typeof headRefChoices)[number]) =>
    selectedHeadRef && selectedHeadRef === choice.remote?.name
      ? selectedHeadRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const headRefItems = [CURRENT_BRANCH_HEAD_REF, ...headRefChoices.map(valueForHeadRefChoice)];
  const filteredHeadRefItems = [
    CURRENT_BRANCH_HEAD_REF,
    ...matchingHeadRefChoices.map(valueForHeadRefChoice),
  ];
  const source = selectedTurn !== undefined ? checkpointController.source : gitController.source;
  const rendered = useRenderableDiffSource({
    source,
    selectedTurnId,
    collapseScopeKey,
    collapsedDiffFiles,
    resolvedTheme,
  });

  return {
    activeCheckpointDiff,
    activeCwd,
    allowsCommitControls: true,
    ...rendered,
    baseRefChoices,
    baseRefItems,
    branchDiffPreview,
    collapseScopeKey,
    environmentId,
    filteredBaseRefItems,
    filteredHeadRefItems,
    gitStatusQuery,
    inferredCheckpointTurnCountByTurnId,
    isGitRepo,
    canRefresh: environmentId !== null && gitActionCwd !== null,
    emptyChangesLabel: "No net changes in this selection.",
    emptyPatchLabel: "No patch available for this selection.",
    latestTurn,
    localBranchRefs,
    matchingBaseRefChoices,
    matchingHeadRefChoices,
    openInPreferredEditor,
    orderedTurnDiffSummaries,
    remoteBranchRefs,
    reviewSectionId,
    reviewSectionTitle,
    refreshDiff,
    routeThreadRef,
    selectedBaseRef,
    selectedHeadRef,
    selectedFilePath,
    selectedFileRevealRequestId,
    selectedGitScope,
    selectedGitSource,
    currentBranchRef,
    effectiveHeadRef,
    gitActionCwd,
    loadingLabel: selectedTurn
      ? "Loading checkpoint diff..."
      : selectedGitScope === "unstaged"
        ? "Loading working tree diff..."
        : "Loading branch diff...",
    selectedScopeLabel,
    selectedTurn,
    selectedTurnId,
    serverConfig,
    source,
    showWhitespaceControl: true,
    supportsPull: true,
    valueForBaseRefChoice,
    valueForHeadRefChoice,
    headRefChoices,
    headRefItems,
    workspaceOwner,
  };
}

/** Selects between independently-owned commit and workspace source controllers. */
export function useDiffPanelSource(input: UseDiffPanelSourceInput) {
  const commitController = useCommitDiffSourceController(input.commitTarget);
  const workspaceController = useWorkspaceDiffSourceController({
    initialGitScope: input.initialGitScope,
    threadRef: input.threadRef,
    workspaceRef: input.workspaceRef,
    fallbackCwd: input.fallbackCwd,
    ignoreWhitespace: input.ignoreWhitespace,
    baseRefQuery: input.baseRefQuery,
    headRefQuery: input.headRefQuery,
    collapsedDiffFiles: input.collapsedDiffFiles,
    resolvedTheme: input.resolvedTheme,
    enabled: input.commitTarget === null,
    environmentIdOverride: input.commitTarget?.environmentId ?? null,
    cwdOverride: input.commitTarget?.cwd ?? null,
  });
  const commitSource =
    commitController.source ??
    ({
      kind: "commit",
      patch: undefined,
      truncated: false,
      pending: false,
      error: null,
    } as const);
  const commitReviewSectionId = input.commitTarget ? `commit:${input.commitTarget.commitId}` : null;
  const commitCollapseScopeKey = input.commitTarget
    ? `${input.commitTarget.environmentId}:${commitReviewSectionId}`
    : null;
  const commitRendered = useRenderableDiffSource({
    source: commitSource,
    selectedTurnId: null,
    collapseScopeKey: commitCollapseScopeKey,
    collapsedDiffFiles: input.collapsedDiffFiles,
    resolvedTheme: input.resolvedTheme,
  });
  const refreshCommitDiff = useCallback(
    () => commitController.query.refresh(),
    [commitController.query],
  );

  if (input.commitTarget === null) {
    return { ...workspaceController, commitDiff: commitController.query };
  }
  return {
    ...workspaceController,
    ...commitRendered,
    activeCwd: input.commitTarget.cwd,
    allowsCommitControls: false,
    canRefresh: true,
    collapseScopeKey: commitCollapseScopeKey,
    commitDiff: commitController.query,
    emptyChangesLabel: "No changes in this commit.",
    emptyPatchLabel: "No patch available for this commit.",
    environmentId: input.commitTarget.environmentId,
    gitActionCwd: null,
    isGitRepo: true,
    loadingLabel: "Loading commit diff...",
    refreshDiff: refreshCommitDiff,
    reviewSectionId: `commit:${input.commitTarget.commitId}`,
    reviewSectionTitle: input.commitTarget.label,
    selectedFilePath: null,
    selectedFileRevealRequestId: 0,
    selectedScopeLabel: input.commitTarget.label,
    selectedTurn: undefined,
    selectedTurnId: null,
    showWhitespaceControl: false,
    source: commitSource,
    supportsPull: false,
  };
}
