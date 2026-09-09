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
  resolveConversationTabAfterClose,
  resolveConversationTabSettlement,
  resolveConversationTabRouteKey,
  resolveWorktreeFocusTarget,
  resolveWorktreeSelectionTarget,
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
const conversationTab = (
  id: string,
  isActive = false,
  parentKey: string | null = null,
): ConversationTab => ({
  _tag: "thread",
  key: key(id),
  threadRef: {
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make(id),
  },
  title: id,
  isActive,
  state: "working",
  project: null,
  parentKey,
});
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

const allWorktrees = {
  scope: "all",
  projectRootByProjectKey: new Map([["env:project", "/repo"]]),
} as const;

describe("openConversationTab", () => {
  it("appends a newly opened conversation", () => {
    expect(openConversationTab(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps an already-open conversation in place rather than reordering", () => {
    expect(openConversationTab(["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveConversationTabAfterClose", () => {
  it("returns the previous header tab when the active tab closes", () => {
    const first = conversationTab("first");
    const previous = conversationTab("previous");
    const closing = conversationTab("closing", true);

    expect(
      resolveConversationTabAfterClose({
        tabs: [first, previous, closing],
        closingKey: closing.key,
      }),
    ).toBe(previous);
  });

  it("returns the next header tab when the first tab closes", () => {
    const closing = conversationTab("closing", true);
    const next = conversationTab("next");

    expect(
      resolveConversationTabAfterClose({ tabs: [closing, next], closingKey: closing.key }),
    ).toBe(next);
  });

  it("returns the visible parent tab instead of its nested sub-agent", () => {
    const parent = conversationTab("parent");
    const child = conversationTab("child", false, parent.key);
    const closing = conversationTab("closing", true);

    expect(
      resolveConversationTabAfterClose({ tabs: [parent, child, closing], closingKey: closing.key }),
    ).toBe(parent);
  });
});

describe("resolveConversationTabSettlement", () => {
  it("closes the settled family and targets the previous visible tab", () => {
    const previous = conversationTab("previous");
    const parent = conversationTab("parent");
    const activeChild = conversationTab("child", true, parent.key);

    expect(
      resolveConversationTabSettlement({
        tabs: [previous, parent, activeChild],
        settlingKey: parent.key,
      }),
    ).toEqual({
      keysToClose: [parent.key, activeChild.key],
      closesActiveTab: true,
      target: previous,
    });
  });

  it("targets the next tab when the first visible tab settles", () => {
    const settling = conversationTab("settling", true);
    const next = conversationTab("next");

    expect(
      resolveConversationTabSettlement({
        tabs: [settling, next],
        settlingKey: settling.key,
      }).target,
    ).toBe(next);
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
      project: null,
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
        project: null,
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
      ...allWorktrees,
    });
    expect(tabs.map((tab) => tab.key)).toEqual([key("d1-thread"), key("b"), key("a")]);
    expect(tabs.map((tab) => tab.isActive)).toEqual([false, true, false]);
    expect(tabs.map((tab) => tab.project)).toEqual([
      { environmentId: "env", workspaceRoot: "/repo" },
      { environmentId: "env", workspaceRoot: "/repo" },
      { environmentId: "env", workspaceRoot: "/repo" },
    ]);
  });

  it("drops keys whose conversation no longer exists", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a"), key("deleted")],
      threads: [thread("a")],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
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
      ...allWorktrees,
    });
    expect(tabs[0]).toMatchObject({ _tag: "thread", state: "failed", title: "a" });
  });

  it("titles an untitled conversation rather than rendering an empty tab", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [thread("a", { title: "" })],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
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
      ...allWorktrees,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("parent"), key("child"), key("unrelated")]);
  });

  it("records the orchestrator's tab key on the conversation it spawned", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("child")],
      threads: [thread("child", { parentThreadId: "parent" } as never)],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
    });

    expect(tabs[0]).toMatchObject({ _tag: "thread", parentKey: key("parent") });
  });

  it("leaves a top-level conversation unparented", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("a")],
      threads: [thread("a")],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
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
      ...allWorktrees,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("owner"), key("managed-child")]);
  });

  it("ignores a stale persisted native-child open key", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("owner"), key("unrelated"), key("native-child")],
      threads: [thread("owner"), thread("unrelated"), nativeChild],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
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
      ...allWorktrees,
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
      ...allWorktrees,
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
      ...allWorktrees,
    };
    const before = buildConversationTabs({ ...source, threads: [] });
    expect(before[0]).toMatchObject({ _tag: "draft", draftId: "d1", key: key("promoting") });

    const after = buildConversationTabs({ ...source, threads: [thread("promoting")] });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ _tag: "thread", key: key("promoting") });
  });
});

describe("buildConversationTabs — cross-worktree tabs", () => {
  const inCheckout = thread("checkout-thread");
  const inWorktree = thread("worktree-thread", { worktreePath: "/repo-wt" } as never);
  const openKeys = [key("checkout-thread"), key("worktree-thread")];

  it("keeps open conversations from every worktree visible", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-thread"), key("worktree-thread")]);
  });

  it("keeps worktree drafts beside checkout conversations", () => {
    const tabs = buildConversationTabs({
      openKeys: [...openKeys, key("draft-thread")],
      threads: [inCheckout, inWorktree],
      drafts: [draft("d1", "draft-thread", { envMode: "worktree", worktreePath: "/repo-wt" })],
      activeKey: null,
      ...allWorktrees,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([
      key("checkout-thread"),
      key("worktree-thread"),
      key("draft-thread"),
    ]);
  });

  it("keeps the routed conversation active without hiding its peers", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [inCheckout, inWorktree],
      drafts: [],
      activeKey: key("checkout-thread"),
      ...allWorktrees,
    });

    // Routing somewhere and finding no active tab would be the worse failure.
    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-thread"), key("worktree-thread")]);
  });

  it("keeps a local draft visible", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread")],
      activeKey: null,
      ...allWorktrees,
    });

    expect(tabs).toHaveLength(1);
  });

  it("keeps a worktree draft visible", () => {
    const source = {
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread", { envMode: "worktree", worktreePath: "/repo-wt" })],
      activeKey: null,
      ...allWorktrees,
    };

    expect(buildConversationTabs(source)).toHaveLength(1);
  });

  it("keeps a draft for a not-yet-created worktree visible", () => {
    const source = {
      openKeys: [key("draft-thread")],
      threads: [],
      drafts: [draft("d1", "draft-thread", { envMode: "worktree", worktreePath: null })],
      activeKey: null,
      ...allWorktrees,
    };

    expect(buildConversationTabs(source)).toHaveLength(1);
  });
});

describe("buildConversationTabs — selected-project scope", () => {
  const projectRootByProjectKey = new Map([
    ["env:project", "/repo"],
    ["env:other-project", "/other-repo"],
  ]);
  const projectScope = {
    scope: "project",
    projectKey: "env:project",
    projectRootByProjectKey,
  } as const;
  const checkoutThread = thread("checkout-thread");
  const worktreeThread = thread("worktree-thread", { worktreePath: "/repo-wt" } as never);
  const otherProjectThread = thread("other-project-thread", {
    projectId: "other-project",
    worktreePath: "/other-repo-wt",
  } as never);
  const openKeys = [key("checkout-thread"), key("worktree-thread"), key("other-project-thread")];

  it("shows the checkout and every worktree from the selected project", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread, otherProjectThread],
      drafts: [],
      activeKey: null,
      ...projectScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-thread"), key("worktree-thread")]);
    expect(tabs.every((tab) => tab.project === null)).toBe(true);
  });

  it("applies the selected-project scope to drafts", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("checkout-draft"), key("worktree-draft"), key("other-project-draft")],
      threads: [],
      drafts: [
        draft("checkout", "checkout-draft"),
        draft("worktree", "worktree-draft", {
          envMode: "worktree",
          worktreePath: "/repo-wt",
        }),
        draft("other", "other-project-draft", {
          projectId: "other-project",
          envMode: "worktree",
          worktreePath: "/other-repo-wt",
        }),
      ],
      activeKey: null,
      ...projectScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("checkout-draft"), key("worktree-draft")]);
  });

  it("shows every open tab until the selected project resolves", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread, otherProjectThread],
      drafts: [],
      activeKey: null,
      ...projectScope,
      projectKey: null,
    });

    expect(tabs.map((tab) => tab.key)).toEqual(openKeys);
  });

  it("keeps the routed conversation visible during a project change", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread, otherProjectThread],
      drafts: [],
      activeKey: key("other-project-thread"),
      ...projectScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual(openKeys);
  });
});

describe("buildConversationTabs — selected-worktree scope", () => {
  const projectRootByProjectKey = new Map([["env:project", "/repo"]]);
  const worktreeScope = {
    scope: "worktree",
    worktreeKey: "env:/repo-wt",
    projectRootByProjectKey,
  } as const;
  const checkoutThread = thread("checkout-thread");
  const worktreeThread = thread("worktree-thread", { worktreePath: "/repo-wt" } as never);
  const openKeys = [key("checkout-thread"), key("worktree-thread")];

  it("shows only open conversations from the selected worktree", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread],
      drafts: [],
      activeKey: null,
      ...worktreeScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("worktree-thread")]);
    expect(tabs[0]?.project).toBeNull();
  });

  it("keeps other worktree keys open so all-worktrees scope can restore them", () => {
    const scopedTabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread],
      drafts: [],
      activeKey: null,
      ...worktreeScope,
    });
    const allTabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread],
      drafts: [],
      activeKey: null,
      ...allWorktrees,
    });

    expect(scopedTabs.map((tab) => tab.key)).toEqual([key("worktree-thread")]);
    expect(allTabs.map((tab) => tab.key)).toEqual(openKeys);
  });

  it("applies the selected-worktree scope to drafts", () => {
    const tabs = buildConversationTabs({
      openKeys: [key("checkout-draft"), key("worktree-draft")],
      threads: [],
      drafts: [
        draft("checkout", "checkout-draft"),
        draft("worktree", "worktree-draft", {
          envMode: "worktree",
          worktreePath: "/repo-wt",
        }),
      ],
      activeKey: null,
      ...worktreeScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual([key("worktree-draft")]);
  });

  it("shows every open tab until the selected worktree resolves", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread],
      drafts: [],
      activeKey: null,
      ...worktreeScope,
      worktreeKey: null,
    });

    expect(tabs.map((tab) => tab.key)).toEqual(openKeys);
  });

  it("keeps the routed conversation visible during a scope transition", () => {
    const tabs = buildConversationTabs({
      openKeys,
      threads: [checkoutThread, worktreeThread],
      drafts: [],
      activeKey: key("checkout-thread"),
      ...worktreeScope,
    });

    expect(tabs.map((tab) => tab.key)).toEqual(openKeys);
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

  it("focuses another open conversation when the routed one is closing", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: { drafts: [], active: [older, newer] as never },
        openKeys: new Set([key("older"), key("newer")]),
        excludedKey: key("newer"),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "older" } });
  });

  it("focuses another open conversation when the routed draft is closing", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: {
          drafts: [draft("closing", "closing-thread")],
          active: [older] as never,
        },
        openKeys: new Set([key("closing-thread"), key("older")]),
        excludedKey: key("closing-thread"),
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
        worktree: {
          drafts: [draft("d1", "d1-thread"), draft("d2", "d2-thread")],
          active: [],
        },
        openKeys: new Set([key("d2-thread")]),
      }),
    ).toEqual({ _tag: "draft", draftId: "d2" });
  });

  it("prefers an open draft over a closed conversation", () => {
    // Open beats closed across both pools. Resolving threads to exhaustion
    // first abandoned the draft the user was writing in.
    expect(
      resolveWorktreeFocusTarget({
        worktree: {
          drafts: [draft("d1", "d1-thread")],
          active: [newer] as never,
        },
        openKeys: new Set([key("d1-thread")]),
      }),
    ).toEqual({ _tag: "draft", draftId: "d1" });
  });

  it("still prefers an open conversation over an open draft", () => {
    expect(
      resolveWorktreeFocusTarget({
        worktree: {
          drafts: [draft("d1", "d1-thread")],
          active: [newer] as never,
        },
        openKeys: new Set([key("d1-thread"), key("newer")]),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "newer" } });
  });

  it("selects the first active conversation even when a later one is already open", () => {
    expect(
      resolveWorktreeSelectionTarget({
        worktree: {
          drafts: [draft("open-draft", "open-draft-thread")],
          active: [older, newer] as never,
          conversationCount: 3,
        },
        openKeys: new Set([key("newer"), key("open-draft-thread")]),
      }),
    ).toEqual({ _tag: "thread", threadRef: { environmentId: "env", threadId: "older" } });
  });

  it("starts a new thread when the selected worktree has no conversations", () => {
    expect(
      resolveWorktreeSelectionTarget({
        worktree: { drafts: [], active: [], conversationCount: 0 },
        openKeys: new Set(),
      }),
    ).toEqual({ _tag: "new-thread" });
  });

  it("starts a new thread when the worktree has history but nothing active", () => {
    expect(
      resolveWorktreeSelectionTarget({
        worktree: { drafts: [], active: [], conversationCount: 1 },
        openKeys: new Set(),
      }),
    ).toEqual({ _tag: "new-thread" });
  });
});
