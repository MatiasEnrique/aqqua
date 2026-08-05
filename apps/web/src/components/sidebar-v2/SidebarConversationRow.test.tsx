import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@aqqua/contracts";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";

vi.mock("../../uiStateStore", () => ({
  useUiStateStore: <T,>(
    select: (state: { threadLastVisitedAtById: Readonly<Record<string, string>> }) => T,
  ) => select({ threadLastVisitedAtById: {} }),
}));

vi.mock("../../threadSelectionStore", () => ({
  useThreadSelectionStore: <T,>(
    select: (state: {
      selectedThreadKeys: ReadonlySet<string>;
      toggleThread: (threadKey: string) => void;
    }) => T,
  ) => select({ selectedThreadKeys: new Set(), toggleThread: () => {} }),
}));

vi.mock("../../lib/openPullRequestLink", () => ({ useOpenPrLink: () => () => {} }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: undefined }) }));

import { SidebarConversationRow, type SidebarConversationRowProps } from "./SidebarConversationRow";

const environmentId = EnvironmentId.make("environment-local");
const thread: EnvironmentThreadShell = {
  id: ThreadId.make("thread-parent"),
  environmentId,
  projectId: ProjectId.make("project-1"),
  parentThreadId: null,
  title: "Parent conversation",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-08-04T10:00:00.000Z",
  updatedAt: "2026-08-04T10:01:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: {
    threadId: ThreadId.make("thread-parent"),
    status: "idle",
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-08-04T10:01:00.000Z",
  },
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const baseProps = {
  thread,
  variant: "card",
  variantAction: "settle",
  settlementSupported: false,
  deletable: true,
  snoozeSupported: false,
  snoozeWakeLabelText: null,
  wokeAt: null,
  depth: 0,
  childCount: 0,
  subAgentStateCounts: null,
  reserveExpandGutter: false,
  isExpanded: false,
  onToggleExpanded: () => {},
  isActive: false,
  jumpLabel: null,
  environmentLabel: null,
  projectCwd: null,
  projectTitle: null,
  showProjectIdentity: false,
  showBranch: true,
  band: "single",
  providerEntryByInstanceId: new Map(),
  onThreadClick: () => {},
  onThreadActivate: () => {},
  onStartRename: () => {},
  onRenameTitleChange: () => {},
  onCommitRename: () => {},
  onCancelRename: () => {},
  isRenaming: false,
  renamingTitle: "",
  onContextMenu: () => {},
  onSettle: () => {},
  onUnsettle: () => {},
  onSnooze: () => {},
  onUnsnooze: () => {},
  onDelete: () => {},
  onChangeRequestState: () => {},
} satisfies SidebarConversationRowProps;

function activationTarget(markup: string): string | null {
  return markup.match(/<div role="button"[^>]*><\/div>/)?.[0] ?? null;
}

describe("SidebarConversationRow", () => {
  it("shows a sub-thread's status when its parent is expanded", () => {
    const markup = renderToStaticMarkup(
      <SidebarConversationRow
        {...baseProps}
        thread={{
          ...thread,
          parentThreadId: ThreadId.make("thread-orchestrator"),
          session: thread.session === null ? null : { ...thread.session, status: "running" },
        }}
        variant="sub"
        depth={1}
      />,
    );

    expect(markup).toContain('data-testid="sidebar-v2-row-sub"');
    expect(markup).toContain("Working");
  });

  it("keeps collapsed sub-agent states visible beside the parent's own state", () => {
    const markup = renderToStaticMarkup(
      <SidebarConversationRow
        {...baseProps}
        subAgentStateCounts={{ working: 1, needsInput: 1, done: 0, stale: 0, settled: 1 }}
      />,
    );

    expect(markup).toContain("Done");
    expect(markup).toContain(
      'aria-label="1 working conversation, 1 needs input conversation, 1 settled conversation"',
    );
    expect(markup).toContain('class="shrink-0"><span role="status"');
  });

  it("keeps card, compact, and sub-row controls outside the row activation target", () => {
    const variants = [
      { variant: "card", variantAction: "settle" },
      { variant: "slim", variantAction: "unsettle" },
      { variant: "slim", variantAction: "unsnooze" },
      { variant: "sub", variantAction: "settle" },
    ] as const;

    for (const { variant, variantAction } of variants) {
      const markup = renderToStaticMarkup(
        <SidebarConversationRow
          {...baseProps}
          variant={variant}
          variantAction={variantAction}
          settlementSupported
          deletable
          snoozeSupported
          childCount={1}
          depth={variant === "sub" ? 1 : 0}
        />,
      );

      const activation = activationTarget(markup);
      const label = `${variant}:${variantAction}`;
      expect(activation, label).not.toBeNull();
      expect(activation, label).not.toContain("<button");
      expect(activation, label).not.toContain("<input");
      expect(markup, label).toContain(
        variant === "sub"
          ? `aria-label="Expand sub-agents of ${thread.title}"`
          : `data-testid="sidebar-v2-subagent-toggle-${thread.id}"`,
      );
    }
  });

  it("keeps Un-settle but drops Delete on a settled conversation a flow owns", () => {
    const settledRow = (deletable: boolean) =>
      renderToStaticMarkup(
        <SidebarConversationRow
          {...baseProps}
          variant="slim"
          variantAction="unsettle"
          settlementSupported
          deletable={deletable}
        />,
      );

    expect(settledRow(true)).toContain('aria-label="Delete thread"');

    const owned = settledRow(false);
    expect(owned).not.toContain('aria-label="Delete thread"');
    expect(owned).toContain('aria-label="Un-settle thread"');
  });
});
