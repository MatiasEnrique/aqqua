import { create } from "zustand";
import type { SidebarWorktreeGroup } from "./components/Sidebar.worktreeGroups";

interface WorktreeHeaderStore {
  /** The worktree the chat header names, and whose context its `+` uses. */
  activeWorktreeGroup: SidebarWorktreeGroup | null;
  /** How many worktrees the registry is showing, for the header's summary. */
  worktreeCount: number;
  setActiveWorktree: (input: { group: SidebarWorktreeGroup | null; worktreeCount: number }) => void;
}

/**
 * The selected worktree, published by the sidebar and consumed by the chat
 * header.
 *
 * Deriving it twice would mean duplicating the settled/snoozed partition —
 * orchestrator inheritance, change-request state, per-environment capabilities
 * — which is exactly the logic most likely to drift between two copies. The
 * sidebar already computes it, so it publishes instead.
 *
 * The coupling is real rather than incidental: the same setting turns on the
 * card sidebar and the tabbed header, so the publisher is mounted whenever the
 * consumer needs a value.
 */
export const useWorktreeHeaderStore = create<WorktreeHeaderStore>((set) => ({
  activeWorktreeGroup: null,
  worktreeCount: 0,
  setActiveWorktree: ({ group, worktreeCount }) =>
    set((state) =>
      state.activeWorktreeGroup === group && state.worktreeCount === worktreeCount
        ? state
        : { activeWorktreeGroup: group, worktreeCount },
    ),
}));
