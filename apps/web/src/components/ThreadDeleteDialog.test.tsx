import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  canSelectAllWorktreeCandidates,
  isThreadDeleteInspectionPending,
  resolveCheckedAfterInspection,
  ThreadDeleteDialogView,
  shouldDefaultDeleteWorktrees,
} from "./ThreadDeleteDialog";
import { Dialog } from "./ui/dialog";

const mergedClean = {
  availability: "available",
  refName: "feature/work",
  headCommit: "abc123",
  baseRef: "origin/main",
  mergeStatus: "merged",
  workingTreeStatus: "clean",
} as const;

describe("ThreadDeleteDialog", () => {
  it("defaults only when every candidate is available, merged, and clean", () => {
    expect(shouldDefaultDeleteWorktrees([mergedClean])).toBe(true);
    expect(shouldDefaultDeleteWorktrees([{ ...mergedClean, workingTreeStatus: "dirty" }])).toBe(
      false,
    );
    expect(
      shouldDefaultDeleteWorktrees([mergedClean, { ...mergedClean, workingTreeStatus: "dirty" }]),
    ).toBe(false);
    expect(shouldDefaultDeleteWorktrees([{ ...mergedClean, mergeStatus: "unknown" }])).toBe(false);
    expect(shouldDefaultDeleteWorktrees([])).toBe(false);
    expect(resolveCheckedAfterInspection(false, true, [mergedClean])).toBe(false);
    expect(
      isThreadDeleteInspectionPending({
        requestId: 2,
        inspectedRequestId: 1,
        candidateCount: 1,
        pending: false,
      }),
    ).toBe(true);
    expect(
      canSelectAllWorktreeCandidates(["available", "missing"], {
        available: mergedClean,
        missing: {
          ...mergedClean,
          availability: "missing",
          refName: null,
          headCommit: null,
          baseRef: null,
          mergeStatus: "unknown",
          workingTreeStatus: "unknown",
        },
      }),
    ).toBe(false);
  });

  it("renders the worktree checkbox, statuses, warning, and singular copy", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <ThreadDeleteDialogView
          request={{
            title: "Feature work",
            threadCount: 1,
            candidates: [
              {
                key: "local\u001f/tmp/feature",
                environmentId: "local" as EnvironmentId,
                projectCwd: "/tmp/repo",
                path: "/tmp/feature",
                displayPath: "feature",
              },
            ],
            hasUnverifiableWorktrees: false,
          }}
          inspections={{ "local\u001f/tmp/feature": mergedClean }}
          checked
          pending={false}
          onCancel={() => undefined}
          onCheckedChange={() => undefined}
          onDelete={() => undefined}
        />
      </Dialog>,
    );

    expect(markup).toContain("Delete “Feature work”?");
    expect(markup).toContain("Also delete the worktree");
    expect(markup).toContain("origin/main");
    expect(markup).toContain("Merged");
    expect(markup).toContain("Clean");
    expect(markup).toContain("removed with force and cannot be recovered");
    expect(markup).toContain('type="checkbox"');
  });

  it("renders aggregate and incomplete-catalog copy", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <ThreadDeleteDialogView
          request={{
            title: "",
            threadCount: 2,
            candidates: [],
            hasUnverifiableWorktrees: true,
          }}
          inspections={{}}
          checked={false}
          pending={false}
          onCancel={() => undefined}
          onCheckedChange={() => undefined}
          onDelete={() => undefined}
        />
      </Dialog>,
    );

    expect(markup).toContain("Delete 2 threads?");
    expect(markup).toContain("other thread references could not be verified");
  });
});
