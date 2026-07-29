import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  GitObjectId,
  VcsCreateWorktreeInput,
  VcsGetCommitDetailsResult,
  VcsInspectWorktreeRemovalResult,
  VcsListHistoryInput,
  VcsListHistoryResult,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodeGitObjectId = Schema.decodeUnknownSync(GitObjectId);
const decodeListHistoryInput = Schema.decodeUnknownSync(VcsListHistoryInput);
const decodeListHistoryResult = Schema.decodeUnknownSync(VcsListHistoryResult);
const decodeCommitDetailsResult = Schema.decodeUnknownSync(VcsGetCommitDetailsResult);
const decodeInspectWorktreeRemovalResult = Schema.decodeUnknownSync(
  VcsInspectWorktreeRemovalResult,
);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);

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

  it("enforces history pagination limits", () => {
    expect(decodeListHistoryInput({ cwd: "/repo" })).toEqual({ cwd: "/repo" });
    expect(decodeListHistoryInput({ cwd: "/repo", cursor: 100, limit: 200 })).toEqual({
      cwd: "/repo",
      cursor: 100,
      limit: 200,
    });
    expect(() => decodeListHistoryInput({ cwd: "/repo", limit: 201 })).toThrow();
    expect(() => decodeListHistoryInput({ cwd: "/repo", cursor: -1 })).toThrow();
  });

  it("decodes commit summaries and file details", () => {
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
      }).files[0],
    ).toMatchObject({ kind: "added", binary: true, insertions: null, deletions: null });
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
