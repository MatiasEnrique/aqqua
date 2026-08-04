import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@aqqua/contracts";

import { getVisibleSidebarThreadIds } from "./Sidebar.logic";
import {
  buildSidebarThreadTree,
  buildSidebarThreadSubAgentStateCounts,
  filterVisibleSidebarThreadEntries,
  inheritSettledFromOrchestrators,
  resolveCollapsedThreadSelectionTarget,
  resolveSidebarThreadAncestorIds,
  selectSidebarThreadFamilyPage,
  shouldReserveThreadExpandGutter,
  takeSidebarThreadFamilies,
  type SidebarThreadSection,
  type SidebarThreadTreeEntry,
} from "./Sidebar.threadTree";

describe("buildSidebarThreadSubAgentStateCounts", () => {
  const entries: ReadonlyArray<
    SidebarThreadTreeEntry<{
      id: string;
      parentThreadId?: string;
      state: "working" | "needsInput" | "done" | "stale" | "settled";
    }>
  > = [
    { thread: { id: "root", state: "done" }, depth: 0, childCount: 3 },
    {
      thread: { id: "child-a", parentThreadId: "root", state: "working" },
      depth: 1,
      childCount: 1,
    },
    {
      thread: { id: "grandchild", parentThreadId: "child-a", state: "needsInput" },
      depth: 2,
      childCount: 0,
    },
    {
      thread: { id: "child-b", parentThreadId: "root", state: "working" },
      depth: 1,
      childCount: 0,
    },
    {
      thread: { id: "settled-child", parentThreadId: "root", state: "settled" },
      depth: 1,
      childCount: 0,
    },
    { thread: { id: "other-root", state: "stale" }, depth: 0, childCount: 0 },
  ];

  it("summarizes every descendant state on the root, excluding the root itself", () => {
    expect(
      buildSidebarThreadSubAgentStateCounts({
        entries,
        getKey: (thread) => thread.id,
        classify: (thread) => thread.state,
      }).get("root"),
    ).toEqual({
      working: 2,
      needsInput: 1,
      // The root's own "done" belongs to its status label, not these counters.
      done: 0,
      stale: 0,
      settled: 1,
    });
  });

  it("summarizes descendants for a nested orchestrator that can be promoted to a root", () => {
    expect(
      buildSidebarThreadSubAgentStateCounts({
        entries,
        getKey: (thread) => thread.id,
        classify: (thread) => thread.state,
      }).get("child-a"),
    ).toEqual({
      working: 0,
      needsInput: 1,
      done: 0,
      stale: 0,
      settled: 0,
    });
  });

  it("leaves a childless root with an empty tally", () => {
    expect(
      buildSidebarThreadSubAgentStateCounts({
        entries,
        getKey: (thread) => thread.id,
        classify: (thread) => thread.state,
      }).get("other-root"),
    ).toEqual({
      working: 0,
      needsInput: 0,
      done: 0,
      stale: 0,
      settled: 0,
    });
  });
});

describe("resolveSidebarThreadAncestorIds", () => {
  const entries: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>> = [
    { thread: { id: "root" }, depth: 0, childCount: 2 },
    { thread: { id: "child-a" }, depth: 1, childCount: 1 },
    { thread: { id: "grandchild" }, depth: 2, childCount: 0 },
    { thread: { id: "child-b" }, depth: 1, childCount: 0 },
    { thread: { id: "other-root" }, depth: 0, childCount: 0 },
  ];
  const ancestorsOf = (threadId: string) =>
    resolveSidebarThreadAncestorIds({ entries, threadId, getThreadId: (thread) => thread.id });

  it("returns nothing for a root", () => {
    expect(ancestorsOf("root")).toEqual([]);
    expect(ancestorsOf("other-root")).toEqual([]);
  });

  it("returns the parent of a sub-agent", () => {
    expect(ancestorsOf("child-b")).toEqual(["root"]);
  });

  it("returns the whole chain outermost first", () => {
    expect(ancestorsOf("grandchild")).toEqual(["root", "child-a"]);
  });

  it("returns nothing for a thread the tree doesn't contain", () => {
    expect(ancestorsOf("missing")).toEqual([]);
  });
});

describe("shouldReserveThreadExpandGutter", () => {
  it("stays closed for a list with no sub-agents at all", () => {
    expect(
      shouldReserveThreadExpandGutter([
        { depth: 0, childCount: 0 },
        { depth: 0, childCount: 0 },
      ]),
    ).toBe(false);
  });

  it("opens for every row once one of them owns a toggle", () => {
    expect(
      shouldReserveThreadExpandGutter([
        { depth: 0, childCount: 0 },
        { depth: 0, childCount: 3 },
        { depth: 1, childCount: 0 },
      ]),
    ).toBe(true);
  });

  it("ignores toggles above minDepth", () => {
    const rows = [
      { depth: 0, childCount: 2 },
      { depth: 1, childCount: 0 },
    ];
    expect(shouldReserveThreadExpandGutter(rows, { minDepth: 1 })).toBe(false);
  });

  it("opens at minDepth when a nested row owns a toggle", () => {
    const rows = [
      { depth: 0, childCount: 1 },
      { depth: 1, childCount: 1 },
      { depth: 2, childCount: 0 },
    ];
    expect(shouldReserveThreadExpandGutter(rows, { minDepth: 1 })).toBe(true);
  });

  it("accepts any iterable, including a Map's values", () => {
    const meta = new Map([
      ["a", { depth: 0, childCount: 0 }],
      ["b", { depth: 0, childCount: 1 }],
    ]);
    expect(shouldReserveThreadExpandGutter(meta.values())).toBe(true);
  });
});

describe("filterVisibleSidebarThreadEntries", () => {
  const entries: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>> = [
    { thread: { id: "root" }, depth: 0, childCount: 2 },
    { thread: { id: "child-a" }, depth: 1, childCount: 1 },
    { thread: { id: "grandchild" }, depth: 2, childCount: 0 },
    { thread: { id: "child-b" }, depth: 1, childCount: 0 },
    { thread: { id: "sibling-root" }, depth: 0, childCount: 0 },
  ];

  it("hides descendants at any depth under a collapsed parent", () => {
    const visible = filterVisibleSidebarThreadEntries({
      entries,
      isExpanded: (entry) => entry.thread.id !== "root",
    });

    expect(visible.map((entry) => entry.thread.id)).toEqual(["root", "sibling-root"]);
  });

  it("hides only the collapsed subtree and keeps later siblings visible", () => {
    const visible = filterVisibleSidebarThreadEntries({
      entries,
      isExpanded: (entry) => entry.thread.id !== "child-a",
    });

    expect(visible.map((entry) => entry.thread.id)).toEqual([
      "root",
      "child-a",
      "child-b",
      "sibling-root",
    ]);
  });
});

describe("resolveCollapsedThreadSelectionTarget", () => {
  const entries: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>> = [
    { thread: { id: "root" }, depth: 0, childCount: 2 },
    { thread: { id: "child-a" }, depth: 1, childCount: 1 },
    { thread: { id: "grandchild" }, depth: 2, childCount: 0 },
    { thread: { id: "child-b" }, depth: 1, childCount: 0 },
    { thread: { id: "sibling-root" }, depth: 0, childCount: 0 },
  ];

  it("promotes a selected descendant to the collapsing parent", () => {
    expect(
      resolveCollapsedThreadSelectionTarget({
        entries,
        collapsedThreadId: "root",
        selectedThreadId: "grandchild",
        getThreadId: (thread) => thread.id,
      }),
    ).toBe("root");
  });

  it("does nothing when the selected thread is outside the collapsed subtree", () => {
    expect(
      resolveCollapsedThreadSelectionTarget({
        entries,
        collapsedThreadId: "child-a",
        selectedThreadId: "child-b",
        getThreadId: (thread) => thread.id,
      }),
    ).toBeNull();
  });
});

describe("getVisibleSidebarThreadIds", () => {
  it("skips descendants hidden inside a collapsed parent while preserving root order", () => {
    const previewEntries: ReadonlyArray<SidebarThreadTreeEntry<{ id: ThreadId }>> = [
      { thread: { id: ThreadId.make("thread-root-1") }, depth: 0, childCount: 2 },
      { thread: { id: ThreadId.make("thread-child-1") }, depth: 1, childCount: 1 },
      { thread: { id: ThreadId.make("thread-grandchild-1") }, depth: 2, childCount: 0 },
      { thread: { id: ThreadId.make("thread-child-2") }, depth: 1, childCount: 0 },
      { thread: { id: ThreadId.make("thread-root-2") }, depth: 0, childCount: 0 },
      { thread: { id: ThreadId.make("thread-root-3") }, depth: 0, childCount: 0 },
    ];
    const families = takeSidebarThreadFamilies({ entries: previewEntries, rootLimit: 2 });
    const visibleEntries = filterVisibleSidebarThreadEntries({
      entries: families.visible,
      isExpanded: (entry) => entry.thread.id !== ThreadId.make("thread-root-1"),
    });

    expect(families.rootCount).toBe(3);
    expect(families.visible.map((entry) => entry.thread.id)).toEqual([
      ThreadId.make("thread-root-1"),
      ThreadId.make("thread-child-1"),
      ThreadId.make("thread-grandchild-1"),
      ThreadId.make("thread-child-2"),
      ThreadId.make("thread-root-2"),
    ]);
    expect(
      getVisibleSidebarThreadIds([
        {
          renderedThreadIds: visibleEntries.map((entry) => entry.thread.id),
        },
      ]),
    ).toEqual([ThreadId.make("thread-root-1"), ThreadId.make("thread-root-2")]);
  });
});

describe("buildSidebarThreadTree", () => {
  const t = (id: string, parentThreadId?: string | null) => ({
    id,
    ...(parentThreadId === undefined ? {} : { parentThreadId }),
  });

  const shape = (threads: ReadonlyArray<{ id: string; parentThreadId?: string | null }>) =>
    buildSidebarThreadTree({ threads }).map((entry) => [
      entry.thread.id,
      entry.depth,
      entry.childCount,
    ]);

  it("returns a flat list when nothing is delegated", () => {
    expect(shape([t("a"), t("b", null), t("c")])).toEqual([
      ["a", 0, 0],
      ["b", 0, 0],
      ["c", 0, 0],
    ]);
  });

  it("places sub-agents directly under their orchestrator, preserving sibling order", () => {
    expect(
      shape([
        t("orchestrator"),
        t("other"),
        t("impl-b", "orchestrator"),
        t("impl-a", "orchestrator"),
      ]),
    ).toEqual([
      ["orchestrator", 0, 2],
      ["impl-b", 1, 0],
      ["impl-a", 1, 0],
      ["other", 0, 0],
    ]);
  });

  it("nests deeper generations depth-first", () => {
    expect(shape([t("root"), t("child", "root"), t("grandchild", "child")])).toEqual([
      ["root", 0, 1],
      ["child", 1, 1],
      ["grandchild", 2, 0],
    ]);
  });

  it("promotes a sub-agent to a root when its orchestrator is not in the list", () => {
    // Parent archived, deleted, or filtered into another project.
    expect(shape([t("orphan", "missing-parent"), t("normal")])).toEqual([
      ["orphan", 0, 0],
      ["normal", 0, 0],
    ]);
  });

  it("emits every thread exactly once when parent references form a cycle", () => {
    const result = shape([t("a", "b"), t("b", "a"), t("c")]);
    expect(result.map(([id]) => id).sort()).toEqual(["a", "b", "c"]);
    expect(result).toHaveLength(3);
  });

  it("treats a self-referencing thread as a root", () => {
    expect(shape([t("self", "self")])).toEqual([["self", 0, 0]]);
  });

  it("clamps display depth without reordering", () => {
    const threads = [
      t("d0"),
      t("d1", "d0"),
      t("d2", "d1"),
      t("d3", "d2"),
      t("d4", "d3"),
      t("d5", "d4"),
    ];
    expect(buildSidebarThreadTree({ threads, maxDepth: 2 }).map((entry) => entry.depth)).toEqual([
      0, 1, 2, 2, 2, 2,
    ]);
    expect(buildSidebarThreadTree({ threads }).map((entry) => entry.thread.id)).toEqual([
      "d0",
      "d1",
      "d2",
      "d3",
      "d4",
      "d5",
    ]);
  });

  it("returns an empty list for no threads", () => {
    expect(buildSidebarThreadTree({ threads: [] })).toEqual([]);
  });
});

describe("takeSidebarThreadFamilies", () => {
  const entries: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>> = [
    { thread: { id: "r1" }, depth: 0, childCount: 2 },
    { thread: { id: "r1-a" }, depth: 1, childCount: 0 },
    { thread: { id: "r1-b" }, depth: 1, childCount: 0 },
    { thread: { id: "r2" }, depth: 0, childCount: 0 },
    { thread: { id: "r3" }, depth: 0, childCount: 1 },
    { thread: { id: "r3-a" }, depth: 1, childCount: 0 },
  ];

  const ids = (list: ReadonlyArray<{ thread: { id: string } }>) => list.map((e) => e.thread.id);

  it("counts roots, not rows", () => {
    expect(takeSidebarThreadFamilies({ entries, rootLimit: 2 }).rootCount).toBe(3);
  });

  it("keeps every sub-agent of a surviving orchestrator", () => {
    const result = takeSidebarThreadFamilies({ entries, rootLimit: 1 });
    expect(ids(result.visible)).toEqual(["r1", "r1-a", "r1-b"]);
    expect(ids(result.hidden)).toEqual(["r2", "r3", "r3-a"]);
  });

  it("hides a whole family once the root limit is exceeded", () => {
    const result = takeSidebarThreadFamilies({ entries, rootLimit: 2 });
    expect(ids(result.visible)).toEqual(["r1", "r1-a", "r1-b", "r2"]);
    expect(ids(result.hidden)).toEqual(["r3", "r3-a"]);
  });

  it("keeps everything when the limit covers all roots", () => {
    const result = takeSidebarThreadFamilies({ entries, rootLimit: 3 });
    expect(ids(result.visible)).toEqual(ids(entries));
    expect(result.hidden).toEqual([]);
  });

  it("hides everything at a zero limit", () => {
    const result = takeSidebarThreadFamilies({ entries, rootLimit: 0 });
    expect(result.visible).toEqual([]);
    expect(ids(result.hidden)).toEqual(ids(entries));
  });
});

describe("selectSidebarThreadFamilyPage", () => {
  const entries: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>> = [
    { thread: { id: "r1" }, depth: 0, childCount: 2 },
    { thread: { id: "r1-a" }, depth: 1, childCount: 1 },
    { thread: { id: "r1-a-i" }, depth: 2, childCount: 0 },
    { thread: { id: "r1-b" }, depth: 1, childCount: 0 },
    { thread: { id: "r2" }, depth: 0, childCount: 0 },
    { thread: { id: "r3" }, depth: 0, childCount: 1 },
    { thread: { id: "r3-a" }, depth: 1, childCount: 0 },
  ];
  const selectPage = (input: {
    expanded?: ReadonlySet<string>;
    rootLimit?: number;
    pinnedThreadId?: string | null;
  }) =>
    selectSidebarThreadFamilyPage({
      entries,
      isExpanded: (entry) => (input.expanded ?? new Set()).has(entry.thread.id),
      rootLimit: input.rootLimit ?? 10,
      pinnedThreadId: input.pinnedThreadId ?? null,
      getThreadId: (thread) => thread.id,
    });
  const ids = (rows: ReadonlyArray<SidebarThreadTreeEntry<{ id: string }>>) =>
    rows.map((entry) => entry.thread.id);

  it("renders an orchestrator as one row while its sub-agents stay collapsed", () => {
    const page = selectPage({});
    expect(ids(page.rows)).toEqual(["r1", "r2", "r3"]);
    expect(page.rootCount).toBe(3);
    expect(page.hiddenRootCount).toBe(0);
    expect(page.expandedThreadIds).toEqual(new Set());
  });

  it("reveals only the expanded branch", () => {
    const page = selectPage({ expanded: new Set(["r1"]) });
    expect(ids(page.rows)).toEqual(["r1", "r1-a", "r1-b", "r2", "r3"]);
    expect(page.expandedThreadIds).toEqual(new Set(["r1"]));
  });

  it("pages by family, so a hidden orchestrator takes its sub-agents with it", () => {
    const page = selectPage({ expanded: new Set(["r1", "r1-a"]), rootLimit: 1 });
    expect(ids(page.rows)).toEqual(["r1", "r1-a", "r1-a-i", "r1-b"]);
    expect(page.hiddenRootCount).toBe(2);
  });

  it("forces the branch holding the pinned thread open", () => {
    const page = selectPage({ pinnedThreadId: "r1-a-i" });
    expect(ids(page.rows)).toEqual(["r1", "r1-a", "r1-a-i", "r1-b", "r2", "r3"]);
    expect(page.expandedThreadIds).toEqual(new Set(["r1", "r1-a"]));
  });

  it("pulls the pinned thread's whole family past the page limit", () => {
    const page = selectPage({ pinnedThreadId: "r3-a", rootLimit: 1 });
    expect(ids(page.rows)).toEqual(["r1", "r3", "r3-a"]);
    expect(page.hiddenRootCount).toBe(1);
  });

  it("leaves the page alone when the pinned thread is already on it", () => {
    const page = selectPage({ pinnedThreadId: "r1", rootLimit: 2 });
    expect(ids(page.rows)).toEqual(["r1", "r2"]);
    expect(page.hiddenRootCount).toBe(1);
  });

  it("ignores a pinned thread the tree doesn't contain", () => {
    const page = selectPage({ pinnedThreadId: "missing", rootLimit: 1 });
    expect(ids(page.rows)).toEqual(["r1"]);
    expect(page.hiddenRootCount).toBe(2);
  });
});

describe("inheritSettledFromOrchestrators", () => {
  type Thread = { id: string; parentThreadId?: string | null };
  const sectionsFor = (
    threads: readonly Thread[],
    own: Readonly<Record<string, SidebarThreadSection>>,
  ) =>
    Object.fromEntries(
      inheritSettledFromOrchestrators({
        threads,
        classify: (thread) => own[thread.id] ?? "active",
      }),
    );

  const family: readonly Thread[] = [
    { id: "root" },
    { id: "child-a", parentThreadId: "root" },
    { id: "grandchild", parentThreadId: "child-a" },
    { id: "child-b", parentThreadId: "root" },
    { id: "other-root" },
  ];

  it("pulls the whole delegation into the tail when the orchestrator settles", () => {
    expect(sectionsFor(family, { root: "settled" })).toEqual({
      root: "settled",
      "child-a": "settled",
      grandchild: "settled",
      "child-b": "settled",
      "other-root": "active",
    });
  });

  it("leaves unrelated roots and sibling branches alone", () => {
    expect(sectionsFor(family, { "child-a": "settled" })).toEqual({
      root: "active",
      "child-a": "settled",
      grandchild: "settled",
      "child-b": "active",
      "other-root": "active",
    });
  });

  it("keeps a sub-agent's own snooze, which outranks the parent's settle", () => {
    expect(sectionsFor(family, { root: "settled", "child-a": "snoozed" })).toEqual({
      root: "settled",
      "child-a": "snoozed",
      grandchild: "active",
      "child-b": "settled",
      "other-root": "active",
    });
  });

  it("does not pull sub-agents out of the inbox for a snoozed orchestrator", () => {
    expect(sectionsFor(family, { root: "snoozed" })).toEqual({
      root: "snoozed",
      "child-a": "active",
      grandchild: "active",
      "child-b": "active",
      "other-root": "active",
    });
  });

  it("treats an absent parent as a root", () => {
    expect(sectionsFor([{ id: "orphan", parentThreadId: "gone" }], {})).toEqual({
      orphan: "active",
    });
  });

  it("terminates on a parentage cycle", () => {
    const cycle: readonly Thread[] = [
      { id: "a", parentThreadId: "b" },
      { id: "b", parentThreadId: "a" },
      { id: "self", parentThreadId: "self" },
    ];
    expect(sectionsFor(cycle, { self: "settled" })).toEqual({
      a: "active",
      b: "active",
      self: "settled",
    });
  });
});
