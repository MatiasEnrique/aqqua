import { canSettle, canSnooze } from "@aqqua/client-runtime/state/thread-settled";
import { scopeThreadRef, scopedThreadKey } from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef } from "@aqqua/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useOpenPrLink } from "../../../lib/openPullRequestLink";
import type { ProviderInstanceEntry } from "../../../providerInstances";
import { useEnvironmentQuery } from "../../../state/query";
import { vcsEnvironment } from "../../../state/vcs";
import { useThreadSelectionStore } from "../../../threadSelectionStore";
import { parseTimestampDate } from "../../../timestampFormat";
import type { SidebarThreadSummary } from "../../../types";
import { useUiStateStore } from "../../../uiStateStore";
import { resolveLocalCheckoutBranchMismatch } from "../../BranchToolbar.logic";
import {
  hasUnseenCompletion,
  resolveSidebarConversationSummaryState,
  resolveSidebarV2Status,
} from "../../Sidebar.logic";
import type { SnoozePreset } from "../../Sidebar.snooze";
import { getTriggerDisplayModelLabel } from "../../chat/providerIconUtils";
import {
  sidebarCardSurfaceClassName,
  type SidebarCardBand,
  type SidebarCardBranchLabel,
} from "../../sidebar/card";
import {
  prStatusIndicator,
  resolveThreadPr,
  settledPrHoverColorClass,
} from "../../ThreadStatusIndicators";
import { rowBranchLabel } from "../rowBranchLabel";

/**
 * Everything every conversation row needs, whatever shape it draws itself in.
 * The row components below differ in composition, not in what a thread is, so
 * this stays one contract rather than three near-identical ones.
 */
export interface ConversationRowProps {
  readonly thread: SidebarThreadSummary;
  /** False on environments whose server predates thread.settle/unsettle. */
  readonly settlementSupported: boolean;
  /** Same contract for thread.snooze/unsnooze. */
  readonly snoozeSupported: boolean;
  /** 0 for a root conversation, 1+ for a sub-agent spawned by an orchestrator. */
  readonly depth: number;
  /** Direct sub-agent count among the rows this section renders. */
  readonly childCount: number;
  readonly isExpanded: boolean;
  readonly isActive: boolean;
  readonly isRenaming: boolean;
  readonly renamingTitle: string;
  readonly jumpLabel: string | null;
  readonly environmentLabel: string | null;
  readonly projectCwd: string | null;
  readonly projectTitle: string | null;
  readonly showProjectIdentity: boolean;
  /**
   * False in worktree grouping, where the group header above already names the
   * branch every card under it shares.
   */
  readonly showBranch: boolean;
  /**
   * Where this row sits in its family's panel. Only the active section bands;
   * the settled and snoozed tails stay flat.
   */
  readonly band: SidebarCardBand;
  readonly providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly onToggleExpanded: (threadRef: ScopedThreadRef, expanded: boolean) => void;
  readonly onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  readonly onRenameTitleChange: (title: string) => void;
  readonly onCommitRename: (
    threadRef: ScopedThreadRef,
    title: string,
    originalTitle: string,
  ) => void;
  readonly onCancelRename: () => void;
  readonly onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  readonly onSettle: (threadRef: ScopedThreadRef) => void;
  readonly onUnsettle: (threadRef: ScopedThreadRef) => void;
  readonly onSnooze: (threadRef: ScopedThreadRef, preset: SnoozePreset) => void;
  readonly onUnsnooze: (threadRef: ScopedThreadRef) => void;
  readonly onDelete: (threadRef: ScopedThreadRef) => void;
  readonly onChangeRequestState: (
    threadKey: string,
    state: "open" | "closed" | "merged" | null,
  ) => void;
  /**
   * When a snooze ended (timer or early wake); drives the Woke pill until the
   * user visits the thread.
   */
  readonly wokeAt: string | null;
}

/**
 * Reads a thread the way the sidebar sees it, and returns the handlers a row
 * binds. Presentation is deliberately absent: which of these a row shows, and
 * how loudly, is the row's business.
 */
export function useConversationRow(props: ConversationRowProps) {
  const { thread, onChangeRequestState } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const openPrLink = useOpenPrLink();

  // Same semantics as v1 (never-visited counts as read): flipping the beta
  // flag must not light up every historical thread as unread.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarV2Status(thread);
  const summaryState = resolveSidebarConversationSummaryState(thread);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is an
  // explicit act, so unlike Done, a never-visited woke thread still shows the
  // pill; visiting clears it. An unparseable visit timestamp counts as
  // never-visited — corrupt local data must not eat the wake signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke = wokeAtDate !== null && (lastVisitedDate === null || lastVisitedDate < wokeAtDate);
  // In-flight rows (working, or waiting on approval/input) fade as a whole:
  // there is nothing for the user to do yet, so prominence is reserved for rows
  // that need a human — done (unread), read-but-unsettled, failed, and freshly
  // woken. The status label keeps its hue, so waiting rows stay findable.
  const isInFlight = status === "working" || status === "approval" || status === "input";
  const shouldRecede =
    (status === "ready" || isInFlight) && !isUnread && !isWoke && !props.isActive && !isSelected;

  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const branch: SidebarCardBranchLabel | null = rowBranchLabel(thread);

  const pr = resolveThreadPr({ threadBranch: thread.branch, gitStatus: gitStatus.data });
  const prStatus = prStatusIndicator(pr, gitStatus.data?.sourceControlProvider);
  const settledPrHoverClass = pr ? settledPrHoverColorClass(pr.state) : undefined;
  // Report the PR state up: the parent partitions rows with effectiveSettled,
  // and a merged/closed PR auto-settles a thread — data only rows have.
  const prState = pr?.state ?? null;
  useEffect(() => {
    onChangeRequestState(threadKey, prState);
  }, [onChangeRequestState, prState, threadKey]);

  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const provider = {
    driverKind: providerEntry?.driverKind ?? null,
    instanceId: modelInstanceId,
    displayName: thread.session?.providerName ?? modelInstanceId,
    modelLabel: selectedModel
      ? getTriggerDisplayModelLabel(selectedModel)
      : thread.modelSelection.model,
  };

  const {
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onDelete,
    onSettle,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onToggleExpanded,
    onUnsettle,
    onUnsnooze,
    renamingTitle,
  } = props;

  // Clicking a row only ever opens it. Expanding a branch is a separate,
  // explicit act owned by the row's own chevron affordance, so navigating into
  // an orchestrator never reshuffles the list under the pointer.
  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      onThreadClick(event, threadRef);
    },
    [onThreadClick, threadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThreadActivate(threadRef);
    },
    [onThreadActivate, threadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      onStartRename(threadRef, thread.title);
    },
    [isRenaming, onStartRename, thread.title, threadRef],
  );

  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCommitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCancelRename();
      }
    },
    [onCancelRename, onCommitRename, renamingTitle, thread.title, threadRef],
  );
  const handleRenameBlur = useCallback(() => {
    if (!renameCommittedRef.current) {
      onCommitRename(threadRef, renamingTitle, thread.title);
    }
  }, [onCommitRename, renamingTitle, thread.title, threadRef]);

  const handleSettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSettle(threadRef);
    },
    [onSettle, threadRef],
  );
  const handleUnsettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsettle(threadRef);
    },
    [onUnsettle, threadRef],
  );
  const handleDeleteClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDelete(threadRef);
    },
    [onDelete, threadRef],
  );
  const handleUnsnoozeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsnooze(threadRef);
    },
    [onUnsnooze, threadRef],
  );
  const handleSnoozePreset = useCallback(
    (preset: SnoozePreset) => {
      onSnooze(threadRef, preset);
    },
    [onSnooze, threadRef],
  );
  const handleSelectionCheckedChange = useCallback(
    (checked: boolean) => {
      if (checked !== isSelected) toggleThreadSelection(threadKey);
    },
    [isSelected, threadKey, toggleThreadSelection],
  );
  const handleToggleExpanded = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleExpanded(threadRef, !props.isExpanded);
    },
    [onToggleExpanded, props.isExpanded, threadRef],
  );
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (pr?.url) openPrLink(event, pr.url);
    },
    [openPrLink, pr],
  );

  // While the snooze popover is open the pointer leaves the row, which would
  // fade the hover actions out from under the open menu; pin them.
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // One clock for both predicates. They share a grace-window rule (a user
  // message unadopted for QUEUED_TURN_START_GRACE_MS counts as pending work),
  // so reading the clock twice lets a row land on the far side of that window
  // for settle but not for snooze — the two buttons would disagree about the
  // same thread. Deliberately not hoisted to a prop: a per-render `now` from
  // the parent would change identity every render and defeat the memo on every
  // row, and a ticked one would lag the grace window by the tick interval.
  const now = new Date().toISOString();
  // Snooze is offered only where it can succeed: capability-gated and never on
  // blocked-on-you work or queued turns (the server rejects both).
  const showSnoozeButton = props.snoozeSupported && canSnooze(thread, { now });
  const canQuickSettle = props.settlementSupported && canSettle(thread, { now });
  // If the thread becomes blocked while the popover is open, the button
  // unmounts without firing onOpenChange(false). Deriving the flag keeps a
  // stale true from permanently hiding the status label, and the effect clears
  // the raw state so the popover doesn't resurrect if the button remounts.
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  useEffect(() => {
    if (!showSnoozeButton) setSnoozeMenuOpen(false);
  }, [showSnoozeButton]);

  return {
    threadRef,
    threadKey,
    isSelected,
    isUnread,
    isWoke,
    isInFlight,
    shouldRecede,
    status,
    summaryState,
    provider,
    branch,
    branchMismatch,
    pr,
    prStatus,
    settledPrHoverClass,
    canQuickSettle,
    showSnoozeButton,
    snoozeMenuOpen,
    setSnoozeMenuOpen,
    surfaceClassName: sidebarCardSurfaceClassName({
      isActive: props.isActive,
      isSelected,
      recede: shouldRecede,
      inFlight: isInFlight,
      band: props.band,
    }),
    handleClick,
    handleContextMenu,
    handleDeleteClick,
    handleDoubleClick,
    handleKeyDown,
    handlePrClick,
    handleRenameBlur,
    handleRenameKeyDown,
    handleSelectionCheckedChange,
    handleSettleClick,
    handleSnoozePreset,
    handleToggleExpanded,
    handleUnsettleClick,
    handleUnsnoozeClick,
  };
}

export type ConversationRowModel = ReturnType<typeof useConversationRow>;
