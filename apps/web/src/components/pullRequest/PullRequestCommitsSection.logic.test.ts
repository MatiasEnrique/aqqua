import type { GitChangeRequestCommit } from "@aqqua/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { formatPullRequestCommitRow } from "./PullRequestCommitsSection.logic";

const commit = (overrides: Partial<GitChangeRequestCommit> = {}): GitChangeRequestCommit => ({
  oid: "1234567890abcdef",
  messageHeadline: "Ship the detail panel",
  authorName: "Mona Lisa",
  authorLogin: "monalisa",
  authoredAt: "2026-08-05T11:00:00.000Z",
  committedAt: "2026-08-05T11:01:00.000Z",
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("formatPullRequestCommitRow", () => {
  it("formats identity, author, and relative authored time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    expect(formatPullRequestCommitRow(commit())).toEqual({
      shortSha: "1234567",
      headline: "Ship the detail panel",
      author: "Mona Lisa",
      timestamp: "2026-08-05T11:00:00.000Z",
      relativeTime: "1h ago",
    });
  });

  it("falls back through committed time, login, and empty values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    expect(
      formatPullRequestCommitRow(
        commit({ authorName: null, authoredAt: null, messageHeadline: "" }),
      ),
    ).toMatchObject({
      author: "monalisa",
      headline: "(no commit message)",
      relativeTime: "59m ago",
    });
    expect(
      formatPullRequestCommitRow(
        commit({ authorName: null, authorLogin: null, authoredAt: null, committedAt: null }),
      ),
    ).toMatchObject({ author: "Unknown author", relativeTime: "Unknown time" });
  });
});
