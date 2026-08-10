import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@aqqua/contracts";

import {
  buildConversationTabs,
  type ConversationTab,
  conversationTabKey,
  groupConversationTabFamilies,
  openConversationTab,
  openNewSubAgentConversationTabs,
  resolveConversationTabRouteKey,
  resolveWorktreeFocusTarget,
  retainKnownConversationTabs,
  syncOpenFlowConversationTabs,
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
const flowCard = (...threadIds: string[]) => ({
  archivedAt: null,
  stepThreads: threadIds.map((threadId, stepIndex) => ({
    stepIndex,
    threadId: ThreadId.make(threadId),
    spawnedAt: `2026-01-01T00:00:0${stepIndex}.000Z`,
  })),
});
const draft = (draftId: string, threadId: string, overrides: Record<string, unknown> = {}) =>
  ({
    draftId,
    environmentId: "env",
    threadId,
    projectId: "project",
    envMode: "local",
    worktreePath: null,
    title: "New thread",
    ...overrides,
  }) as never;

/** Every conversation above lives in `project`, whose own checkout is `/repo`. */
const projectRootByProjectKey = new Map([["env:project", "/repo"]]);
/** Scoping off, which is how every pre-existing case here behaved. */
const unscoped = { worktreeKey: null, projectRootByProjectKey };

describe("openConversationTab", () => {
  it("appends a newly opened conversation", () => {
    expect(openConversationTab(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps an already-open conversation in place rather than reordering", () => {
    expect(openConversationTab(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });
});

describe("openNewSubAgentConversationTabs", () => {
  it("opens a newly spawned sub-agent beside its already-open parent", () => {
    const parent = thread("parent");
    const child = thread("child", { parentThreadId: "parent" } as never);

    expect(
      openNewSubAgentConversationTabs({
        openKeys: [key("parent")],
        previousThreads: [parent],
        threads: [parent, child],
      }),
    ).toEqual([key("parent"), key("child")]);
  });

  it("does not turn a newly loaded root conversation into an open tab", () => {
    expect(
      openNewSubAgentConversationTabs({
        openKeys: [key("parent")],
        previousThreads: [thread("parent")],
        threads: [thread("parent"), thread("unrelated")],
      }),
    ).toEqual([key("parent")]);
  });

  it("does not open an existing sub-agent from restored history", () => {
    const parent = thread("parent");
    const child = thread("child", { parentThreadId: "parent" } as never);

    expect(
      openNewSubAgentConversationTabs({
        openKeys: [key("parent")],
        previousThreads: [parent, child],
        threads: [parent, child],
      }),
    ).toEqual([key("parent")]);
  });

  it("keeps a newly observed provider-native child out of conversation tabs", () => {
    const owner = thread("owner");
    const nativeChild = thread("native-child", {
      parentThreadId: "owner",
      providerSubagent: { ownerThreadId: "owner", provider: "codex", childId: "c1" },
    } as never);

    expect(
      openNewSubAgentConversationTabs({
        openKeys: [key("owner")],
        previousThreads: [owner],
        threads: [owner, nativeChild],
      }),
    ).toEqual([key("owner")]);
  });

  it("leaves a provider-native child closed when its owner tab is not open", () => {
    const owner = thread("owner");
    const nativeChild = thread("native-child", {
      parentThreadId: "owner",
      providerSubagent: { ownerThreadId: "owner", provider: "codex", childId: "c1" },
    } as never);

    expect(
      openNewSubAgentConversationTabs({
        openKeys: [key("elsewhere")],
        previousThreads: [owner],
        threads: [owner, nativeChild],
      }),
    ).toEqual([key("elsewhere")]);
  });

  it("does not attach a child to a same-id parent from another environment", () => {
    const parent = thread("parent", { environmentId: "other-env" } as never);
    const child = thread("child", { parentThreadId: "parent" } as never);

    expect(
      openNewSubAgentConversationTabs({
        openKeys: [conversationTabKey({ environmentId: "other-env", threadId: "parent" } as never)],
        previousThreads: [parent],
        threads: [parent, child],
      }),
    ).toEqual([conversationTabKey({ environmentId: "other-env", threadId: "parent" } as never)]);
  });
});

describe("syncOpenFlowConversationTabs", () => {
  it("restores every step root and managed sub-agent for an already-open flow", () => {
    const implement = thread("implement");
    const managedChild = thread("managed-child", { parentThreadId: "implement" } as never);
    const nativeChild = thread("native-child", {
      parentThreadId: "implement",
      providerSubagent: {
        ownerThreadId: "implement",
        provider: "claudeAgent",
        childId: "native-1",
      },
    } as never);

    expect(
      syncOpenFlowConversationTabs({
        openKeys: [key("unrelated"), key("implement")],
        cardsByEnvironment: new Map([
          [
            EnvironmentId.make("env"),
            [flowCard("issue", "plan", "implement", "review", "fix", "ship")],
          ],
        ]),
        threads: [
          thread("unrelated"),
          thread("issue"),
          thread("plan"),
          implement,
          managedChild,
          nativeChild,
          thread("review"),
          thread("fix"),
          thread("ship"),
        ],
      }),
    ).toEqual([
      key("unrelated"),
      key("issue"),
      key("plan"),
      key("implement"),
      key("managed-child"),
      key("review"),
      key("fix"),
      key("ship"),
    ]);
  });

  it("does not open flow history until one of its conversations is open", () => {
    expect(
      syncOpenFlowConversationTabs({
        openKeys: [key("unrelated")],
        cardsByEnvironment: new Map([[EnvironmentId.make("env"), [flowCard("issue", "plan")]]]),
        threads: [thread("unrelated"), thread("issue"), thread("plan")],
      }),
    ).toEqual([key("unrelated")]);
  });
});

describe("groupConversationTabFamilies", () => {
  const tab = (id: string, parentId: string | null = null): ConversationTab =>
    ({
      _tag: "thread",
      key: id,
      threadRef: { environmentId: "env", threadId: id },
      title: id,
      isActive: false,
      state: "working",
      parentKey: parentId,
    }) as ConversationTab;

  it("bands sub-agents under the orchestrator that spawned them", () => {
    const families = groupConversationTabFamilies([
      tab("parent"),
      tab("other"),
      tab("child-a", "parent"),
      tab("child-b", "parent"),
    ]);

    expect(families.map((family) => family.key)).toEqual(["parent", "other"]);
    expect(families[0]?.children.map((child) => child.key)).toEqual(["child-a", "child-b"]);
    expect(families[1]?.children).toEqual([]);
  });

  it("keeps unsupported nested delegation visible without flattening it into the family", () => {
    const families = groupConversationTabFamilies([
      tab("parent"),
      tab("grandchild", "child"),
      tab("child", "parent"),
    ]);

    expect(families.map((family) => family.key)).toEqual(["parent", "grandchild"]);
    expect(families[0]?.children.map((child) => child.key)).toEqual(["child"]);
  });

  it("leads its own family when the orchestrator is not in the strip", () => {
    const families = groupConversationTabFamilies([tab("orphan", "absent-parent")]);

    expect(families.map((family) => family.key)).toEqual(["orphan"]);
  });

  it("gives every tab a place even when the parent chain loops", () => {
    const families = groupConversationTabFamilies([tab("a", "b"), tab("b", "a")]);

    expect(
      families.flatMap((family) => [family.parent.key, ...family.children.map((c) => c.key)]),
    ).toHaveLength(2);
  });

  it("never nests a draft, which has no orchestrator to nest under", () => {
    const families = groupConversationTabFamilies([
      tab("parent"),
      {
        _tag: "draft",
        key: "draft",
        threadRef: { environmentId: "env", threadId: "draft" },
        title: "New conversation",
        isActive: false,
        draftId: "draft",
      } as ConversationTab,
    ]);

    expect(families.map((family) => family.key)).toEqual(["parent", "draft"]);
  });
});

describe("buildConversationTabs", () => {
  it("keeps the order tabs were opened in and marks the routed one active", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("d1-thread"), key("b"), key("a")],
      threads: [thread("a"), thread("b")],
      drafts: [draft("d1", "d1-thread")],
      activeKey: key("b"),
      ...unscoped,
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
      ...unscoped,
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
      ...unscoped,
    });
    expect(tabs[0]).toMatchObject({ _tag: "thread", state: "failed", title: "a" });
  });

  it("titles an untitled conversation rather than rendering an empty tab", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [thread("a", { title: "" })],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });
    expect(tabs[0]).toMatchObject({ title: "Untitled" });
  });
});

describe("buildConversationTabs — sub-agent families", () => {
  it("pulls a sub-agent up to sit directly after its orchestrator", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("parent"), key("unrelated"), key("child")],
      threads: [
        thread("parent"),
        thread("unrelated"),
        thread("child", { parentThreadId: "parent" } as never),
      ],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("parent"), key("child"), key("unrelated")]);
  });

  it("records the orchestrator's tab key on the conversation it spawned", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("child")],
      threads: [thread("child", { parentThreadId: "parent" } as never)],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs[0]).toMatchObject({ _tag: "thread", parentKey: key("parent") });
  });

  it("leaves a top-level conversation unparented", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [thread("a")],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs[0]).toMatchObject({ _tag: "thread", parentKey: null });
  });
});

describe("buildConversationTabs — provider-native subagents", () => {
  const nativeChild = thread("native-child", {
    parentThreadId: "owner",
    providerSubagent: {
      ownerThreadId: "owner",
      provider: "codex",
      childId: "c1",
    },
  } as never);

  it("keeps native children out while preserving aqqua-managed child tabs", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("owner"), key("managed-child"), key("native-child")],
      threads: [
        thread("owner"),
        thread("managed-child", { parentThreadId: "owner" } as never),
        nativeChild,
      ],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("owner"), key("managed-child")]);
  });

  it("ignores a stale persisted native-child open key", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("owner"), key("unrelated"), key("native-child")],
      threads: [thread("owner"), thread("unrelated"), nativeChild],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("owner"), key("unrelated")]);
  });

  it("keeps nested native descendants out of the tab strip too", () => {
    const grandchild = thread("native-grandchild", {
      parentThreadId: "native-child",
      providerSubagent: {
        ownerThreadId: "owner",
        provider: "codex",
        childId: "c2",
        parentChildId: "c1",
      },
    } as never);

    const tabs = buildConversationTabs({
      openKeys: [key("owner"), key("native-child"), key("native-grandchild")],
      threads: [thread("owner"), nativeChild, grandchild],
      drafts: [],
      activeKey: null,
      ...unscoped,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("owner")]);
  });

  it("does not promote third-level native children of an aqqua-managed agent to parents", () => {
    const claudeAgent = thread("claude-agent", { parentThreadId: "codex-owner" } as never);
    const claudeNativeChild = thread("claude-native-child", {
      parentThreadId: "claude-agent",
      providerSubagent: {
        ownerThreadId: "claude-agent",
        provider: "claude",
        childId: "task-1",
      },
    } as never);

    const tabs = buildConversationTabs({
      openKeys: [key("codex-owner"), key("claude-agent"), key("claude-native-child")],
      threads: [thread("codex-owner"), claudeAgent, claudeNativeChild],
      drafts: [],
      activeKey: key("claude-agent"),
      ...unscoped,
    });
    const families = groupConversationTabFamilies(tabs);

    expect(tabs.map((tab) => tab.key)).toEqual([key("codex-owner"), key("claude-agent")]);
    expect(families).toHaveLength(1);
    expect(families[0]?.parent.key).toBe(key("codex-owner"));
    expect(families[0]?.children.map((tab) => tab.key)).toEqual([key("claude-agent")]);
  });
});

describe("resolveConversationTabRouteKey", () => {
  it("keeps the owner tab active while a native child transcript is routed", () => {
    expect(
      resolveConversationTabRouteKey({
        routeThreadKey: key("native-child"),
        threads: [
          thread("owner"),
          thread("native-child", {
            parentThreadId: "owner",
            providerSubagent: { ownerThreadId: "owner", provider: "codex", childId: "c1" },
          } as never),
        ],
      }),
    ).toBe(key("owner"));
  });

  it("activates the aqqua-managed Claude owner for its third-level native child", () => {
    expect(
      resolveConversationTabRouteKey({
        routeThreadKey: key("claude-native-child"),
        threads: [
          thread("codex-owner"),
          thread("claude-agent", { parentThreadId: "codex-owner" } as never),
          thread("claude-native-child", {
            parentThreadId: "claude-agent",
            providerSubagent: {
              ownerThreadId: "claude-agent",
              provider: "claude",
              childId: "task-1",
            },
          } as never),
        ],
      }),
    ).toBe(key("claude-agent"));
  });

  it("leaves ordinary and aqqua-managed child routes unchanged", () => {
    expect(
      resolveConversationTabRouteKey({
        routeThreadKey: key("managed-child"),
        threads: [thread("managed-child", { parentThreadId: "owner" } as never)],
      }),
    ).toBe(key("managed-child"));
  });
});

describe("buildConversationTabs — draft promotion", () => {
  it("keeps one tab as a draft becomes its thread", () => {
    const source = {
      openKeys: [key("promoting")],
      drafts: [draft("d1", "promoting")],
      activeKey: key("promoting"),
      ...unscoped,
    };
    const before = buildConversationTabs({ ...source, threads: [] });
    expect(before[0]).toMatchObject({ _tag: "draft", draftId: "d1", key: key("promoting") });

    const after = buildConversationTabs({ ...source, threads: [thread("promoting")] });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ _tag: "thread", key: key("promoting") });
  });
});

describe("buildConversationTabs — worktree scoping", () => {
  // `/repo` is the project checkout; `/repo-wt` a worktree beside it.
  const checkoutKey = "env:/repo";
  const worktreeKey = "env:/repo-wt";
  const inCheckout = thread("checkout-thread");
  const inWorktree = thread("worktree-thread", { worktreePath: "/repo-wt" } as never);
  const openKeys = [key("checkout-thread"), key("worktree-thread")];

  it("shows only the active worktree's conversations", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: null,
      worktreeKey,
      projectRootByProjectKey,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("worktree-thread")]);
  });

  it("swaps the strip wholesale when the worktree changes", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: null,
      worktreeKey: checkoutKey,
      projectRootByProjectKey,
    });

    // The other worktree's tab is hidden, not closed: the open keys are
    // untouched, so switching back restores it.
    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-thread")]);
  });

  it("keeps the routed conversation even when it sits outside the worktree", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: key("checkout-thread"),
      worktreeKey,
      projectRootByProjectKey,
    });

    // Routing somewhere and finding no active tab would be the worse failure.
    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-thread"), key("worktree-thread")]);
  });

  it("files a local draft under the project checkout", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread")],
      activeKey: null,
      worktreeKey: checkoutKey,
      projectRootByProjectKey,
    });

    expect(tabs).toHaveLength(1);
  });

  it("files a worktree draft under the tree it targets", () => {
    const source = {
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread", { envMode: "worktree", worktreePath: "/repo-wt" })],
      activeKey: null,
      projectRootByProjectKey,
    };

    expect(buildConversationTabs({ ...source, worktreeKey })).toHaveLength(1);
    expect(buildConversationTabs({ ...source, worktreeKey: checkoutKey })).toHaveLength(0);
  });

  it("keeps a draft for a not-yet-created worktree out of every existing one", () => {
    const source = {
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread", { envMode: "worktree", worktreePath: null })],
      activeKey: null,
      projectRootByProjectKey,
    };

    expect(buildConversationTabs({ ...source, worktreeKey: checkoutKey })).toHaveLength(0);
    expect(
      buildConversationTabs({
        ...source,
        worktreeKey: "new-worktree:env:project:d1",
      }),
    ).toHaveLength(1);
  });

  it("shows every open tab before a worktree has been resolved", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: null,
      worktreeKey: null,
      projectRootByProjectKey,
    });

    expect(tabs).toHaveLength(2);
  });

  it("shows a conversation whose project is unknown rather than hiding it", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("checkout-thread")],
      threads: [inCheckout],
      drafts: [],
      activeKey: key("checkout-thread"),
      worktreeKey,
      projectRootByProjectKey: new Map(),
    });

    expect(tabs).toHaveLength(1);
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
  const older = {
    environmentId: "env",
    id: "older",
    parentThreadId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const newer = {
    environmentId: "env",
    id: "newer",
    parentThreadId: null,
    updatedAt: "2026-02-01T00:00:00.000Z",
  };

  it("focuses the parent conversation instead of an open running sub-thread", () => {
    const parent = {
      environmentId: "env",
      id: "parent",
      parentThreadId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const subThread = {
      environmentId: "env",
      id: "sub-thread",
      parentThreadId: "parent",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [parent, subThread] as never },
        openKeys: new Set([key("sub-thread")]),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "parent" } });
  });

  it("keeps an orphaned sub-thread reachable when its parent is unavailable", () => {
    const subThread = {
      environmentId: "env",
      id: "sub-thread",
      parentThreadId: "missing-parent",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [subThread] as never },
        openKeys: new Set(),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "sub-thread" } });
  });

  it("does not promote an orphaned native child into a parent conversation", () => {
    const nativeChild = {
      environmentId: "env",
      id: "native-child",
      parentThreadId: "missing-owner",
      providerSubagent: {
        ownerThreadId: "missing-owner",
        provider: "codex",
        childId: "native-1",
      },
      updatedAt: "2026-02-01T00:00:00.000Z",
    };

    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [nativeChild] as never },
        openKeys: new Set([key("native-child")]),
      }),
    ).toEqual({ _tag: "none" });
  });

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

  it("prefers an open draft over a closed conversation", () => {
    // Open beats closed across both pools. Resolving threads to exhaustion
    // first abandoned the draft the user was writing in.
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [draft("d1", "d1-thread")], active: [newer] as never },
        openKeys: new Set([key("d1-thread")]),
      }),
    ).toEqual({ _tag: "draft", draftId: "d1" });
  });

  it("still prefers an open conversation over an open draft", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [draft("d1", "d1-thread")], active: [newer] as never },
        openKeys: new Set([key("d1-thread"), key("newer")]),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "newer" } });
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
