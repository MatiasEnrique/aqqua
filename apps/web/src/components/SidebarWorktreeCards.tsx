import { SidebarV2View } from "./sidebar-v2/SidebarV2View";
import { useSidebarV2Model } from "./sidebar-v2/useSidebarV2Model";

/**
 * The worktree-card sidebar: one card per worktree, selection-first.
 *
 * Grouping is pinned to `worktree` — the cards *are* the worktree groups, so
 * this entry can never be reshaped by a stale flat preference. Conversations
 * are still reachable inline by expanding a card; the chat header's tab strip
 * is the fast path.
 */
export default function SidebarWorktreeCards() {
  const model = useSidebarV2Model({ groupingMode: "worktree", enableManualWorktreeOrdering: true });
  return <SidebarV2View model={model} presentation="cards" />;
}
