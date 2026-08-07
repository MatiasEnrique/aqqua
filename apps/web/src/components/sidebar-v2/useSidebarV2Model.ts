import type { SidebarV2ViewModel } from "./models";
import { useProjectActionsController } from "./useProjectActionsController";
import { useSidebarNavigationController } from "./useSidebarNavigationController";
import { useSidebarV2Sections } from "./useSidebarV2Sections";
import { useWorktreeLifecycleController } from "./useWorktreeLifecycleController";

/** Composes the worktree-card sidebar's domain sections and controllers. */
export function useSidebarV2Model(): SidebarV2ViewModel {
  const sections = useSidebarV2Sections();
  const navigation = useSidebarNavigationController(sections);
  const worktreeLifecycle = useWorktreeLifecycleController({ sections });
  const projectActions = useProjectActionsController({
    projects: sections.projects,
    runtime: sections.runtime,
  });

  return {
    route: sections.route,
    projects: sections.projects,
    threads: sections.threads,
    worktrees: sections.worktrees,
    worktreeLifecycle,
    projectActions,
    navigation,
  };
}
