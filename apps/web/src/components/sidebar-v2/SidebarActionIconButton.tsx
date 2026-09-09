import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * An icon action for the sidebar's scope row — new worktree, new card, edit
 * flow. They sit shoulder to shoulder with the row's picker, so they share one
 * 28px square and one hover treatment instead of each surface rolling its own.
 */
export function SidebarActionIconButton({
  icon: Icon,
  label,
  tooltip,
  disabled = false,
  className,
  onClick,
}: {
  readonly icon: LucideIcon;
  /** The accessible name; the tooltip carries the short version. */
  readonly label: string;
  readonly tooltip: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className={cn(
              "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none",
              className,
            )}
            onClick={onClick}
          />
        }
      >
        <Icon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="right">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
