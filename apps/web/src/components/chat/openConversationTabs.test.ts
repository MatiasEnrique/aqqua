import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";

import {
  buildConversationTabs,
  closeConversationTab,
  conversationTabKey,
  openConversationTab,
  resolveConversationTabCloseTarget,
  resolveWorktreeFocusTarget,
  retainKnownConversationTabs,
} from "./openConversationTabs";

const thread = (
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId: "env",
    id,
    projectId: "project",
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    session: null,
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

const key = (id: string) => conversationTabKey({ environmentId: "env", threadId: id } as never);
const draft = (draftId: string, threadId: string) => ({
  draftId,
  environmentId: "env" as never,
  threadId: threadId as never,
  title: "New thread",
});

describe("openConversationTab", () => {
  it("appends a newly opened conversation", () => {
    expect(openConversationTab(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps an already-open conversation in place rather than reordering", () => {
    expect(openConversationTab(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });
});

describe("closeConversationTab", () => {
  it("removes only the closed conversation", () => {
    expect(closeConversationTab(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("resolveConversationTabCloseTarget", () => {
  it("moves to the tab on the right when closing the routed one", () => {
    expect(
      resolveConversationTabCloseTarget({ keys: ["a", "b", "c"], closingKey: "b", activeKey: "b" }),
    ).toBe("c");
  });

  it("falls back to the tab on the left at the end of the strip", () => {
    expect(
      resolveConversationTabCloseTarget({ keys: ["a", "b"], closingKey: "b", activeKey: "b" }),
    ).toBe("a");
  });

  it("reports nothing to route to when the last tab closes", () => {
    expect(
      resolveConversationTabCloseTarget({ keys: ["a"], closingKey: "a", activeKey: "a" }),
    ).toBeNull();
  });

  it("leaves the route alone when closing a background tab", () => {
    expect(
      resolveConversationTabCloseTarget({ keys: ["a", "b"], closingKey: "a", activeKey: "b" }),
    ).toBeNull();
  });
});

describe("buildConversationTabs", () => {
  it("keeps the order tabs were opened in and marks the routed one active", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("d1-thread"), key("b"), key("a")],
      threads: [thread("a"), thread("b")],
      drafts: [draft("d1", "d1-thread")],
      activeKey: key("b"),
    });
    expect(tabs.map((tab) => tab.key)).toEqual([key("d1-thread"), key("b"), key("a")]);
    expect(tabs.map((tab) => tab.isActive)).toEqual([false, true, false]);
  });

  it("drops keys whose conversation no longer exists", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a"), key("deleted")],
      threads: [thread("a")],
      drafts: [],
      activeKey: null,
    });
    expect(tabs.map((tab) => tab.key)).toEqual([key("a")]);
  });

  it("carries the conversation's aggregate state, failure included", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [
        thread("a", {
          session: { status: "error" },
          latestTurn: { state: "completed" },
        } as Partial<EnvironmentThreadShell>),
      ],
      drafts: [],
      activeKey: null,
    });
    expect(tabs[0]).toMatchObject({ _tag: "thread", state: "failed", title: "a" });
  });

  it("titles an untitled conversation rather than rendering an empty tab", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [thread("a", { title: "" })],
      drafts: [],
      activeKey: null,
    });
    expect(tabs[0]).toMatchObject({ title: "Untitled" });
  });
});

describe("buildConversationTabs — draft promotion", () => {
  it("keeps one tab as a draft becomes its thread", () => {
    const source = {
      openKeys: [key("promoting")],
      drafts: [draft("d1", "promoting")],
      activeKey: key("promoting"),
    };
    const before = buildConversationTabs({ ...source, threads: [] });
    expect(before[0]).toMatchObject({ _tag: "draft", draftId: "d1", key: key("promoting") });

    const after = buildConversationTabs({ ...source, threads: [thread("promoting")] });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ _tag: "thread", key: key("promoting") });
  });
});

describe("retainKnownConversationTabs", () => {
  it("prunes keys with no live conversation behind them", () => {
    expect(
      retainKnownConversationTabs({ keys: ["a", "b", "c"], knownKeys: new Set(["a", "c"]) }),
    ).toEqual(["a", "c"]);
  });
});

describe("resolveWorktreeFocusTarget", () => {
  const older = { environmentId: "env", id: "older", updatedAt: "2026-01-01T00:00:00.000Z" };
  const newer = { environmentId: "env", id: "newer", updatedAt: "2026-02-01T00:00:00.000Z" };

  it("focuses an already-open conversation over a more recent closed one", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [older, newer] as never },
        openKeys: new Set([key("older")]),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "older" } });
  });

  it("falls back to the most recently active conversation when none is open", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [older, newer] as never },
        openKeys: new Set(),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "newer" } });
  });

  it("prefers an open draft when the worktree has no conversation", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [draft("d1", "d1-thread"), draft("d2", "d2-thread")], active: [] },
        openKeys: new Set([key("d2-thread")]),
      }),
    ).toEqual({ _tag: "draft", draftId: "d2" });
  });

  it("reports an empty worktree so the caller can select it without navigating", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [] },
        openKeys: new Set(),
      }),
    ).toEqual({ _tag: "none" });
  });
});
