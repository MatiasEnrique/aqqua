import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { buildSidebarWorktreeGroups } from "./Sidebar.worktreeGroups";

const thread = (
  id: string,
  environmentId: string,
  worktreePath: string | null,
  branch: string,
  updatedAt: string,
  parentThreadId: string | null = null,
): EnvironmentThreadShell =>
  ({
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make(environmentId),
    projectId: ProjectId.make("project"),
    worktreePath,
    branch,
    updatedAt,
    parentThreadId: parentThreadId ? ThreadId.make(parentThreadId) : null,
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
      settled: [],
      drafts: [],
      projectsByKey: new Map([
        ["local:project", { workspaceRoot: "/repo", environmentLabel: "Local" }],
        ["remote:project", { workspaceRoot: "/repo", environmentLabel: "Remote" }],
      ]),
    });

    expect(groups.map((group) => group.label)).toEqual(["main", "remote-branch", "feature"]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });

  it("keeps lifecycle sections and new worktree drafts inside each group", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [thread("active", "local", "/repo-wt", "feature", "2026-01-03T00:00:00.000Z")],
      snoozed: [thread("snoozed", "local", "/repo-wt", "feature", "2026-01-02T00:00:00.000Z")],
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
      settled: [{ id: "settled" }],
    });
    expect(groups.find((group) => group.label.startsWith("New worktree"))?.drafts).toHaveLength(1);
  });

  it("places local drafts in the current checkout group", () => {
    const groups = buildSidebarWorktreeGroups({
      active: [],
      snoozed: [],
      settled: [],
      drafts: [
        {
          draftId: "local-draft",
          environmentId: "local",
          projectId: "project",
          envMode: "local",
          title: "New conversation",
          baseBranch: null,
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
        isProjectCheckout: true,
        drafts: [expect.objectContaining({ draftId: "local-draft" })],
      }),
    ]);
  });
});
