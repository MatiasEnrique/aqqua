import type { SidebarThreadGroupingMode } from "@aqqua/contracts";

/**
 * How the read model buckets conversations. `worktree_cards` is a presentation
 * of `worktree`, not a third bucketing: keeping the derivation binary means the
 * card sidebar reuses the worktree groups, family bands and ordering already
 * proven by the worktree view instead of forking them.
 */
export type SidebarGroupingMode = "flat" | "worktree";

export function resolveSidebarGroupingMode(
  setting: SidebarThreadGroupingMode,
): SidebarGroupingMode {
  return setting === "flat" ? "flat" : "worktree";
}

/** Whether the setting asks for the worktree-card sidebar and its tabbed header. */
export function isWorktreeCardsMode(setting: SidebarThreadGroupingMode): boolean {
  return setting === "worktree_cards";
}
