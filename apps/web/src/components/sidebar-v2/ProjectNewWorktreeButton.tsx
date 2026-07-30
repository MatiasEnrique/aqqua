import { GitBranchPlusIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ProjectNewWorktreeButton(props: {
  projectRef: { environmentId: EnvironmentId; projectId: ProjectId };
  projectName: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`New worktree in ${props.projectName}`}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-sidebar-foreground active:scale-[0.94] motion-reduce:transform-none",
              props.className,
            )}
            onClick={() =>
              openCommandPalette({
                open: "new-worktree",
                context: { projectRef: props.projectRef },
              })
            }
          />
        }
      >
        <GitBranchPlusIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="right">New worktree</TooltipPopup>
    </Tooltip>
  );
}
