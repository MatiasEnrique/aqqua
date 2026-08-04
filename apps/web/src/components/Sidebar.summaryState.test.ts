import { describe, expect, it } from "vite-plus/test";

import {
  resolveRegularSidebarSubAgentStateCounts,
  type SidebarConversationStateCounts,
} from "./Sidebar.summaryState";

const counts: SidebarConversationStateCounts = {
  working: 0,
  needsInput: 1,
  done: 0,
  stale: 0,
  settled: 1,
};

describe("resolveRegularSidebarSubAgentStateCounts", () => {
  it("shows nonzero descendant counts even when the active tree reports no children", () => {
    expect(
      resolveRegularSidebarSubAgentStateCounts({
        groupingMode: "flat",
        threadKey: "parent",
        countsByThreadKey: new Map([["parent", counts]]),
      }),
    ).toBe(counts);
  });

  it("hides empty tallies and every tally in worktree mode", () => {
    const empty = { working: 0, needsInput: 0, done: 0, stale: 0, settled: 0 };
    expect(
      resolveRegularSidebarSubAgentStateCounts({
        groupingMode: "flat",
        threadKey: "parent",
        countsByThreadKey: new Map([["parent", empty]]),
      }),
    ).toBeNull();
    expect(
      resolveRegularSidebarSubAgentStateCounts({
        groupingMode: "worktree",
        threadKey: "parent",
        countsByThreadKey: new Map([["parent", counts]]),
      }),
    ).toBeNull();
  });
});
