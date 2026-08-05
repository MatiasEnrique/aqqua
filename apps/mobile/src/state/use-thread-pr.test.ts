import type { VcsStatusResult } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadPr } from "./thread-pr-presentation";

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 3774,
  title: "Desktop-style pull request indicator",
  url: "https://github.com/aqqua/aqqua/pull/3774",
  baseRef: "main",
  headRef: "codex/desktop-style-pr-indicator",
  state: "merged",
  checksStatus: "pending",
};

describe("presentThreadPr", () => {
  it("uses the compact pull request number label without a hash prefix", () => {
    expect(presentThreadPr(pullRequest, undefined)).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 pull request merged, checks pending",
      textClassName: "text-violet-600 dark:text-violet-400",
      checksLabel: "Pending",
      checksTextClassName: "text-amber-600 dark:text-amber-400",
    });
  });

  it("uses merge-request terminology for GitLab", () => {
    expect(
      presentThreadPr(pullRequest, {
        kind: "gitlab",
        name: "GitLab",
        baseUrl: "https://gitlab.com",
      }),
    ).toMatchObject({
      label: "3774",
      accessibilityLabel: "#3774 merge request merged, checks pending",
    });
  });

  it.each([
    ["success", "Passing", "text-emerald-600 dark:text-emerald-400"],
    ["failure", "Failing", "text-red-600 dark:text-red-400"],
  ] as const)("presents %s checks compactly", (checksStatus, checksLabel, checksTextClassName) => {
    expect(presentThreadPr({ ...pullRequest, checksStatus }, undefined)).toMatchObject({
      checksLabel,
      checksTextClassName,
    });
  });

  it.each([undefined, null] as const)(
    "omits unreported checks when status is %s",
    (checksStatus) => {
      expect(presentThreadPr({ ...pullRequest, checksStatus }, undefined)).toMatchObject({
        accessibilityLabel: "#3774 pull request merged",
        checksLabel: null,
        checksTextClassName: null,
      });
    },
  );
});
