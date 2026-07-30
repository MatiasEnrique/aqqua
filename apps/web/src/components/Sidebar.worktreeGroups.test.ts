import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  buildSidebarRepositoryGroups,
  buildSidebarWorktreeGroups,
  filterExpandedSidebarWorktreeGroups,
  filterRemovedSidebarWorktreeGroups,
  resolveSidebarWorktreeDeleteAction,
  resolveSidebarWorktreeConversationLocation,
  resolveSidebarWorktreeSettleAction,
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
          environmentId: "local",
          projectId: "project",
          envMode: "worktree",
          title: "future",
          baseBranch: "main",
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

  it("places local drafts in the current checkout group", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      drafts: [
        {
          draftId: "local-draft",
          environmentId: "local",
          projectId: "project",
          envMode: "local",
          title: "New conversation",
          baseBranch: "main",
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
          environmentId: "local",
          projectId: "project",
          envMode: "local",
          title: "New conversation",
          baseBranch: null,
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
          "t3-main",
          "local",
          "/repos/t3code",
          "main",
          "2026-01-01T00:00:00.000Z",
          null,
          "ready",
          "t3code",
        ),
      ],
      snoozed: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:ciber", { workspaceRoot: "/repos/ciber", environmentLabel: "Local" }],
        ["local:t3code", { workspaceRoot: "/repos/t3code", environmentLabel: "Local" }],
      ]),
    });

    const repositories = buildSidebarRepositoryGroups({
      projects: [
        {
          projectKey: "repo:ciber",
          displayName: "ciber",
          memberProjectRefs: [{ environmentId: "local", projectId: "ciber" }],
        },
        {
          projectKey: "repo:t3code",
          displayName: "t3code",
          memberProjectRefs: [{ environmentId: "local", projectId: "t3code" }],
        },
        {
          projectKey: "repo:empty",
          displayName: "empty",
          memberProjectRefs: [{ environmentId: "local", projectId: "empty" }],
        },
      ],
      worktrees,
    });

    expect(
      repositories.map((repository) => ({
        key: repository.project.projectKey,
        branches: repository.worktrees.map((worktree) => worktree.label),
        conversations: repository.conversationCount,
        working: repository.workingConversationCount,
      })),
    ).toEqual([
      { key: "repo:ciber", branches: ["main"], conversations: 1, working: 1 },
      { key: "repo:t3code", branches: ["main"], conversations: 1, working: 0 },
      { key: "repo:empty", branches: [], conversations: 0, working: 0 },
    ]);
  });
});

describe("filterExpandedSidebarWorktreeGroups", () => {
  const ciberMain = { key: "ciber:main" };
  const ciberDev = { key: "ciber:dev" };
  const t3Main = { key: "t3code:main" };
  const repositories = [
    { key: "ciber", worktrees: [ciberMain, ciberDev] },
    { key: "t3code", worktrees: [t3Main] },
  ];

  it("omits every worktree inside a collapsed repository", () => {
    expect(
      filterExpandedSidebarWorktreeGroups({
        worktrees: [ciberMain, ciberDev, t3Main],
        repositories,
        repositoryHierarchyVisible: true,
        getRepositoryWorktrees: (repository) => repository.worktrees,
        isRepositoryExpanded: (repository) => repository.key !== "ciber",
        isWorktreeExpanded: () => true,
      }),
    ).toEqual([t3Main]);
  });

  it("omits conversations inside a collapsed worktree without repository grouping", () => {
    expect(
      filterExpandedSidebarWorktreeGroups({
        worktrees: [ciberMain, ciberDev, t3Main],
        repositories,
        repositoryHierarchyVisible: false,
        getRepositoryWorktrees: (repository) => repository.worktrees,
        isRepositoryExpanded: () => true,
        isWorktreeExpanded: (worktree) => worktree.key !== "ciber:dev",
      }),
    ).toEqual([ciberMain, t3Main]);
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

describe("filterRemovedSidebarWorktreeGroups", () => {
  const removedAt = "2026-07-29T22:00:00.000Z";
  const settledOnly = {
    key: "local:/worktrees/ciber/dev-22",
    drafts: [],
    active: [],
    snoozed: [],
    updatedAt: Date.parse("2026-07-29T21:59:00.000Z"),
  } as unknown as SidebarWorktreeGroup;

  it("hides a settled-only worktree after successful removal", () => {
    expect(
      filterRemovedSidebarWorktreeGroups([settledOnly], {
        [settledOnly.key]: removedAt,
      }),
    ).toEqual([]);
  });

  it("shows a path again when new work appears after removal", () => {
    const recreated = {
      ...settledOnly,
      active: [{}],
      updatedAt: Date.parse("2026-07-29T21:00:00.000Z"),
    } as unknown as SidebarWorktreeGroup;

    expect(
      filterRemovedSidebarWorktreeGroups([recreated], {
        [recreated.key]: removedAt,
      }),
    ).toEqual([recreated]);
  });
});
