import type { GitChangeRequestCheck, VcsStatusResult } from "@aqqua/contracts";

export type PullRequestStatus = NonNullable<VcsStatusResult["pr"]>;

export interface StatusPresentation {
  readonly label: string;
  readonly tone: "neutral" | "pending" | "success" | "failure" | "info";
  readonly icon: "clock" | "check" | "x";
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
