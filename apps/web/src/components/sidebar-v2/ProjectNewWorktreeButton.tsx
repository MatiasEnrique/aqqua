import { GitBranchPlusIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@aqqua/contracts";

import { openCommandPalette } from "../../commandPaletteBus";
import { SidebarActionIconButton } from "./SidebarActionIconButton";

export function ProjectNewWorktreeButton(props: {
  projectRef: { environmentId: EnvironmentId; projectId: ProjectId };
  projectName: string;
  className?: string;
}) {
  return (
    <SidebarActionIconButton
      icon={GitBranchPlusIcon}
      label={`New worktree in ${props.projectName}`}
      tooltip="New worktree"
      {...(props.className === undefined ? {} : { className: props.className })}
      onClick={() =>
        openCommandPalette({
          open: "new-worktree",
          context: { projectRef: props.projectRef },
        })
      }
    />
  );
}
