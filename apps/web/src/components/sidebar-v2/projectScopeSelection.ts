/**
 * Which projects the sidebar is filtered to.
 *
 * The empty selection means "every project" rather than "no projects". A filter
 * that can be emptied into showing nothing is a trap: the sidebar would go
 * blank with no obvious way back, and the chip row that drives this can be
 * emptied one `×` at a time. Every rule below preserves that reading.
 */
export type ProjectScopeSelection = ReadonlySet<string>;

export const EMPTY_PROJECT_SCOPE_SELECTION: ProjectScopeSelection = new Set<string>();

/** The subset of a project group these rules need. */
export interface ProjectScopeCandidate {
  readonly projectKey: string;
}

/** The selection the combobox just produced, as a set of project keys. */
export function projectScopeSelectionFromKeys(keys: readonly string[]): ProjectScopeSelection {
  return keys.length === 0 ? EMPTY_PROJECT_SCOPE_SELECTION : new Set(keys);
}

/**
 * Drop keys whose project has gone away — deleted, or regrouped under a
 * different key by Settings → General.
 *
 * Returns the original set when nothing changed so the identity stays stable
 * for `useMemo`/`useEffect` downstream.
 */
export function pruneProjectScopeSelection(
  selection: ProjectScopeSelection,
  candidates: readonly ProjectScopeCandidate[],
): ProjectScopeSelection {
  if (selection.size === 0) return selection;
  const live = new Set(candidates.map((candidate) => candidate.projectKey));
  const next = new Set<string>();
  for (const key of selection) {
    if (live.has(key)) next.add(key);
  }
  return next.size === selection.size ? selection : next;
}

/** The selected groups, in the sidebar's own project order. */
export function resolveSelectedProjectGroups<T extends ProjectScopeCandidate>(
  selection: ProjectScopeSelection,
  candidates: readonly T[],
): readonly T[] {
  if (selection.size === 0) return [];
  return candidates.filter((candidate) => selection.has(candidate.projectKey));
}

/**
 * The one project in scope, or null.
 *
 * Per-project affordances — new worktree, the board's project route, the
 * project context menu — only make sense when the answer is unambiguous, so a
 * multi-project selection reads the same as no selection to them.
 */
export function resolveSoleScopedProjectGroup<T extends ProjectScopeCandidate>(
  selected: readonly T[],
): T | null {
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

/**
 * The project a scope change just added, if it added exactly one.
 *
 * Board mode follows this into the project's route. Removals and multi-key
 * jumps return null: there is no single project to point the surface at.
 */
export function resolveProjectScopeAddition(
  previous: ProjectScopeSelection,
  next: readonly string[],
): string | null {
  const added = next.filter((key) => !previous.has(key));
  return added.length === 1 ? (added[0] ?? null) : null;
}

/**
 * A stable cache key for the current scope, order-independent.
 *
 * Paging state (the settled tail) resets on this, so `{a, b}` reached by
 * picking `a` then `b` must key the same as `{b, a}`.
 */
export function projectScopeSelectionKey(selection: ProjectScopeSelection): string {
  return selection.size === 0 ? "all" : [...selection].sort().join(" ");
}
