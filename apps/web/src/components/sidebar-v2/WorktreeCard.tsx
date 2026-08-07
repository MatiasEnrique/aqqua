import { GitBranchIcon, GitPullRequestIcon, Trash2Icon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "~/lib/utils";
import {
  resolveSidebarWorktreeDeleteAction,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";
import { SidebarWorktreeSummaryStateLabel } from "./SidebarStatusPresentations";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * One worktree as a single registry row — the whole unit of the worktree-cards
 * sidebar.
 *
 * The row does not open: conversations live in the header's tab strip, so the
 * sidebar's only job is to answer "which checkouts exist, and which one is
 * shouting". That is a branch name, its kind, and exactly one state — no
 * counters, no children, no rail.
 */
export function WorktreeCard(props: {
  readonly group: SidebarWorktreeGroup;
  readonly isSelected: boolean;
  readonly removingWorktreeKey: string | null;
  readonly onSelect: (group: SidebarWorktreeGroup) => void;
  readonly onDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onContextMenu: (event: ReactMouseEvent, group: SidebarWorktreeGroup) => void;
}) {
  const { group } = props;
  const deleteAction = resolveSidebarWorktreeDeleteAction({
    isProjectCheckout: group.isProjectCheckout,
    worktreeCreated: group.workspaceRoot !== null && group.projectRoot !== null,
    isRemoving: props.removingWorktreeKey !== null,
    isSettling: false,
  });
  const showDeleteAction =
    !group.isProjectCheckout && group.workspaceRoot !== null && group.projectRoot !== null;
  const summaryState = group.summaryState === "settled" ? null : group.summaryState;

  return (
    // `data-thread-selection-safe`, not `data-thread-item`: the card is a
    // worktree, and marquee selection, range selection and keyboard traversal
    // all treat a thread item as a selectable conversation.
    <li data-thread-selection-safe data-testid={`worktree-card-${group.key}`} className="list-none">
      <div
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg pr-2 pl-1.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
          // Selection is a *tinted* surface, not a lifted white one: the
          // registry sits on the sidebar's own ground, and hover is the same
          // material at half strength so the two never read as one state.
          props.isSelected
            ? "bg-sidebar-control-surface"
            : "bg-transparent hover:bg-sidebar-control-surface/60",
        )}
      >
        <button
          type="button"
          onClick={() => props.onSelect(group)}
          onContextMenu={(event) => props.onContextMenu(event, group)}
          aria-current={props.isSelected ? "true" : undefined}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <GitBranchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs font-semibold text-sidebar-foreground">
            {group.label}
          </span>
          {/* The kind is the first thing to go when the sidebar narrows: the
              branch name and the state both carry more, and this row has to
              survive being dragged well below the design's 360px. */}
          <span className="hidden shrink-0 text-[10px] leading-3 text-sidebar-muted-foreground/70 @[19rem]/sidebar-conversations:inline">
            {group.isProjectCheckout ? "current checkout" : "worktree"}
          </span>
          {group.mergedChangeRequestNumber === null ? null : (
            <span
              aria-label={`Pull request #${group.mergedChangeRequestNumber} merged`}
              className="ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-[11px] font-semibold text-violet-600 tabular-nums dark:text-violet-300"
            >
              <GitPullRequestIcon aria-hidden className="size-3.5" />
              <span>#{group.mergedChangeRequestNumber}</span>
            </span>
          )}
          {summaryState === null ? null : (
            <SidebarWorktreeSummaryStateLabel
              state={summaryState}
              className={group.mergedChangeRequestNumber === null ? "ml-auto pl-2" : "pl-1"}
            />
          )}
        </button>
        {showDeleteAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Delete worktree ${group.label}`}
                  disabled={!deleteAction.enabled}
                  onClick={() => props.onDeleteWorktree(group)}
                  className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/55"
                />
              }
            >
              <Trash2Icon aria-hidden className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">
              {deleteAction.enabled ? "Delete worktree" : deleteAction.disabledReason}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </li>
  );
}
