import type {
  GitChangeRequestCheck,
  GitRepositoryChangeRequestSummary,
  VcsStatusResult,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aggregateChecksPresentation,
  branchPanelPullRequest,
  changeRequestCommentCount,
  changeRequestStatePresentation,
  checkPresentation,
  composerSubmitEnabled,
  keyChangeRequestChecks,
  pullRequestMetadata,
  pullRequestFingerprint,
  pullRequestSectionVisibility,
  reduceDeleteBranchDialogStep,
  selectablePullRequests,
  shouldRefetchChecks,
  statusToneClassName,
  summaryPanelPullRequest,
} from "./PullRequestPanel.logic";

const pr = (overrides: Partial<NonNullable<VcsStatusResult["pr"]>> = {}) => ({
  number: 42,
  title: "Add the pull request panel",
  url: "https://example.test/pulls/42",
  baseRef: "main",
  headRef: "feature/pull-request-panel",
  state: "open" as const,
  checksStatus: "pending" as const,
  ...overrides,
});

const summary = (
  overrides: Partial<GitRepositoryChangeRequestSummary> = {},
): GitRepositoryChangeRequestSummary => ({
  number: 43,
  title: "Make pull requests selectable",
  url: "https://example.test/pulls/43",
  baseRefName: "main",
  headRefName: "feature/pr-selector",
  state: "open",
  ...overrides,
});

describe("panel pull request normalization", () => {
  it("preserves the branch pull request shape and its aggregate checks status", () => {
    expect(branchPanelPullRequest(pr({ hasConflicts: true }))).toEqual(pr({ hasConflicts: true }));
    expect(branchPanelPullRequest(null)).toBeNull();
  });

  it("normalizes repository summaries without inventing a checks status", () => {
    expect(summaryPanelPullRequest(summary({ hasConflicts: true }))).toEqual({
      number: 43,
      title: "Make pull requests selectable",
      url: "https://example.test/pulls/43",
      baseRef: "main",
      headRef: "feature/pr-selector",
      state: "open",
      hasConflicts: true,
    });
  });

  it("deduplicates the branch pull request from repository choices", () => {
    expect(
      selectablePullRequests(pr(), {
        supported: true,
        changeRequests: [summary({ number: 42 }), summary(), summary({ number: 44 })],
        truncated: false,
      }).map(({ number }) => number),
    ).toEqual([43, 44]);
  });

  it("has no repository choices for unavailable or unsupported results", () => {
    expect(selectablePullRequests(null, null)).toEqual([]);
    expect(
      selectablePullRequests(null, {
        supported: false,
        changeRequests: [summary()],
        truncated: false,
      }),
    ).toEqual([]);
  });
});

describe("shouldRefetchChecks", () => {
  it("refetches details for streamed updates to the current PR", () => {
    expect(
      shouldRefetchChecks(pr({ checksStatus: "pending" }), pr({ checksStatus: "success" })),
    ).toBe(true);
  });

  it("lets a newly keyed query load a different PR without a redundant refetch", () => {
    expect(shouldRefetchChecks(null, pr())).toBe(false);
    expect(shouldRefetchChecks(pr(), pr({ number: 43 }))).toBe(false);
  });
});

describe("pullRequestFingerprint", () => {
  it("changes when streamed aggregate state changes", () => {
    expect(pullRequestFingerprint(pr({ checksStatus: "pending" }))).not.toBe(
      pullRequestFingerprint(pr({ checksStatus: "success" })),
    );
  });

  it("changes when merge conflicts appear", () => {
    expect(pullRequestFingerprint(pr())).not.toBe(
      pullRequestFingerprint(pr({ hasConflicts: true })),
    );
  });

  it("covers PR identity, refs, metadata, and state", () => {
    const initial = pullRequestFingerprint(pr());
    for (const changed of [
      pr({ number: 43 }),
      pr({ title: "Renamed" }),
      pr({ url: "https://example.test/pulls/43" }),
      pr({ baseRef: "release" }),
      pr({ headRef: "feature/renamed" }),
      pr({ state: "closed" }),
    ]) {
      expect(pullRequestFingerprint(changed)).not.toBe(initial);
    }
    expect(pullRequestFingerprint(null)).toBe("none");
  });
});

describe("pull request status presentation", () => {
  it("maps status tones to semantic text colors", () => {
    expect(statusToneClassName("success")).toBe("text-success-foreground");
    expect(statusToneClassName("failure")).toBe("text-destructive-foreground");
    expect(statusToneClassName("pending")).toBe("text-warning-foreground");
    expect(statusToneClassName("neutral")).toBe("text-muted-foreground");
    expect(statusToneClassName("info")).toBe("text-info-foreground");
  });

  it.each([
    ["pending", "Pending", "clock"],
    ["success", "Passing", "check"],
    ["failure", "Failing", "x"],
    [null, "Not reported", "clock"],
  ] as const)("maps aggregate %s status", (status, label, icon) => {
    expect(aggregateChecksPresentation(status)).toMatchObject({ label, icon });
  });

  it.each([
    ["pending", "Pending", "clock"],
    ["success", "Passed", "check"],
    ["failure", "Failed", "x"],
    ["skipped", "Skipped", "check"],
    ["neutral", "Neutral", "check"],
  ] satisfies ReadonlyArray<readonly [GitChangeRequestCheck["status"], string, string]>)(
    "maps check %s status",
    (status, label, icon) => {
      expect(checkPresentation(status)).toMatchObject({ label, icon });
    },
  );

  it("labels every change request state", () => {
    expect(changeRequestStatePresentation("open")).toEqual({ label: "Open", tone: "success" });
    expect(changeRequestStatePresentation("closed")).toEqual({
      label: "Closed",
      tone: "neutral",
    });
    expect(changeRequestStatePresentation("merged")).toEqual({ label: "Merged", tone: "info" });
  });
});

describe("pull request detail presentation", () => {
  const conversation = {
    supported: true,
    description: null,
    additions: 12,
    deletions: 3,
    reviewers: ["octocat", "hubot"],
    comments: [{ id: "issue", author: null, body: "Hi", createdAt: null, url: "" }],
    commentsTruncated: false,
    reviewThreads: [
      {
        id: "thread",
        isResolved: false,
        isOutdated: false,
        path: "src/a.ts",
        line: 4,
        startLine: null,
        comments: [
          { id: "review-1", author: null, body: "One", createdAt: null, url: "" },
          { id: "review-2", author: null, body: "Two", createdAt: null, url: "" },
        ],
        commentsTruncated: false,
      },
    ],
    reviewThreadsTruncated: false,
  } as const;

  it("counts issue and review-thread comments and derives compact metadata", () => {
    expect(changeRequestCommentCount(conversation)).toBe(3);
    expect(pullRequestMetadata({ pr: pr(), conversation })).toEqual({
      branchLabel: "feature/pull-request-panel → main",
      additions: 12,
      deletions: 3,
      reviewersLabel: "octocat, hubot",
      commentsLabel: "3 comments",
      checksLabel: "Pending",
    });
  });

  it("pluralizes the comment count label", () => {
    const single = { ...conversation, comments: [conversation.comments[0]!], reviewThreads: [] };
    expect(pullRequestMetadata({ pr: pr(), conversation: single })).toMatchObject({
      commentsLabel: "1 comment",
    });
    expect(
      pullRequestMetadata({
        pr: pr(),
        conversation: { ...conversation, comments: [], reviewThreads: [] },
      }),
    ).toMatchObject({ commentsLabel: "No comments" });
  });

  it("uses quiet empty labels when conversation data is unavailable", () => {
    expect(
      pullRequestMetadata({ pr: pr({ checksStatus: null }), conversation: null }),
    ).toMatchObject({ reviewersLabel: "—", commentsLabel: "—", checksLabel: "—" });
    expect(
      pullRequestMetadata({
        pr: summaryPanelPullRequest(summary()),
        conversation: null,
      }),
    ).toMatchObject({ checksLabel: "—" });
  });

  it("gates GitHub-only sections and branch deletion", () => {
    expect(pullRequestSectionVisibility("github", "merged")).toMatchObject({
      description: true,
      commits: true,
      comments: true,
      deleteBranch: true,
      manage: false,
      merge: false,
      checks: true,
    });
    expect(pullRequestSectionVisibility("gitlab", "open")).toMatchObject({
      description: false,
      commits: false,
      comments: false,
      deleteBranch: false,
      manage: true,
      merge: true,
      checks: true,
    });
  });

  it("enables composers only for non-empty idle drafts", () => {
    expect(composerSubmitEnabled(" reply ", false)).toBe(true);
    expect(composerSubmitEnabled("   ", false)).toBe(false);
    expect(composerSubmitEnabled("reply", true)).toBe(false);
  });
});

describe("delete branch steps", () => {
  it("offers local cleanup only for a remaining plain branch", () => {
    expect(
      reduceDeleteBranchDialogStep({
        _tag: "branch",
        refName: "feature/pr",
        removal: "not_requested",
      }),
    ).toEqual({ kind: "confirm-local", refName: "feature/pr" });
    expect(
      reduceDeleteBranchDialogStep({ _tag: "branch", refName: "feature/pr", removal: "removed" }),
    ).toEqual({ kind: "complete" });
  });

  it("routes worktrees, checked-out branches, and empty local state", () => {
    expect(
      reduceDeleteBranchDialogStep({
        _tag: "worktree",
        refName: "feature/pr",
        worktreePath: "/repo/pr",
      }),
    ).toEqual({ kind: "worktree", refName: "feature/pr", worktreePath: "/repo/pr" });
    expect(reduceDeleteBranchDialogStep({ _tag: "checked_out", refName: "feature/pr" })).toEqual({
      kind: "checked-out",
      refName: "feature/pr",
    });
    expect(reduceDeleteBranchDialogStep({ _tag: "none" })).toEqual({ kind: "complete" });
  });
});

describe("keyChangeRequestChecks", () => {
  it("assigns unique data-derived keys when providers repeat a check name", () => {
    const checks = [
      { name: "test", status: "success" as const, detailsUrl: "https://example.test/jobs/1" },
      { name: "test", status: "failure" as const, detailsUrl: "https://example.test/jobs/2" },
      { name: "test", status: "pending" as const, detailsUrl: "https://example.test/jobs/2" },
    ];

    const keyed = keyChangeRequestChecks(checks);
    expect(new Set(keyed.map(({ key }) => key)).size).toBe(checks.length);
    expect(keyed[1]?.key).not.toBe(keyed[2]?.key);
  });
});
