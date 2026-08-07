import type { SidebarThreadGroupingMode } from "@aqqua/contracts";
import { isWorktreeCardsMode } from "./sidebar-v2/groupingMode";

export type AppSidebarVariant = "settings" | "regular" | "worktree" | "worktree-cards";

export function resolveAppSidebarVariant(input: {
  readonly isOnSettings: boolean;
  readonly worktreeViewEnabled: boolean;
  readonly threadGroupingMode: SidebarThreadGroupingMode;
}): AppSidebarVariant {
  if (input.isOnSettings) return "settings";
  // The beta flag still gates every worktree-aware sidebar: a grouping
  // preference left over from an earlier opt-in must not reintroduce one.
  if (!input.worktreeViewEnabled) return "regular";
  return isWorktreeCardsMode(input.threadGroupingMode) ? "worktree-cards" : "worktree";
}
