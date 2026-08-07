import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";
import type { ProjectScopeSelection } from "./projectScopeSelection";

/**
 * One folder in the worktree registry: a project and the checkouts under it.
 *
 * `project: null` means "render these checkouts without a folder". Two things
 * ask for that: the remainder bucket, whose worktrees belong to no repository
 * group at all, and a scope filtered down to one project, where a folder would
 * only restate the filter.
 */
export interface WorktreeCardGroup<TProject> {
  readonly key: string;
  readonly project: TProject | null;
  readonly worktrees: readonly SidebarWorktreeGroup[];
}

export const UNGROUPED_WORKTREE_CARD_GROUP_KEY = "ungrouped";

/**
 * The registry's folders, in project order, with any unplaceable worktrees
 * appended.
 *
 * Repository groups cover every *project*, including ones with no checkouts —
 * an empty folder is still where "new worktree" lives, so it earns its row.
 * The project filter is the exception: once it names projects, folders outside
 * the filter would all be empty, and a list of empty folders is noise rather
 * than affordance.
 */
export function buildWorktreeCardGroups<TProject extends { readonly projectKey: string }>(input: {
  readonly repositories: readonly {
    readonly project: TProject;
    readonly worktrees: readonly SidebarWorktreeGroup[];
  }[];
  readonly worktrees: readonly SidebarWorktreeGroup[];
  readonly selection: ProjectScopeSelection;
}): WorktreeCardGroup<TProject>[] {
  const claimedWorktreeKeys = new Set(
    input.repositories.flatMap((repository) =>
      repository.worktrees.map((worktree) => worktree.key),
    ),
  );
  const scoped = input.repositories.filter(
    (repository) =>
      input.selection.size === 0 || input.selection.has(repository.project.projectKey),
  );
  const ungrouped = input.worktrees.filter((worktree) => !claimedWorktreeKeys.has(worktree.key));
  // Filtered to a single project with nothing else on screen, the folder has
  // nothing left to say: the chip above the list already names the project,
  // and its "new worktree" button moves up beside that chip. All the folder
  // would add is a row of chrome and a way to collapse the only thing there.
  // A remainder bucket alongside it brings the folder back — with two flat
  // runs of cards there would be no way to tell which is which.
  const foldersAreRedundant =
    input.selection.size === 1 && scoped.length === 1 && ungrouped.length === 0;
  const groups: WorktreeCardGroup<TProject>[] = scoped.map((repository) => ({
    key: repository.project.projectKey,
    project: foldersAreRedundant ? null : repository.project,
    worktrees: repository.worktrees,
  }));

  if (ungrouped.length > 0) {
    groups.push({
      key: UNGROUPED_WORKTREE_CARD_GROUP_KEY,
      project: null,
      worktrees: ungrouped,
    });
  }
  return groups;
}
