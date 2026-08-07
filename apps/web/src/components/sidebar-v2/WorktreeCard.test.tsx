import type { EnvironmentId, ProjectId } from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

const { SortableWorktreeCardList, WorktreeCard } = await import("./WorktreeCard");

const group = (overrides: Partial<SidebarWorktreeGroup> = {}): SidebarWorktreeGroup =>
  ({
    key: "local:/repo-wt",
    environmentId: "local" as EnvironmentId,
    projectId: "project" as ProjectId,
    workspaceRoot: "/repo-wt",
    projectRoot: "/repo",
    environmentLabel: "Local",
    label: "header-refactor",
    isProjectCheckout: false,
    stateCounts: { working: 2, needsInput: 1, done: 3, stale: 0, settled: 4 },
    summaryState: "needsInput",
    mergedChangeRequestNumber: null,
    updatedAt: 0,
    drafts: [],
    active: [],
    snoozed: [],
    unsettled: [],
    conversationCount: 6,
    workingConversationCount: 2,
    ...overrides,
  }) as SidebarWorktreeGroup;

const render = (worktree: SidebarWorktreeGroup, isSelected = false) =>
  renderToStaticMarkup(
    <WorktreeCard
      group={worktree}
      isSelected={isSelected}
      removingWorktreeKey={null}
      onSelect={() => {}}
      onDeleteWorktree={() => {}}
      onContextMenu={() => {}}
    />,
  );

describe("WorktreeCard", () => {
  it("shows one prioritized state and no counters", () => {
    const markup = render(group());

    expect(markup).toContain('aria-label="Worktree status: Needs input"');
    expect(markup).toContain("pr-2 pl-1.5");
    expect(markup).not.toContain("pr-0.5");
    // The counters would say "2 working conversations, 1 needs input …".
    expect(markup).not.toContain("conversations,");
    expect(markup).not.toContain(">2<");
    expect(markup).not.toContain(">3<");
  });

  it("leaves the project avatar to the parent project folder", () => {
    expect(render(group())).not.toContain("data-project-favicon");
  });

  it("labels the project checkout differently from a worktree", () => {
    // The rendered text node, not a bare substring: `worktree-card-<key>` is in
    // the testid of every card, so `toContain("worktree")` passed even with the
    // kind label deleted.
    expect(render(group())).toContain(">worktree</span>");
    expect(render(group({ isProjectCheckout: true }))).toContain(">current checkout</span>");
  });

  it("marks the selected card with the row highlight and no left rail", () => {
    const selected = render(group(), true);

    expect(selected).toContain("bg-sidebar-control-surface");
    expect(selected).toContain('aria-current="true"');
    expect(selected).not.toContain("border-l");
    // Unselected rows sit on the sidebar itself; only hover borrows the
    // selected material, and then at partial strength.
    const unselected = render(group());
    expect(unselected).toContain("bg-transparent");
    expect(unselected).toContain("hover:bg-sidebar-control-surface/60");
    // The bare utility, not the `hover:` or `/60` variants of it.
    expect(unselected).not.toMatch(/[\s"]bg-sidebar-control-surface[\s"]/);
  });

  it("renders no conversation rows, so the card is the whole hierarchy", () => {
    const markup = render(
      group({
        drafts: [{ draftId: "d1", title: "New conversation" }] as never,
        active: [{ id: "a", title: "Fix palette warmth" }] as never,
      }),
    );

    expect(markup).not.toContain("Fix palette warmth");
    expect(markup).not.toContain("New conversation");
    expect(markup).not.toContain("<ul");
  });

  it("shows no state at all for a worktree with nothing to report", () => {
    expect(render(group({ summaryState: null }))).not.toContain("Worktree status:");
  });

  it("removes settlement actions and the settled status from worktree cards", () => {
    const markup = render(group({ summaryState: "settled" }));

    expect(markup).not.toContain("Settle all");
    expect(markup).not.toContain("Worktree status: Settled");
  });

  it("shows an inline grey delete control that turns red on hover", () => {
    const markup = render(group());

    expect(markup).toContain('aria-label="Delete worktree header-refactor"');
    expect(markup).toContain("text-muted-foreground");
    expect(markup).toContain("hover:text-destructive");
    expect(markup).not.toContain("Worktree actions for");
  });

  it("keeps the delete column reserved on the undeletable project checkout", () => {
    const markup = render(group({ isProjectCheckout: true }));

    // No control, but the column still has to exist: without it the checkout's
    // state label sits a trash button further right than every other row's.
    expect(markup).not.toContain("Delete worktree");
    expect(markup).toContain('<span aria-hidden="true" class="size-7 shrink-0"></span>');
  });

  it("shows the merged pull request number and icon in violet", () => {
    const markup = render(group({ mergedChangeRequestNumber: 42, summaryState: "settled" }));

    expect(markup).toContain('aria-label="Pull request #42 merged"');
    expect(markup).toContain("text-violet-600");
    expect(markup).toContain(">#42</span>");
  });

  it("exposes an accessible drag handle when sibling worktrees can be reordered", () => {
    const markup = renderToStaticMarkup(
      <SortableWorktreeCardList
        groups={[group(), group({ key: "local:/repo-other", label: "other-worktree" })]}
        activeWorktreeKey={null}
        removingWorktreeKey={null}
        onSelect={() => {}}
        onDeleteWorktree={() => {}}
        onContextMenu={() => {}}
        onReorder={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Reorder worktree header-refactor"');
    expect(markup).toContain('aria-label="Reorder worktree other-worktree"');
  });
});
