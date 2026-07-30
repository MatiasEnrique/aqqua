import { Trash2Icon } from "lucide-react";
import {
  memo,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarSummaryStateLabel } from "./SidebarStatusPresentations";

/**
 * A new worktree conversation that exists only on this client until its first
 * message creates the server thread. It follows the compact conversation-row
 * rhythm and stays visibly stale until the first message starts real work.
 */
export const SidebarDraftRow = memo(function SidebarDraftRow(props: {
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
