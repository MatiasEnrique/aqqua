import type { SidebarThreadGroupingMode } from "@aqqua/contracts";
import { isWorktreeCardsMode } from "../sidebar-v2/groupingMode";

/**
 * The header shape. `breadcrumb` is the original single row — project / thread
 * title. `worktree-tabs` adds a second row listing the conversations in the
 * selected worktree.
 *
 * Derived from the same setting that picks the sidebar so the two surfaces can
 * never disagree about which model the user is looking at.
 */
export type ChatHeaderMode = "breadcrumb" | "worktree-tabs";

export function resolveChatHeaderMode(input: {
  readonly threadGroupingMode: SidebarThreadGroupingMode;
  /** The worktree sidebar is an opt-in beta; the tabbed header rides with it. */
  readonly worktreeViewEnabled: boolean;
}): ChatHeaderMode {
  if (!input.worktreeViewEnabled) return "breadcrumb";
  return isWorktreeCardsMode(input.threadGroupingMode) ? "worktree-tabs" : "breadcrumb";
}
