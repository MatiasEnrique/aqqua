import { describe, expect, it } from "vite-plus/test";
import { inheritSettledFromOrchestrators, type SidebarThreadSection } from "./Sidebar.threadTree";

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

  it("pulls active descendants into the settled partition", () => {
    expect(sectionsFor(family, { root: "settled" })).toEqual({
      root: "settled",
      "child-a": "settled",
      grandchild: "settled",
      "child-b": "settled",
      "other-root": "active",
    });
  });

  it("preserves a descendant's own snooze", () => {
    expect(sectionsFor(family, { root: "settled", "child-a": "snoozed" })).toEqual({
      root: "settled",
      "child-a": "snoozed",
      grandchild: "active",
      "child-b": "settled",
      "other-root": "active",
    });
  });

  it("terminates on missing parents and cycles", () => {
    expect(
      sectionsFor(
        [
          { id: "orphan", parentThreadId: "gone" },
          { id: "a", parentThreadId: "b" },
          { id: "b", parentThreadId: "a" },
          { id: "self", parentThreadId: "self" },
        ],
        { self: "settled" },
      ),
    ).toEqual({ orphan: "active", a: "active", b: "active", self: "settled" });
  });
});
