import { scopedThreadKey, scopeThreadRef } from "@aqqua/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aqqua/client-runtime/state/models";
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@aqqua/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: ({ cwd }: { cwd: string }) => <span data-project-favicon={cwd} />,
}));

/**
 * The shelf subscribes to the selection store directly rather than taking it
 * as a prop, so a drag repaints ten rows instead of the whole sidebar. Under
 * `renderToStaticMarkup` a zustand hook reports its INITIAL state, so the
 * selection these tests want to see has to be stubbed in.
 */
const selection = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock("../../threadSelectionStore", () => {
  const readState = () => ({
    selectedThreadKeys: selection.keys,
    removeFromSelection: () => {},
    clearSelection: () => {},
    toggleThread: () => {},
    rangeSelectTo: () => {},
    setSelection: () => {},
  });
  const useThreadSelectionStore = <T,>(selector: (state: ReturnType<typeof readState>) => T): T =>
    selector(readState());
  useThreadSelectionStore.getState = readState;
  return { useThreadSelectionStore };
});

const { SidebarSettledSection } = await import("./SidebarSettledSection");

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
  settledAt: "2026-09-08T09:06:00.000Z",
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

const threadKey = (settled: EnvironmentThreadShell) =>
  scopedThreadKey(scopeThreadRef(settled.environmentId, settled.id));

const render = (threads: readonly EnvironmentThreadShell[], selectedThreadKey: string | null) =>
  renderToStaticMarkup(
    <SidebarSettledSection
      threads={threads}
      projectCwdByKey={new Map([["local:project", "/repo"]])}
      projectDisplayNameByKey={new Map([["local:project", "aqqua"]])}
      selectedThreadKey={selectedThreadKey}
      onSelectThread={() => {}}
      onThreadContextMenu={() => {}}
      onRestoreThread={() => {}}
      onDeleteThreads={() => {}}
    />,
  );

describe("SidebarSettledSection", () => {
  afterEach(() => {
    selection.keys = new Set();
  });

  it("stays out of the sidebar entirely when nothing is settled", () => {
    expect(render([], null)).toBe("");
  });

  it("names the shelf and counts it while shut, without listing anything", () => {
    const markup = render([thread(), thread({ id: ThreadId.make("thread-2") })], null);

    expect(markup).toContain("Settled");
    expect(markup).toContain(">2<");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("Fix sidebar rows");
  });

  it("carries each settled conversation's project icon and name", () => {
    const settled = thread();
    const markup = render([settled], threadKey(settled));

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Fix sidebar rows");
    expect(markup).toContain('data-project-favicon="/repo"');
    expect(markup).toContain("aqqua");
  });

  it("offers the two actions a settled conversation has left", () => {
    const settled = thread();
    const markup = render([settled], threadKey(settled));

    expect(markup).toContain('aria-label="Restore conversation Fix sidebar rows"');
    expect(markup).toContain('aria-label="Delete conversation Fix sidebar rows"');
  });

  it("marks the quick delete as destructive so it never reads as one more nudge", () => {
    const markup = render([thread()], threadKey(thread()));

    expect(markup).toContain("hover:text-destructive");
  });

  it("opens itself on the routed conversation so route and list agree", () => {
    const routed = thread({ id: ThreadId.make("thread-2"), title: "Rework the header" });
    const markup = render([thread(), routed], threadKey(routed));

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Rework the header");
  });

  it("shows only the recent tail — settled work is history, not a second inbox", () => {
    const threads = Array.from({ length: 14 }, (_, index) =>
      thread({ id: ThreadId.make(`thread-${index}`), title: `Settled ${index}` }),
    );
    const markup = render(threads, threadKey(threads[0] as EnvironmentThreadShell));

    expect(markup).toContain(">14<");
    expect(markup).toContain("Settled 9");
    expect(markup).not.toContain("Settled 10");
  });

  it("stays out of the way until something is multi-selected", () => {
    const settled = thread();

    expect(render([settled], threadKey(settled))).not.toContain(
      "data-sidebar-settled-selection-bar",
    );
  });

  it("offers one delete for the whole selection, counting only the rows it shows", () => {
    const first = thread();
    const second = thread({ id: ThreadId.make("thread-2"), title: "Rework the header" });
    selection.keys = new Set([threadKey(first), threadKey(second), "local:thread-elsewhere"]);

    const markup = render([first, second], threadKey(first));

    expect(markup).toContain("data-sidebar-settled-selection-bar");
    expect(markup).toContain("2 selected");
    expect(markup).toContain("Delete");
    expect(markup).toContain('aria-label="Clear selection"');
  });

  it("marks selected rows so a marquee shows what it caught", () => {
    const first = thread();
    const second = thread({ id: ThreadId.make("thread-2"), title: "Rework the header" });
    selection.keys = new Set([threadKey(second)]);

    const markup = render([first, second], threadKey(first));

    expect(markup.match(/data-multi-selected/g)).toHaveLength(1);
  });
});
