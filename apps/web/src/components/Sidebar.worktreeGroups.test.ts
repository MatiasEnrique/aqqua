import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@aqqua/contracts";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import {
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  filterExpandedSidebarWorktreeGroups,
  filterHiddenSidebarWorktreeGroups,
  filterRemovedSidebarWorktreeGroups,
  resolveSidebarProjectState,
  resolveSidebarWorktreeDeleteAction,
  resolveSidebarWorktreeConversationLocation,
  resolveSidebarWorktreeSettleAction,
  resolveSidebarWorktreeSummaryState,
  sidebarLocationContextMenuItems,
  sidebarWorktreeHasVisibleChildren,
  type SidebarWorktreeGroup,
} from "./Sidebar.worktreeGroups";

const thread = (
  id: string,
  environmentId: string,
  worktreePath: string | null,
  branch: string,
  updatedAt: string,
  parentThreadId: string | null = null,
  sessionStatus: "running" | "starting" | "ready" | "interrupted" | "error" | null = null,
  projectId = "project",
): EnvironmentThreadShell =>
  ({
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make(environmentId),
    projectId: ProjectId.make(projectId),
    worktreePath,
    branch,
    updatedAt,
    parentThreadId: parentThreadId ? ThreadId.make(parentThreadId) : null,
    session:
      sessionStatus === null
        ? null
        : {
            status: sessionStatus,
          },
  }) as EnvironmentThreadShell;

describe("buildSidebarWorktreeGroups", () => {
  it("separates equal paths by environment and orders project checkouts first", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [
        thread("remote", "remote", "/repo-wt", "remote-branch", "2026-01-03T00:00:00.000Z"),
        thread("local-wt", "local", "/repo-wt", "feature", "2026-01-02T00:00:00.000Z"),
        thread("checkout", "local", null, "main", "2026-01-01T00:00:00.000Z"),
      ],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
        ["remote:project", { workspaceRoot: "/repo", environmentLabel: "Remote" }],
      ]),
    });

    expect(groups.map((group) => group.label)).toEqual(["main", "remote-branch", "feature"]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
    expect(groups.find((group) => group.label === "remote-branch")?.environmentLabel).toBe(
      "Remote",
    );
    expect(groups.find((group) => group.label === "feature")?.environmentLabel).toBe("Local");
  });

  it("uses settled conversations for totals without exposing per-worktree settled rows", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [
        thread("active", "local", "/repo-wt", "feature", "2026-01-03T00:00:00.000Z", null, "ready"),
      ],
      snoozed: [
        thread(
          "snoozed",
          "local",
          "/repo-wt",
          "feature",
          "2026-01-02T00:00:00.000Z",
          null,
          "ready",
        ),
      ],
      settled: [thread("settled", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z")],
      drafts: [
        {
          draftId: "draft",
          threadId: ThreadId.make("draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "worktree",
          title: "future",
          baseBranch: "main",
          worktreePath: null,
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.label === "feature")).toMatchObject({
      active: [{ id: "active" }],
      snoozed: [{ id: "snoozed" }],
      conversationCount: 3,
      stateCounts: {
        working: 0,
        needsInput: 0,
        done: 2,
        stale: 0,
        settled: 1,
      },
    });
    expect(groups.find((group) => group.label === "feature")).not.toHaveProperty("settled");
    expect(groups.find((group) => group.label.startsWith("New worktree"))?.drafts).toHaveLength(1);
  });

  it("retains a settled-only worktree group for its summary and delete control", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      settled: [thread("settled", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z")],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups).toEqual([
      expect.objectContaining({
        workspaceRoot: "/repo-wt",
        projectRoot: "/repo",
        isProjectCheckout: false,
        label: "feature",
        active: [],
        snoozed: [],
        conversationCount: 1,
        stateCounts: {
          working: 0,
          needsInput: 0,
          done: 0,
          stale: 0,
          settled: 1,
        },
      }),
    ]);
    expect(groups[0]).not.toHaveProperty("settled");
  });

  it("carries the merged pull request number from the newest matching conversation", () => {
    const olderMerged = {
      ...thread("older", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z"),
      settledChangeRequestNumber: 41,
    };
    const newerMerged = {
      ...thread("newer", "local", "/repo-wt", "feature", "2026-01-02T00:00:00.000Z"),
      settledChangeRequestNumber: 42,
    };

    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      settled: [olderMerged, newerMerged],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups[0]?.mergedChangeRequestNumber).toBe(42);
  });

  it("places local drafts in the current checkout group", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      drafts: [
        {
          draftId: "local-draft",
          threadId: ThreadId.make("local-draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "local",
          title: "New conversation",
          baseBranch: "main",
          worktreePath: null,
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups).toEqual([
      expect.objectContaining({
        workspaceRoot: "/repo",
        projectRoot: "/repo",
        isProjectCheckout: true,
        label: "main",
        drafts: [expect.objectContaining({ draftId: "local-draft" })],
      }),
    ]);
  });

  it("summarizes every conversation while exposing only rendered active rows", () => {
    const visible = thread(
      "visible",
      "local",
      "/repo-wt",
      "feature",
      "2026-01-04T00:00:00.000Z",
      null,
      "ready",
    );
    const hiddenWorking = thread(
      "hidden-working",
      "local",
      "/repo-wt",
      "feature",
      "2026-01-03T00:00:00.000Z",
      "visible",
      "running",
    );

    const groups = buildSidebarWorktreeGroups({
      active: [visible, hiddenWorking],
      renderedActive: [visible],
      snoozed: [
        thread(
          "snoozed",
          "local",
          "/repo-wt",
          "feature",
          "2026-01-02T00:00:00.000Z",
          null,
          "starting",
        ),
      ],
      settled: [thread("settled", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z")],
      drafts: [
        {
          draftId: "draft",
          threadId: ThreadId.make("draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "local",
          title: "New conversation",
          baseBranch: null,
          worktreePath: null,
          createdAt: "2026-01-05T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo-wt", environmentLabel: "Local" }],
      ]),
    });

    expect(groups).toEqual([
      expect.objectContaining({
        active: [expect.objectContaining({ id: "visible" })],
        unsettled: [
          expect.objectContaining({ id: "visible" }),
          expect.objectContaining({ id: "hidden-working" }),
          expect.objectContaining({ id: "snoozed" }),
        ],
        conversationCount: 5,
        workingConversationCount: 2,
        stateCounts: {
          working: 2,
          needsInput: 0,
          done: 1,
          stale: 1,
          settled: 1,
        },
      }),
    ]);
  });

  it("renders active rows in rendered-tree order so sub-agents follow their orchestrator", () => {
    const orchestrator = thread(
      "orchestrator",
      "local",
      null,
      "main",
      "2026-01-01T00:00:00.000Z",
      null,
      "ready",
    );
    const subAgent = thread(
      "sub-agent",
      "local",
      null,
      "main",
      "2026-01-04T00:00:00.000Z",
      "orchestrator",
      "running",
    );
    const other = thread("other", "local", null, "main", "2026-01-03T00:00:00.000Z", null, "ready");

    const groups = buildSidebarWorktreeGroups({
      // Sorted order (most recent first) interleaves the sub-agent away from
      // its parent; the rendered tree order is what must survive grouping.
      active: [subAgent, other, orchestrator],
      renderedActive: [other, orchestrator, subAgent],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups[0]?.active.map((thread) => thread.id)).toEqual([
      "other",
      "orchestrator",
      "sub-agent",
    ]);
  });

  it("counts input, approvals, errored, and interrupted work independently", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [
        {
          ...thread("needs-input", "local", "/repo-wt", "feature", "2026-01-05T00:00:00.000Z"),
          hasPendingUserInput: true,
        },
        {
          ...thread("needs-approval", "local", "/repo-wt", "feature", "2026-01-04T12:00:00.000Z"),
          hasPendingApprovals: true,
        },
        thread(
          "errored",
          "local",
          "/repo-wt",
          "feature",
          "2026-01-04T00:00:00.000Z",
          null,
          "error",
        ),
        thread(
          "interrupted",
          "local",
          "/repo-wt",
          "feature",
          "2026-01-03T00:00:00.000Z",
          null,
          "interrupted",
        ),
      ],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo-wt", environmentLabel: "Local" }],
      ]),
    });

    expect(groups[0]?.stateCounts).toEqual({
      working: 0,
      needsInput: 2,
      done: 0,
      stale: 2,
      settled: 0,
    });
  });
});

describe("worktree action availability", () => {
  it("disables settlement with a visible reason when there is nothing to settle", () => {
    expect(
      resolveSidebarWorktreeSettleAction({
        conversationCount: 0,
        settlementSupported: true,
        hasBlockedConversation: false,
        isSettling: false,
        isRemoving: false,
      }),
    ).toEqual({
      enabled: false,
      disabledReason: "No conversations to settle.",
    });
  });

  it("enables settlement only when conversations are ready", () => {
    expect(
      resolveSidebarWorktreeSettleAction({
        conversationCount: 2,
        settlementSupported: true,
        hasBlockedConversation: false,
        isSettling: false,
        isRemoving: false,
      }),
    ).toEqual({ enabled: true, disabledReason: null });
  });

  it("explains why the current checkout cannot be deleted", () => {
    expect(
      resolveSidebarWorktreeDeleteAction({
        isProjectCheckout: true,
        worktreeCreated: true,
        isRemoving: false,
        isSettling: false,
      }),
    ).toEqual({
      enabled: false,
      disabledReason: "The current checkout cannot be deleted.",
    });
  });

  it("enables deletion for an idle secondary worktree", () => {
    expect(
      resolveSidebarWorktreeDeleteAction({
        isProjectCheckout: false,
        worktreeCreated: true,
        isRemoving: false,
        isSettling: false,
      }),
    ).toEqual({ enabled: true, disabledReason: null });
  });
});

describe("buildSidebarRepositoryGroups", () => {
  it("keeps equal branch labels separated under their repository", () => {
    const worktrees = buildSidebarWorktreeGroups({
      active: [
        thread(
          "ciber-main",
          "local",
          "/repos/ciber",
          "main",
          "2026-01-02T00:00:00.000Z",
          null,
          "running",
          "ciber",
        ),
        thread(
          "aqqua-main",
          "local",
          "/repos/aqqua",
          "main",
          "2026-01-01T00:00:00.000Z",
          null,
          "ready",
          "aqqua",
        ),
      ],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:ciber", { workspaceRoot: "/repos/ciber", environmentLabel: "Local" }],
        ["local:aqqua", { workspaceRoot: "/repos/aqqua", environmentLabel: "Local" }],
      ]),
    });

    const repositories = buildSidebarRepositoryGroups({
      projects: [
        {
          projectKey: "repo:ciber",
          displayName: "ciber",
          memberProjectRefs: [{ environmentId: EnvironmentId.make("local"), projectId: "ciber" }],
        },
        {
          projectKey: "repo:aqqua",
          displayName: "aqqua",
          memberProjectRefs: [{ environmentId: EnvironmentId.make("local"), projectId: "aqqua" }],
        },
        {
          projectKey: "repo:empty",
          displayName: "empty",
          memberProjectRefs: [{ environmentId: EnvironmentId.make("local"), projectId: "empty" }],
        },
      ],
      worktrees,
    });

    expect(
      repositories.map((repository) => ({
        key: repository.project.projectKey,
        branches: repository.worktrees.map((worktree) => worktree.label),
        state: repository.state,
        conversations: repository.conversationCount,
        working: repository.workingConversationCount,
      })),
    ).toEqual([
      {
        key: "repo:ciber",
        branches: ["main"],
        state: "working",
        conversations: 1,
        working: 1,
      },
      {
        key: "repo:aqqua",
        branches: ["main"],
        state: "done",
        conversations: 1,
        working: 0,
      },
      {
        key: "repo:empty",
        branches: [],
        state: "idle",
        conversations: 0,
        working: 0,
      },
    ]);
  });
});

describe("resolveSidebarProjectState", () => {
  const worktree = (
    summaryState: SidebarWorktreeGroup["summaryState"],
  ): Pick<SidebarWorktreeGroup, "summaryState"> => ({ summaryState });

  it("prioritizes failed, needs input, working, done, settled, and idle", () => {
    expect(resolveSidebarProjectState([worktree("needsInput"), worktree("failed")])).toBe("failed");
    expect(resolveSidebarProjectState([worktree("working"), worktree("needsInput")])).toBe(
      "needsInput",
    );
    expect(resolveSidebarProjectState([worktree("done"), worktree("working")])).toBe("working");
    expect(resolveSidebarProjectState([worktree("settled"), worktree("done")])).toBe("done");
    expect(resolveSidebarProjectState([worktree(null), worktree("settled")])).toBe("settled");
    expect(resolveSidebarProjectState([worktree(null)])).toBe("idle");
    expect(resolveSidebarProjectState([])).toBe("idle");
  });
});

describe("filterExpandedSidebarWorktreeGroups", () => {
  const ciberMain = { key: "ciber:main" };
  const ciberDev = { key: "ciber:dev" };
  const aqquaMain = { key: "aqqua:main" };
  const repositories = [
    { key: "ciber", worktrees: [ciberMain, ciberDev] },
    { key: "aqqua", worktrees: [aqquaMain] },
  ];

  it("omits every worktree inside a collapsed repository", () => {
    expect(
      filterExpandedSidebarWorktreeGroups({
        worktrees: [ciberMain, ciberDev, aqquaMain],
        repositories,
        repositoryHierarchyVisible: true,
        getRepositoryWorktrees: (repository) => repository.worktrees,
        isRepositoryExpanded: (repository) => repository.key !== "ciber",
        isWorktreeExpanded: () => true,
      }),
    ).toEqual([aqquaMain]);
  });

  it("omits conversations inside a collapsed worktree without repository grouping", () => {
    expect(
      filterExpandedSidebarWorktreeGroups({
        worktrees: [ciberMain, ciberDev, aqquaMain],
        repositories,
        repositoryHierarchyVisible: false,
        getRepositoryWorktrees: (repository) => repository.worktrees,
        isRepositoryExpanded: () => true,
        isWorktreeExpanded: (worktree) => worktree.key !== "ciber:dev",
      }),
    ).toEqual([ciberMain, aqquaMain]);
  });
});

describe("sidebarWorktreeHasVisibleChildren", () => {
  it("does not expose expansion for settled-only history", () => {
    expect(
      sidebarWorktreeHasVisibleChildren({
        drafts: [],
        active: [],
        snoozed: [],
      }),
    ).toBe(false);
    expect(
      sidebarWorktreeHasVisibleChildren({
        drafts: [],
        active: [{} as EnvironmentThreadShell],
        snoozed: [],
      }),
    ).toBe(true);
  });
});

describe("resolveSidebarWorktreeConversationLocation", () => {
  it("targets the project checkout without inventing a worktree path", () => {
    expect(
      resolveSidebarWorktreeConversationLocation({
        isProjectCheckout: true,
        label: "main",
        workspaceRoot: "/repos/ciber",
      }),
    ).toEqual({
      branch: "main",
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    });
  });

  it("targets an existing secondary worktree", () => {
    expect(
      resolveSidebarWorktreeConversationLocation({
        isProjectCheckout: false,
        label: "dev-22",
        workspaceRoot: "/worktrees/ciber/dev-22",
      }),
    ).toEqual({
      branch: "dev-22",
      worktreePath: "/worktrees/ciber/dev-22",
      envMode: "worktree",
      startFromOrigin: false,
    });
  });

  it("groups a draft aimed at an existing worktree into that worktree", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [thread("a", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z")],
      snoozed: [],
      drafts: [
        {
          draftId: "draft",
          threadId: ThreadId.make("draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "worktree",
          title: "second conversation",
          baseBranch: "feature",
          worktreePath: "/repo-wt",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    // Starting a second conversation in a worktree must not look like leaving
    // it for a brand-new one.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.workspaceRoot).toBe("/repo-wt");
    expect(groups[0]?.drafts.map((draft) => draft.draftId)).toEqual(["draft"]);
    expect(groups[0]?.active.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("flags a group opened by a draft aimed at the project's own checkout", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      drafts: [
        {
          draftId: "draft",
          threadId: ThreadId.make("draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "worktree",
          title: "in the checkout",
          baseBranch: "main",
          worktreePath: "/repo",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    // When a draft creates the group before any thread does, the checkout flag
    // has to be derived the same way `addThread` derives it — project checkouts
    // sort first, so a hardcoded `false` sorted the group below its position.
    expect(groups[0]?.isProjectCheckout).toBe(true);
  });

  it("still gives a worktree draft with no path its own new-worktree group", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [thread("a", "local", "/repo-wt", "feature", "2026-01-01T00:00:00.000Z")],
      snoozed: [],
      drafts: [
        {
          draftId: "draft",
          threadId: ThreadId.make("draft-thread"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          envMode: "worktree",
          title: "future",
          baseBranch: "main",
          worktreePath: null,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
      ]),
    });

    expect(groups).toHaveLength(2);
    expect(groups.some((group) => group.key.startsWith("new-worktree:"))).toBe(true);
  });

  it("does not target a not-yet-created draft worktree", () => {
    expect(
      resolveSidebarWorktreeConversationLocation({
        isProjectCheckout: false,
        label: "New worktree",
        workspaceRoot: null,
      }),
    ).toBeNull();
  });
});

describe("sidebarLocationContextMenuItems", () => {
  it("keeps worktree context menus focused on conversation creation", () => {
    expect(sidebarLocationContextMenuItems({ isProjectLocation: false })).toEqual([
      { id: "new-conversation", label: "New conversation here" },
    ]);
  });

  it("offers a new worktree from a project location", () => {
    expect(sidebarLocationContextMenuItems({ isProjectLocation: true })).toEqual([
      { id: "new-conversation", label: "New conversation here" },
      { id: "new-worktree", label: "New worktree here" },
    ]);
  });
});

describe("filterHiddenSidebarWorktreeGroups", () => {
  const settledOnly = {
    key: "local:/worktrees/ciber/dev-22",
    drafts: [],
    active: [],
    snoozed: [],
    updatedAt: Date.parse("2026-07-29T21:59:00.000Z"),
  } as unknown as SidebarWorktreeGroup;

  it("hides a settled-only worktree after successful removal", () => {
    expect(filterHiddenSidebarWorktreeGroups([settledOnly], new Set([settledOnly.key]))).toEqual(
      [],
    );
  });

  it("shows a path again when new work appears after removal", () => {
    const recreated = {
      ...settledOnly,
      active: [{}],
      updatedAt: Date.parse("2026-07-29T21:00:00.000Z"),
    } as unknown as SidebarWorktreeGroup;

    expect(filterHiddenSidebarWorktreeGroups([recreated], new Set([recreated.key]))).toEqual([
      recreated,
    ]);
  });

  it("accepts the legacy record form via filterRemovedSidebarWorktreeGroups", () => {
    expect(
      filterRemovedSidebarWorktreeGroups([settledOnly], {
        [settledOnly.key]: "2026-07-29T22:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("session error aggregates", () => {
  it("counts a session-error thread as stale even when the latest turn completed", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [
        {
          ...thread(
            "errored-done",
            "local",
            "/repo-wt",
            "feature",
            "2026-01-04T00:00:00.000Z",
            null,
            "error",
          ),
          latestTurn: {
            state: "completed",
            completedAt: "2026-01-04T00:00:00.000Z",
          },
        } as EnvironmentThreadShell,
      ],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo-wt", environmentLabel: "Local" }],
      ]),
    });

    expect(groups[0]?.stateCounts).toEqual({
      working: 0,
      needsInput: 0,
      done: 0,
      stale: 1,
      settled: 0,
    });
    // The counters still fold the failure into `stale`; the single state the
    // card and the project row show must not.
    expect(groups[0]?.summaryState).toBe("failed");
    expect(resolveSidebarProjectState(groups)).toBe("failed");
  });
});

describe("resolveSidebarWorktreeSummaryState", () => {
  const conversation = (
    overrides: Parameters<typeof resolveSidebarWorktreeSummaryState>[0]["conversations"][number],
  ) => overrides;
  const runningSession = { status: "running" as const };
  const failed = conversation({ session: { status: "error" }, latestTurn: { state: "completed" } });
  const needsInput = conversation({ hasPendingUserInput: true, session: runningSession });
  const working = conversation({ session: runningSession });
  const done = conversation({ session: null, latestTurn: { state: "completed" } });

  it("resolves failed ahead of every other state", () => {
    expect(
      resolveSidebarWorktreeSummaryState({
        conversations: [done, working, needsInput, failed],
        settledCount: 3,
      }),
    ).toBe("failed");
  });

  it("resolves needs input ahead of working and done", () => {
    expect(
      resolveSidebarWorktreeSummaryState({
        conversations: [done, working, needsInput],
        settledCount: 3,
      }),
    ).toBe("needsInput");
  });

  it("resolves working ahead of done", () => {
    expect(
      resolveSidebarWorktreeSummaryState({ conversations: [done, working], settledCount: 3 }),
    ).toBe("working");
  });

  it("resolves done ahead of settled", () => {
    expect(resolveSidebarWorktreeSummaryState({ conversations: [done], settledCount: 3 })).toBe(
      "done",
    );
  });

  it("falls back to settled only when nothing is unsettled", () => {
    expect(resolveSidebarWorktreeSummaryState({ conversations: [], settledCount: 3 })).toBe(
      "settled",
    );
  });

  it("reports no state for a worktree with nothing in it", () => {
    expect(resolveSidebarWorktreeSummaryState({ conversations: [], settledCount: 0 })).toBeNull();
  });

  it("reads a never-run conversation as done rather than failed", () => {
    expect(
      resolveSidebarWorktreeSummaryState({ conversations: [{ session: null }], settledCount: 0 }),
    ).toBe("done");
  });
});
