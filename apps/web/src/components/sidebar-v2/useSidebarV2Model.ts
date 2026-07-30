import type { SidebarV2ViewModel } from "./models";
import { useProjectActionsController } from "./useProjectActionsController";
import { useSidebarNavigationController } from "./useSidebarNavigationController";
import { useSidebarV2Sections } from "./useSidebarV2Sections";
import { useThreadLifecycleController } from "./useThreadLifecycleController";
import { useWorktreeLifecycleController } from "./useWorktreeLifecycleController";

/**
 * Composes domain sections and focused controllers into the view model.
 * The view receives only named sections/controllers — never a flat bag of
 * every intermediate binding.
 */
export function useSidebarV2Model(): SidebarV2ViewModel {
  const sections = useSidebarV2Sections();
  const navigation = useSidebarNavigationController(sections);
  const threadLifecycle = useThreadLifecycleController({
    sections,
    navigation,
  });
  const worktreeLifecycle = useWorktreeLifecycleController({
    sections,
    planForwardNavigation: threadLifecycle.planForwardNavigation,
  });
  const projectActions = useProjectActionsController({
    projects: sections.projects,
    runtime: sections.runtime,
  });

  const { planForwardNavigation: _plan, ...threadLifecycleForView } = threadLifecycle;

  return {
    route: sections.route,
    projects: sections.projects,
    threads: sections.threads,
    worktrees: sections.worktrees,
    threadLifecycle: threadLifecycleForView,
    worktreeLifecycle,
    projectActions,
    navigation,
  };
}
