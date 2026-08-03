import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";
import {
  buildWorktreeDeletionPlan,
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
  isFinalWorktreeReferenceAfterDeletion,
  selectThreadsForWorktree,
  worktreeRemovalInspectionUnchanged,
} from "./worktreeCleanup";
import { WORKTREE_DELETION_BOUNDARY } from "./hooks/useThreadActions";

const localEnvironmentId = EnvironmentId.make("environment-local");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    checkpoints: [],
    activities: [],
    proposedPlans: [],
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

describe("getOrphanedWorktreePathForThread", () => {
  it("returns null when the target thread does not exist", () => {
    const result = getOrphanedWorktreePathForThread([], ThreadId.make("missing-thread"));
    expect(result).toBeNull();
  });

  it("returns null when the target thread has no worktree", () => {
    const threads = [makeThread()];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBeNull();
  });

  it("returns the path when no other thread links to that worktree", () => {
    const threads = [makeThread({ worktreePath: "/tmp/repo/worktrees/feature-a" })];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });

  it("returns null when another thread links to the same worktree", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBeNull();
  });

  it("ignores threads linked to different worktrees", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-b",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });
});

describe("formatWorktreePathForDisplay", () => {
  it("shows only the last path segment for unix-like paths", () => {
    const result = formatWorktreePathForDisplay(
      "/Users/julius/.aqqua/worktrees/aqqua-mvp/aqqua-4e609bb8",
    );
    expect(result).toBe("aqqua-4e609bb8");
  });

  it("normalizes windows separators before selecting the final segment", () => {
    const result = formatWorktreePathForDisplay(
      "C:\\Users\\julius\\.aqqua\\worktrees\\aqqua-mvp\\aqqua-4e609bb8",
    );
    expect(result).toBe("aqqua-4e609bb8");
  });

  it("uses the final segment even when outside ~/.aqqua/worktrees", () => {
    const result = formatWorktreePathForDisplay("/tmp/custom-worktrees/my-worktree");
    expect(result).toBe("my-worktree");
  });

  it("ignores trailing slashes", () => {
    const result = formatWorktreePathForDisplay("/tmp/custom-worktrees/my-worktree/");
    expect(result).toBe("my-worktree");
  });
});

describe("selectThreadsForWorktree", () => {
  it("selects every conversation for one environment and worktree path", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const matching = makeThread({
      id: ThreadId.make("matching"),
      worktreePath: "/tmp/worktrees/feature-a",
    });
    const anotherConversation = makeThread({
      id: ThreadId.make("another-conversation"),
      worktreePath: "/tmp/worktrees/feature-a/",
    });
    const anotherWorktree = makeThread({
      id: ThreadId.make("another-worktree"),
      worktreePath: "/tmp/worktrees/feature-b",
    });
    const anotherEnvironment = makeThread({
      id: ThreadId.make("another-environment"),
      environmentId: remoteEnvironmentId,
      worktreePath: "/tmp/worktrees/feature-a",
    });

    expect(
      selectThreadsForWorktree({
        environmentId: localEnvironmentId,
        worktreePath: "/tmp/worktrees/feature-a",
        threads: [matching, anotherConversation, anotherWorktree, anotherEnvironment],
      }).map((thread) => thread.id),
    ).toEqual([ThreadId.make("matching"), ThreadId.make("another-conversation")]);
  });
});

describe("WORKTREE_DELETION_BOUNDARY", () => {
  it("documents a single server-owned operation instead of client sequential deletes", () => {
    expect(WORKTREE_DELETION_BOUNDARY).toEqual({
      membership: "server-at-execution-time",
      threadDelete: "server-thread-delete",
      worktreeRemoval: "server-after-thread-delete",
      localBranchRemoval: "server-after-worktree-removal",
    });
    expect(WORKTREE_DELETION_BOUNDARY.membership).not.toBe("client-snapshot");
    expect(WORKTREE_DELETION_BOUNDARY.threadDelete).not.toBe("client-sequential-roots");
  });
});

describe("buildWorktreeDeletionPlan", () => {
  it("offers the sole active reference", () => {
    const target = makeThread({ worktreePath: "/tmp/worktrees/only" });
    const plan = buildWorktreeDeletionPlan({
      targets: [target],
      threads: [target],
      projects: [
        {
          environmentId: localEnvironmentId,
          id: target.projectId,
          workspaceRoot: "/tmp/repo",
        },
      ],
      completeEnvironmentIds: new Set([localEnvironmentId]),
    });

    expect(plan.candidates.map((candidate) => candidate.path)).toEqual(["/tmp/worktrees/only"]);
  });

  it("offers one worktree only when every active and archived reference is selected", () => {
    const target = makeThread({
      id: ThreadId.make("thread-active"),
      worktreePath: "/tmp/worktrees/shared",
    });
    const archived = makeThread({
      id: ThreadId.make("thread-archived"),
      worktreePath: "/tmp/worktrees/shared",
      archivedAt: "2026-02-14T00:00:00.000Z",
    });
    const projects = [
      {
        environmentId: localEnvironmentId,
        id: ProjectId.make("project-1"),
        workspaceRoot: "/tmp/repo",
      },
    ];

    expect(
      buildWorktreeDeletionPlan({
        targets: [target],
        threads: [target, archived],
        projects,
        completeEnvironmentIds: new Set([localEnvironmentId]),
      }).candidates,
    ).toEqual([]);

    expect(
      buildWorktreeDeletionPlan({
        targets: [target, archived],
        threads: [target, archived],
        projects,
        completeEnvironmentIds: new Set([localEnvironmentId]),
      }).candidates,
    ).toEqual([
      {
        key: `${localEnvironmentId}\u001f/tmp/worktrees/shared`,
        environmentId: localEnvironmentId,
        projectCwd: "/tmp/repo",
        path: "/tmp/worktrees/shared",
        displayPath: "shared",
      },
    ]);
  });

  it("blocks cleanup when the environment reference catalog is incomplete", () => {
    const target = makeThread({ worktreePath: "/tmp/worktrees/unverifiable" });
    const plan = buildWorktreeDeletionPlan({
      targets: [target],
      threads: [target],
      projects: [
        {
          environmentId: localEnvironmentId,
          id: ProjectId.make("project-1"),
          workspaceRoot: "/tmp/repo",
        },
      ],
      completeEnvironmentIds: new Set(),
    });

    expect(plan.candidates).toEqual([]);
    expect(plan.hasUnverifiableWorktrees).toBe(true);
  });

  it("offers an archived thread when it is the final reference", () => {
    const archived = makeThread({
      id: ThreadId.make("archived-only"),
      worktreePath: "/tmp/worktrees/archived-only",
      archivedAt: "2026-02-14T00:00:00.000Z",
    });
    const plan = buildWorktreeDeletionPlan({
      targets: [archived],
      threads: [archived],
      projects: [
        {
          environmentId: localEnvironmentId,
          id: archived.projectId,
          workspaceRoot: "/tmp/repo",
        },
      ],
      completeEnvironmentIds: new Set([localEnvironmentId]),
    });

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.displayPath).toBe("archived-only");
  });

  it("keeps project and environment candidates separate while deduplicating shared paths", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const projectTwo = ProjectId.make("project-2");
    const localA = makeThread({
      id: ThreadId.make("local-a"),
      worktreePath: "/tmp/worktrees/shared",
    });
    const localB = makeThread({
      id: ThreadId.make("local-b"),
      worktreePath: "/tmp/worktrees/shared",
    });
    const remote = makeThread({
      id: ThreadId.make("remote"),
      environmentId: remoteEnvironmentId,
      projectId: projectTwo,
      worktreePath: "/tmp/worktrees/shared",
    });
    const plan = buildWorktreeDeletionPlan({
      targets: [localA, localB, remote],
      threads: [localA, localB, remote],
      projects: [
        {
          environmentId: localEnvironmentId,
          id: localA.projectId,
          workspaceRoot: "/tmp/local-repo",
        },
        {
          environmentId: remoteEnvironmentId,
          id: projectTwo,
          workspaceRoot: "/tmp/remote-repo",
        },
      ],
      completeEnvironmentIds: new Set([localEnvironmentId, remoteEnvironmentId]),
    });

    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates.map((candidate) => candidate.projectCwd)).toEqual([
      "/tmp/local-repo",
      "/tmp/remote-repo",
    ]);
  });
});

describe("worktree deletion execution safeguards", () => {
  it("only reaches the final shared reference after prior deletions succeed", () => {
    const first = makeThread({
      id: ThreadId.make("first"),
      worktreePath: "/tmp/worktrees/shared",
    });
    const second = makeThread({
      id: ThreadId.make("second"),
      worktreePath: "/tmp/worktrees/shared",
    });
    const candidate = {
      key: `${localEnvironmentId}\u001f/tmp/worktrees/shared`,
      environmentId: localEnvironmentId,
      projectCwd: "/tmp/repo",
      path: "/tmp/worktrees/shared",
      displayPath: "shared",
    };

    expect(
      isFinalWorktreeReferenceAfterDeletion({
        candidate,
        current: first,
        catalogThreads: [first, second],
        deletedThreadKeys: new Set(),
      }),
    ).toBe(false);
    expect(
      isFinalWorktreeReferenceAfterDeletion({
        candidate,
        current: second,
        catalogThreads: [first, second],
        deletedThreadKeys: new Set([`${localEnvironmentId}:first`]),
      }),
    ).toBe(true);
  });

  it("rejects a smart-default removal when HEAD or safety state changes", () => {
    const inspected = {
      availability: "available",
      refName: "feature/work",
      headCommit: "abc",
      baseRef: "main",
      mergeStatus: "merged",
      workingTreeStatus: "clean",
    } as const;

    expect(worktreeRemovalInspectionUnchanged(inspected, inspected)).toBe(true);
    expect(
      worktreeRemovalInspectionUnchanged(inspected, {
        ...inspected,
        headCommit: "def",
      }),
    ).toBe(false);
    expect(
      worktreeRemovalInspectionUnchanged(inspected, {
        ...inspected,
        workingTreeStatus: "dirty",
      }),
    ).toBe(false);
  });
});
