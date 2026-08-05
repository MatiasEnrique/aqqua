import type { GitChangeRequestCheck, VcsStatusResult } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aggregateChecksPresentation,
  changeRequestStatePresentation,
  checkPresentation,
  keyChangeRequestChecks,
  pullRequestFingerprint,
  shouldRefetchChecks,
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
