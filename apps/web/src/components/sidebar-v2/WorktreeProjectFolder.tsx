import type { EnvironmentId } from "@aqqua/contracts";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { SidebarProjectState } from "../Sidebar.worktreeGroups";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarProjectStateIndicator } from "./SidebarStatusPresentations";

/**
 * A project's folder in the worktree registry.
 *
 * The registry is flat by nature — every row is a checkout — so the folder is
 * the only place the *repository* is named. It stays a header rather than
 * becoming a card: one line of chrome per project, at a smaller weight than
 * the checkouts it holds, so collapsing several projects still reads as a list
 * of branches rather than a list of folders.
 */
export function WorktreeProjectFolder(props: {
  readonly displayName: string;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly projectKey: string;
  readonly worktreeCount: number;
  readonly state: SidebarProjectState;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
  /** The project's own affordances — today, "new worktree". */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    // The pad is the seam between projects: the registry's own 4px gap is tuned
    // for checkout rows, and at that spacing two projects run together into one
    // ladder of branches.
    <li data-thread-selection-safe className="list-none pb-2.5">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the context menu belongs to the composite folder row. */}
      <div
        onContextMenu={props.onContextMenu}
        className="flex h-7 w-full min-w-0 items-center rounded-md pr-0.5 text-sidebar-foreground transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover"
      >
        <button
          type="button"
          aria-expanded={props.expanded}
          aria-controls={`worktree-folder-${props.projectKey}`}
          aria-label={`${props.expanded ? "Collapse" : "Expand"} project ${props.displayName}`}
          onClick={props.onToggle}
          // No chevron. It took the leftmost slot and pushed the project's icon
          // to the right of its own children's icons, which read as the tree
          // upside down. The project icon is the row's anchor instead, and it
          // sits left of every card beneath it.
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ProjectFavicon
            environmentId={props.environmentId}
            cwd={props.workspaceRoot}
            className="size-4 shrink-0 rounded-sm"
          />
          <span className="min-w-0 truncate text-xs font-medium text-sidebar-muted-foreground">
            {props.displayName}
          </span>
          {/* Only while shut. Open, every checkout states its own case one row
              down, and a folder-level summary would just be a louder copy of
              the loudest child. */}
          {props.expanded ? null : (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
              <SidebarProjectStateIndicator state={props.state} />
              <span className="text-[10px] tabular-nums text-sidebar-muted-foreground/70">
                {props.worktreeCount}
              </span>
            </span>
          )}
        </button>
        {props.actions}
      </div>
      {props.expanded ? (
        // Indented past the project icon, so a checkout's own icon starts
        // right of its project's.
        <ul id={`worktree-folder-${props.projectKey}`} className="flex flex-col gap-1 pt-1 pl-2.5">
          {props.children}
        </ul>
      ) : null}
    </li>
  );
}
