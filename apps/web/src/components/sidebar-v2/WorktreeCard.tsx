import type { EnvironmentId, ServerConfig } from "@aqqua/contracts";
import { GitBranchIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";
import { SidebarWorktreeSummaryStateLabel } from "./SidebarStatusPresentations";
import { WorktreeActionsPopover } from "./WorktreeActionsPopover";

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
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly removingWorktreeKey: string | null;
  readonly settlingWorktreeKey: string | null;
  readonly onSelect: (group: SidebarWorktreeGroup) => void;
  readonly onSettleWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onDeleteWorktree: (group: SidebarWorktreeGroup) => void;
  readonly onContextMenu: (event: ReactMouseEvent, group: SidebarWorktreeGroup) => void;
}) {
  const { group } = props;
  // The avatar identifies the *project*, so it follows the repository root and
  // falls back to the worktree only when the group has no project behind it.
  const faviconCwd = group.projectRoot ?? group.workspaceRoot;

  return (
    <li data-thread-item data-testid={`worktree-card-${group.key}`} className="list-none">
      <div
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg pr-0.5 pl-1.5 transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
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
          {faviconCwd === null ? (
            <span aria-hidden className="size-4 shrink-0" />
          ) : (
            <ProjectFavicon
              environmentId={group.environmentId}
              cwd={faviconCwd}
              className="size-4 shrink-0 rounded-sm"
            />
          )}
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
          {group.summaryState === null ? null : (
            <SidebarWorktreeSummaryStateLabel state={group.summaryState} className="ml-auto pl-2" />
          )}
        </button>
        <WorktreeActionsPopover
          group={group}
          serverConfigs={props.serverConfigs}
          removingWorktreeKey={props.removingWorktreeKey}
          settlingWorktreeKey={props.settlingWorktreeKey}
          onSettleWorktree={props.onSettleWorktree}
          onDeleteWorktree={props.onDeleteWorktree}
        />
      </div>
    </li>
  );
}
