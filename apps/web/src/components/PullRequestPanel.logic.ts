import type {
  GitChangeRequestCheck,
  GitDeleteChangeRequestBranchLocalState,
  GitGetChangeRequestConversationResult,
  GitListRepositoryChangeRequestsResult,
  GitRepositoryChangeRequestSummary,
  VcsStatusResult,
} from "@aqqua/contracts";

export type PullRequestStatus = NonNullable<VcsStatusResult["pr"]>;

export interface PanelPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly state: "open" | "closed" | "merged";
  readonly checksStatus?: "success" | "failure" | "pending" | null | undefined;
}

export function branchPanelPullRequest(pr: VcsStatusResult["pr"]): PanelPullRequest | null {
  if (pr === null) return null;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    state: pr.state,
    checksStatus: pr.checksStatus,
  };
}

export function summaryPanelPullRequest(
  summary: GitRepositoryChangeRequestSummary,
): PanelPullRequest {
  return {
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRef: summary.baseRefName,
    headRef: summary.headRefName,
    state: summary.state,
  };
}

export function selectablePullRequests(
  branchPr: PanelPullRequest | null,
  result: GitListRepositoryChangeRequestsResult | null,
): ReadonlyArray<PanelPullRequest> {
  if (result === null || !result.supported) return [];
  return result.changeRequests
    .filter((summary) => summary.number !== branchPr?.number)
    .map(summaryPanelPullRequest);
}

export interface StatusPresentation {
  readonly label: string;
  readonly tone: "neutral" | "pending" | "success" | "failure" | "info";
  readonly icon: "clock" | "check" | "x";
}

export function statusToneClassName(tone: StatusPresentation["tone"]): string {
  switch (tone) {
    case "neutral":
      return "text-muted-foreground";
    case "pending":
      return "text-warning-foreground";
    case "success":
      return "text-success-foreground";
    case "failure":
      return "text-destructive-foreground";
    case "info":
      return "text-info-foreground";
  }
}

export function pullRequestFingerprint(pr: VcsStatusResult["pr"]): string {
  if (pr === null) return "none";
  return JSON.stringify([
    pr.number,
    pr.title,
    pr.url,
    pr.baseRef,
    pr.headRef,
    pr.state,
    pr.checksStatus ?? null,
  ]);
}

export function shouldRefetchChecks(
  previous: VcsStatusResult["pr"],
  current: VcsStatusResult["pr"],
): boolean {
  return (
    previous !== null &&
    current !== null &&
    previous.number === current.number &&
    pullRequestFingerprint(previous) !== pullRequestFingerprint(current)
  );
}

export function aggregateChecksPresentation(
  status: PullRequestStatus["checksStatus"],
): StatusPresentation {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "pending", icon: "clock" };
    case "success":
      return { label: "Passing", tone: "success", icon: "check" };
    case "failure":
      return { label: "Failing", tone: "failure", icon: "x" };
    case null:
    case undefined:
      return { label: "Not reported", tone: "neutral", icon: "clock" };
  }
}

export function changeRequestCommentCount(
  conversation: GitGetChangeRequestConversationResult | null,
): number {
  if (!conversation?.supported) return 0;
  return (
    conversation.comments.length +
    conversation.reviewThreads.reduce((count, thread) => count + thread.comments.length, 0)
  );
}

export function pullRequestMetadata(input: {
  readonly pr: PullRequestStatus;
  readonly conversation: GitGetChangeRequestConversationResult | null;
}) {
  const { conversation, pr } = input;
  const commentCount = changeRequestCommentCount(conversation);
  return {
    branchLabel: `${pr.headRef} → ${pr.baseRef}`,
    additions: conversation?.supported ? conversation.additions : null,
    deletions: conversation?.supported ? conversation.deletions : null,
    reviewersLabel: !conversation?.supported
      ? "—"
      : conversation.reviewers.length > 0
        ? conversation.reviewers.join(", ")
        : "None",
    commentsLabel: !conversation?.supported
      ? "—"
      : commentCount === 0
        ? "No comments"
        : `${commentCount} ${commentCount === 1 ? "comment" : "comments"}`,
    checksLabel: pr.checksStatus == null ? "—" : aggregateChecksPresentation(pr.checksStatus).label,
  };
}

export function pullRequestSectionVisibility(
  providerKind: string | null | undefined,
  state: PullRequestStatus["state"],
) {
  const github = providerKind === "github";
  return {
    description: github,
    commits: github,
    comments: github,
    manage: state === "open" || state === "closed",
    merge: state === "open",
    deleteBranch: github && state === "merged",
    checks: true,
  } as const;
}

export function composerSubmitEnabled(body: string, pending: boolean): boolean {
  return !pending && body.trim().length > 0;
}

export type DeleteBranchDialogStep =
  | { readonly kind: "confirm-remote" }
  | { readonly kind: "confirm-local"; readonly refName: string }
  | { readonly kind: "worktree"; readonly refName: string; readonly worktreePath: string }
  | { readonly kind: "checked-out"; readonly refName: string }
  | { readonly kind: "complete" };

export function reduceDeleteBranchDialogStep(
  local: GitDeleteChangeRequestBranchLocalState,
): DeleteBranchDialogStep {
  switch (local._tag) {
    case "none":
      return { kind: "complete" };
    case "branch":
      return local.removal === "not_requested"
        ? { kind: "confirm-local", refName: local.refName }
        : { kind: "complete" };
    case "worktree":
      return { kind: "worktree", refName: local.refName, worktreePath: local.worktreePath };
    case "checked_out":
      return { kind: "checked-out", refName: local.refName };
  }
}

export function checkPresentation(status: GitChangeRequestCheck["status"]): StatusPresentation {
  switch (status) {
    case "pending":
      return { label: "Pending", tone: "pending", icon: "clock" };
    case "success":
      return { label: "Passed", tone: "success", icon: "check" };
    case "failure":
      return { label: "Failed", tone: "failure", icon: "x" };
    case "skipped":
      return { label: "Skipped", tone: "neutral", icon: "check" };
    case "neutral":
      return { label: "Neutral", tone: "neutral", icon: "check" };
  }
}

export function keyChangeRequestChecks(
  checks: ReadonlyArray<GitChangeRequestCheck>,
): ReadonlyArray<{ readonly check: GitChangeRequestCheck; readonly key: string }> {
  const occurrences = new Map<string, number>();
  return checks.map((check) => {
    const identity = JSON.stringify([check.name, check.detailsUrl ?? null]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { check, key: `${identity}:${occurrence}` };
  });
}

export function changeRequestStatePresentation(
  state: PullRequestStatus["state"],
): Pick<StatusPresentation, "label" | "tone"> {
  switch (state) {
    case "open":
      return { label: "Open", tone: "success" };
    case "closed":
      return { label: "Closed", tone: "neutral" };
    case "merged":
      return { label: "Merged", tone: "info" };
  }
}
