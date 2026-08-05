import type {
  ChangeRequestComment,
  ChangeRequestReviewThread,
  GitGetChangeRequestConversationResult,
} from "@aqqua/contracts";

export type PullRequestConversationTimelineItem =
  | { readonly kind: "comment"; readonly comment: ChangeRequestComment }
  | { readonly kind: "review-thread"; readonly thread: ChangeRequestReviewThread };

function timestampValue(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function reviewThreadCreatedAt(thread: ChangeRequestReviewThread): string | null {
  return thread.comments.reduce<string | null>((earliest, comment) => {
    if (comment.createdAt === null) return earliest;
    if (earliest === null || timestampValue(comment.createdAt) < timestampValue(earliest)) {
      return comment.createdAt;
    }
    return earliest;
  }, null);
}

export function orderChangeRequestComments(
  comments: ReadonlyArray<ChangeRequestComment>,
): ReadonlyArray<ChangeRequestComment> {
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort(
      (left, right) =>
        timestampValue(left.comment.createdAt) - timestampValue(right.comment.createdAt) ||
        left.index - right.index,
    )
    .map(({ comment }) => comment);
}

export function orderPullRequestConversation(
  conversation: Pick<GitGetChangeRequestConversationResult, "comments" | "reviewThreads">,
): ReadonlyArray<PullRequestConversationTimelineItem> {
  return [
    ...conversation.comments.map((comment) => ({ kind: "comment" as const, comment })),
    ...conversation.reviewThreads.map((thread) => ({ kind: "review-thread" as const, thread })),
  ].sort((left, right) => {
    const leftTime =
      left.kind === "comment" ? left.comment.createdAt : reviewThreadCreatedAt(left.thread);
    const rightTime =
      right.kind === "comment" ? right.comment.createdAt : reviewThreadCreatedAt(right.thread);
    return timestampValue(leftTime) - timestampValue(rightTime);
  });
}

export function reviewThreadLocation(thread: ChangeRequestReviewThread): string {
  const path = thread.path ?? "Unknown file";
  const line = thread.line ?? thread.startLine;
  return line === null ? path : `${path}:${line}`;
}
