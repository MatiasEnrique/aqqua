import {
  scopeThreadRef,
  scopedThreadKey,
  scopedWorkspaceKey,
} from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  panelOwnerKey,
  threadPanelOwner,
  workspacePanelOwner,
  type PanelOwner,
} from "./panelOwner";
import {
  migratePersistedRightPanelState,
  rightPanelOwnerForKind,
  selectActiveRightPanel,
  selectActiveRightPanelContextSurface,
  selectActiveRightPanelSurface,
  selectRightPanelContextState,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const workspaceRef = {
  environmentId: refA.environmentId,
  workspaceRoot: "/tmp/project/.worktrees/feature",
};
const workspaceOwner = workspacePanelOwner(workspaceRef)!;

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("rightPanelStore", () => {
  it("drops the legacy singleton terminal surface during migration", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            activeSurfaceId: "terminal",
            surfaces: [
              { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
              { id: "terminal", kind: "terminal" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
        },
      },
    });
  });

  it("upgrades saved single-session terminal surfaces to split-capable surfaces", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "terminal:term-1",
            surfaces: [{ id: "terminal:term-1", kind: "terminal", resourceId: "term-1" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "terminal:term-1",
          surfaces: [
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
              originThreadId: "thread-A",
              terminalPanes: [{ terminalId: "term-1", originThreadId: "thread-A" }],
            },
          ],
        },
      },
    });
  });

  it("upgrades saved file surfaces with neutral reveal state", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "file:src/index.ts",
            surfaces: [{ id: "file:src/index.ts", kind: "file", relativePath: "src/index.ts" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "file:src/index.ts",
          surfaces: [
            {
              id: "file:src/index.ts",
              kind: "file",
              relativePath: "src/index.ts",
              revealLine: null,
              revealRequestId: 0,
            },
          ],
        },
      },
    });
  });

  it("drops malformed persisted descriptors without discarding valid surfaces", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "diff",
            surfaces: [null, { id: "mystery", kind: "unknown" }, { id: "diff", kind: "diff" }],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [{ id: "diff", kind: "diff" }],
        },
      },
    });
  });

  it("preserves a persisted History surface when migrating older state", () => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "history",
            surfaces: [
              { id: "diff", kind: "diff" },
              { id: "history", kind: "history" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "history",
          surfaces: [
            { id: "diff", kind: "diff" },
            { id: "history", kind: "history" },
          ],
        },
      },
    });
  });

  it("open sets the active panel for a thread", () => {
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refB)).toBeNull();
  });

  it("opening a different kind keeps both surfaces and activates the new one", () => {
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("preview");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toHaveLength(2);
  });

  it("reopening an inactive singleton activates its existing surface", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().open(refA, "diff");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        { id: "plan", kind: "plan" },
      ],
    });
  });

  it("keeps files as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().open(refA, "files");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
  });

  it("keeps history as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "history");
    useRightPanelStore.getState().open(refA, "history");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "history",
      surfaces: [{ id: "history", kind: "history" }],
    });
  });

  it("replaces the standalone explorer with peer file surfaces", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("removes persisted file surfaces when their workspace no longer exists", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "plan",
      surfaces: [{ id: "plan", kind: "plan" }],
    });

    useRightPanelStore.getState().openFile(refB, "conductor.json");
    useRightPanelStore.getState().reconcileFileSurfaces(refB, false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("close hides the panel without clearing its selected surface", () => {
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().close(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: "plan",
      surfaces: [{ id: "plan", kind: "plan" }],
    });
  });

  it("toggles empty panel visibility without creating a surface", () => {
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: null,
      surfaces: [],
    });

    useRightPanelStore.getState().toggleVisibility(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  });

  it("toggle hides the panel without discarding the active surface", () => {
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("diff");
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
  });

  it("toggle to a different kind switches active", () => {
    useRightPanelStore.getState().toggle(refA, "preview");
    useRightPanelStore.getState().toggle(refA, "plan");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("plan");
  });

  it("removeThread clears persisted state", () => {
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().removeThread(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBeNull();
  });

  it("close on never-opened thread is a no-op", () => {
    useRightPanelStore.getState().close(refA);
    expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  });

  it("tracks one surface per browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["browser:tab-a", "browser:tab-b"]);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "browser:tab-b",
      kind: "preview",
      resourceId: "tab-b",
    });
  });

  it("tracks one surface per terminal session", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openTerminal(refA, "term-2");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([
      {
        id: "terminal:term-1",
        kind: "terminal",
        resourceId: "term-1",
        terminalIds: ["term-1"],
        activeTerminalId: "term-1",
        originThreadId: "thread-A",
        terminalPanes: [{ terminalId: "term-1", originThreadId: "thread-A" }],
      },
      {
        id: "terminal:term-2",
        kind: "terminal",
        resourceId: "term-2",
        terminalIds: ["term-2"],
        activeTerminalId: "term-2",
        originThreadId: "thread-A",
        terminalPanes: [{ terminalId: "term-2", originThreadId: "thread-A" }],
      },
    ]);
    expect(state.activeSurfaceId).toBe("terminal:term-2");
  });

  it("keeps the real origin thread when a terminal is stored in a workspace bucket", () => {
    useRightPanelStore.getState().openTerminal(workspaceOwner, "term-1", refA.threadId);

    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, workspaceOwner),
    ).toMatchObject({
      kind: "terminal",
      originThreadId: "thread-A",
      terminalPanes: [{ terminalId: "term-1", originThreadId: "thread-A" }],
    });
  });

  it("uses distinct canonical keys for thread and workspace owners", () => {
    const threadOwner = threadPanelOwner(refA);
    const threadKey = panelOwnerKey(threadOwner);
    const workspaceKey = panelOwnerKey(workspaceOwner);

    expect(threadKey).toBe(scopedThreadKey(refA));
    expect(workspaceKey).toBe(scopedWorkspaceKey(workspaceRef));
    expect(threadKey).not.toBe(workspaceKey);
    // Workspace ownership never fabricates a ThreadId / ScopedThreadRef key.
    expect(workspaceOwner).toEqual({
      type: "workspace",
      workspaceRef,
    });
    expect(workspaceOwner).not.toHaveProperty("threadId");
    expect(workspaceOwner).not.toHaveProperty("threadRef");
  });

  it("does not collide thread and workspace storage buckets for the same environment", () => {
    useRightPanelStore.getState().open(refA, "plan");
    useRightPanelStore.getState().open(workspaceOwner, "diff");

    const byThreadKey = useRightPanelStore.getState().byThreadKey;
    const threadKey = panelOwnerKey(refA);
    const workspaceKey = panelOwnerKey(workspaceOwner);

    expect(Object.keys(byThreadKey).sort()).toEqual([threadKey, workspaceKey].sort());
    expect(byThreadKey[threadKey]?.surfaces.map((surface) => surface.kind)).toEqual(["plan"]);
    expect(byThreadKey[workspaceKey]?.surfaces.map((surface) => surface.kind)).toEqual(["diff"]);
    expect(selectThreadRightPanelState(byThreadKey, refA).surfaces).toHaveLength(1);
    expect(selectThreadRightPanelState(byThreadKey, workspaceOwner).surfaces).toHaveLength(1);
  });

  it("migrates legacy synthetic workspace ThreadId keys to workspace owner keys", () => {
    const legacyWorkspaceKey = `${refA.environmentId}:workspace-root:${workspaceRef.workspaceRoot}`;
    const migrated = migratePersistedRightPanelState({
      byThreadKey: {
        [legacyWorkspaceKey]: {
          isOpen: true,
          activeSurfaceId: "diff",
          surfaces: [
            { id: "diff", kind: "diff" },
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
              originThreadId: "thread-A",
              terminalPanes: [{ terminalId: "term-1", originThreadId: "thread-A" }],
            },
          ],
        },
      },
    });

    const expectedKey = panelOwnerKey(workspaceOwner);
    expect(Object.keys(migrated.byThreadKey)).toEqual([expectedKey]);
    expect(migrated.byThreadKey[expectedKey]).toMatchObject({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        {
          kind: "terminal",
          originThreadId: "thread-A",
          terminalIds: ["term-1"],
        },
      ],
    });
    // Workspace open does not require constructing a ThreadId.
    expect(workspaceOwner.type).toBe("workspace");
  });

  it("routes kinds to thread vs workspace owners without synthetic ThreadIds", () => {
    const context = { threadRef: refA, workspaceRef };
    const planOwner = rightPanelOwnerForKind(context, "plan");
    const diffOwner = rightPanelOwnerForKind(context, "diff");
    const terminalOwner = rightPanelOwnerForKind(context, "terminal");

    expect(planOwner).toEqual({ type: "thread", threadRef: refA });
    expect(diffOwner).toEqual({ type: "workspace", workspaceRef });
    expect(terminalOwner).toEqual({ type: "workspace", workspaceRef });
    expect((diffOwner as PanelOwner & { type: "workspace" }).workspaceRef).not.toHaveProperty(
      "threadId",
    );
  });

  it("tracks split panes and the active pane within a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      originThreadId: "thread-A",
      terminalPanes: [
        { terminalId: "term-1", originThreadId: "thread-A" },
        { terminalId: "term-2", originThreadId: "thread-A" },
      ],
    });

    useRightPanelStore.getState().activateTerminal(refA, "terminal:term-1", "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-2"],
      activeTerminalId: "term-2",
      originThreadId: "thread-A",
      terminalPanes: [{ terminalId: "term-2", originThreadId: "thread-A" }],
    });
  });

  it("tracks vertical layout for a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2", "vertical");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      splitDirection: "vertical",
      originThreadId: "thread-A",
      terminalPanes: [
        { terminalId: "term-1", originThreadId: "thread-A" },
        { terminalId: "term-2", originThreadId: "thread-A" },
      ],
    });
  });

  it("closing the final terminal pane removes its surface and closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing the active surface activates a neighboring surface", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "browser:tab-a",
    );
  });

  it("closing the final surface closes the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("closing other surfaces keeps the selected surface active", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeOtherSurfaces(refA, "file:src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "browser:tab-a");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
    });
  });

  it("closing all surfaces closes the panel", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    useRightPanelStore.getState().closeAllSurfaces(refA);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("reconciles browser surfaces without deleting other surface kinds", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["tab-b", "tab-c"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["terminal:term-1", "browser:tab-b", "browser:tab-c"]);
  });

  it("shares workspace surfaces while keeping plan and browser surfaces per thread", () => {
    useRightPanelStore.getState().open(workspaceOwner, "diff");
    useRightPanelStore.getState().openFile(workspaceOwner, "src/index.ts");
    useRightPanelStore.getState().open(refA, "plan");

    const stateA = selectRightPanelContextState(useRightPanelStore.getState().byThreadKey, {
      threadRef: refA,
      workspaceRef,
    });
    const stateB = selectRightPanelContextState(useRightPanelStore.getState().byThreadKey, {
      threadRef: refB,
      workspaceRef,
    });

    expect(stateA.surfaces.map((surface) => surface.kind)).toEqual(["plan", "diff", "file"]);
    expect(stateB.surfaces.map((surface) => surface.kind)).toEqual(["diff", "file"]);
    expect(stateB.activeSurfaceId).toBe("file:src/index.ts");
  });

  it("is a pure derivation and allocates a fresh snapshot each call", () => {
    useRightPanelStore.getState().open(workspaceOwner, "diff");
    const byThreadKey = useRightPanelStore.getState().byThreadKey;
    const context = { threadRef: refA, workspaceRef };

    const firstSnapshot = selectRightPanelContextState(byThreadKey, context);
    const secondSnapshot = selectRightPanelContextState(byThreadKey, context);

    expect(firstSnapshot).toEqual({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
    // Pure selectors must not rely on global referential identity — ChatView
    // stabilizes this via useMemo on the byThreadKey subscription instead.
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot).toEqual(firstSnapshot);
  });

  it("ChatView-style byThreadKey subscription + local memo reaches a fixed point", () => {
    // Mirrors ChatView: subscribe to the stable record, derive the aggregate
    // snapshot with memoized deps (not inside a useSyncExternalStore selector).
    useRightPanelStore.getState().open(workspaceOwner, "diff");
    useRightPanelStore.getState().open(refA, "plan");

    const context = { threadRef: refA, workspaceRef };
    let memoDeps: readonly unknown[] | null = null;
    let memoizedSnapshot: ReturnType<typeof selectRightPanelContextState> | null = null;
    let derivationCount = 0;
    let renderCount = 0;

    const render = () => {
      renderCount += 1;
      // Selector: identity of the record only (Object.is stable when unchanged).
      const byThreadKey = useRightPanelStore.getState().byThreadKey;
      const deps = [byThreadKey, context] as const;
      if (
        !memoDeps ||
        deps.length !== memoDeps.length ||
        deps.some((dep, index) => !Object.is(dep, memoDeps![index]))
      ) {
        derivationCount += 1;
        memoizedSnapshot = selectRightPanelContextState(byThreadKey, context);
        memoDeps = deps;
      }
      const rightPanelState = memoizedSnapshot!;
      const activeSurface = rightPanelState.isOpen
        ? (rightPanelState.surfaces.find(
            (surface) => surface.id === rightPanelState.activeSurfaceId,
          ) ?? null)
        : null;
      return { byThreadKey, rightPanelState, activeSurface };
    };

    // Re-render loop with no store change must stabilize (no infinite updates).
    const first = render();
    const second = render();
    const third = render();

    expect(renderCount).toBe(3);
    expect(derivationCount).toBe(1);
    expect(second.byThreadKey).toBe(first.byThreadKey);
    expect(third.byThreadKey).toBe(first.byThreadKey);
    expect(second.rightPanelState).toBe(first.rightPanelState);
    expect(third.rightPanelState).toBe(first.rightPanelState);
    expect(second.activeSurface).toBe(first.activeSurface);
    expect(first.activeSurface).toMatchObject({ id: "plan", kind: "plan" });
    expect(first.rightPanelState.surfaces.map((surface) => surface.kind)).toEqual(["plan", "diff"]);

    // A real store write replaces byThreadKey and invalidates the memo once.
    // Close the thread plan so the workspace surface becomes the active one.
    useRightPanelStore.getState().closeSurface(refA, "plan");
    useRightPanelStore.getState().open(workspaceOwner, "history");
    const afterUpdate = render();
    const afterUpdateAgain = render();

    expect(derivationCount).toBe(2);
    expect(afterUpdate.byThreadKey).not.toBe(first.byThreadKey);
    expect(afterUpdate.rightPanelState).not.toBe(first.rightPanelState);
    expect(afterUpdateAgain.rightPanelState).toBe(afterUpdate.rightPanelState);
    expect(afterUpdate.rightPanelState.surfaces.map((surface) => surface.kind)).toEqual([
      "diff",
      "history",
    ]);
    expect(afterUpdate.activeSurface).toMatchObject({ id: "history", kind: "history" });
  });

  it("shares History across threads in the same workspace", () => {
    useRightPanelStore.getState().open(workspaceOwner, "history");

    const stateA = selectRightPanelContextState(useRightPanelStore.getState().byThreadKey, {
      threadRef: refA,
      workspaceRef,
    });
    const stateB = selectRightPanelContextState(useRightPanelStore.getState().byThreadKey, {
      threadRef: refB,
      workspaceRef,
    });

    expect(stateA.activeSurfaceId).toBe("history");
    expect(stateA.surfaces).toEqual([{ id: "history", kind: "history" }]);
    expect(stateB).toEqual(stateA);
  });

  it("lazily migrates legacy workspace surfaces and hiding keeps their resources", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "plan");
    store.open(refA, "diff");
    store.openTerminal(refA, "term-1");
    store.migrateLegacyWorkspaceSurfaces({ threadRef: refA, workspaceRef });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.kind,
      ),
    ).toEqual(["plan"]);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, workspaceOwner)
        .surfaces,
    ).toMatchObject([
      { kind: "diff" },
      { kind: "terminal", originThreadId: "thread-A", terminalIds: ["term-1"] },
    ]);

    useRightPanelStore.getState().close(workspaceOwner);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, workspaceOwner)
        .surfaces,
    ).toHaveLength(2);
    useRightPanelStore.getState().show(workspaceOwner);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, workspaceOwner).isOpen,
    ).toBe(true);
  });

  it("preserves colliding legacy terminal ids from different origin threads", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openTerminal(refB, "term-1");
    store.migrateLegacyWorkspaceSurfaces({ threadRef: refA, workspaceRef });
    store.migrateLegacyWorkspaceSurfaces({ threadRef: refB, workspaceRef });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, workspaceOwner)
        .surfaces,
    ).toMatchObject([
      { kind: "terminal", resourceId: "term-1", originThreadId: "thread-A" },
      { kind: "terminal", resourceId: "term-1", originThreadId: "thread-B" },
    ]);
  });

  it("hides a context without disposing resources and restores the last surface", () => {
    const context = {
      threadRef: refA,
      workspaceRef,
    };
    const store = useRightPanelStore.getState();
    store.open(workspaceOwner, "diff");
    store.close(workspaceOwner);
    store.open(refA, "plan");

    store.hideContext(context);
    expect(
      selectRightPanelContextState(useRightPanelStore.getState().byThreadKey, context),
    ).toEqual(
      expect.objectContaining({
        isOpen: false,
        surfaces: [
          expect.objectContaining({ kind: "plan" }),
          expect.objectContaining({ kind: "diff" }),
        ],
      }),
    );

    useRightPanelStore.getState().restoreContext(context);
    expect(
      selectActiveRightPanelContextSurface(useRightPanelStore.getState().byThreadKey, context),
    ).toMatchObject({ kind: "plan" });
  });
});
