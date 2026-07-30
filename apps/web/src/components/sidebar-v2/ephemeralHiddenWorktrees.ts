import {
  sidebarWorktreeHasVisibleChildren,
  type SidebarWorktreeGroup,
} from "../Sidebar.worktreeGroups";

/**
 * Clears optimistic worktree hides once the authoritative projection no longer
 * needs them: the group vanished, or new visible work reappeared on the path.
 * Never persists; a reload starts with an empty hide set.
 */
export function nextEphemeralHiddenWorktreeKeys(
  hiddenWorktreeKeys: ReadonlySet<string>,
  projectedGroups: readonly Pick<SidebarWorktreeGroup, "key" | "drafts" | "active" | "snoozed">[],
): ReadonlySet<string> | null {
  if (hiddenWorktreeKeys.size === 0) return null;

  const groupByKey = new Map(projectedGroups.map((group) => [group.key, group] as const));
  let changed = false;
  const next = new Set<string>();
  for (const key of hiddenWorktreeKeys) {
    const group = groupByKey.get(key);
    if (group === undefined) {
      changed = true;
      continue;
    }
    if (sidebarWorktreeHasVisibleChildren(group)) {
      changed = true;
      continue;
    }
    next.add(key);
  }
  return changed ? next : null;
}

export function addEphemeralHiddenWorktreeKey(
  hiddenWorktreeKeys: ReadonlySet<string>,
  worktreeKey: string,
): ReadonlySet<string> {
  if (hiddenWorktreeKeys.has(worktreeKey)) return hiddenWorktreeKeys;
  const next = new Set(hiddenWorktreeKeys);
  next.add(worktreeKey);
  return next;
}

export function removeEphemeralHiddenWorktreeKey(
  hiddenWorktreeKeys: ReadonlySet<string>,
  worktreeKey: string,
): ReadonlySet<string> {
  if (!hiddenWorktreeKeys.has(worktreeKey)) return hiddenWorktreeKeys;
  const next = new Set(hiddenWorktreeKeys);
  next.delete(worktreeKey);
  return next;
}
