import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  MessageSquareIcon,
  NetworkIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { canSettle, canSnooze } from "@aqqua/client-runtime/state/thread-settled";
import { scopeThreadRef, scopedThreadKey } from "@aqqua/client-runtime/environment";
import type { ScopedThreadRef } from "@aqqua/contracts";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { cn } from "~/lib/utils";
import {
  hasUnseenCompletion,
  isTrailingDoubleClick,
  resolveSidebarConversationSummaryState,
  resolveSidebarV2Status,
} from "../Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "../BranchToolbar.logic";
import {
  prStatusIndicator,
  resolveThreadPr,
  settledPrHoverColorClass,
} from "../ThreadStatusIndicators";
import type { SnoozePreset } from "../Sidebar.snooze";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Checkbox } from "../ui/checkbox";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { SUB_AGENT_INDENT_PX } from "./constants";
import { JumpHintBadge, SidebarV2ThreadTooltip, SnoozePopoverButton } from "./rowChrome";
import { settledTimeLabel, threadTimeLabel } from "./rowTimeLabels";
import {
  SIDEBAR_STATE_PRESENTATIONS,
  SidebarStateCounters,
  SidebarSummaryStateLabel,
} from "./SidebarStatusPresentations";
import type { SidebarConversationStateCounts } from "../Sidebar.summaryState";

export const SidebarConversationRow = memo(function SidebarConversationRow(props: {
  thread: SidebarThreadSummary;
  // "sub" is a card's descendant: a compact row that trades the card's project
  // and branch chrome for indentation, since the orchestrator above it already
  // establishes both.
  variant: "card" | "slim" | "sub";
  // Slim rows are either settled (action: un-settle) or merely quiet
  // (seen Ready threads — action: settle).
  variantAction: "settle" | "unsettle" | "unsnooze";
  // False on environments whose server predates thread.settle/unsettle:
  // the lifecycle affordances hide entirely rather than fail on click.
  settlementSupported: boolean;
  // Same contract for thread.snooze/unsnooze.
  snoozeSupported: boolean;
  // Compact wake countdown ("2h") for rows in the snoozed shelf.
  snoozeWakeLabelText: string | null;
  // When a snooze ended (timer or early wake); drives the Woke pill until
  // the user visits the thread.
  wokeAt: string | null;
  /** 0 for a root conversation, 1+ for a sub-agent spawned by an orchestrator. */
  depth: number;
  /** Direct sub-agent count among the rows this section renders. */
  childCount: number;
  /**
   * State tally for this orchestrator's sub-agents, excluding the orchestrator
   * itself — the card shows its own status next to these, not folded into them.
   */
  subAgentStateCounts: SidebarConversationStateCounts | null;
  /**
   * Whether nested rows reserve the expand-toggle column. Set for every sub-agent
   * row once any of them owns a toggle, so sibling titles keep one left edge.
   */
  reserveExpandGutter: boolean;
  isExpanded: boolean;
  onToggleExpanded: (threadRef: ScopedThreadRef, expanded: boolean) => void;
  isActive: boolean;
  jumpLabel: string | null;
  environmentLabel: string | null;
  projectCwd: string | null;
  projectTitle: string | null;
  showProjectIdentity: boolean;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: SnoozePreset) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onDelete: (threadRef: ScopedThreadRef) => void;
  onChangeRequestState: (threadKey: string, state: "open" | "closed" | "merged" | null) => void;
}) {
  const {
    childCount,
    depth,
    isExpanded,
    isRenaming,
    onChangeRequestState,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onDelete,
    onRenameTitleChange,
    onSettle,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onToggleExpanded,
    onUnsettle,
    onUnsnooze,
    renamingTitle,
    reserveExpandGutter,
    thread,
    variant,
    variantAction,
  } = props;
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
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so unlike Done, a never-visited woke thread still
  // shows the pill; visiting clears it. An unparseable visit timestamp
  // counts as never-visited — corrupt local data must not eat the wake
  // signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke = wokeAtDate !== null && (lastVisitedDate === null || lastVisitedDate < wokeAtDate);
  // In-flight rows (working, or waiting on approval/input) fade as a whole:
  // there is nothing for the user to do yet, so prominence is reserved for
  // rows that need a human — done (unread), read-but-unsettled, failed, and
  // freshly woken. The status label keeps its hue, so waiting rows stay
  // findable. In-flight rows recede the same as read-ready ones (inbox-zero:
  // working threads aren't your problem yet) — only the colored status label
  // stands out.
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
  const pr = resolveThreadPr({
    threadBranch: thread.branch,
    gitStatus: gitStatus.data,
  });
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
  const driverKind = providerEntry?.driverKind ?? null;
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  const detailsTooltip = (
    <SidebarV2ThreadTooltip
      thread={thread}
      projectTitle={props.projectTitle}
      projectCwd={props.projectCwd}
      environmentLabel={props.environmentLabel}
      driverKind={driverKind}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
    />
  );

  // Clicking a row only ever opens it. Expanding a branch is a separate,
  // explicit act: the row's own chevron affordance (the card's count chip,
  // the nested row's gutter chevron) owns it, so navigating into an
  // orchestrator never reshuffles the list under the pointer.
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
  const handleSelectionCheckedChange = useCallback(
    (checked: boolean) => {
      if (checked !== isSelected) toggleThreadSelection(threadKey);
    },
    [isSelected, threadKey, toggleThreadSelection],
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
  // While the snooze popover is open the pointer leaves the row, which
  // would fade the hover actions out from under the open menu; pin them.
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // Snooze is offered only where it can succeed: capability-gated and never
  // on blocked-on-you work or queued turns (the server rejects both).
  const showSnoozeButton =
    props.snoozeSupported && canSnooze(thread, { now: new Date().toISOString() });
  const canQuickSettle =
    props.settlementSupported && canSettle(thread, { now: new Date().toISOString() });
  // If the thread becomes blocked while the popover is open, the button
  // unmounts without firing onOpenChange(false). Deriving the flag keeps a
  // stale true from permanently hiding the status label / pinning the
  // hover actions, and the effect clears the raw state so the popover
  // doesn't resurrect if the button later remounts.
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  useEffect(() => {
    if (!showSnoozeButton) setSnoozeMenuOpen(false);
  }, [showSnoozeButton]);
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (pr?.url) openPrLink(event, pr.url);
    },
    [openPrLink, pr],
  );
  const handleToggleExpanded = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleExpanded(threadRef, !isExpanded);
    },
    [isExpanded, onToggleExpanded, threadRef],
  );

  // All Sidebar V2 rows share one surface model. Live threads used to look
  // like elevated cards while settled threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  const rowSurfaceClassName = cn(
    "group/v2-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : shouldRecede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    isInFlight &&
      !props.isActive &&
      !isSelected &&
      "opacity-70 transition-opacity hover:opacity-100",
  );

  const title = isRenaming ? (
    <input
      autoFocus
      value={renamingTitle}
      aria-label="Thread title"
      onChange={(event) => onRenameTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleRenameKeyDown}
      onBlur={handleRenameBlur}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 text-sm",
        shouldRecede ? "font-normal" : "font-medium",
        variant === "card"
          ? cn(
              "truncate",
              isUnread || isWoke
                ? "text-foreground"
                : shouldRecede
                  ? "text-muted-foreground/80"
                  : status === "failed"
                    ? "text-foreground/95"
                    : "text-foreground/90",
            )
          : cn(
              "truncate group-hover/v2-row:text-foreground",
              props.isActive || isWoke
                ? "text-foreground"
                : isUnread
                  ? "text-muted-foreground"
                  : // Sub-agents are live work, not history: they sit a step
                    // above the settled tail's resting contrast.
                    variant === "sub"
                    ? "text-muted-foreground/85"
                    : "text-muted-foreground/70",
            ),
      )}
    >
      {thread.title}
    </span>
  );

  const prBadge =
    prStatus && pr ? (
      <button
        type="button"
        onClick={handlePrClick}
        className={cn(
          "shrink-0 font-mono text-xs hover:underline",
          variant === "slim" && variantAction === "unsettle"
            ? props.isActive
              ? "text-muted-foreground/70"
              : cn("text-muted-foreground/35 transition-colors", settledPrHoverClass)
            : prStatus.colorClass,
        )}
        aria-label={prStatus.tooltip}
      >
        #{pr.number}
      </button>
    ) : null;

  // The chevron a nested orchestrator owns. Cards use the count chip in their
  // meta line instead, so this is only rendered by the "sub" variant.
  const expandToggle =
    childCount > 0 ? (
      <button
        type="button"
        data-thread-selection-safe
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? `Collapse sub-agents of ${thread.title}`
            : `Expand sub-agents of ${thread.title}`
        }
        onClick={handleToggleExpanded}
        className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {isExpanded ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
      </button>
    ) : null;

  const subAgentCountToggle =
    childCount > 0 ? (
      <button
        type="button"
        data-thread-selection-safe
        data-testid={`sidebar-v2-subagent-toggle-${thread.id}`}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? `Collapse sub-agents of ${thread.title}`
            : `Expand sub-agents of ${thread.title}`
        }
        onClick={handleToggleExpanded}
        className="-ml-0.5 inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-sm px-1 text-[11px] font-medium tabular-nums text-muted-foreground/85 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <NetworkIcon aria-hidden className="size-3" />
        {childCount}
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 transition-transform", !isExpanded && "-rotate-90")}
        />
      </button>
    ) : null;

  if (variant === "sub") {
    return (
      <li data-thread-item className="relative list-none">
        {/* One guide per ancestor level, descending from the orchestrator's left
            content edge. The top bleeds into the row above to bridge the list
            gap; the bottom stops flush so the last sub-agent closes the branch
            instead of pointing at the next root. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 bottom-0 left-2.5 z-10 flex"
        >
          {Array.from({ length: depth }, (_, level) => (
            <span
              key={level}
              className="border-l border-sidebar-border/70"
              style={{ width: SUB_AGENT_INDENT_PX }}
            />
          ))}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                data-testid="sidebar-v2-row-sub"
                className={cn(rowSurfaceClassName, "flex h-8 items-center gap-2 pr-2.5")}
                style={{ paddingInlineStart: 10 + depth * SUB_AGENT_INDENT_PX }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {reserveExpandGutter
              ? (expandToggle ?? <span aria-hidden className="size-4 shrink-0" />)
              : null}
            {title}
            {prBadge}
            {driverKind ? (
              <span
                role="img"
                aria-label={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                title={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                className="inline-flex shrink-0 items-center opacity-60"
              >
                <ProviderInstanceIcon
                  driverKind={driverKind}
                  displayName={thread.session?.providerName ?? modelInstanceId}
                  iconClassName="size-3"
                />
              </span>
            ) : null}
            <span className="shrink-0 text-[11px] text-muted-foreground/45 @max-[300px]/sidebar-conversations:hidden">
              Updated {threadTimeLabel(thread)}
            </span>
            <span className="relative ml-auto flex h-6 min-w-14 shrink-0 items-center justify-end">
              <span
                className={cn(
                  "inline-flex justify-end text-[11px] transition-opacity",
                  props.settlementSupported && "group-hover/v2-row:opacity-0",
                )}
              >
                <SidebarSummaryStateLabel state={summaryState} />
              </span>
              {props.settlementSupported ? (
                <button
                  type="button"
                  aria-label="Settle thread"
                  onClick={handleSettleClick}
                  className="absolute inset-y-0 right-0 inline-flex cursor-pointer items-center rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/v2-row:opacity-100"
                >
                  <CheckIcon className="size-3" />
                </button>
              ) : null}
            </span>
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  if (variant === "slim") {
    return (
      <li
        data-thread-item
        className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_34px]"
      >
        <div
          className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 pr-2.5")}
          style={{ paddingInlineStart: 10 + depth * SUB_AGENT_INDENT_PX }}
        >
          {variantAction === "unsettle" ? (
            <Checkbox
              data-thread-selection-safe
              aria-label={`Select ${thread.title}`}
              checked={isSelected}
              onCheckedChange={handleSelectionCheckedChange}
              className="size-4 shrink-0 opacity-65 transition-opacity group-hover/v2-row:opacity-100 data-checked:opacity-100"
            />
          ) : null}
          {subAgentCountToggle}
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="sidebar-v2-row-slim"
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 outline-none"
                  onClick={handleClick}
                  onDoubleClick={handleDoubleClick}
                  onKeyDown={handleKeyDown}
                  onContextMenu={handleContextMenu}
                />
              }
            >
              {/* Settled history recedes: dimmed favicon at rest, restored on
              hover so the tail stays scannable when you're hunting. */}
              {props.showProjectIdentity ? (
                <span
                  className={cn(
                    "shrink-0 transition-opacity",
                    !props.isActive &&
                      "opacity-40 grayscale group-hover/v2-row:opacity-100 group-hover/v2-row:grayscale-0",
                  )}
                >
                  <ProjectFavicon
                    environmentId={thread.environmentId}
                    cwd={props.projectCwd ?? ""}
                    className="size-4"
                    fallbackIcon={MessageSquareIcon}
                  />
                </span>
              ) : null}
              {title}
              {/* The PR badge stays outside the hover-fading slot: it must
              remain visible AND clickable while the row is hovered. Only
              the time/jump label yields to the settle affordance. */}
              {prBadge}
              {driverKind ? (
                <span
                  role="img"
                  aria-label={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                  title={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                  className="inline-flex shrink-0 items-center opacity-60"
                >
                  <ProviderInstanceIcon
                    driverKind={driverKind}
                    displayName={thread.session?.providerName ?? modelInstanceId}
                    iconClassName="size-3"
                  />
                </span>
              ) : null}
              {variantAction === "unsnooze" ? (
                <span className="shrink-0 text-[11px] text-muted-foreground/45 @max-[300px]/sidebar-conversations:hidden">
                  Updated {threadTimeLabel(thread)}
                </span>
              ) : null}
              {variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                <span className="shrink-0 text-[11px] text-blue-600/75 @max-[300px]/sidebar-conversations:hidden dark:text-blue-400/75">
                  Wakes {props.snoozeWakeLabelText}
                </span>
              ) : null}
              <span className="relative ml-auto flex h-6 min-w-14 shrink-0 items-center justify-end">
                <span className="inline-flex justify-end tabular-nums text-muted-foreground/55 transition-opacity group-hover/v2-row:opacity-0">
                  {variantAction === "unsnooze" ? (
                    <SidebarSummaryStateLabel state={summaryState} className="text-[11px]" />
                  ) : variantAction === "unsettle" ? (
                    <span
                      role="status"
                      aria-label={`Settled ${settledTimeLabel(thread)}${isWoke ? ", woke from snooze" : ""}`}
                      title={isWoke ? "Settled · Woke from snooze" : "Settled"}
                      className={cn(
                        "inline-flex items-center gap-1 text-xs",
                        SIDEBAR_STATE_PRESENTATIONS.settled.className,
                      )}
                    >
                      <CircleCheckIcon aria-hidden className="size-3.5" />
                      <span className="text-muted-foreground/55">{settledTimeLabel(thread)}</span>
                      {isWoke ? <AlarmClockIcon aria-hidden className="size-3" /> : null}
                    </span>
                  ) : isWoke ? (
                    // A wake can land straight in the settled tail (e.g. PR
                    // merged while snoozed); the signal must survive the trip.
                    <span
                      role="status"
                      aria-label="Woke from snooze"
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"
                    >
                      <AlarmClockIcon aria-hidden className="size-3" />
                      Woke
                    </span>
                  ) : (
                    <span className="text-xs">{threadTimeLabel(thread)}</span>
                  )}
                </span>
                {variantAction === "unsnooze" ? (
                  !props.snoozeSupported ? null : (
                    <button
                      type="button"
                      aria-label="Wake thread now"
                      onClick={handleUnsnoozeClick}
                      className="absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/v2-row:opacity-100"
                    >
                      <AlarmClockOffIcon className="size-3" />
                    </button>
                  )
                ) : variantAction === "unsettle" ? (
                  // Settled rows are history, so they are also where you prune:
                  // delete sits next to un-settle rather than only in the
                  // context menu. Deletion needs no server capability, so it
                  // renders even where settlement is unsupported.
                  <span className="absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:opacity-100 group-hover/v2-row:opacity-100">
                    <button
                      type="button"
                      aria-label="Delete thread"
                      onClick={handleDeleteClick}
                      onDoubleClick={(event) => event.stopPropagation()}
                      className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-destructive-foreground"
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                    {props.settlementSupported ? (
                      <button
                        type="button"
                        aria-label="Un-settle thread"
                        onClick={handleUnsettleClick}
                        className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Undo2Icon className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ) : !props.settlementSupported ? null : (
                  <button
                    type="button"
                    aria-label="Settle thread"
                    onClick={handleSettleClick}
                    className="absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/v2-row:opacity-100"
                  >
                    <CheckIcon className="size-3" />
                  </button>
                )}
              </span>
              {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
            </TooltipTrigger>
            {detailsTooltip}
          </Tooltip>
        </div>
      </li>
    );
  }

  return (
    <li
      data-thread-item
      className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              data-testid="sidebar-v2-row-card"
              className={rowSurfaceClassName}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          <div className="relative z-10 flex h-9 min-w-0 items-center gap-2 px-2.5">
            {props.showProjectIdentity ? (
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={props.projectCwd ?? ""}
                className="size-4 shrink-0"
              />
            ) : null}
            {subAgentCountToggle}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {title}
              {prBadge}
            </div>
            <div className="ml-auto flex h-7 shrink-0 items-center gap-2.5 text-[11px] leading-none">
              {driverKind ? (
                <span
                  role="img"
                  aria-label={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                  title={`${thread.session?.providerName ?? modelInstanceId}, ${modelLabel}`}
                  className="inline-flex size-4 shrink-0 items-center justify-center self-center leading-none opacity-60"
                >
                  <ProviderInstanceIcon
                    driverKind={driverKind}
                    displayName={thread.session?.providerName ?? modelInstanceId}
                    iconClassName="size-3.5"
                  />
                </span>
              ) : null}
              <span className="shrink-0 leading-none text-muted-foreground/45 tabular-nums @max-[300px]/sidebar-conversations:hidden">
                Updated {threadTimeLabel(thread)}
              </span>
              {/* Sub-agent tally sits outside the status slot: it survives the
                  hover cross-fade to the snooze button, and it reads as what it
                  is — the fan-out below this card, not this card's own state. */}
              {props.subAgentStateCounts === null ? null : (
                <span className="shrink-0">
                  <SidebarStateCounters counts={props.subAgentStateCounts} />
                </span>
              )}
              <span className="group/v2-status-slot relative flex h-7 min-w-14 shrink-0 items-center justify-end">
                <span
                  className={cn(
                    "inline-flex items-center transition-opacity",
                    showSnoozeButton &&
                      "group-focus-within/v2-status-slot:absolute group-focus-within/v2-status-slot:right-0 group-hover/v2-row:absolute group-hover/v2-row:right-0 group-hover/v2-row:opacity-0",
                    snoozeMenuOpen && "absolute right-0 opacity-0",
                  )}
                >
                  <SidebarSummaryStateLabel state={summaryState} />
                </span>
                {showSnoozeButton ? (
                  <span
                    className={cn(
                      "absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:static focus-within:opacity-100 group-hover/v2-row:static group-hover/v2-row:opacity-100",
                      snoozeMenuOpen && "static opacity-100",
                    )}
                  >
                    {showSnoozeButton ? (
                      <SnoozePopoverButton
                        open={snoozeMenuOpen}
                        onOpenChange={setSnoozeMenuOpen}
                        onSnooze={handleSnoozePreset}
                      />
                    ) : null}
                  </span>
                ) : null}
              </span>
              {props.settlementSupported ? (
                <button
                  type="button"
                  aria-label={`Settle conversation ${thread.title}`}
                  title={
                    canQuickSettle
                      ? `Settle ${thread.title}`
                      : `${thread.title} is still working or needs attention`
                  }
                  disabled={!canQuickSettle}
                  onClick={handleSettleClick}
                  className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transform-none"
                >
                  <CheckIcon aria-hidden className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});
