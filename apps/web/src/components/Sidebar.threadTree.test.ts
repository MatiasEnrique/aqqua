import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@aqqua/contracts";

import { getVisibleSidebarThreadIds } from "./Sidebar.logic";
import {
  buildSidebarThreadTree,
  filterVisibleSidebarThreadEntries,
  resolveCollapsedThreadSelectionTarget,
  resolveSidebarThreadAncestorIds,
  shouldReserveThreadExpandGutter,
  takeSidebarThreadFamilies,
  type SidebarThreadTreeEntry,
} from "./Sidebar.threadTree";

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
