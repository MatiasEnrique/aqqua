import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import {
  decodeGitHubConversationOverviewJson,
  decodeGitHubPullRequestCommitsJson,
  decodeGitHubReviewThreadsJson,
} from "./gitHubConversation.ts";

function successOf<A, E>(result: Result.Result<A, E>): A {
  if (!Result.isSuccess(result)) return assert.fail("Expected decoder success");
  return result.success;
}

describe("gitHubConversation decoders", () => {
  it("decodes a tolerant overview and flattens user and team review requests", () => {
    const result = successOf(
      decodeGitHubConversationOverviewJson(
        JSON.stringify({
          number: 42,
          state: "OPEN",
          mergedAt: null,
          headRefName: "feature/conversation",
          author: null,
          body: "Conversation body",
          createdAt: "2026-08-05T10:00:00Z",
          url: "https://github.com/acme/repo/pull/42",
          comments: [],
          reviewRequests: [
            { login: "octocat" },
            { name: "Core team", slug: "core-team" },
            { name: "Docs team" },
            {},
          ],
        }),
      ),
    );

    assert.deepStrictEqual(result, {
      number: 42,
      state: "open",
      headRefName: "feature/conversation",
      isCrossRepository: false,
      additions: null,
      deletions: null,
      reviewers: ["octocat", "core-team", "Docs team"],
      description: {
        author: null,
        body: "Conversation body",
        createdAt: "2026-08-05T10:00:00Z",
        url: "https://github.com/acme/repo/pull/42",
      },
      comments: [],
      commentsTruncated: false,
    });
  });

  it("keeps the most recent 100 issue comments", () => {
    const comments = Array.from({ length: 101 }, (_, index) => ({
      id: `comment-${index}`,
      author: { login: "octocat" },
      body: `Comment ${index}`,
      createdAt: null,
      url: `https://github.com/acme/repo/pull/42#issuecomment-${index}`,
    }));
    const result = successOf(
      decodeGitHubConversationOverviewJson(
        JSON.stringify({
          number: 42,
          headRefName: "feature/conversation",
          comments,
          reviewRequests: [],
        }),
      ),
    );

    assert.strictEqual(result.commentsTruncated, true);
    assert.strictEqual(result.comments.length, 100);
    assert.strictEqual(result.comments[0]?.id, "comment-1");
    assert.strictEqual(result.comments.at(-1)?.id, "comment-100");
  });

  it("normalizes a pull request with mergedAt as merged", () => {
    const result = successOf(
      decodeGitHubConversationOverviewJson(
        JSON.stringify({
          number: 42,
          state: "CLOSED",
          mergedAt: "2026-08-05T11:00:00Z",
          headRefName: "feature/conversation",
        }),
      ),
    );

    assert.strictEqual(result.state, "merged");
  });

  it("decodes review thread flags, nullable locations, and truncated comments", () => {
    const result = successOf(
      decodeGitHubReviewThreadsJson(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: true },
                  nodes: [
                    {
                      id: "thread-1",
                      isResolved: true,
                      isOutdated: true,
                      path: null,
                      line: null,
                      startLine: null,
                      diffSide: "RIGHT",
                      comments: {
                        totalCount: 2,
                        nodes: [
                          {
                            id: "comment-1",
                            author: null,
                            body: "A reply",
                            createdAt: "2026-08-05T10:00:00Z",
                            url: "https://github.com/acme/repo/pull/42#discussion_r1",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        }),
      ),
    );

    assert.strictEqual(result.reviewThreadsTruncated, true);
    assert.deepStrictEqual(result.reviewThreads, [
      {
        id: "thread-1",
        isResolved: true,
        isOutdated: true,
        path: null,
        line: null,
        startLine: null,
        diffSide: "RIGHT",
        comments: [
          {
            id: "comment-1",
            author: null,
            body: "A reply",
            createdAt: "2026-08-05T10:00:00Z",
            url: "https://github.com/acme/repo/pull/42#discussion_r1",
          },
        ],
        commentsTruncated: true,
      },
    ]);
  });

  it("skips malformed review thread nodes", () => {
    const result = successOf(
      decodeGitHubReviewThreadsJson(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    { isResolved: true },
                    { id: "valid-thread", comments: { totalCount: 0, nodes: [] } },
                  ],
                },
              },
            },
          },
        }),
      ),
    );

    assert.deepStrictEqual(
      result.reviewThreads.map((thread) => thread.id),
      ["valid-thread"],
    );
  });

  it("decodes commits without authors and preserves empty messages", () => {
    const result = successOf(
      decodeGitHubPullRequestCommitsJson(
        JSON.stringify({
          number: 42,
          commits: [
            {
              oid: "abc123",
              messageHeadline: "",
              authoredDate: null,
              committedDate: "2026-08-05T10:00:00Z",
            },
          ],
        }),
      ),
    );

    assert.deepStrictEqual(result, {
      number: 42,
      headOid: "abc123",
      commits: [
        {
          oid: "abc123",
          messageHeadline: "",
          authorName: null,
          authorLogin: null,
          authoredAt: null,
          committedAt: "2026-08-05T10:00:00Z",
        },
      ],
      truncated: false,
    });
  });

  it("caps commits at 250 while deriving headOid from the complete list", () => {
    const commits = Array.from({ length: 251 }, (_, index) => ({
      oid: `oid-${index}`,
      messageHeadline: `Commit ${index}`,
      authors: [{ login: ` author-${index} `, name: ` Author ${index} ` }],
    }));
    const result = successOf(
      decodeGitHubPullRequestCommitsJson(JSON.stringify({ number: 42, commits })),
    );

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.commits.length, 250);
    assert.strictEqual(result.commits.at(-1)?.oid, "oid-249");
    assert.strictEqual(result.headOid, "oid-250");
    assert.strictEqual(result.commits[0]?.authorName, "Author 0");
    assert.strictEqual(result.commits[0]?.authorLogin, "author-0");
  });
});
