import type { GitChangeRequestCommit } from "@aqqua/contracts";

import { formatRelativeTimeLabel } from "../../timestampFormat";

export interface PullRequestCommitRow {
  readonly shortSha: string;
  readonly headline: string;
  readonly author: string;
  readonly timestamp: string | null;
  readonly relativeTime: string;
}

export function formatPullRequestCommitRow(commit: GitChangeRequestCommit): PullRequestCommitRow {
  const timestamp = commit.authoredAt ?? commit.committedAt;
  return {
    shortSha: commit.oid.slice(0, 7),
    headline: commit.messageHeadline || "(no commit message)",
    author: commit.authorName ?? commit.authorLogin ?? "Unknown author",
    timestamp,
    relativeTime: timestamp === null ? "Unknown time" : formatRelativeTimeLabel(timestamp),
  };
}
