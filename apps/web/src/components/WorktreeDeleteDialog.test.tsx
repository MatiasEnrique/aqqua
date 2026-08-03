import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "./ui/dialog";
import { WorktreeDeleteDialogView } from "./WorktreeDeleteDialog";

const availableRequest = {
  label: "feature/cleanup",
  path: "/repo/worktrees/cleanup",
  conversationCount: 2,
  archivedCount: 1,
  inspection: {
    availability: "available",
    refName: "feature/cleanup",
    headCommit: "abc123",
    baseRef: "origin/main",
    mergeStatus: "merged",
    workingTreeStatus: "clean",
  },
} as const;

describe("WorktreeDeleteDialog", () => {
  it("offers explicit local-branch deletion and promises to keep the remote branch", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <WorktreeDeleteDialogView
          request={availableRequest}
          deleteBranch
          onDeleteBranchChange={() => undefined}
          onCancel={() => undefined}
          onDelete={() => undefined}
        />
      </Dialog>,
    );

    expect(markup).toContain("Delete worktree “feature/cleanup”?");
    expect(markup).toContain("Also delete local branch");
    expect(markup).toContain("feature/cleanup");
    expect(markup).toContain("Remote branches are never deleted");
    expect(markup).toContain("Merged");
    expect(markup).toContain("Clean");
    expect(markup).toContain('type="checkbox"');
  });

  it("cleans stale conversations without offering an unverified branch or path deletion", () => {
    const markup = renderToStaticMarkup(
      <Dialog open>
        <WorktreeDeleteDialogView
          request={{
            ...availableRequest,
            inspection: {
              availability: "not_worktree",
              refName: null,
              headCommit: null,
              baseRef: null,
              mergeStatus: "unknown",
              workingTreeStatus: "unknown",
            },
          }}
          deleteBranch={false}
          onDeleteBranchChange={() => undefined}
          onCancel={() => undefined}
          onDelete={() => undefined}
        />
      </Dialog>,
    );

    expect(markup).toContain("no longer recognizes this path as a worktree");
    expect(markup).toContain("leave the directory untouched");
    expect(markup).not.toContain("Also delete local branch");
  });
});
