import { describe, expect, it } from "vite-plus/test";

import {
  orderChangeRequestComments,
  orderPullRequestConversation,
  reviewThreadCreatedAt,
  reviewThreadLocation,
} from "./PullRequestConversationSection.logic";

const comment = (id: string, createdAt: string | null) => ({
  id,
  author: { login: "octocat" },
  body: id,
  createdAt,
  url: `https://example.test/${id}`,
});

const thread = {
  id: "thread",
  isResolved: false,
  isOutdated: false,
  path: "src/panel.tsx",
  line: 42,
  startLine: 40,
  comments: [
    comment("review-later", "2026-08-05T12:00:00.000Z"),
    comment("review-first", "2026-08-05T10:00:00.000Z"),
  ],
  commentsTruncated: false,
} as const;

describe("conversation timeline", () => {
  it("interleaves issue comments and review threads by creation time", () => {
    const ordered = orderPullRequestConversation({
      comments: [
        comment("last", "2026-08-05T13:00:00.000Z"),
        comment("first", "2026-08-05T09:00:00.000Z"),
      ],
      reviewThreads: [thread],
    });
    expect(
      ordered.map((item) => (item.kind === "comment" ? item.comment.id : item.thread.id)),
    ).toEqual(["first", "thread", "last"]);
  });

  it("uses the earliest thread comment and formats its location", () => {
    expect(reviewThreadCreatedAt(thread)).toBe("2026-08-05T10:00:00.000Z");
    expect(reviewThreadLocation(thread)).toBe("src/panel.tsx:42");
    expect(reviewThreadLocation({ ...thread, line: null, startLine: null })).toBe("src/panel.tsx");
  });

  it("orders comments while keeping missing timestamps stable at the end", () => {
    expect(
      orderChangeRequestComments([
        comment("missing-1", null),
        comment("later", "2026-08-05T12:00:00.000Z"),
        comment("earlier", "2026-08-05T10:00:00.000Z"),
        comment("missing-2", null),
      ]).map(({ id }) => id),
    ).toEqual(["earlier", "later", "missing-1", "missing-2"]);
  });
});
