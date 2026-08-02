import { describe, expect, it } from "vite-plus/test";

import type { GitHistoryCommitSummary, GitObjectId, VcsListHistoryResult } from "@aqqua/contracts";

import { combineHistoryPages } from "./gitHistoryQuery";

const makeCommit = (value: string): GitHistoryCommitSummary => ({
  id: value.repeat(40).slice(0, 40) as GitObjectId,
  parentIds: [],
  subject: value,
  authorName: "Test",
  authorEmail: "test@example.com",
  authoredAt: "2026-07-29T12:00:00Z",
  committedAt: "2026-07-29T12:00:00Z",
  isHead: false,
  refs: [],
});

function page(
  commits: GitHistoryCommitSummary[],
  nextCursor: string | null,
  referencesTruncated = false,
): VcsListHistoryResult {
  return {
    commits,
    isRepo: true,
    nextCursor,
    referencesTruncated,
  };
}

describe("combineHistoryPages", () => {
  it("preserves page order and deduplicates commits by full id", () => {
    const a = makeCommit("a");
    const b = makeCommit("b");
    const c = makeCommit("c");

    expect(combineHistoryPages([page([a, b], "cursor-page-2"), page([b, c], null)])).toEqual({
      commits: [a, b, c],
      isRepo: true,
      nextCursor: null,
      referencesTruncated: false,
    });
  });

  it("keeps the latest opaque cursor and aggregates ref truncation", () => {
    const a = makeCommit("a");
    const b = makeCommit("b");

    expect(combineHistoryPages([page([a], "cursor-1", true), page([b], "cursor-2")])).toMatchObject(
      {
        nextCursor: "cursor-2",
        referencesTruncated: true,
      },
    );
  });
});
