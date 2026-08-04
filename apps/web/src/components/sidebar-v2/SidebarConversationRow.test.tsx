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
  return markup.match(/<div role="button"[^>]*>.*?<\/div>/s)?.[0] ?? null;
}

describe("SidebarConversationRow", () => {
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

  it("keeps card and compact controls outside the row activation target", () => {
    for (const variantAction of ["settle", "unsettle", "unsnooze"] as const) {
      const markup = renderToStaticMarkup(
        <SidebarConversationRow
          {...baseProps}
          variant={variantAction === "settle" ? "card" : "slim"}
          variantAction={variantAction}
          settlementSupported
          snoozeSupported
          childCount={1}
        />,
      );

      const activation = activationTarget(markup);
      expect(activation).not.toBeNull();
      expect(activation).not.toContain("<button");
      expect(activation).not.toContain("<input");
      expect(markup).toContain(`data-testid="sidebar-v2-subagent-toggle-${thread.id}"`);
    }
  });
});
