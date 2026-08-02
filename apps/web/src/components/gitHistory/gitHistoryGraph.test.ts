import { describe, expect, it } from "vite-plus/test";

import type { GitHistoryCommitSummary, GitObjectId } from "@aqqua/contracts";

import { layoutGitHistoryGraph } from "./gitHistoryGraph";

const id = (value: string) => value.repeat(40).slice(0, 40) as GitObjectId;

function commit(value: string, parents: string[]): GitHistoryCommitSummary {
  return {
    id: id(value),
    parentIds: parents.map(id),
    subject: value,
    authorName: "Test",
    authorEmail: "test@example.com",
    authoredAt: "2026-07-29T12:00:00Z",
    committedAt: "2026-07-29T12:00:00Z",
    isHead: value === "a",
    refs: [],
  };
}

describe("layoutGitHistoryGraph", () => {
  it("keeps a linear history in one lane", () => {
    const rows = layoutGitHistoryGraph([commit("a", ["b"]), commit("b", ["c"]), commit("c", [])]);

    expect(rows.map((row) => row.nodeLane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1]);
    expect(rows[0]?.edges.some((edge) => edge.phase === "incoming")).toBe(false);
    expect(rows[1]?.edges.some((edge) => edge.phase === "incoming")).toBe(true);
    expect(rows[2]?.after).toEqual([]);
  });

  it("creates and rejoins lanes for a merge", () => {
    const rows = layoutGitHistoryGraph([
      commit("a", ["b", "c"]),
      commit("b", ["d"]),
      commit("c", ["d"]),
      commit("d", []),
    ]);

    expect(rows[0]?.nodeLane).toBe(0);
    expect(rows[0]?.after.map((lane) => lane.targetId)).toEqual([id("b"), id("c")]);
    expect(rows[1]?.nodeLane).toBe(0);
    expect(rows[2]?.nodeLane).toBe(1);
    expect(rows[3]?.before.filter((lane) => lane.targetId === id("d"))).toHaveLength(2);
    expect(rows[3]?.nodeLane).toBe(0);
    expect(rows[3]?.after).toEqual([]);
  });

  it("keeps existing row layout stable when older commits are appended", () => {
    const firstPage = [commit("a", ["b", "c"]), commit("b", ["d"])];
    const firstLayout = layoutGitHistoryGraph(firstPage);
    const completeLayout = layoutGitHistoryGraph([
      ...firstPage,
      commit("c", ["d"]),
      commit("d", []),
    ]);

    expect(completeLayout.slice(0, firstLayout.length)).toEqual(firstLayout);
  });

  it("adds independent tips to the right while another lane is active", () => {
    const rows = layoutGitHistoryGraph([
      commit("a", ["b"]),
      commit("x", ["y"]),
      commit("b", []),
      commit("y", []),
    ]);

    expect(rows.map((row) => row.nodeLane)).toEqual([0, 1, 0, 0]);
    expect(rows[1]?.laneCount).toBe(2);
    expect(rows[1]?.edges.some((edge) => edge.phase === "incoming")).toBe(false);
  });

  it("collapses duplicate lanes converging on the same parent", () => {
    const rows = layoutGitHistoryGraph([
      commit("a", ["b", "c"]),
      commit("b", ["d"]),
      commit("c", ["d"]),
      commit("d", ["e"]),
    ]);

    expect(rows[3]?.before.map((lane) => lane.targetId)).toEqual([id("d"), id("d")]);
    expect(rows[3]?.after.map((lane) => lane.targetId)).toEqual([id("e")]);
    expect(rows[3]?.nodeLane).toBe(0);
  });

  it("inserts every additional parent of an octopus merge beside the first parent", () => {
    const rows = layoutGitHistoryGraph([commit("a", ["b", "c", "d", "e"]), commit("b", ["f"])]);

    expect(rows[0]?.after.map((lane) => lane.targetId)).toEqual([
      id("b"),
      id("c"),
      id("d"),
      id("e"),
    ]);
    expect(new Set(rows[0]?.after.map((lane) => lane.colorSlot)).size).toBe(4);
  });

  it("preserves unresolved parent lanes beyond the final loaded row", () => {
    const rows = layoutGitHistoryGraph([commit("a", ["b", "c"]), commit("b", ["d"])]);

    expect(rows.at(-1)?.after.map((lane) => lane.targetId)).toEqual([id("d"), id("c")]);
  });
});
