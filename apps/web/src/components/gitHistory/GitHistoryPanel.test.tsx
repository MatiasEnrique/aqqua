import {
  EnvironmentId,
  type GitHistoryCommitSummary,
  type GitObjectId,
  ThreadId,
} from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  historyTarget: null as {
    environmentId: EnvironmentId;
    cwd: string;
    includeOrigin: boolean;
  } | null,
  history: {
    data: null as {
      commits: GitHistoryCommitSummary[];
      isRepo: boolean;
      nextCursor: number | null;
      referencesTruncated: boolean;
    } | null,
    commits: [] as GitHistoryCommitSummary[],
    initialError: null as string | null,
    olderError: null as string | null,
    isPending: false,
    isLoadingOlder: false,
    refresh: vi.fn(),
    loadOlder: vi.fn(),
    retryOlder: vi.fn(),
  },
}));

vi.mock("./gitHistoryQuery", () => ({
  usePaginatedGitHistory: (target: {
    environmentId: EnvironmentId;
    cwd: string;
    includeOrigin: boolean;
  }) => {
    testState.historyTarget = target;
    return testState.history;
  },
}));
vi.mock("../DiffPanel", () => ({
  default: ({
    commitTarget,
  }: {
    commitTarget?: { commitId: GitObjectId; cwd: string; label: string };
  }) => (
    <div
      data-testid="regular-diff-panel"
      data-commit-id={commitTarget?.commitId}
      data-cwd={commitTarget?.cwd}
    >
      {commitTarget?.label}
    </div>
  ),
}));

import { GitHistoryCommitPane, GitHistoryPanel } from "./GitHistoryPanel";

const environmentId = EnvironmentId.make("environment-test");
const threadRef = { environmentId, threadId: ThreadId.make("thread-test") };
const commitId = "a".repeat(40) as GitObjectId;
const commit: GitHistoryCommitSummary = {
  id: commitId,
  parentIds: [],
  subject: "Add history viewer",
  authorName: "Test Author",
  authorEmail: "test@example.com",
  authoredAt: "2026-07-29T12:00:00.000Z",
  committedAt: "2026-07-29T12:00:00.000Z",
  isHead: true,
  refs: [
    { name: "main", kind: "local_branch", current: true },
    { name: "v1.0.0", kind: "tag", current: false },
  ],
};

function renderPanel(): string {
  return renderToStaticMarkup(
    <GitHistoryPanel
      environmentId={environmentId}
      cwd="/tmp/repo"
      timestampFormat="24-hour"
      composerDraftTarget={threadRef}
      threadRef={threadRef}
      workspaceRef={null}
    />,
  );
}

beforeEach(() => {
  testState.historyTarget = null;
  testState.history.data = null;
  testState.history.commits = [];
  testState.history.initialError = null;
  testState.history.olderError = null;
  testState.history.isPending = false;
  testState.history.isLoadingOlder = false;
  testState.history.refresh.mockReset();
  testState.history.loadOlder.mockReset();
  testState.history.retryOlder.mockReset();
});

describe("GitHistoryPanel", () => {
  it("defaults to local commits and renders the origin opt-in", () => {
    const markup = renderPanel();

    expect(markup).toContain("Include origin");
    expect(markup).toContain('aria-label="Include origin commits"');
    expect(testState.historyTarget).toMatchObject({ includeOrigin: false });
  });

  it("renders loading, initial error, and unborn repository states distinctly", () => {
    testState.history.isPending = true;
    expect(renderPanel()).toContain('aria-label="Loading Git history"');

    testState.history.isPending = false;
    testState.history.initialError = "Git failed";
    expect(renderPanel()).toContain("Could not load Git history");
    expect(renderPanel()).toContain("Git failed");

    testState.history.initialError = null;
    testState.history.data = {
      commits: [],
      isRepo: true,
      nextCursor: null,
      referencesTruncated: false,
    };
    expect(renderPanel()).toContain("No commits yet");
  });

  it("renders commit identity, refs, selection semantics, and the graph on the right", () => {
    testState.history.data = {
      commits: [commit],
      isRepo: true,
      nextCursor: 100,
      referencesTruncated: false,
    };
    testState.history.commits = [commit];

    const markup = renderPanel();
    expect(markup).toContain("Add history viewer");
    expect(markup).toContain("HEAD");
    expect(markup).toContain("main");
    expect(markup).toContain("v1.0.0");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("Load older commits");
    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('data-testid="regular-diff-panel"');
    expect(markup.indexOf('data-history-pane="diff"')).toBeLessThan(
      markup.indexOf('data-history-pane="graph"'),
    );
  });

  it("mounts the regular diff viewer with only the selected commit target", () => {
    const markup = renderToStaticMarkup(
      <GitHistoryCommitPane
        environmentId={environmentId}
        cwd="/tmp/repo"
        commit={commit}
        composerDraftTarget={threadRef}
        threadRef={threadRef}
        workspaceRef={null}
        onBack={() => undefined}
      />,
    );

    expect(markup).toContain('data-testid="regular-diff-panel"');
    expect(markup).toContain(`data-commit-id="${commitId}"`);
    expect(markup).toContain('data-cwd="/tmp/repo"');
    expect(markup).toContain("Add history viewer");
    expect(markup).not.toContain("Author");
    expect(markup).not.toContain("Parents");
    expect(markup).not.toContain("Changed files");
  });

  it("keeps loaded rows visible while showing an older-page retry", () => {
    testState.history.data = {
      commits: [commit],
      isRepo: true,
      nextCursor: 100,
      referencesTruncated: true,
    };
    testState.history.commits = [commit];
    testState.history.olderError = "Older page failed";

    const markup = renderPanel();
    expect(markup).toContain("Add history viewer");
    expect(markup).toContain("Older page failed");
    expect(markup).toContain("Retry older commits");
    expect(markup).toContain("Some reference labels were omitted");
  });

  it("keeps cached rows visible when first-page revalidation fails", () => {
    testState.history.data = {
      commits: [commit],
      isRepo: true,
      nextCursor: null,
      referencesTruncated: false,
    };
    testState.history.commits = [commit];
    testState.history.initialError = "Refresh failed";

    const markup = renderPanel();
    expect(markup).toContain("Add history viewer");
    expect(markup).toContain("Refresh failed");
    expect(markup).toContain(">Retry<");
  });
});
