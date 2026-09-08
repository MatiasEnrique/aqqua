import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarWorktreeGroup } from "../Sidebar.worktreeGroups";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

const {
  SortableWorktreeCardList,
  WorktreeCard,
  buildThreadContextMenuItems,
  orderThreadsParentFirst,
  resolveConversationClickAction,
} = await import("./WorktreeCard");

const group = (overrides: Partial<SidebarWorktreeGroup> = {}): SidebarWorktreeGroup =>
  ({
    key: "local:/repo-wt",
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("project"),
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
      conversationsExpanded
      removingWorktreeKey={null}
      onSelect={() => {}}
      onConversationsExpandedChange={() => {}}
      onDeleteWorktree={() => {}}
      onContextMenu={() => {}}
    />,
  );

const thread = (overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell => ({
  environmentId: EnvironmentId.make("local"),
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project"),
  parentThreadId: null,
  title: "Fix sidebar rows",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "test-model",
  },
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: "default",
  branch: "feature/sidebar",
  worktreePath: "/repo-wt",
  latestTurn: null,
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:05:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  settledChangeRequestNumber: undefined,
  snoozedUntil: null,
  snoozedAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const renderThreads = (
  worktree: SidebarWorktreeGroup,
  threads: readonly EnvironmentThreadShell[],
  options: {
    readonly selectedThreadKey?: string | null;
    readonly selectedDraftId?: string | null;
    readonly threadSectionByKey?: ReadonlyMap<string, "active" | "snoozed" | "settled">;
    readonly conversationsExpanded?: boolean;
  } = {},
) =>
  renderToStaticMarkup(
    <WorktreeCard
      group={worktree}
      isSelected={false}
      conversationsExpanded={options.conversationsExpanded ?? true}
      removingWorktreeKey={null}
      onSelect={() => {}}
      onConversationsExpandedChange={() => {}}
      onDeleteWorktree={() => {}}
      onContextMenu={() => {}}
      threads={threads}
      onToggleThreadSettled={() => {}}
      {...(options.threadSectionByKey ? { threadSectionByKey: options.threadSectionByKey } : {})}
      {...(options.selectedThreadKey !== undefined
        ? { selectedThreadKey: options.selectedThreadKey }
        : {})}
      {...(options.selectedDraftId !== undefined
        ? { selectedDraftId: options.selectedDraftId }
        : {})}
    />,
  );

describe("WorktreeCard", () => {
  it("shows one prioritized state and no counters", () => {
    const markup = render(group());

    expect(markup).toContain('aria-label="Worktree status: Needs input"');
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

  it("keeps worktree-only rendering when conversation rows are not supplied", () => {
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

  it("renders a selected thread title with branch and relative-time metadata", () => {
    const selectedThread = thread();
    const markup = renderThreads(group(), [selectedThread], {
      selectedThreadKey: scopedThreadKey(
        scopeThreadRef(selectedThread.environmentId, selectedThread.id),
      ),
    });

    expect(markup).toContain(">Fix sidebar rows</span>");
    expect(markup).toContain("feature/sidebar");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("bg-sidebar-row-active");
  });

  it("renders a direct settle action on an active conversation card", () => {
    const markup = renderThreads(group(), [thread()]);

    expect(markup).toContain('aria-label="Settle conversation Fix sidebar rows"');
    expect(markup).not.toContain('aria-label="Un-settle conversation Fix sidebar rows"');
    expect(markup).toContain("right-0 top-0 size-10 justify-center");
    expect(markup).not.toContain("right-3 top-2");
    expect(markup).toContain("hover:bg-destructive/10");
    expect(markup).toContain("hover:text-destructive");
  });

  it("collapses and expands the worktree conversation list", () => {
    const expanded = renderThreads(group(), [thread()], { conversationsExpanded: true });
    const collapsed = renderThreads(group(), [thread()], { conversationsExpanded: false });

    expect(expanded).toContain('aria-label="Collapse conversations in worktree header-refactor"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain(">Fix sidebar rows</span>");
    expect(expanded).toContain("transition-[height,opacity]");
    expect(expanded).toContain("ease-(--ease-fluid)");
    expect(expanded).toContain("motion-reduce:transition-none");
    expect(collapsed).toContain('aria-label="Expand conversations in worktree header-refactor"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain(">Fix sidebar rows</span>");
  });

  it("renders drafts as selectable conversation rows with draft metadata", () => {
    const markup = renderThreads(
      group({
        drafts: [
          {
            draftId: "draft-1",
            environmentId: EnvironmentId.make("local"),
            threadId: ThreadId.make("draft-thread-1"),
            projectId: ProjectId.make("project"),
            envMode: "worktree",
            title: "New sidebar thread",
            baseBranch: "main",
            worktreePath: "/repo-wt",
            createdAt: "2026-09-08T09:06:00.000Z",
          },
        ],
      }),
      [],
      { selectedDraftId: "draft-1" },
    );

    expect(markup).toContain(">New sidebar thread</span>");
    expect(markup).toContain("Draft · main");
    expect(markup).toContain('aria-current="page"');
  });

  it("uses canonical priority for plans, never-run threads, and approval or input waits", () => {
    const markup = renderThreads(group(), [
      thread({
        id: ThreadId.make("plan"),
        title: "Plan thread",
        interactionMode: "plan",
        hasActionableProposedPlan: true,
        latestTurn: {
          turnId: TurnId.make("plan-turn"),
          requestedAt: "2026-09-08T09:00:00.000Z",
          assistantMessageId: null,
          state: "completed",
          startedAt: "2026-09-08T09:00:00.000Z",
          completedAt: "2026-09-08T09:05:00.000Z",
        },
      }),
      thread({ id: ThreadId.make("never-run"), title: "Never run" }),
      thread({
        id: ThreadId.make("approval"),
        title: "Approval wait",
        hasPendingApprovals: true,
      }),
      thread({
        id: ThreadId.make("input"),
        title: "Input wait",
        hasPendingUserInput: true,
      }),
    ]);

    expect(markup).toContain('aria-label="Plan thread: Plan Ready"');
    expect(markup).toContain('aria-label="Never run: Stale"');
    expect(markup).toContain('aria-label="Approval wait: Pending Approval"');
    expect(markup).toContain('aria-label="Input wait: Awaiting Input"');
    expect(markup).not.toContain('aria-label="Never run: Done"');
  });

  it("treats an active override as active even when settledAt is stale", () => {
    const activeOverride = renderThreads(group(), [
      thread({
        id: ThreadId.make("active-again"),
        title: "Active again",
        settledAt: "2026-09-07T09:00:00.000Z",
        settledOverride: "active",
      }),
    ]);

    expect(activeOverride).toContain('aria-label="Active again: Stale"');
    expect(activeOverride).not.toContain('aria-label="Active again: Settled"');
  });

  it("uses the authoritative sidebar section for snoozed presentation", () => {
    const snoozedThread = thread({ id: ThreadId.make("snoozed"), title: "Wake later" });
    const markup = renderThreads(group(), [snoozedThread], {
      threadSectionByKey: new Map([
        [
          scopedThreadKey(scopeThreadRef(snoozedThread.environmentId, snoozedThread.id)),
          "snoozed" as const,
        ],
      ]),
    });

    expect(markup).toContain("Snoozed · feature/sidebar");
  });

  it("leaves settled conversations to the sidebar's own settled shelf", () => {
    const settledThread = thread({ id: ThreadId.make("settled"), title: "Old work" });
    const threadKey = scopedThreadKey(
      scopeThreadRef(settledThread.environmentId, settledThread.id),
    );
    const options = {
      threadSectionByKey: new Map([[threadKey, "settled" as const]]),
    };

    expect(renderThreads(group(), [settledThread], options)).not.toContain("Old work");
    // Not even the routed one. The shelf opens itself on the routed
    // conversation, so revealing it here would show it twice.
    expect(
      renderThreads(group(), [settledThread], { ...options, selectedThreadKey: threadKey }),
    ).not.toContain("Old work");
  });

  it("reads settlement off the thread when no section map is supplied", () => {
    const markup = renderThreads(group(), [
      thread({
        id: ThreadId.make("settled"),
        title: "Settled thread",
        settledAt: "2026-09-07T09:00:00.000Z",
      }),
    ]);

    expect(markup).not.toContain("Settled thread");
  });

  it("orders each parent before its sub-agents without disturbing sibling order", () => {
    const parent = thread({ id: ThreadId.make("parent"), title: "Parent" });
    const firstChild = thread({
      id: ThreadId.make("first-child"),
      parentThreadId: parent.id,
      title: "First child",
    });
    const secondChild = thread({
      id: ThreadId.make("second-child"),
      parentThreadId: parent.id,
      title: "Second child",
    });
    const other = thread({ id: ThreadId.make("other"), title: "Other" });

    expect(orderThreadsParentFirst([firstChild, other, secondChild, parent])).toEqual([
      other,
      parent,
      firstChild,
      secondChild,
    ]);
  });

  it("resolves modifier selection before navigation and ignores trailing double-clicks", () => {
    expect(
      resolveConversationClickAction({
        platform: "MacIntel",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        detail: 1,
      }),
    ).toBe("toggle-selection");
    expect(
      resolveConversationClickAction({
        platform: "Win32",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        detail: 1,
      }),
    ).toBe("toggle-selection");
    expect(
      resolveConversationClickAction({
        platform: "MacIntel",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        detail: 1,
      }),
    ).toBe("range-selection");
    expect(
      resolveConversationClickAction({
        platform: "MacIntel",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        detail: 2,
      }),
    ).toBe("ignore");
  });

  it("builds lifecycle menus for the clicked thread section", () => {
    expect(buildThreadContextMenuItems("active", [])).toMatchObject([
      { id: "settle", label: "Settle thread" },
      { id: "snooze", label: "Snooze" },
      { id: "delete", label: "Delete", destructive: true },
    ]);
    expect(buildThreadContextMenuItems("snoozed", [])).toMatchObject([
      { id: "unsnooze", label: "Wake thread" },
      { id: "settle", label: "Settle thread" },
      { id: "delete", label: "Delete", destructive: true },
    ]);
    expect(buildThreadContextMenuItems("settled", [])).toMatchObject([
      { id: "unsettle", label: "Un-settle thread" },
      { id: "delete", label: "Delete", destructive: true },
    ]);
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

  it("lets the undeletable project checkout use the full row width", () => {
    const markup = render(group({ isProjectCheckout: true }));

    expect(markup).not.toContain("Delete worktree");
    expect(markup).not.toContain('<span aria-hidden="true" class="size-7 shrink-0"></span>');
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
        worktreeConversationExpandedByKey={{}}
        removingWorktreeKey={null}
        onSelect={() => {}}
        onWorktreeConversationExpandedChange={() => {}}
        onDeleteWorktree={() => {}}
        onContextMenu={() => {}}
        onReorder={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Reorder worktree header-refactor"');
    expect(markup).toContain('aria-label="Reorder worktree other-worktree"');
  });

  it("does not expose a drag handle for a worktree without a sortable sibling", () => {
    const markup = renderToStaticMarkup(
      <SortableWorktreeCardList
        groups={[group()]}
        activeWorktreeKey={null}
        worktreeConversationExpandedByKey={{}}
        removingWorktreeKey={null}
        onSelect={() => {}}
        onWorktreeConversationExpandedChange={() => {}}
        onDeleteWorktree={() => {}}
        onContextMenu={() => {}}
        onReorder={() => {}}
      />,
    );

    expect(markup).not.toContain("Reorder worktree");
  });
});
