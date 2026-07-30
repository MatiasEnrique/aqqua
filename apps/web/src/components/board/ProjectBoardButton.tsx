import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ProjectBoardButton(props: {
  projectRef: { environmentId: EnvironmentId; projectId: ProjectId };
  projectName: string;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Open board for ${props.projectName}`}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-sidebar-row-hover hover:text-sidebar-foreground active:scale-[0.94] motion-reduce:transform-none",
              props.className,
            )}
            onClick={() => {
              void navigate({
                to: "/board/$environmentId/$projectId",
                params: {
                  environmentId: props.projectRef.environmentId,
                  projectId: props.projectRef.projectId,
                },
              });
            }}
          />
        }
      >
        <LayoutGridIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="right">Agentic board</TooltipPopup>
    </Tooltip>
  );
}
