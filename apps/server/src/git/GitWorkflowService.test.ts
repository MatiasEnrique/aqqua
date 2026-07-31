import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as GitManager from "./GitManager.ts";
import * as GitHistory from "./GitHistory.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

function makeLayer(input: {
  readonly detect: VcsDriverRegistry.VcsDriverRegistry["Service"]["detect"];
}) {
  return GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: input.detect,
      }),
    ),
    Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
    Layer.provide(Layer.mock(GitHistory.GitHistory)({})),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
  );
}

describe("GitWorkflowService", () => {
  it.effect("returns an empty local status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.localStatus({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty full status when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const status = yield* workflow.status({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(status, {
        isRepo: false,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: null,
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 0,
        pr: null,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("does not call GitManager status methods when no VCS repository is detected", () => {
    const localStatus = vi.fn();
    const remoteStatus = vi.fn();
    const status = vi.fn();

    const testLayer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(GitHistory.GitHistory)({})),
      Layer.provide(
        Layer.mock(GitManager.GitManager)({
          localStatus,
          remoteStatus,
          status,
        }),
      ),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      yield* workflow.localStatus({ cwd: "/not-a-repo" });
      yield* workflow.remoteStatus({ cwd: "/not-a-repo" });
      yield* workflow.status({ cwd: "/not-a-repo" });

      assert.equal(localStatus.mock.calls.length, 0);
      assert.equal(remoteStatus.mock.calls.length, 0);
      assert.equal(status.mock.calls.length, 0);
    }).pipe(Effect.provide(testLayer));
  });

  it.effect("returns an empty ref list when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const refs = yield* workflow.listRefs({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(refs, {
        refs: [],
        isRepo: false,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 0,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("returns an empty history when no VCS repository is detected", () =>
    Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const history = yield* workflow.listHistory({ cwd: "/not-a-repo" });

      assert.deepStrictEqual(history, {
        commits: [],
        isRepo: false,
        nextCursor: null,
        referencesTruncated: false,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.succeed(null),
        }),
      ),
    ),
  );

  it.effect("delegates commit details after detecting Git", () => {
    const commitId = "0123456789abcdef0123456789abcdef01234567" as const;
    const getDetails = vi.fn(() =>
      Effect.succeed({
        commitId,
        committerName: "Test",
        committerEmail: "test@example.com",
        committedAt: "2026-07-29T12:00:00Z",
        body: "",
        bodyTruncated: false,
        comparisonParentId: null,
        files: [],
        filesTruncated: false,
      }),
    );
    const layer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () =>
            Effect.succeed({
              kind: "git",
            } as never),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(GitHistory.GitHistory)({ getDetails })),
      Layer.provide(Layer.mock(GitManager.GitManager)({})),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const result = yield* workflow.getCommitDetails({ cwd: "/repo", commitId });

      assert.equal(result.commitId, commitId);
      assert.equal(getDetails.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("delegates a selected commit file diff after detecting Git", () => {
    const commitId = "0123456789abcdef0123456789abcdef01234567" as const;
    const getFileDiff = vi.fn(() =>
      Effect.succeed({ commitId, path: "README.md", diff: "patch", truncated: false }),
    );
    const layer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed({ kind: "git" } as never),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(GitHistory.GitHistory)({ getFileDiff })),
      Layer.provide(Layer.mock(GitManager.GitManager)({})),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const result = yield* workflow.getCommitFileDiff({
        cwd: "/repo",
        commitId,
        path: "README.md",
        previousPath: null,
      });

      assert.equal(result.diff, "patch");
      assert.equal(getFileDiff.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects commit details when no repository is detected", () => {
    const getDetails = vi.fn();
    const layer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          detect: () => Effect.succeed(null),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(GitHistory.GitHistory)({ getDetails })),
      Layer.provide(Layer.mock(GitManager.GitManager)({})),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* Effect.flip(
        workflow.getCommitDetails({
          cwd: "/not-a-repo",
          commitId: "0123456789abcdef0123456789abcdef01234567",
        }),
      );

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.getCommitDetails",
        command: "vcs-route",
        cwd: "/not-a-repo",
        detail: "No Git repository was detected for the selected commit.",
      });
      assert.equal(getDetails.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("structures workflow detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.status({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitManagerError",
        operation: "GitWorkflowService.status",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git workflow.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("structures command detection failures without exposing upstream details", () => {
    const cause = new VcsRepositoryDetectionError({
      operation: "VcsDriverRegistry.detect",
      cwd: "/repo",
      detail: "upstream command detail must stay in the cause chain",
    });

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const error = yield* workflow.listRefs({ cwd: "/repo" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "GitCommandError",
        operation: "GitWorkflowService.listRefs",
        command: "vcs-route",
        cwd: "/repo",
        detail: "Failed to detect a VCS repository for this Git command.",
      });
      expect(error.message).not.toContain(cause.detail);
    }).pipe(
      Effect.provide(
        makeLayer({
          detect: () => Effect.fail(cause),
        }),
      ),
    );
  });

  it.effect("routes worktree-removal inspection through the Git driver", () => {
    const inspectWorktreeRemoval = vi.fn(() =>
      Effect.succeed({
        availability: "available" as const,
        refName: "feature/work",
        headCommit: "abc123",
        baseRef: "main",
        mergeStatus: "merged" as const,
        workingTreeStatus: "clean" as const,
      }),
    );
    const layer = GitWorkflowService.layer.pipe(
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          resolve: () =>
            Effect.succeed({
              kind: "git",
            } as VcsDriverRegistry.VcsDriverHandle),
        }),
      ),
      Layer.provide(
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          inspectWorktreeRemoval,
        }),
      ),
      Layer.provide(Layer.mock(GitHistory.GitHistory)({})),
      Layer.provide(Layer.mock(GitManager.GitManager)({})),
    );

    return Effect.gen(function* () {
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const result = yield* workflow.inspectWorktreeRemoval({
        cwd: "/repo",
        path: "/repo-worktree",
      });

      expect(result.mergeStatus).toBe("merged");
      expect(inspectWorktreeRemoval).toHaveBeenCalledWith({
        cwd: "/repo",
        path: "/repo-worktree",
      });
    }).pipe(Effect.provide(layer));
  });
});
