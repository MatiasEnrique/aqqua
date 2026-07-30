import { autoAnimate } from "@formkit/auto-animate";
import { useAtomValue } from "@effect/atom-react";
import {
  canSettle,
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CheckIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CopyIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  EllipsisIcon,
  MessageSquareIcon,
  NetworkIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SquarePenIcon,
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
  type ReactNode,
} from "react";
import { useParams, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { readLocalApi } from "../localApi";
import {
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  resolveThreadExpanded,
  useUiStateStore,
} from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useNowMinute } from "../hooks/useNowMinute";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel, parseTimestampDate } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import {
  firstValidTimestampMs,
  hasUnseenCompletion,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  resolveAdjacentThreadId,
  resolveSidebarConversationSummaryState,
  resolveSettledTimestamp,
  resolveSidebarV2Status,
  selectSidebarDraftRows,
  shouldNavigateAfterProjectRemoval,
  sortLogicalProjectsForSidebar,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
} from "./Sidebar.logic";
import {
  buildSidebarThreadTree,
  filterVisibleSidebarThreadEntries,
  shouldReserveThreadExpandGutter,
} from "./Sidebar.threadTree";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import {
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  filterExpandedSidebarWorktreeGroups,
  filterRemovedSidebarWorktreeGroups,
  resolveSidebarWorktreeDeleteAction,
  resolveSidebarWorktreeConversationLocation,
  resolveSidebarWorktreeSettleAction,
  sidebarWorktreeHasVisibleChildren,
  type SidebarWorktreeConversationLocation,
  type SidebarWorktreeGroup,
  type SidebarWorktreeStateCounts,
} from "./Sidebar.worktreeGroups";
import {
  prStatusIndicator,
  resolveThreadPr,
  settledPrHoverColorClass,
} from "./ThreadStatusIndicators";
import {
  resolveSnoozePresets,
  snoozeWakeDescription,
  snoozeWakeLabel,
  type SnoozePreset,
} from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { primaryServerProvidersAtom } from "../state/server";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { CommandDialogTrigger } from "./ui/command";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarContent, SidebarGroup, SidebarMenuButton, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
/**
 * Indent and guide width per sub-agent nesting level. Matches the card's own
 * horizontal padding so the first guide descends from the orchestrator card's
 * left content edge.
 */
const SUB_AGENT_INDENT_PX = 16;
const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Settled rows read "how long ago did this wrap up", matching their sort
// key: both go through resolveSettledTimestamp so label and order can't
// disagree.
function settledTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveSettledTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift any layout when it appears. pointer-events-none
// so it never swallows clicks meant for the settle/un-settle buttons it
// can overlap.
function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}

function SidebarV2ThreadTooltip({
  thread,
  projectTitle,
  projectCwd,
  environmentLabel,
  driverKind,
  modelInstanceId,
  modelLabel,
  branchMismatch,
}: {
  thread: SidebarThreadSummary;
  projectTitle: string | null;
  projectCwd: string | null;
  environmentLabel: string | null;
  driverKind: ProviderInstanceEntry["driverKind"] | null;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
}) {
  return (
    <TooltipPopup
      side="right"
      align="start"
      sideOffset={4}
      variant="glass"
      className="max-w-80 text-left whitespace-normal"
    >
      <div className="flex min-w-0 max-w-80 flex-col gap-2 px-0.5 py-1.5">
        <div className="min-w-0 truncate text-xs leading-none font-medium text-foreground">
          {thread.title}
        </div>
        <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
          {projectTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={projectCwd ?? ""}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{projectTitle}</div>
            </div>
          ) : null}
          {environmentLabel ? (
            <div className="flex min-w-0 items-center gap-2">
              <ServerIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
            </div>
          ) : null}
          {thread.branch ? (
            <div className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{thread.branch}</div>
            </div>
          ) : null}
          {branchMismatch ? (
            <div className="flex min-w-0 items-start gap-2 text-warning">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
              <div className="min-w-0 flex-1 wrap-break-word leading-5">
                You're currently checked out on another branch.
              </div>
            </div>
          ) : null}
          {driverKind ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={thread.session?.providerName ?? modelInstanceId}
                iconClassName="size-3 shrink-0 grayscale opacity-60"
              />
              <div className="min-w-0 truncate text-foreground/75">{modelLabel}</div>
            </div>
          ) : null}
          {thread.session?.lastError ? (
            <div className="flex min-w-0 items-center gap-2 text-red-600 dark:text-red-400">
              <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
              <div className="min-w-0 truncate">Error occurred</div>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipPopup>
  );
}

/**
 * Hover entry point for snooze: a clock button opening the preset menu.
 * Controlled by the row (which also uses the open state to pin its hover
 * actions while the menu is up).
 */
function SnoozePopoverButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: SnoozePreset) => void;
}) {
  const { open, onOpenChange, onSnooze } = props;
  // Presets resolve at open time so "In 1 hour" is relative to the click,
  // not to when the row mounted.
  const presets = useMemo(() => (open ? resolveSnoozePresets(new Date()) : []), [open]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Snooze thread"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="inline-flex h-full cursor-pointer items-center gap-0.5 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ClockIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-56" viewportClassName="p-1">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChange(false);
              onSnooze(preset);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
          >
            <span className="flex-1">{preset.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
              {preset.whenLabel}
            </span>
          </button>
        ))}
      </PopoverPopup>
    </Popover>
  );
}

type SidebarSummaryState = "working" | "done" | "stale" | "settled";

const SIDEBAR_STATE_PRESENTATIONS = {
  working: {
    label: "Working",
    description: "An agent session is running.",
    icon: CircleDashedIcon,
    className: "text-sky-600 dark:text-sky-400",
  },
  needsInput: {
    label: "Needs input",
    description: "Waiting for your reply or approval.",
    icon: CircleAlertIcon,
    className: "text-violet-600 dark:text-violet-300",
  },
  done: {
    label: "Done",
    description: "Completed or ready, still in the active list.",
    icon: CircleCheckIcon,
    className: "text-emerald-700 dark:text-emerald-300",
  },
  stale: {
    label: "Stale",
    description: "A draft, interrupted turn, or failed session.",
    icon: ClockIcon,
    className: "text-muted-foreground/60",
  },
  settled: {
    label: "Settled",
    description: "Stored in the shared Settled section.",
    icon: CircleCheckIcon,
    className: "text-amber-600 dark:text-amber-300",
  },
} as const;

function SidebarSummaryStateLabel(props: { state: SidebarSummaryState; className?: string }) {
  const presentation = SIDEBAR_STATE_PRESENTATIONS[props.state];
  const Icon = presentation.icon;

  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 font-medium leading-none",
        presentation.className,
        props.className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span role="status" className="leading-none">
        {presentation.label}
      </span>
    </span>
  );
}

const SIDEBAR_WORKTREE_STATE_ORDER = ["working", "needsInput", "done", "stale", "settled"] as const;

function worktreeStatePresentations(counts: SidebarWorktreeStateCounts) {
  return SIDEBAR_WORKTREE_STATE_ORDER.flatMap((key) => {
    const count = counts[key];
    return count > 0 ? [{ key, ...SIDEBAR_STATE_PRESENTATIONS[key], count }] : [];
  });
}

function SidebarWorktreeStateCounters(props: { counts: SidebarWorktreeStateCounts }) {
  const counters = worktreeStatePresentations(props.counts);
  const summary = counters
    .map(
      (counter) =>
        `${counter.count} ${counter.label.toLowerCase()} conversation${counter.count === 1 ? "" : "s"}`,
    )
    .join(", ");

  return (
    <span
      role="status"
      aria-label={summary}
      className="inline-flex h-4 shrink-0 items-center gap-1.5 leading-none tabular-nums"
    >
      {counters.map((counter) => {
        const Icon = counter.icon;
        return (
          <span
            key={counter.key}
            title={`${counter.count} ${counter.label.toLowerCase()}`}
            aria-hidden
            className={cn("inline-flex items-center gap-0.5 font-medium", counter.className)}
          >
            <Icon className="size-3.5 shrink-0" />
            <span>{counter.count}</span>
          </span>
        );
      })}
    </span>
  );
}

function SidebarWorktreeStatusDetails(props: { group: SidebarWorktreeGroup }) {
  const states = worktreeStatePresentations(props.group.stateCounts);
  return (
    <>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{props.group.label}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {props.group.isProjectCheckout ? "Current checkout" : "Worktree"}
          {props.group.environmentLabel ? ` · ${props.group.environmentLabel}` : ""}
        </div>
        <div
          className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70"
          title={props.group.workspaceRoot ?? props.group.projectRoot ?? undefined}
        >
          {props.group.workspaceRoot ?? props.group.projectRoot ?? "New worktree"}
        </div>
      </div>
      <div className="mt-3 grid gap-1">
        {states.map((state) => {
          const Icon = state.icon;
          return (
            <div
              key={state.key}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1.5 py-1.5"
            >
              <span
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md bg-foreground/[0.04]",
                  state.className,
                )}
              >
                <Icon aria-hidden className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{state.label}</span>
                <span className="block text-[11px] leading-4 text-muted-foreground text-pretty">
                  {state.description}
                </span>
              </span>
              <span
                className={cn(
                  "self-start pt-0.5 text-xs font-semibold tabular-nums",
                  state.className,
                )}
              >
                {state.count}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const SidebarV2Row = memo(function SidebarV2Row(props: {
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
        <div className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 px-2.5")}>
          {variantAction === "unsettle" ? (
            <Checkbox
              data-thread-selection-safe
              aria-label={`Select ${thread.title}`}
              checked={isSelected}
              onCheckedChange={handleSelectionCheckedChange}
              className="size-4 opacity-65 transition-opacity group-hover/v2-row:opacity-100 data-checked:opacity-100"
            />
          ) : null}
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
                    <span className="text-xs">
                      {variantAction === "unsettle"
                        ? settledTimeLabel(thread)
                        : threadTimeLabel(thread)}
                    </span>
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
            {childCount > 0 ? (
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
            ) : null}
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

/**
 * A new worktree conversation that exists only on this client until its first
 * message creates the server thread. It follows the compact conversation-row
 * rhythm and stays visibly stale until the first message starts real work.
 */
const SidebarV2DraftRow = memo(function SidebarV2DraftRow(props: {
  draftId: string;
  title: string;
  environmentId: EnvironmentId;
  projectCwd: string | null;
  projectTitle: string | null;
  showProjectIdentity: boolean;
  isActive: boolean;
  onClick: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}) {
  const { draftId, onClick, onDiscard } = props;
  const handleClick = useCallback(() => onClick(draftId), [draftId, onClick]);
  const handleDiscardClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDiscard(draftId);
    },
    [draftId, onDiscard],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onClick(draftId);
    },
    [draftId, onClick],
  );
  return (
    <li data-thread-selection-safe className="list-none">
      <div
        role="button"
        tabIndex={0}
        data-testid={`sidebar-v2-row-draft-${draftId}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group/v2-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
          props.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <div className="relative z-10 flex h-9 min-w-0 items-center gap-2 px-2.5">
          {props.showProjectIdentity ? (
            <ProjectFavicon
              environmentId={props.environmentId}
              cwd={props.projectCwd ?? ""}
              className="size-4 shrink-0"
            />
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
              {props.title}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/55">
              Waiting for first message
            </span>
          </div>
          <span className="transition-opacity group-hover/v2-row:opacity-0">
            <SidebarSummaryStateLabel state="stale" className="text-[11px]" />
          </span>
          <span className="absolute inset-y-0 right-2 flex items-center opacity-0 transition-opacity group-focus-within/v2-row:opacity-100 group-hover/v2-row:opacity-100">
            <button
              type="button"
              aria-label="Discard draft"
              onClick={handleDiscardClick}
              onDoubleClick={(event) => event.stopPropagation()}
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted-foreground hover:text-destructive-foreground"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </span>
        </div>
      </div>
    </li>
  );
});

export default function SidebarV2() {
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
  const removedWorktreeAtByKey = useUiStateStore((s) => s.removedWorktreeAtByKey);
  const markWorktreeRemoved = useUiStateStore((s) => s.markWorktreeRemoved);
  const clearWorktreeRemoved = useUiStateStore((s) => s.clearWorktreeRemoved);
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

  const handleRemoveProjectMembers = useCallback(
    async (projectGroup: SidebarProjectSnapshot, members: readonly SidebarProjectGroupMember[]) => {
      const api = readLocalApi();
      if (!api) return;

      const memberKeys = new Set(members.map((member) => `${member.environmentId}:${member.id}`));
      const projectThreads = threads.filter((thread) =>
        memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
      );
      const isWholeGroup = members.length === projectGroup.memberProjects.length;
      const singleMember = members.length === 1 ? members[0]! : null;
      const targetLabel = singleMember?.title ?? projectGroup.displayName;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          projectThreads.length > 0
            ? [
                `Remove project "${targetLabel}" and delete its ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}?`,
                ...(singleMember
                  ? [
                      `Path: ${singleMember.workspaceRoot}`,
                      ...(singleMember.environmentLabel
                        ? [`Environment: ${singleMember.environmentLabel}`]
                        : []),
                    ]
                  : [`This removes ${members.length} grouped project entries.`]),
                "This permanently clears conversation history for those threads.",
                isWholeGroup
                  ? "This removes only the project entries, not the files on disk."
                  : "Other entries in this grouped project are unaffected.",
                "This action cannot be undone.",
              ].join("\n")
            : [
                `Remove project "${targetLabel}"?`,
                ...(singleMember
                  ? [
                      `Path: ${singleMember.workspaceRoot}`,
                      ...(singleMember.environmentLabel
                        ? [`Environment: ${singleMember.environmentLabel}`]
                        : []),
                    ]
                  : [`This removes ${members.length} grouped project entries.`]),
                isWholeGroup
                  ? "This removes only the project entries, not the files on disk."
                  : "Other entries in this grouped project are unaffected.",
              ].join("\n"),
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;

      const draftStore = useComposerDraftStore.getState();
      let shouldNavigate = false;
      for (const project of members) {
        const memberThreads = projectThreads.filter(
          (thread) =>
            thread.environmentId === project.environmentId && thread.projectId === project.id,
        );
        const projectRef = scopeProjectRef(project.environmentId, project.id);
        const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
        const memberRemovalNeedsNavigation = shouldNavigateAfterProjectRemoval({
          routeTarget: routeTargetRef.current,
          projectThreads: memberThreads,
          projectDraftId: projectDraftThread?.draftId ?? null,
        });

        const result = await deleteProject({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            ...(memberThreads.length > 0 ? { force: true } : {}),
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: `Failed to remove "${project.title}"`,
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          if (shouldNavigate) {
            void router.navigate({ to: "/" });
          }
          return;
        }

        shouldNavigate ||= memberRemovalNeedsNavigation;
        if (projectDraftThread) {
          draftStore.clearDraftThread(projectDraftThread.draftId);
        }
        draftStore.clearProjectDraftThreadId(projectRef);
      }

      if (shouldNavigate) {
        void router.navigate({ to: "/" });
      }
    },
    [deleteProject, router, threads],
  );

  const renameProjectMember = useCallback(
    async (member: SidebarProjectGroupMember, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) {
        toastManager.add({ type: "warning", title: "Project title cannot be empty" });
        return;
      }
      if (title === member.title) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, title },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectGroupingPreference = useCallback(
    (member: SidebarProjectGroupMember, selection: SidebarProjectGroupingMode | "inherit") => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      const nextOverrides = { ...projectGroupingSettings.sidebarProjectGroupingOverrides };
      if (selection === "inherit") {
        delete nextOverrides[overrideKey];
      } else {
        nextOverrides[overrideKey] = selection;
      }
      updateSettings({ sidebarProjectGroupingOverrides: nextOverrides });
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides, updateSettings],
  );

  const handleProjectActions = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      window.requestAnimationFrame(() => setProjectActionsTarget(projectGroup));
    },
    [],
  );

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
    for (const worktree of unfilteredWorktreeGroups) {
      if (
        removedWorktreeAtByKey[worktree.key] !== undefined &&
        sidebarWorktreeHasVisibleChildren(worktree)
      ) {
        clearWorktreeRemoved(worktree.key);
      }
    }
  }, [clearWorktreeRemoved, removedWorktreeAtByKey, unfilteredWorktreeGroups]);
  const worktreeGroups = useMemo(
    () => filterRemovedSidebarWorktreeGroups(unfilteredWorktreeGroups, removedWorktreeAtByKey),
    [removedWorktreeAtByKey, unfilteredWorktreeGroups],
  );
  const repositoryGroups = useMemo(
    () => buildSidebarRepositoryGroups({ projects: projectGroups, worktrees: worktreeGroups }),
    [projectGroups, worktreeGroups],
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
  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const navigateToDraft = useCallback(
    (draftId: string) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/draft/$draftId",
        params: { draftId },
      });
    },
    [clearSelection, isMobile, router, setOpenMobile],
  );

  // Drafts are client-local, so discarding is a plain store removal — no
  // server command, no confirm. Leaving the routed draft's page after its
  // state is gone would strand the composer, so navigation falls back home.
  const discardDraft = useCallback(
    (draftId: string) => {
      useComposerDraftStore.getState().clearDraftThread(DraftId.make(draftId));
      if (routeDraftId === draftId) {
        void router.navigate({ to: "/" });
      }
    },
    [routeDraftId, router],
  );

  const toggleThreadExpanded = useCallback(
    (threadRef: ScopedThreadRef, expanded: boolean) => {
      const threadKey = scopedThreadKey(threadRef);
      setThreadExpanded(threadKey, expanded);
    },
    [setThreadExpanded],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const threadKey = scopedThreadKey(threadRef);
      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedThreadKeysRef.current);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }
      navigateToThread(threadRef);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  // A settle per thread at a time: double clicks and repeated menu picks
  // must not dispatch a second settle that fails and toasts a false error.
  const settlingThreadKeysRef = useRef(new Set<string>());
  // Parking the thread you're looking at (settle or snooze) moves you
  // forward: the next remaining card (never a settled or snoozed row, never
  // one leaving in the same batch), or a fresh draft in this project when it
  // was the last active one. Callers snapshot the plan BEFORE the command
  // mutates the partition; background parks never navigate (null plan).
  const planForwardNavigation = useCallback(
    (threadKey: string, coParkingKeys?: ReadonlySet<string>): (() => void) | null => {
      if (routeThreadKeyRef.current !== threadKey) return null;
      const shell = threadByKeyRef.current.get(threadKey);
      const orderedKeys = orderedThreadKeysRef.current;
      const settledKeys = settledThreadKeysRef.current;
      const snoozedKeys = snoozedThreadKeysRef.current;
      const currentIndex = orderedKeys.indexOf(threadKey);
      const nextCardKey =
        currentIndex === -1
          ? null
          : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
              (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
            ) ?? null);
      const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
      return nextThread
        ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
        : shell
          ? () =>
              void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
          : () => void router.navigate({ to: "/" });
    },
    [navigateToThread, router],
  );

  const attemptSettle = useCallback(
    (threadRef: ScopedThreadRef, opts: { coSettlingKeys?: ReadonlySet<string> } = {}) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (settlingThreadKeysRef.current.has(threadKey)) return;
        settlingThreadKeysRef.current.add(threadKey);
        try {
          const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
          const result = await settleThread(threadRef);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not settle.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to settle thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Only move forward if the user is still on the settled thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSettle?.();
          }
        } finally {
          settlingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [planForwardNavigation, settleThread],
  );
  const attemptUnsettle = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsettleThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to un-settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsettleThread],
  );
  const attemptUnsnooze = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to wake thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsnoozeThread],
  );
  // One snooze per thread at a time — same double-dispatch guard as settle.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const attemptSnooze = useCallback(
    (
      threadRef: ScopedThreadRef,
      preset: SnoozePreset,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (snoozingThreadKeysRef.current.has(threadKey)) return;
        snoozingThreadKeysRef.current.add(threadKey);
        try {
          // Snoozing the open thread moves you forward, same as settle —
          // both park the thread you're done with for now.
          const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
          const result = await snoozeThread(threadRef, preset.snoozedUntil);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not snooze.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to snooze thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Snooze hides the row, so the toast is the only confirmation —
          // and the Undo is the escape hatch for a mis-click.
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date())}`,
              timeout: 5_000,
              actionProps: {
                children: "Undo",
                onClick: () => attemptUnsnooze(threadRef),
              },
            }),
          );
          // Only move forward if the user is still on the snoozed thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSnooze?.();
          }
        } finally {
          snoozingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [attemptUnsnooze, planForwardNavigation, snoozeThread],
  );

  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const deleteThreadSelection = useCallback(
    async (selectedThreads: readonly EnvironmentThreadShell[]) => {
      if (selectedThreads.length === 0) return;
      const threadKeys = selectedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      const deletionResult = await deleteThreads(selectedThreads);
      if (deletionResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(deletionResult)) {
          const error = squashAtomCommandFailure(deletionResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete threads",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      if (deletionResult.value !== null) removeFromSelection(threadKeys);
    },
    [deleteThreads, removeFromSelection],
  );
  const deleteSelectedSettledThreads = useCallback(() => {
    if (deletingSettledSelection || selectedSettledThreads.length === 0) return;
    void (async () => {
      setDeletingSettledSelection(true);
      try {
        await deleteThreadSelection(selectedSettledThreads);
      } finally {
        setDeletingSettledSelection(false);
      }
    })();
  }, [deleteThreadSelection, deletingSettledSelection, selectedSettledThreads]);
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (settled-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys].filter(
        (threadKey) => threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // Snooze (N) is offered when every selected thread can actually take
      // it — a mixed selection with blocked-on-you work would half-apply.
      const selectionNow = new Date().toISOString();
      const snoozableThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const canSnoozeSelection = snoozableThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow }),
      );
      const snoozePresets = resolveSnoozePresets(new Date());
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            { id: "settle", label: `Settle (${count})` },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    children: snoozePresets.map((preset) => ({
                      id: `snooze:${preset.id}`,
                      label: `${preset.label} (${preset.whenLabel})`,
                    })),
                  },
                ]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset = snoozePresets.find(
          (candidate) => `snooze:${candidate.id}` === clicked.value,
        );
        if (preset) {
          // Post-snooze navigation must skip threads snoozing in this same
          // batch — they are all leaving the card block together.
          const coSnoozingKeys = new Set(threadKeys);
          for (const thread of snoozableThreads) {
            attemptSnooze(scopeThreadRef(thread.environmentId, thread.id), preset, {
              coSnoozingKeys,
            });
          }
          clearSelection();
        }
        return;
      }
      if (clicked.value === "settle") {
        // Post-settle navigation must skip threads settling in this same
        // batch — they are all leaving the card block together. Rows that
        // are already explicitly settled are skipped: nothing to do on a
        // valid mixed selection.
        const coSettlingKeys = new Set(threadKeys);
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread || thread.settledOverride === "settled") continue;
          attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      await deleteThreadSelection(selectedThreads);
    },
    [
      attemptSettle,
      attemptSnooze,
      clearSelection,
      deleteThreadSelection,
      markThreadUnread,
      serverConfigs,
    ],
  );

  // One deletion path for every entry point (context menu, settled row's trash
  // button): the confirm setting and the worktree-orphan handling inside
  // deleteThreads must not drift between them.
  const attemptDeleteThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const result = await deleteThreads([thread]);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [deleteThreads],
  );

  const attemptSettleWorktree = useCallback(
    (group: SidebarWorktreeGroup) => {
      if (group.unsettled.length === 0 || settlingWorktreeKey !== null) return;
      const threadKeys = new Set(
        group.unsettled.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      if ([...threadKeys].some((threadKey) => settlingThreadKeysRef.current.has(threadKey))) {
        return;
      }

      void (async () => {
        setSettlingWorktreeKey(group.key);
        for (const threadKey of threadKeys) settlingThreadKeysRef.current.add(threadKey);
        const activeRouteKey = routeThreadKeyRef.current;
        const navigateAfterSettle =
          activeRouteKey !== null && threadKeys.has(activeRouteKey)
            ? planForwardNavigation(activeRouteKey, threadKeys)
            : null;
        try {
          const result = await settleThreads(group.unsettled);
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: `Could not settle ${group.label}`,
                  description:
                    error instanceof Error
                      ? error.message
                      : "A conversation is still working or needs attention.",
                }),
              );
            }
            return;
          }
          toastManager.add({
            type: "success",
            title: `${group.label} settled`,
            description: `${group.unsettled.length} conversation${group.unsettled.length === 1 ? "" : "s"} moved to Settled.`,
          });
          if (activeRouteKey !== null && routeThreadKeyRef.current === activeRouteKey) {
            navigateAfterSettle?.();
          }
        } finally {
          for (const threadKey of threadKeys) settlingThreadKeysRef.current.delete(threadKey);
          setSettlingWorktreeKey(null);
        }
      })();
    },
    [planForwardNavigation, settleThreads, settlingWorktreeKey],
  );

  const attemptDeleteWorktree = useCallback(
    (group: SidebarWorktreeGroup) => {
      if (
        group.isProjectCheckout ||
        group.workspaceRoot === null ||
        group.projectRoot === null ||
        removingWorktreeKey !== null
      ) {
        return;
      }
      const workspaceRoot = group.workspaceRoot;
      const projectRoot = group.projectRoot;

      void (async () => {
        setRemovingWorktreeKey(group.key);
        try {
          const removed = await deleteWorktree({
            environmentId: group.environmentId as EnvironmentId,
            projectCwd: projectRoot,
            worktreePath: workspaceRoot,
            label: group.label,
            threads,
          });
          if (removed) {
            markWorktreeRemoved(group.key, new Date().toISOString());
          }
        } finally {
          setRemovingWorktreeKey(null);
        }
      })();
    },
    [deleteWorktree, markWorktreeRemoved, removingWorktreeKey, threads],
  );

  const handleLocationContextMenu = useCallback(
    (
      event: ReactMouseEvent,
      input: {
        projectRef: ReturnType<typeof scopeProjectRef>;
        location?: SidebarWorktreeConversationLocation;
      },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const position = { x: event.clientX, y: event.clientY };

      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [{ id: "new-conversation", label: "New conversation here" }],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value !== "new-conversation") return;

        const result = await settlePromise(() =>
          handleNewThreadRef.current(input.projectRef, input.location),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create conversation",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        // Un-settle works on every settled row: for explicit settles it
        // clears the override, for auto-settled rows it pins the thread
        // active until real activity clears the pin. Environments without
        // the settlement capability get no lifecycle items at all.
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        // Presets resolve at menu-open time (same as the popover).
        const snoozePresets = resolveSnoozePresets(new Date());
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      label: `New thread on ${thread.branch}`,
                    },
                  ]
                : []),
              ...(supportsSettlement
                ? [
                    isSettled
                      ? { id: "unsettle", label: "Un-settle thread" }
                      : { id: "settle", label: "Settle thread" },
                  ]
                : []),
              ...(supportsSnooze
                ? [
                    isSnoozed
                      ? { id: "unsnooze", label: "Wake thread" }
                      : {
                          id: "snooze",
                          label: "Snooze",
                          disabled: !canSnooze(thread, { now: new Date().toISOString() }),
                          children: snoozePresets.map((preset) => ({
                            id: `snooze:${preset.id}`,
                            label: `${preset.label} (${preset.whenLabel})`,
                          })),
                        },
                  ]
                : []),
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              { id: "delete", label: "Delete", destructive: true, icon: "trash" },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset = snoozePresets.find(
            (candidate) => `snooze:${candidate.id}` === clicked.value,
          );
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "new-thread-on-branch": {
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "mark-unread":
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
            return;
          case "delete":
            attemptDeleteThread(threadRef);
            return;
          default:
            return;
        }
      })();
    },
    [
      attemptDeleteThread,
      attemptSettle,
      attemptSnooze,
      attemptUnsettle,
      attemptUnsnooze,
      handleMultiSelectContextMenu,
      markThreadUnread,
      serverConfigs,
      startThreadRename,
    ],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
  ]);

  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
  const shortcutModifiers = useShortcutModifierState();
  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    { platform: navigator.platform },
  );
  useEffect(() => {
    setShowJumpHints(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow]);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(() => {
    // One project: nothing to pick, create immediately.
    if (projectGroups.length <= 1) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  }, [isMobile, newThreadContext, projectGroups.length, setOpenMobile]);

  const commandPaletteShortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  // Same resolution as v1: prefer the local-thread binding, fall back to
  // chat.new, no platform gating — web users have working shortcuts too.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="@container/sidebar-conversations gap-0"
        fixedHeader={
          <SidebarGroup className="gap-1 p-2">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <CommandDialogTrigger
                  render={
                    <SidebarMenuButton
                      type="button"
                      aria-label="Search threads and commands"
                      className="focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                      data-testid="command-palette-trigger"
                    />
                  }
                >
                  <SearchIcon />
                  <div className="flex-1 truncate text-left">Search</div>
                  {commandPaletteShortcutLabel ? (
                    <Kbd className="mr-px h-4 min-w-0 rounded-sm bg-sidebar-control-surface px-1.5 text-[10px] text-sidebar-muted-foreground ring-1 ring-sidebar-border">
                      {commandPaletteShortcutLabel}
                    </Kbd>
                  ) : null}
                </CommandDialogTrigger>
              </div>
              <div className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={handleNewThreadClick}
                        disabled={projects.length === 0}
                        aria-label="New thread"
                      />
                    }
                  >
                    <SquarePenIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {newThreadShortcutLabel
                      ? `New thread (${newThreadShortcutLabel})`
                      : "New thread"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            {projectGroups.length > 0 ? (
              <div className="flex items-center gap-1">
                <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        aria-label="Filter threads by project"
                        className="min-w-0 flex-1 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onContextMenu={(event) => {
                          if (scopedProjectGroup === null) return;
                          handleLocationContextMenu(event, {
                            projectRef: scopeProjectRef(
                              scopedProjectGroup.environmentId,
                              scopedProjectGroup.id,
                            ),
                          });
                        }}
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <ProjectFavicon
                        environmentId={scopedProjectGroup.environmentId}
                        cwd={scopedProjectGroup.workspaceRoot}
                        className="size-4 shrink-0"
                      />
                    ) : (
                      <FolderIcon className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {scopedProjectGroup?.displayName ?? "All projects"}
                    </span>
                    <ChevronDownIcon className="-mr-px size-4 shrink-0" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="w-(--anchor-width)">
                    <MenuRadioGroup
                      value={projectScopeKey ?? "all"}
                      onValueChange={(value) =>
                        setProjectScopeKey(value === "all" ? null : (value as string))
                      }
                    >
                      <MenuRadioItem
                        value="all"
                        closeOnClick
                        className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                      >
                        <FolderIcon className="size-4 shrink-0" />
                        <span className="min-w-0 truncate text-sm">All projects</span>
                      </MenuRadioItem>
                      {projectGroups.map((project) => {
                        const scopeKey = project.projectKey;
                        return (
                          <MenuRadioItem
                            key={scopeKey}
                            value={scopeKey}
                            closeOnClick
                            className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                          >
                            <ProjectFavicon
                              environmentId={project.environmentId}
                              cwd={project.workspaceRoot}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                            <button
                              type="button"
                              aria-label={`Project actions for ${project.displayName}`}
                              title={`Project actions for ${project.displayName}`}
                              className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                void handleProjectActions(event, project);
                              }}
                            >
                              <EllipsisIcon className="size-3.5" />
                            </button>
                          </MenuRadioItem>
                        );
                      })}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
                        type="button"
                        aria-label="New project"
                      />
                    }
                  >
                    <FolderPlusIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">New project</TooltipPopup>
                </Tooltip>
              </div>
            ) : null}
          </SidebarGroup>
        }
      >
        <SidebarGroup className="px-2 pb-1 pt-0">
          <TooltipProvider
            key="sidebar-thread-tooltips-150"
            delay={150}
            closeDelay={0}
            timeout={400}
          >
            <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
              {(() => {
                const renderThreadRow = (
                  thread: EnvironmentThreadShell,
                  section: "active" | "snoozed" | "settled",
                ) => {
                  const threadKey = scopedThreadKey(
                    scopeThreadRef(thread.environmentId, thread.id),
                  );
                  const treeMeta = activeTreeMetaByKey.get(threadKey);
                  const depth = section === "active" ? (treeMeta?.depth ?? 0) : 0;
                  // Settled, snoozed and sub-agent rows are the ONLY things
                  // that collapse a row: every other thread is a full card.
                  // Density comes from users (or the auto rules) actually
                  // parking work, and from delegation nesting under its
                  // orchestrator — not from the sidebar second-guessing what
                  // still matters.
                  const rowVariant = section !== "active" ? "slim" : depth > 0 ? "sub" : "card";
                  return (
                    <SidebarV2Row
                      // Keyed per variant on purpose: when a thread settles,
                      // the card fades out in place and the slim row fades
                      // in at its settled position instead of one element
                      // FLIP-sliding through every row in between (rows here
                      // are translucent, so a crossing row reads as text
                      // painted over text).
                      key={`${threadKey}:${rowVariant}`}
                      thread={thread}
                      variant={rowVariant}
                      depth={depth}
                      childCount={section === "active" ? (treeMeta?.childCount ?? 0) : 0}
                      reserveExpandGutter={reserveSubAgentGutter}
                      isExpanded={expandedThreadKeys.has(threadKey)}
                      onToggleExpanded={toggleThreadExpanded}
                      // Snoozed rows wake; settled rows un-settle (explicit
                      // settles clear the override, auto-settled rows get
                      // pinned active); cards settle.
                      variantAction={
                        section === "snoozed"
                          ? "unsnooze"
                          : section === "settled"
                            ? "unsettle"
                            : "settle"
                      }
                      settlementSupported={
                        serverConfigs.get(thread.environmentId)?.environment.capabilities
                          .threadSettlement === true
                      }
                      snoozeSupported={
                        serverConfigs.get(thread.environmentId)?.environment.capabilities
                          .threadSnooze === true
                      }
                      snoozeWakeLabelText={
                        section === "snoozed" && thread.snoozedUntil != null
                          ? snoozeWakeLabel(thread.snoozedUntil, new Date())
                          : null
                      }
                      // All sections: a woken thread can classify straight
                      // into the settled tail (PR merged while snoozed), and
                      // the wake signal must survive the trip. Still-snoozed
                      // rows resolve to null on their own.
                      wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                      isActive={routeThreadKey === threadKey}
                      jumpLabel={showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null}
                      environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                      projectCwd={
                        projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                      }
                      projectTitle={
                        projectDisplayNameByKey.get(
                          `${thread.environmentId}:${thread.projectId}`,
                        ) ?? null
                      }
                      showProjectIdentity={
                        section !== "settled" && sidebarThreadGroupingMode !== "worktree"
                      }
                      providerEntryByInstanceId={providerEntryByInstanceId}
                      onThreadClick={handleThreadClick}
                      onThreadActivate={navigateToThread}
                      onStartRename={startThreadRename}
                      onRenameTitleChange={setRenamingTitle}
                      onCommitRename={commitThreadRename}
                      onCancelRename={cancelThreadRename}
                      isRenaming={renamingThreadKey === threadKey}
                      renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                      onContextMenu={handleThreadContextMenu}
                      onSettle={attemptSettle}
                      onUnsettle={attemptUnsettle}
                      onSnooze={attemptSnooze}
                      onUnsnooze={attemptUnsnooze}
                      onDelete={attemptDeleteThread}
                      onChangeRequestState={handleChangeRequestState}
                    />
                  );
                };
                const renderDraftRow = (row: (typeof groupedDraftRows)[number]) => {
                  const projectKey =
                    `${row.environmentId}:${row.projectId}` as `${EnvironmentId}:${ProjectId}`;
                  return (
                    <SidebarV2DraftRow
                      key={`draft:${row.draftId}`}
                      draftId={row.draftId}
                      title={row.title}
                      environmentId={row.environmentId as EnvironmentId}
                      projectCwd={projectCwdByKey.get(projectKey) ?? null}
                      projectTitle={projectDisplayNameByKey.get(projectKey) ?? null}
                      showProjectIdentity={sidebarThreadGroupingMode !== "worktree"}
                      isActive={routeDraftId === row.draftId}
                      onClick={navigateToDraft}
                      onDiscard={discardDraft}
                    />
                  );
                };
                const items: ReactNode[] = [];
                if (sidebarThreadGroupingMode === "worktree") {
                  const renderWorktreeGroup = (group: SidebarWorktreeGroup): ReactNode[] => {
                    const groupItems: ReactNode[] = [];
                    const settlementSupported =
                      serverConfigs.get(group.environmentId as EnvironmentId)?.environment
                        .capabilities.threadSettlement === true;
                    const worktreeSettlementBlocked = group.unsettled.some(
                      (thread) => !canSettle(thread, { now: new Date().toISOString() }),
                    );
                    const settleAction = resolveSidebarWorktreeSettleAction({
                      conversationCount: group.unsettled.length,
                      settlementSupported,
                      hasBlockedConversation: worktreeSettlementBlocked,
                      isSettling: settlingWorktreeKey !== null,
                      isRemoving: removingWorktreeKey !== null,
                    });
                    const deleteAction = resolveSidebarWorktreeDeleteAction({
                      isProjectCheckout: group.isProjectCheckout,
                      worktreeCreated: group.workspaceRoot !== null && group.projectRoot !== null,
                      isRemoving: removingWorktreeKey !== null,
                      isSettling: settlingWorktreeKey !== null,
                    });
                    const hasVisibleChildren = sidebarWorktreeHasVisibleChildren(group);
                    // A routed descendant does not override the user's collapse:
                    // the conversation remains open in chat while its sidebar
                    // container is allowed to stay closed.
                    const expanded =
                      hasVisibleChildren && worktreeExpandedByKey[group.key] !== false;
                    groupItems.push(
                      <div
                        key={`${group.key}:header`}
                        data-thread-selection-safe
                        className="mb-1 mt-1 flex items-center gap-1 rounded-lg"
                      >
                        <button
                          type="button"
                          aria-expanded={hasVisibleChildren ? expanded : undefined}
                          onClick={
                            hasVisibleChildren
                              ? () => setWorktreeExpanded(group.key, !expanded)
                              : undefined
                          }
                          onContextMenu={(event) => {
                            const location = resolveSidebarWorktreeConversationLocation(group);
                            if (location === null) return;
                            handleLocationContextMenu(event, {
                              projectRef: scopeProjectRef(
                                group.environmentId as EnvironmentId,
                                group.projectId as ProjectId,
                              ),
                              location,
                            });
                          }}
                          className={cn(
                            "flex min-h-14 min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left text-sidebar-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover motion-reduce:transform-none",
                            hasVisibleChildren
                              ? "cursor-pointer active:scale-[0.96]"
                              : "cursor-default",
                          )}
                        >
                          {hasVisibleChildren ? (
                            expanded ? (
                              <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0" />
                            ) : (
                              <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0" />
                            )
                          ) : (
                            <span aria-hidden className="size-3.5 shrink-0" />
                          )}
                          <GitBranchIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {group.label}
                            </span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/65">
                              <SidebarWorktreeStateCounters counts={group.stateCounts} />
                              <span aria-hidden>·</span>
                              <span className="truncate">
                                {group.isProjectCheckout ? "Current checkout" : "Worktree"}
                              </span>
                            </span>
                          </span>
                        </button>
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                aria-label={`Worktree actions for ${group.label}`}
                                className="mr-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-foreground active:scale-[0.96] motion-reduce:transform-none"
                              />
                            }
                          >
                            <EllipsisIcon aria-hidden className="size-4" />
                          </PopoverTrigger>
                          <PopoverPopup
                            side="right"
                            align="start"
                            className="w-80"
                            viewportClassName="p-3"
                          >
                            <SidebarWorktreeStatusDetails group={group} />
                            <div className="mt-3 grid gap-2 border-t border-border/60 pt-3">
                              <div>
                                <PopoverClose
                                  render={
                                    <Button
                                      size="lg"
                                      variant="outline"
                                      disabled={!settleAction.enabled}
                                      onClick={() => attemptSettleWorktree(group)}
                                      className="h-10 w-full justify-start px-3"
                                    />
                                  }
                                >
                                  <CheckCheckIcon aria-hidden />
                                  Settle all
                                </PopoverClose>
                                {settleAction.disabledReason ? (
                                  <p className="px-1 pt-1.5 text-[11px] leading-4 text-muted-foreground text-pretty">
                                    {settleAction.disabledReason}
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <PopoverClose
                                  render={
                                    <Button
                                      size="lg"
                                      variant="destructive-outline"
                                      disabled={!deleteAction.enabled}
                                      onClick={() => attemptDeleteWorktree(group)}
                                      className="h-10 w-full justify-start px-3"
                                    />
                                  }
                                >
                                  <Trash2Icon aria-hidden />
                                  Delete worktree
                                </PopoverClose>
                                {deleteAction.disabledReason ? (
                                  <p className="px-1 pt-1.5 text-[11px] leading-4 text-muted-foreground text-pretty">
                                    {deleteAction.disabledReason}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </PopoverPopup>
                        </Popover>
                      </div>,
                    );
                    if (!expanded) {
                      return [
                        <li
                          key={`worktree:${group.key}`}
                          data-thread-selection-safe
                          className="list-none"
                        >
                          {groupItems}
                        </li>,
                      ];
                    }
                    for (const draft of group.drafts) {
                      groupItems.push(renderDraftRow(draft));
                    }
                    for (const thread of group.active) {
                      groupItems.push(renderThreadRow(thread, "active"));
                    }
                    const visibleGroupSnoozed = snoozedShelfExpanded ? group.snoozed : [];
                    if (group.snoozed.length > 0) {
                      groupItems.push(
                        <li
                          key={`${group.key}:snoozed`}
                          data-thread-selection-safe
                          className="list-none"
                        >
                          <button
                            type="button"
                            onClick={toggleSnoozedShelf}
                            aria-expanded={snoozedShelfExpanded}
                            className="mb-1 mt-2 flex w-full items-center gap-2 px-2.5 text-left"
                          >
                            <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                              {snoozedShelfExpanded
                                ? "Snoozed"
                                : `Snoozed (${group.snoozed.length})`}
                            </span>
                            <span className="h-px flex-1 bg-blue-500/20" />
                          </button>
                        </li>,
                      );
                    }
                    for (const thread of visibleGroupSnoozed) {
                      groupItems.push(renderThreadRow(thread, "snoozed"));
                    }
                    return [
                      <li
                        key={`worktree:${group.key}`}
                        data-thread-selection-safe
                        className="list-none"
                      >
                        {groupItems[0]}
                        <ul role="list" className="ml-2 border-l border-sidebar-border/60 pl-1.5">
                          {groupItems.slice(1)}
                        </ul>
                      </li>,
                    ];
                  };

                  if (repositoryHierarchyVisible) {
                    for (const repository of repositoryGroups) {
                      const expanded = resolveProjectExpanded(projectExpandedById, [
                        repository.project.projectKey,
                      ]);
                      items.push(
                        <li
                          key={`repository:${repository.project.projectKey}`}
                          data-thread-selection-safe
                          className="list-none"
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Collapse" : "Expand"} repository ${repository.project.displayName}`}
                            onClick={() =>
                              setProjectExpanded(repository.project.projectKey, !expanded)
                            }
                            onContextMenu={(event) =>
                              handleLocationContextMenu(event, {
                                projectRef: scopeProjectRef(
                                  repository.project.environmentId,
                                  repository.project.id,
                                ),
                              })
                            }
                            className="mt-2 flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-sidebar-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover active:scale-[0.96] motion-reduce:transform-none"
                          >
                            {expanded ? (
                              <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
                            ) : (
                              <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
                            )}
                            <ProjectFavicon
                              environmentId={repository.project.environmentId}
                              cwd={repository.project.workspaceRoot}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {repository.project.displayName}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-normal tabular-nums text-muted-foreground/60">
                              <span>
                                {repository.worktrees.length} branch
                                {repository.worktrees.length === 1 ? "" : "es"}
                              </span>
                              {!expanded ? (
                                <>
                                  <span aria-hidden>·</span>
                                  <MessageSquareIcon aria-hidden className="size-3" />
                                  <span>{repository.conversationCount}</span>
                                </>
                              ) : null}
                            </span>
                          </button>
                          {expanded ? (
                            <ul
                              role="list"
                              className="ml-2 border-l border-sidebar-border/60 pl-1.5"
                            >
                              {repository.worktrees.flatMap(renderWorktreeGroup)}
                            </ul>
                          ) : null}
                        </li>,
                      );
                    }
                  } else {
                    for (const group of worktreeGroups) {
                      items.push(...renderWorktreeGroup(group));
                    }
                  }
                } else {
                  items.push(
                    ...draftRows.map(renderDraftRow),
                    ...visibleActiveThreads.map((thread) => renderThreadRow(thread, "active")),
                  );
                  // Snoozed shelf: between the inbox and Settled — out of the
                  // way, never gone. The header always renders while anything
                  // is snoozed (the count is the whole footprint when
                  // collapsed); rows only when expanded. Vanishes entirely at
                  // count 0.
                  if (snoozedThreads.length > 0) {
                    items.push(
                      <li
                        key="snoozed-shelf-header"
                        data-thread-selection-safe
                        className="list-none"
                      >
                        <button
                          type="button"
                          onClick={toggleSnoozedShelf}
                          aria-expanded={snoozedShelfExpanded}
                          data-testid="sidebar-v2-snoozed-shelf-toggle"
                          className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                        >
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {snoozedShelfExpanded
                              ? "Snoozed"
                              : `Snoozed (${snoozedThreads.length})`}
                          </span>
                          <span className="h-px flex-1 bg-blue-500/20 dark:bg-blue-400/15" />
                          <ChevronDownIcon
                            aria-hidden
                            className={cn(
                              "size-3 text-blue-600 transition-transform dark:text-blue-400",
                              snoozedShelfExpanded && "rotate-180",
                            )}
                          />
                        </button>
                      </li>,
                    );
                    for (const thread of visibleSnoozedThreads) {
                      items.push(renderThreadRow(thread, "snoozed"));
                    }
                  }
                }
                if (settledThreads.length > 0) {
                  items.push(
                    <li key="settled-shelf-header" data-thread-selection-safe className="list-none">
                      <div className="mb-1 mt-3 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={toggleSettledShelf}
                          aria-expanded={settledShelfExpanded}
                          data-testid="sidebar-v2-settled-shelf-toggle"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 text-left"
                        >
                          <span className="text-xs font-medium text-muted-foreground/50">
                            {settledShelfExpanded
                              ? "Settled"
                              : `Settled (${settledThreads.length})`}
                          </span>
                          <span className="h-px flex-1 bg-sidebar-border/60" />
                          <ChevronDownIcon
                            aria-hidden
                            className={cn(
                              "size-3 text-muted-foreground/50 transition-transform",
                              settledShelfExpanded && "rotate-180",
                            )}
                          />
                        </button>
                        {selectedSettledThreads.length > 0 ? (
                          <button
                            type="button"
                            disabled={deletingSettledSelection}
                            onClick={deleteSelectedSettledThreads}
                            className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-50"
                            aria-label={`Delete ${selectedSettledThreads.length} selected settled conversation${selectedSettledThreads.length === 1 ? "" : "s"}`}
                          >
                            <Trash2Icon aria-hidden className="size-3" />
                            <span className="tabular-nums">
                              Delete {selectedSettledThreads.length}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </li>,
                  );
                }
                for (const thread of renderedSettledThreads) {
                  items.push(renderThreadRow(thread, "settled"));
                }
                return items;
              })()}
              {settledShelfExpanded && hiddenSettledCount > 0 ? (
                <li className="list-none">
                  <button
                    type="button"
                    onClick={showMoreSettled}
                    className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon aria-hidden className="size-4 shrink-0" />
                    Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                  </button>
                </li>
              ) : null}
            </ul>
          </TooltipProvider>
          {activeThreads.length + snoozedThreads.length + settledThreads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <Dialog
        open={projectActionsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setProjectActionsTarget(null);
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader className="gap-3 pb-1!">
            <DialogTitle className="text-balance">Project settings</DialogTitle>
            <DialogDescription className="sr-only">
              Manage project names, grouping rules, and environments.
            </DialogDescription>
            <div className="grid gap-1.5 text-base text-muted-foreground">
              {projectActionsTarget?.memberProjects.map((member) => (
                <div key={member.physicalProjectKey} className="flex min-w-0 items-center gap-3">
                  <span className="flex min-w-0 items-center gap-1">
                    <FolderIcon className="size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 truncate font-mono">{member.workspaceRoot}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-4 shrink-0 rounded-sm"
                      aria-label="Copy project path"
                      title="Copy project path"
                      onClick={() =>
                        copyProjectPath(member.workspaceRoot, { path: member.workspaceRoot })
                      }
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                  </span>
                  <span className="flex min-w-0 shrink-0 items-center gap-1">
                    <ServerIcon className="size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 truncate">
                      {member.environmentLabel ?? "Current environment"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </DialogHeader>
          <DialogPanel className="p-0">
            <div className="divide-y divide-border/60">
              {projectActionsTarget?.memberProjects.map((member) => (
                <section
                  key={member.physicalProjectKey}
                  className="grid min-w-0 gap-5 px-6 pb-5 pt-2 sm:gap-4 sm:pb-4 sm:pt-2"
                >
                  <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Project name</span>
                      <Input
                        key={`${member.physicalProjectKey}:${member.title}`}
                        aria-label={`Project name in ${member.environmentLabel ?? "current environment"}`}
                        defaultValue={member.title}
                        onBlur={(event) => {
                          void renameProjectMember(member, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Grouping rule</span>
                      <Select
                        value={
                          projectGroupingSettings.sidebarProjectGroupingOverrides?.[
                            deriveProjectGroupingOverrideKey(member)
                          ] ?? "inherit"
                        }
                        onValueChange={(value) => {
                          if (
                            value === "inherit" ||
                            value === "repository" ||
                            value === "repository_path" ||
                            value === "separate"
                          ) {
                            updateProjectGroupingPreference(member, value);
                          }
                        }}
                      >
                        <SelectTrigger
                          className="w-full sm:min-h-7.5"
                          aria-label={`Grouping rule for ${member.environmentLabel ?? "current environment"}`}
                        >
                          <SelectValue>
                            {(() => {
                              const selection =
                                projectGroupingSettings.sidebarProjectGroupingOverrides?.[
                                  deriveProjectGroupingOverrideKey(member)
                                ] ?? "inherit";
                              return selection === "inherit"
                                ? `Default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                                : PROJECT_GROUPING_MODE_LABELS[selection];
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="start" alignItemWithTrigger={false}>
                          <SelectItem hideIndicator value="inherit">
                            Use global default
                          </SelectItem>
                          <SelectItem hideIndicator value="repository">
                            {PROJECT_GROUPING_MODE_LABELS.repository}
                          </SelectItem>
                          <SelectItem hideIndicator value="repository_path">
                            {PROJECT_GROUPING_MODE_LABELS.repository_path}
                          </SelectItem>
                          <SelectItem hideIndicator value="separate">
                            {PROJECT_GROUPING_MODE_LABELS.separate}
                          </SelectItem>
                        </SelectPopup>
                      </Select>
                    </label>
                  </div>
                  {projectActionsTarget.memberProjects.length > 1 ? (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
                        onClick={() => {
                          const projectGroup = projectActionsTarget;
                          setProjectActionsTarget(null);
                          void handleRemoveProjectMembers(projectGroup, [member]);
                        }}
                      >
                        <Trash2Icon />
                        Remove project
                      </Button>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
            {projectActionsTarget && projectActionsTarget.memberProjects.length > 1 ? (
              <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/32 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-base font-medium text-foreground sm:text-sm">
                    Remove this project everywhere
                  </p>
                  <p className="text-base text-pretty text-muted-foreground sm:text-sm">
                    Deletes all grouped entries and their conversation history.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  className="shrink-0"
                  onClick={() => {
                    const projectGroup = projectActionsTarget;
                    setProjectActionsTarget(null);
                    void handleRemoveProjectMembers(projectGroup, projectGroup.memberProjects);
                  }}
                >
                  <Trash2Icon />
                  Remove all entries
                </Button>
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter
            variant="bare"
            className={cn(
              projectActionsTarget?.memberProjects.length === 1 && "sm:justify-between",
            )}
          >
            {projectActionsTarget?.memberProjects.length === 1 ? (
              <Button
                variant="destructive-outline"
                onClick={() => {
                  const projectGroup = projectActionsTarget;
                  setProjectActionsTarget(null);
                  void handleRemoveProjectMembers(projectGroup, projectGroup.memberProjects);
                }}
              >
                <Trash2Icon />
                Remove project
              </Button>
            ) : null}
            <Button onClick={() => setProjectActionsTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <SidebarChromeFooter />
    </>
  );
}
