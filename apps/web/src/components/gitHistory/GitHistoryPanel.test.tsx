import { EnvironmentId, type GitHistoryCommitSummary, type GitObjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  details: {
    data: null as {
      commitId: GitObjectId;
      committerName: string;
      committerEmail: string;
      committedAt: string;
      body: string;
      bodyTruncated: boolean;
      comparisonParentId: GitObjectId | null;
      files: Array<{
        path: string;
        previousPath: string | null;
        kind: "renamed";
        insertions: number | null;
        deletions: number | null;
        binary: boolean;
      }>;
      filesTruncated: boolean;
    } | null,
    error: null as string | null,
    isPending: false,
    refresh: vi.fn(),
  },
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
  usePaginatedGitHistory: () => testState.history,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => testState.details,
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({
    copyToClipboard: testState.copyToClipboard,
    isCopied: false,
  }),
}));

import { GitHistoryCommitDetails, GitHistoryPanel } from "./GitHistoryPanel";

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
      environmentId={EnvironmentId.make("environment-test")}
      cwd="/tmp/repo"
      timestampFormat="24-hour"
    />,
  );
}

beforeEach(() => {
  testState.history.data = null;
  testState.history.commits = [];
  testState.history.initialError = null;
  testState.history.olderError = null;
  testState.history.isPending = false;
  testState.history.isLoadingOlder = false;
  testState.history.refresh.mockReset();
  testState.history.loadOlder.mockReset();
  testState.history.retryOlder.mockReset();
  testState.copyToClipboard.mockReset();
  testState.details.data = null;
  testState.details.error = null;
  testState.details.isPending = false;
  testState.details.refresh.mockReset();
});

describe("GitHistoryPanel", () => {
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

  it("renders commit identity, textual refs, selection semantics, and pagination", () => {
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

  it("renders first-parent details, rename paths, binary counts, and truncation notices", () => {
    const parentId = "b".repeat(40) as GitObjectId;
    testState.details.data = {
      commitId,
      committerName: "Test Committer",
      committerEmail: "committer@example.com",
      committedAt: "2026-07-29T12:30:00.000Z",
      body: "Detailed body",
      bodyTruncated: true,
      comparisonParentId: parentId,
      files: [
        {
          path: "new.bin",
          previousPath: "old.bin",
          kind: "renamed",
          insertions: null,
          deletions: null,
          binary: true,
        },
      ],
      filesTruncated: true,
    };

    const markup = renderToStaticMarkup(
      <GitHistoryCommitDetails
        environmentId={EnvironmentId.make("environment-test")}
        cwd="/tmp/repo"
        commit={{ ...commit, parentIds: [parentId] }}
        timestampFormat="24-hour"
        onBack={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Back to Git history"');
    expect(markup).toContain('aria-label="Copy full commit SHA"');
    expect(markup).toContain("Changes against first parent");
    expect(markup).toContain("old.bin → new.bin");
    expect(markup).toContain("Binary · counts unavailable");
    expect(markup).toContain("Commit message was truncated");
    expect(markup).toContain("Changed-file details were truncated");
  });
});
