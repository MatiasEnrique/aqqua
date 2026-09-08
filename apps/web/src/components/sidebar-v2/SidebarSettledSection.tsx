import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { ChevronRightIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { sidebarProjectKey } from "../Sidebar.worktreeGroups";
import { sidebarThreadKey } from "./sidebarThreadFamilies";

/**
 * Settled work is history, so the shelf shows the tail of it rather than all
 * of it: enough to recognise what was just put down, not enough to become a
 * second inbox. Everything older stays reachable through search.
 */
const RECENTLY_SETTLED_LIMIT = 10;

/** Both row actions share one hit target, so the pair reads as one cluster. */
const ACTION_BUTTON =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-fluid) active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transform-none";

/**
 * One shelf of recently settled conversations, at the foot of the list.
 *
 * Deliberately thinner than a conversation row: no status dot, no branch, no
 * timestamp. A settled conversation has nothing left to report, so the row
 * carries only what identifies it — its project and its title — plus the two
 * actions it has left: coming back, or going away for good. The section stays
 * shut until someone asks for it.
 */
export function SidebarSettledSection(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projectCwdByKey: ReadonlyMap<string, string>;
  readonly projectDisplayNameByKey: ReadonlyMap<string, string>;
  readonly selectedThreadKey: string | null;
  readonly onSelectThread: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  readonly onThreadContextMenu: (event: ReactMouseEvent, thread: EnvironmentThreadShell) => void;
  /** Un-settles the conversation, which drops it back into its project. */
  readonly onRestoreThread: (thread: EnvironmentThreadShell) => void;
  /** Deletes the conversation for good, behind the same confirmation the menu uses. */
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);
  const recent = props.threads.slice(0, RECENTLY_SETTLED_LIMIT);
  // Routing into a settled conversation opens the shelf on its own, so the
  // route and the list can never disagree about where the selection lives.
  // A deliberate toggle outranks that, in both directions.
  const holdsSelection = recent.some(
    (thread) => sidebarThreadKey(thread) === props.selectedThreadKey,
  );
  const expanded = manuallyExpanded ?? holdsSelection;
  if (props.threads.length === 0) return null;

  return (
    <section aria-label="Settled conversations" className="pt-2" data-sidebar-settled-section>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="sidebar-settled-list"
        onClick={() => setManuallyExpanded(!expanded)}
        className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md pl-1 pr-2 text-left text-sidebar-muted-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid) hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-fluid) motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[13px] font-medium leading-5">Settled</span>
        <span className="text-[11px] tabular-nums text-sidebar-muted-foreground/70">
          {props.threads.length}
        </span>
      </button>
      {expanded ? (
        <ul id="sidebar-settled-list" className="flex flex-col pt-0.5">
          {recent.map((thread) => {
            const threadKey = sidebarThreadKey(thread);
            const projectKey = sidebarProjectKey(thread.environmentId, thread.projectId);
            const workspaceRoot = props.projectCwdByKey.get(projectKey);
            const projectName = props.projectDisplayNameByKey.get(projectKey);
            const isSelected = props.selectedThreadKey === threadKey;
            return (
              <li key={threadKey} className="group/settled-row relative list-none">
                <button
                  type="button"
                  onClick={(event) => props.onSelectThread(event, thread)}
                  onContextMenu={(event) => props.onThreadContextMenu(event, thread)}
                  data-sidebar-thread-key={threadKey}
                  aria-current={isSelected ? "page" : undefined}
                  title={
                    projectName === undefined ? thread.title : `${projectName} · ${thread.title}`
                  }
                  // The right pad is the action pair's seat, held open at rest
                  // so nothing shifts or gets covered when they appear.
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md py-1 pl-2 pr-14 text-left outline-none transition-colors duration-(--duration-fast) ease-(--ease-fluid)",
                    isSelected
                      ? "bg-sidebar-row-active text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {workspaceRoot === undefined ? null : (
                    <ProjectFavicon
                      environmentId={thread.environmentId}
                      cwd={workspaceRoot}
                      className="size-3.5 shrink-0 rounded-sm"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                    {thread.title}
                  </span>
                </button>
                <span className="absolute right-1 top-1 flex items-center gap-0.5 transition-opacity duration-(--duration-fast) ease-(--ease-fluid) pointer-fine:opacity-0 pointer-fine:group-hover/settled-row:opacity-100 group-focus-within/settled-row:opacity-100">
                  <button
                    type="button"
                    aria-label={`Delete conversation ${thread.title}`}
                    title="Delete conversation"
                    onClick={() => props.onDeleteThread(thread)}
                    className={cn(ACTION_BUTTON, "hover:bg-destructive/10 hover:text-destructive")}
                  >
                    <Trash2Icon aria-hidden className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Restore conversation ${thread.title}`}
                    title="Restore conversation"
                    onClick={() => props.onRestoreThread(thread)}
                    className={cn(ACTION_BUTTON, "hover:text-sidebar-foreground")}
                  >
                    <RotateCcwIcon aria-hidden className="size-3.5" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
