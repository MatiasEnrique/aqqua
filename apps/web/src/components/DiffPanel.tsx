import type { WorkspacePanelRef } from "@t3tools/client-runtime/environment";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GitObjectId, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSourceControlActionRunning, useVcsPullAction } from "~/lib/sourceControlActions";
import { cn } from "~/lib/utils";
import type { DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useDiffPanelStore } from "../diffPanelStore";
import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { toggleAllDiffFiles } from "../lib/diffCollapse";
import {
  buildFileDiffRenderKey,
  getDiffCollapseIconClassName,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { DiffPanelLoadingState, type DiffPanelMode, DiffPanelShell } from "./DiffPanelShell";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { DiffCommitBar } from "./diffs/DiffCommitBar";
import { DiffPanelToolbar } from "./diffs/DiffPanelToolbar";
import { DiffScopeSelector } from "./diffs/DiffScopeSelector";
import {
  type DiffCommitFile,
  type DiffCommitSelection,
  EMPTY_EXCLUDED_COMMIT_PATHS,
  isCommitFileIncluded,
  resolveDiffCommitPaths,
  shouldShowDiffCommitControls,
  toggleCommitFileExcluded,
} from "./diffs/diffCommitSelection";
import { formatVcsPullOutcome, shouldShowDiffPullControl } from "./diffs/diffPanelGitTarget";
import {
  DIFF_PANEL_HEADER_HEIGHT,
  DIFF_PANEL_UNSAFE_CSS,
  EMPTY_COLLAPSED_DIFF_FILE_KEYS,
} from "./diffs/diffPanelViewConfig";
import { AUTOMATIC_BASE_REF, useDiffPanelSource } from "./diffs/useDiffPanelSource";
import { Checkbox } from "./ui/checkbox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import { Switch } from "./ui/switch";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

/** Git actions that make the panel's own git controls wait their turn. */
const BLOCKING_SOURCE_CONTROL_ACTIONS = ["pull", "runStackedAction", "publishRepository"] as const;

export interface DiffPanelCommitTarget {
  environmentId: EnvironmentId;
  cwd: string;
  commitId: GitObjectId;
  label: string;
  onBack?: () => void;
}

export interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  initialGitScope: "branch" | "unstaged";
  /** Renders one immutable commit through the regular diff-viewer surface. */
  commitTarget?: DiffPanelCommitTarget | null;
  /**
   * Thread the diff belongs to. Falls back to the route params, which carry no
   * thread on the draft route (`/draft/$draftId`).
   */
  threadRef?: ScopedThreadRef | null;
  /** Workspace-scoped git selection owner (diff/history shared across threads). */
  workspaceRef?: WorkspacePanelRef | null;
  /**
   * Repository to diff when the thread resolves no checkout of its own — a
   * conversation that has never been sent has no server thread, and a worktree
   * draft's worktree is only created with its first message.
   */
  fallbackCwd?: string | null;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  initialGitScope: initialGitScopeProp,
  commitTarget = null,
  threadRef: threadRefProp = null,
  workspaceRef = null,
  fallbackCwd = null,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const [initialGitScope] = useState(initialGitScopeProp);
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [commitSelection, setCommitSelection] = useState<DiffCommitSelection>(() => ({
    scopeKey: null,
    excludedPaths: EMPTY_EXCLUDED_COMMIT_PATHS,
  }));
  const codeViewRef = useRef<AnnotatableCodeViewHandle>(null);

  const {
    activeCwd,
    allowsCommitControls,
    allDiffFilesCollapsed,
    baseRefChoices,
    baseRefItems,
    branchDiffPreview,
    codeViewFiles,
    collapseScopeKey,
    canRefresh,
    diffFileKeys,
    diffLineStat,
    emptyChangesLabel,
    emptyPatchLabel,
    environmentId,
    filteredBaseRefItems,
    inferredCheckpointTurnCountByTurnId,
    isGitRepo,
    latestTurn,
    loadingLabel,
    openInPreferredEditor,
    orderedTurnDiffSummaries,
    renderableFiles,
    renderablePatch,
    refreshDiff,
    reviewSectionId,
    reviewSectionTitle,
    routeThreadRef,
    selectedBaseRef,
    selectedFilePath,
    selectedFileRevealRequestId,
    selectedGitScope,
    selectedGitSource,
    gitActionCwd,
    selectedPatch,
    selectedPatchError,
    selectedScopeLabel,
    selectedTurn,
    selectedTurnId,
    showWhitespaceControl,
    source,
    supportsPull,
    valueForBaseRefChoice,
    workspaceOwner,
  } = useDiffPanelSource({
    initialGitScope,
    commitTarget,
    threadRef: threadRefProp,
    workspaceRef,
    fallbackCwd,
    ignoreWhitespace: diffIgnoreWhitespace,
    baseRefQuery,
    collapsedDiffFiles,
    resolvedTheme,
  });

  const commitFiles = useMemo<DiffCommitFile[]>(
    () =>
      renderableFiles.map((fileDiff) => ({
        fileKey: buildFileDiffRenderKey(fileDiff),
        path: resolveFileDiffPath(fileDiff),
        commitPaths: resolveDiffCommitPaths(fileDiff),
      })),
    [renderableFiles],
  );
  const showCommitControls =
    allowsCommitControls &&
    shouldShowDiffCommitControls({
      isGitRepo,
      selectedTurnId,
      gitScope: selectedGitScope,
      hasCwd: gitActionCwd !== null,
    });
  const excludedCommitPaths =
    commitSelection.scopeKey === collapseScopeKey
      ? commitSelection.excludedPaths
      : EMPTY_EXCLUDED_COMMIT_PATHS;
  const setExcludedCommitPaths = useCallback(
    (excludedPaths: ReadonlySet<string>) => {
      setCommitSelection({ scopeKey: collapseScopeKey, excludedPaths });
    },
    [collapseScopeKey],
  );
  const toggleCommitFile = useCallback(
    (filePath: string) => {
      setCommitSelection((current) => ({
        scopeKey: collapseScopeKey,
        excludedPaths: toggleCommitFileExcluded(
          current.scopeKey === collapseScopeKey
            ? current.excludedPaths
            : EMPTY_EXCLUDED_COMMIT_PATHS,
          filePath,
        ),
      }));
    },
    [collapseScopeKey],
  );
  const refreshBranchDiffPreview = branchDiffPreview.refresh;
  const handleCommitActionCompleted = useCallback(() => {
    setCommitSelection({
      scopeKey: collapseScopeKey,
      excludedPaths: EMPTY_EXCLUDED_COMMIT_PATHS,
    });
    refreshBranchDiffPreview();
  }, [collapseScopeKey, refreshBranchDiffPreview]);

  const sourceControlScope = useMemo(
    () => ({ environmentId, cwd: gitActionCwd }),
    [environmentId, gitActionCwd],
  );
  const pullAction = useVcsPullAction(sourceControlScope);
  const isSourceControlBusy = useSourceControlActionRunning(
    sourceControlScope,
    BLOCKING_SOURCE_CONTROL_ACTIONS,
  );
  const [isRefreshingDiff, setIsRefreshingDiff] = useState(false);
  const refreshDiffInFlightRef = useRef(false);
  const handleRefreshDiff = useCallback(() => {
    if (refreshDiffInFlightRef.current || !canRefresh) return;
    refreshDiffInFlightRef.current = true;
    setIsRefreshingDiff(true);
    void (async () => {
      try {
        await refreshDiff();
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not refresh diff",
            description: error instanceof Error ? error.message : "Try again.",
          }),
        );
      } finally {
        refreshDiffInFlightRef.current = false;
        setIsRefreshingDiff(false);
      }
    })();
  }, [canRefresh, refreshDiff]);
  // Tagged with the repository it describes so switching threads or projects
  // never leaves another repository's pull result on screen.
  const [pullStatus, setPullStatus] = useState<{
    readonly kind: "outcome" | "error";
    readonly message: string;
    readonly cwd: string;
  } | null>(null);
  const visiblePullStatus = pullStatus?.cwd === gitActionCwd ? pullStatus : null;
  const showPullControl =
    supportsPull &&
    shouldShowDiffPullControl({
      isGitRepo,
      selectedTurnId,
      hasCwd: gitActionCwd !== null,
    });
  const isPulling = pullAction.isPending;
  const handlePull = useCallback(() => {
    if (environmentId === null || gitActionCwd === null || isSourceControlBusy) return;
    setPullStatus(null);
    void (async () => {
      const result = await pullAction.run();
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const failure = squashAtomCommandFailure(result);
        setPullStatus({
          kind: "error",
          message: failure instanceof Error ? failure.message : "The pull failed.",
          cwd: gitActionCwd,
        });
        return;
      }
      setPullStatus({
        kind: "outcome",
        message: formatVcsPullOutcome(result.value),
        cwd: gitActionCwd,
      });
      // The pull moved HEAD, so the source controller refreshes the diff and
      // every branch/ahead-behind readout derived from repository state.
      void refreshDiff();
    })();
  }, [environmentId, gitActionCwd, isSourceControlBusy, pullAction, refreshDiff]);

  // Reveal the selected file once per reveal request. `codeViewFiles` is a fresh
  // array on every collapse toggle, annotation edit and refetch, so scrolling
  // whenever it changes would yank the viewport back to the selected file (and
  // fight the virtualizer) long after the user asked for it. The pending request
  // is kept until the file actually shows up, because the patch usually resolves
  // after the selection is made.
  const pendingRevealRef = useRef<{
    requestId: number;
    filePath: string;
  } | null>(null);
  const handledRevealRequestIdRef = useRef(0);
  useEffect(() => {
    if (selectedFileRevealRequestId !== handledRevealRequestIdRef.current) {
      handledRevealRequestIdRef.current = selectedFileRevealRequestId;
      pendingRevealRef.current = selectedFilePath
        ? { requestId: selectedFileRevealRequestId, filePath: selectedFilePath }
        : null;
    }
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const file = codeViewFiles.find((candidate) => candidate.filePath === pending.filePath);
    if (!file) return;
    pendingRevealRef.current = null;
    codeViewRef.current?.scrollTo({
      type: "item",
      id: file.fileKey,
      align: "start",
    });
  }, [codeViewFiles, selectedFilePath, selectedFileRevealRequestId]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCollapsedDiffFiles((current) => {
      const currentKeys =
        current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;

      return {
        scopeKey: collapseScopeKey,
        fileKeys: toggleAllDiffFiles(diffFileKeys, currentKeys),
      };
    });
  }, [collapseScopeKey, diffFileKeys]);

  const selectTurn = (turnId: TurnId) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectTurn(routeThreadRef, turnId);
  };
  const selectGitScope = (scope: "branch" | "unstaged") => {
    const targetOwner = workspaceOwner ?? routeThreadRef;
    if (!targetOwner) return;
    useDiffPanelStore.getState().selectGitScope(targetOwner, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    const targetOwner = workspaceOwner ?? routeThreadRef;
    if (!targetOwner) return;
    useDiffPanelStore.getState().selectBranchBaseRef(targetOwner, baseRef);
  };

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
        <DiffScopeSelector
          commit={commitTarget}
          selectedScopeLabel={selectedScopeLabel}
          selectedTurnId={selectedTurnId}
          selectedGitScope={selectedGitScope}
          selectedTurnIdForHighlight={selectedTurn?.turnId ?? null}
          latestTurnId={latestTurn?.turnId ?? null}
          turns={orderedTurnDiffSummaries}
          inferredTurnCounts={inferredCheckpointTurnCountByTurnId}
          timestampFormat={settings.timestampFormat}
          onSelectGitScope={selectGitScope}
          onSelectTurn={selectTurn}
        />
        {selectedTurnId === null && selectedGitScope === "branch" && selectedGitSource?.baseRef && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            title={`${selectedGitSource.headRef ?? "HEAD"} → ${selectedGitSource.baseRef}`}
          >
            <span className="min-w-0 max-w-48 truncate">{selectedGitSource.headRef ?? "HEAD"}</span>
            <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
            <Combobox
              items={baseRefItems}
              filteredItems={filteredBaseRefItems}
              value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
              onOpenChange={(open) => {
                if (!open) setBaseRefQuery("");
              }}
              onValueChange={(value) => {
                if (!value) return;
                selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
              }}
            >
              <ComboboxTrigger
                className="inline-flex min-w-0 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Change comparison target. Currently ${selectedGitSource.baseRef}`}
              >
                <span className="min-w-0 truncate">{selectedGitSource.baseRef}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
              </ComboboxTrigger>
              <ComboboxPopup
                align="start"
                className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0 [&>[data-slot=combobox-popup]]:overflow-hidden"
              >
                <div className="min-w-0 shrink-0 px-3 pt-2.5">
                  <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
                    />
                    <ComboboxInput
                      className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
                      inputClassName="rounded-none bg-transparent text-sm"
                      placeholder="Search refs..."
                      showTrigger={false}
                      size="sm"
                      unstyled
                      value={baseRefQuery}
                      onChange={(event) => setBaseRefQuery(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  <span aria-hidden="true" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                    <span>Branch</span>
                    <span className="text-right">Remote</span>
                  </div>
                </div>
                <ComboboxEmpty>No matching refs.</ComboboxEmpty>
                <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                  <ComboboxItem
                    className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                    contentClassName="w-full min-w-0 overflow-hidden"
                    value={AUTOMATIC_BASE_REF}
                  >
                    <span className="block min-w-0 truncate">Automatic</span>
                  </ComboboxItem>
                  {baseRefChoices.map((choice) => {
                    const item = valueForBaseRefChoice(choice);
                    const hasBoth = choice.local !== null && choice.remote !== null;
                    const useRemote = choice.remote?.name === item;
                    return (
                      <ComboboxItem
                        key={choice.id}
                        className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                        contentClassName="w-full min-w-0 overflow-hidden"
                        value={item}
                      >
                        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                          <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                          {hasBoth ? (
                            <div className="flex justify-end">
                              <Switch
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                aria-label={`Use remote version of ${choice.label}`}
                                checked={useRemote}
                                className="[--thumb-size:--spacing(3)]"
                                onCheckedChange={(checked) => {
                                  const nextRef = checked
                                    ? choice.remote?.name
                                    : choice.local?.name;
                                  if (nextRef) selectBranchBaseRef(nextRef);
                                }}
                              />
                            </div>
                          ) : choice.remote ? (
                            <span
                              className="flex justify-end text-muted-foreground"
                              title="Remote only"
                            >
                              <CheckIcon aria-hidden="true" className="size-3" />
                            </span>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
        )}
      </div>
      <DiffPanelToolbar
        canRefresh={canRefresh}
        isRefreshing={isRefreshingDiff}
        onRefresh={handleRefreshDiff}
        showPull={showPullControl}
        isPulling={isPulling}
        isSourceControlBusy={isSourceControlBusy}
        onPull={handlePull}
        fileCount={codeViewFiles.length}
        additions={diffLineStat.additions}
        deletions={diffLineStat.deletions}
        allFilesCollapsed={allDiffFilesCollapsed}
        onToggleAllFiles={toggleDiffFileCollapse}
        renderMode={diffRenderMode}
        onRenderModeChange={setDiffRenderMode}
        wordWrap={wordWrap}
        onWordWrapChange={setWordWrap}
        showWhitespaceControl={showWhitespaceControl}
        ignoreWhitespace={diffIgnoreWhitespace}
        onIgnoreWhitespaceChange={setDiffIgnoreWhitespace}
      />
    </>
  );

  return (
    <DiffPanelShell
      mode={mode}
      header={headerRow}
      footer={
        showCommitControls && environmentId !== null ? (
          <DiffCommitBar
            // Reset the draft message and last action result per thread/scope.
            key={collapseScopeKey ?? "diff-commit"}
            environmentId={environmentId}
            cwd={gitActionCwd}
            files={commitFiles}
            excludedPaths={excludedCommitPaths}
            onExcludedPathsChange={setExcludedCommitPaths}
            onActionCompleted={handleCommitActionCompleted}
          />
        ) : null
      }
    >
      {environmentId === null ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : activeCwd == null ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a project to inspect its diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <div className="diff-panel-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {source.truncated && (
            <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              This diff was truncated because it exceeded the preview limit. The changes shown are
              incomplete.
            </p>
          )}
          {visiblePullStatus && (
            <p
              className={cn(
                "shrink-0 border-b border-border/70 px-3 py-1.5 text-[11px]",
                visiblePullStatus.kind === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/40 text-muted-foreground",
              )}
              {...(visiblePullStatus.kind === "error" ? { role: "alert" as const } : {})}
            >
              {visiblePullStatus.message}
            </p>
          )}
          {selectedPatchError && !renderablePatch && (
            <div className="px-3">
              <p className="mb-2 text-[11px] text-red-500/80">{selectedPatchError}</p>
            </div>
          )}
          {!renderablePatch ? (
            source.pending ? (
              <DiffPanelLoadingState label={loadingLabel} />
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {typeof selectedPatch === "string" && selectedPatch.trim().length === 0
                    ? emptyChangesLabel
                    : emptyPatchLabel}
                </p>
              </div>
            )
          ) : renderablePatch.kind === "files" ? (
            <div
              className="min-h-0 flex-1"
              onClickCapture={(event) => {
                const composedPath = event.nativeEvent.composedPath?.() ?? [];
                const title = composedPath.find(
                  (node): node is HTMLElement =>
                    node instanceof HTMLElement && node.hasAttribute("data-title"),
                );
                const filePath = title?.textContent?.trim();
                if (filePath) openDiffFile(filePath);
              }}
            >
              <AnnotatableCodeView
                viewerRef={codeViewRef}
                key={collapseScopeKey ?? reviewSectionId}
                // The library owns the sticky positioning of its render
                // window (root > container > stickyContainer): it rewrites
                // `top`/`bottom` on that element every frame to keep the
                // rendered rows aligned with the scroll offset. Overriding
                // those with `top: 0 !important` pinned the window to the top
                // of the viewport and made large diffs jump to the end, so we
                // only style the scroll container itself here.
                className="diff-render-surface h-full min-h-0 overflow-auto"
                files={codeViewFiles}
                sectionId={reviewSectionId}
                sectionTitle={reviewSectionTitle}
                composerDraftTarget={composerDraftTarget}
                renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const includedInCommit = isCommitFileIncluded(excludedCommitPaths, filePath);
                  return (
                    <span className="inline-flex shrink-0 items-center gap-1.5">
                      {showCommitControls && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Checkbox
                                className="size-3.5"
                                aria-label={
                                  includedInCommit
                                    ? `Exclude ${filePath} from commit`
                                    : `Include ${filePath} in commit`
                                }
                                checked={includedInCommit}
                                onClick={(event) => {
                                  event.stopPropagation();
                                }}
                                onCheckedChange={() => {
                                  toggleCommitFile(filePath);
                                }}
                              />
                            }
                          />
                          <TooltipPopup side="top">
                            {includedInCommit ? "Exclude from commit" : "Include in commit"}
                          </TooltipPopup>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className={cn(
                                "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden",
                                getDiffCollapseIconClassName(fileDiff),
                              )}
                              aria-label={collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`}
                              aria-expanded={!collapsed}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleDiffFileCollapsed(fileKey);
                              }}
                            />
                          }
                        >
                          {collapsed ? (
                            <ChevronRightIcon className="size-4" />
                          ) : (
                            <ChevronDownIcon className="size-4" />
                          )}
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          {collapsed ? "Expand diff" : "Collapse diff"}
                        </TooltipPopup>
                      </Tooltip>
                    </span>
                  );
                }}
                options={{
                  diffStyle: diffRenderMode === "split" ? "split" : "unified",
                  lineDiffType: "none",
                  overflow: wordWrap ? "wrap" : "scroll",
                  theme: resolveDiffThemeName(resolvedTheme),
                  themeType: resolvedTheme as DiffThemeType,
                  unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                  stickyHeaders: true,
                  layout: { paddingTop: 8, paddingBottom: 8, gap: 8 },
                  itemMetrics: { diffHeaderHeight: DIFF_PANEL_HEADER_HEIGHT },
                }}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                <pre
                  className={cn(
                    "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                    wordWrap
                      ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                      : "overflow-auto",
                  )}
                >
                  {renderablePatch.text}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </DiffPanelShell>
  );
}
