import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  GitObjectId,
  VcsCreateWorktreeInput,
  VcsDeleteWorktreeInput,
  VcsDeleteWorktreeResult,
  VcsGetCommitDiffInput,
  VcsGetCommitDiffResult,
  VcsGetCommitFileDiffInput,
  VcsGetCommitFileDiffResult,
  VcsGetCommitDetailsResult,
  VcsInspectWorktreeRemovalResult,
  VcsListHistoryInput,
  VcsListHistoryResult,
  GitPreparePullRequestThreadInput,
  GitGetChangeRequestChecksResult,
  GitGetChangeRequestMergeOptionsResult,
  GitMergeChangeRequestInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
  GitSetAutoMergeInput,
  GitUpdateChangeRequestStateInput,
  VcsStatusRemoteResult,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodeGitObjectId = Schema.decodeUnknownSync(GitObjectId);
const decodeListHistoryInput = Schema.decodeUnknownSync(VcsListHistoryInput);
const decodeListHistoryResult = Schema.decodeUnknownSync(VcsListHistoryResult);
const decodeCommitDetailsResult = Schema.decodeUnknownSync(VcsGetCommitDetailsResult);
const decodeCommitDiffInput = Schema.decodeUnknownSync(VcsGetCommitDiffInput);
const decodeCommitDiffResult = Schema.decodeUnknownSync(VcsGetCommitDiffResult);
const decodeCommitFileDiffInput = Schema.decodeUnknownSync(VcsGetCommitFileDiffInput);
const decodeCommitFileDiffResult = Schema.decodeUnknownSync(VcsGetCommitFileDiffResult);
const decodeInspectWorktreeRemovalResult = Schema.decodeUnknownSync(
  VcsInspectWorktreeRemovalResult,
);
const decodeDeleteWorktreeInput = Schema.decodeUnknownSync(VcsDeleteWorktreeInput);
const decodeDeleteWorktreeResult = Schema.decodeUnknownSync(VcsDeleteWorktreeResult);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeMergeOptionsResult = Schema.decodeUnknownSync(GitGetChangeRequestMergeOptionsResult);
const decodeChangeRequestChecksResult = Schema.decodeUnknownSync(GitGetChangeRequestChecksResult);
const decodeMergeChangeRequestInput = Schema.decodeUnknownSync(GitMergeChangeRequestInput);
const decodeSetAutoMergeInput = Schema.decodeUnknownSync(GitSetAutoMergeInput);
const decodeUpdateChangeRequestStateInput = Schema.decodeUnknownSync(
  GitUpdateChangeRequestStateInput,
);
const decodeVcsStatusRemoteResult = Schema.decodeUnknownSync(VcsStatusRemoteResult);

describe("VcsCreateWorktreeInput", () => {
  it("accepts omitted newRefName for existing-refName worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newRefName).toBeUndefined();
    expect(parsed.refName).toBe("feature/existing");
  });

  it("accepts baseRefName metadata for a new worktree ref", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "0123456789abcdef",
      newRefName: "feature/new",
      baseRefName: "origin/main",
      path: "/tmp/worktree",
    });

    expect(parsed.baseRefName).toBe("origin/main");
  });
});

describe("Git history contracts", () => {
  const sha1 = "0123456789abcdef0123456789abcdef01234567";
  const sha256 = `${sha1}0123456789abcdef01234567`;

  it("accepts full SHA-1 and SHA-256 object ids", () => {
    expect(decodeGitObjectId(sha1)).toBe(sha1);
    expect(decodeGitObjectId(sha256)).toBe(sha256);
  });

  it("rejects abbreviated, non-hex, uppercase, and option-like object ids", () => {
    for (const candidate of ["0123456", `${sha1}z`, sha1.toUpperCase(), "--all"]) {
      expect(() => decodeGitObjectId(candidate)).toThrow();
    }
  });

  it("enforces history pagination limits and opaque cursors", () => {
    const opaqueCursor = "v1.eyJ2IjoxLCJ0aXBzIjpbXSwic2tpcCI6MH0";
    expect(decodeListHistoryInput({ cwd: "/repo" })).toEqual({ cwd: "/repo" });
    expect(
      decodeListHistoryInput({
        cwd: "/repo",
        cursor: opaqueCursor,
        includeOrigin: true,
        limit: 200,
      }),
    ).toEqual({
      cwd: "/repo",
      cursor: opaqueCursor,
      includeOrigin: true,
      limit: 200,
    });
    expect(() => decodeListHistoryInput({ cwd: "/repo", limit: 201 })).toThrow();
    expect(() => decodeListHistoryInput({ cwd: "/repo", cursor: 100 })).toThrow();
    expect(() => decodeListHistoryInput({ cwd: "/repo", cursor: "" })).toThrow();
    expect(() => decodeListHistoryInput({ cwd: "/repo", cursor: " ".repeat(3) })).toThrow();
  });

  it("decodes commit summaries and file details", () => {
    const opaqueCursor = "v1.next-page-token";
    expect(
      decodeListHistoryResult({
        commits: [
          {
            id: sha1,
            parentIds: [],
            subject: "Initial commit",
            authorName: "Ada",
            authorEmail: "ada@example.com",
            authoredAt: "2026-07-29T12:00:00Z",
            committedAt: "2026-07-29T12:01:00Z",
            isHead: true,
            refs: [{ name: "main", kind: "local_branch", current: true }],
          },
        ],
        isRepo: true,
        nextCursor: opaqueCursor,
        referencesTruncated: false,
      }),
    ).toMatchObject({
      nextCursor: opaqueCursor,
      commits: [{ refs: [{ name: "main", kind: "local_branch", current: true }] }],
    });

    expect(
      decodeListHistoryResult({
        commits: [
          {
            id: sha1,
            parentIds: [],
            subject: "Initial commit",
            authorName: "Ada",
            authorEmail: "ada@example.com",
            authoredAt: "2026-07-29T12:00:00Z",
            committedAt: "2026-07-29T12:01:00Z",
            isHead: true,
            refs: [{ name: "main", kind: "local_branch", current: true }],
          },
        ],
        isRepo: true,
        nextCursor: null,
        referencesTruncated: false,
      }).commits[0]?.refs[0],
    ).toEqual({ name: "main", kind: "local_branch", current: true });

    expect(
      decodeCommitDetailsResult({
        commitId: sha1,
        committerName: "Grace",
        committerEmail: "grace@example.com",
        committedAt: "2026-07-29T12:01:00Z",
        body: "Details",
        bodyTruncated: false,
        comparisonParentId: null,
        files: [
          {
            path: "image.png",
            previousPath: null,
            kind: "added",
            insertions: null,
            deletions: null,
            binary: true,
          },
        ],
        filesTruncated: false,
      }),
    ).toMatchObject({
      files: [{ kind: "added", binary: true, insertions: null, deletions: null }],
    });

    expect(
      decodeCommitFileDiffInput({
        cwd: "/repo",
        commitId: sha1,
        path: "src/é\tfile.ts",
        previousPath: null,
      }),
    ).toMatchObject({ path: "src/é\tfile.ts", previousPath: null });
    expect(
      decodeCommitFileDiffResult({
        commitId: sha1,
        path: "src/é\tfile.ts",
        diff: "diff --git ...",
        truncated: true,
      }),
    ).toMatchObject({ path: "src/é\tfile.ts", diff: "diff --git ...", truncated: true });

    expect(decodeCommitDiffInput({ cwd: "/repo", commitId: sha1 })).toEqual({
      cwd: "/repo",
      commitId: sha1,
    });
    expect(
      decodeCommitDiffResult({
        commitId: sha1,
        diff: "diff --git a/one.ts b/one.ts\ndiff --git a/two.ts b/two.ts\n",
        truncated: false,
      }),
    ).toMatchObject({
      commitId: sha1,
      diff: "diff --git a/one.ts b/one.ts\ndiff --git a/two.ts b/two.ts\n",
      truncated: false,
    });
  });
});

describe("VcsDeleteWorktreeResult", () => {
  it("decodes archived conversation roots from worktree deletion", () => {
    const parsed = decodeDeleteWorktreeResult({
      status: "completed",
      archivedThreadIds: ["thread-1", "thread-2"],
      worktreeRemoval: "removed",
    });
    expect(parsed).toEqual({
      status: "completed",
      archivedThreadIds: ["thread-1", "thread-2"],
      worktreeRemoval: "removed",
    });
  });

  it("decodes a partial retryable worktree-stage failure with filesystem outcome", () => {
    const parsed = decodeDeleteWorktreeResult({
      status: "partial",
      stage: "worktree",
      archivedThreadIds: ["thread-1"],
      retryable: true,
      detail: "git worktree remove failed",
      worktreeRemoval: "failed",
    });
    expect(parsed.status).toBe("partial");
    if (parsed.status === "partial") {
      expect(parsed.stage).toBe("worktree");
      expect(parsed.retryable).toBe(true);
      expect(parsed.worktreeRemoval).toBe("failed");
    }
  });

  it("decodes a partial post-remove conversation failure with worktree already removed", () => {
    const parsed = decodeDeleteWorktreeResult({
      status: "partial",
      stage: "conversation",
      archivedThreadIds: ["thread-1"],
      retryable: true,
      detail: "straggler archive rejected",
      worktreeRemoval: "removed",
    });
    expect(parsed).toMatchObject({
      status: "partial",
      stage: "conversation",
      worktreeRemoval: "removed",
    });
  });

  it("accepts optional worktree force and explicit local-branch deletion", () => {
    expect(
      decodeDeleteWorktreeInput({
        cwd: "/repo",
        path: "/repo/worktrees/feature",
        force: true,
        deleteBranch: true,
      }),
    ).toEqual({
      cwd: "/repo",
      path: "/repo/worktrees/feature",
      force: true,
      deleteBranch: true,
    });
  });

  it("decodes stale-worktree cleanup and branch-deletion outcomes", () => {
    expect(
      decodeDeleteWorktreeResult({
        status: "completed",
        archivedThreadIds: ["thread-1"],
        worktreeRemoval: "already_missing",
        preservedUnverifiedPath: true,
        branchRemoval: "unavailable",
      }),
    ).toMatchObject({
      status: "completed",
      worktreeRemoval: "already_missing",
      preservedUnverifiedPath: true,
      branchRemoval: "unavailable",
    });
    expect(
      decodeDeleteWorktreeResult({
        status: "partial",
        stage: "branch",
        archivedThreadIds: ["thread-1"],
        retryable: false,
        detail: "branch changed",
        worktreeRemoval: "removed",
        branchRemoval: "failed",
      }),
    ).toMatchObject({
      status: "partial",
      stage: "branch",
      branchRemoval: "failed",
    });
  });
});

describe("VcsInspectWorktreeRemovalResult", () => {
  it("preserves conservative availability, merge, and working-tree states", () => {
    const parsed = decodeInspectWorktreeRemovalResult({
      availability: "available",
      refName: "feature/delete-dialog",
      headCommit: "0123456789abcdef",
      baseRef: "origin/main",
      mergeStatus: "unmerged",
      workingTreeStatus: "dirty",
    });

    expect(parsed).toEqual({
      availability: "available",
      refName: "feature/delete-dialog",
      headCommit: "0123456789abcdef",
      baseRef: "origin/main",
      mergeStatus: "unmerged",
      workingTreeStatus: "dirty",
    });
  });

  it("allows unverifiable and missing worktrees without inventing Git state", () => {
    const parsed = decodeInspectWorktreeRemovalResult({
      availability: "missing",
      refName: null,
      headCommit: null,
      baseRef: null,
      mergeStatus: "unknown",
      workingTreeStatus: "unknown",
    });

    expect(parsed.availability).toBe("missing");
    expect(parsed.mergeStatus).toBe("unknown");
    expect(parsed.workingTreeStatus).toBe("unknown");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("change request mutation contracts", () => {
  it("decodes repository merge options and requires a supported default", () => {
    expect(
      decodeMergeOptionsResult({
        methods: ["merge", "squash"],
        defaultMethod: "squash",
        autoMergeSupported: true,
        autoMergeEnabled: null,
      }),
    ).toEqual({
      methods: ["merge", "squash"],
      defaultMethod: "squash",
      autoMergeSupported: true,
      autoMergeEnabled: null,
    });
    expect(() =>
      decodeMergeOptionsResult({
        methods: [],
        defaultMethod: "merge",
        autoMergeSupported: false,
        autoMergeEnabled: null,
      }),
    ).toThrow();
    expect(() =>
      decodeMergeOptionsResult({
        methods: ["squash"],
        defaultMethod: "merge",
        autoMergeSupported: false,
        autoMergeEnabled: true,
      }),
    ).toThrow();
  });

  it("accepts the generic merge methods", () => {
    for (const method of ["merge", "squash", "rebase"] as const) {
      expect(decodeMergeChangeRequestInput({ cwd: "/repo", reference: "#42", method })).toEqual({
        cwd: "/repo",
        reference: "#42",
        method,
      });
    }
  });

  it("requires a method when enabling auto-merge and omits it when disabling", () => {
    expect(
      decodeSetAutoMergeInput({
        cwd: "/repo",
        reference: "#42",
        enabled: true,
        method: "squash",
      }),
    ).toMatchObject({ enabled: true, method: "squash" });
    expect(
      decodeSetAutoMergeInput({ cwd: "/repo", reference: "#42", enabled: false }),
    ).toMatchObject({ enabled: false });
    expect(() =>
      decodeSetAutoMergeInput({ cwd: "/repo", reference: "#42", enabled: true }),
    ).toThrow();
  });

  it("limits state updates to close and reopen", () => {
    expect(
      decodeUpdateChangeRequestStateInput({
        cwd: "/repo",
        reference: "#42",
        state: "closed",
      }).state,
    ).toBe("closed");
    expect(
      decodeUpdateChangeRequestStateInput({
        cwd: "/repo",
        reference: "#42",
        state: "open",
      }).state,
    ).toBe("open");
    expect(() =>
      decodeUpdateChangeRequestStateInput({
        cwd: "/repo",
        reference: "#42",
        state: "merged",
      }),
    ).toThrow();
  });
});

describe("VcsStatusRemoteResult", () => {
  const remote = {
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "CI status",
      url: "https://github.com/pingdotgg/aqqua/pull/42",
      baseRef: "main",
      headRef: "feature/checks",
      state: "open",
    },
  } as const;

  it("decodes checks status when supplied", () => {
    const parsed = decodeVcsStatusRemoteResult({
      ...remote,
      pr: { ...remote.pr, checksStatus: "pending" },
    });

    expect(parsed.pr?.checksStatus).toBe("pending");
  });

  it("keeps checks status optional for older server payloads", () => {
    const parsed = decodeVcsStatusRemoteResult(remote);

    expect(parsed.pr?.checksStatus).toBeUndefined();
  });
});

describe("GitGetChangeRequestChecksResult", () => {
  it("decodes supported per-check details", () => {
    expect(
      decodeChangeRequestChecksResult({
        supported: true,
        checks: [
          {
            name: "unit tests",
            status: "failure",
            detailsUrl: "https://example.test/checks/1",
          },
          { name: "optional lint", status: "neutral" },
          { name: "docs", status: "skipped" },
        ],
      }),
    ).toEqual({
      supported: true,
      checks: [
        {
          name: "unit tests",
          status: "failure",
          detailsUrl: "https://example.test/checks/1",
        },
        { name: "optional lint", status: "neutral" },
        { name: "docs", status: "skipped" },
      ],
    });
  });

  it("distinguishes an unsupported provider from a supported provider with no checks", () => {
    expect(decodeChangeRequestChecksResult({ supported: false, checks: [] })).toEqual({
      supported: false,
      checks: [],
    });
    expect(decodeChangeRequestChecksResult({ supported: true, checks: [] })).toEqual({
      supported: true,
      checks: [],
    });
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});
