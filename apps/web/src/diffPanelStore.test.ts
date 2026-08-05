import {
  scopeThreadRef,
  scopedThreadKey,
  scopedWorkspaceKey,
} from "@aqqua/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@aqqua/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  migratePersistedDiffPanelState,
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
} from "./diffPanelStore";
import { panelOwnerKey, workspacePanelOwner } from "./panelOwner";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const WORKSPACE_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  workspaceRoot: "/repo",
};
const WORKSPACE_OWNER = workspacePanelOwner(WORKSPACE_REF)!;

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      branchHeadRefByThreadKey: {},
      visibleTurnThreadKey: null,
    }),
  );

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null, headRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "unstaged" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null, headRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main", headRef: null });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main", headRef: null });
  });

  it("normalizes and remembers the selected branch head across scope changes", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectBranchHeadRef(THREAD_REF, " feature/search ");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "branch",
      baseRef: "origin/main",
      headRef: "feature/search",
    });

    useDiffPanelStore.getState().selectBranchHeadRef(THREAD_REF, null);
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main", headRef: null });
  });

  it("resets a matching base when it becomes the selected head", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "feature/search");
    useDiffPanelStore.getState().selectBranchHeadRef(THREAD_REF, "feature/search");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null, headRef: "feature/search" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "feature/search");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null, headRef: "feature/search" });

    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null, headRef: "feature/search" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("migrates live scope into a workspace bucket while remembering a turn per thread", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().migrateLegacyWorkspaceSelection(THREAD_REF, WORKSPACE_REF);
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, WORKSPACE_OWNER),
    ).toEqual({ kind: "branch", baseRef: "origin/main", headRef: null });
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toMatchObject({ kind: "turn", turnId });
    expect(useDiffPanelStore.getState().visibleTurnThreadKey).toBe(
      `${THREAD_REF.environmentId}:${THREAD_REF.threadId}`,
    );
  });

  it("uses distinct canonical keys for thread and workspace owners", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(WORKSPACE_OWNER, "unstaged");

    const byThreadKey = useDiffPanelStore.getState().byThreadKey;
    const threadKey = panelOwnerKey(THREAD_REF);
    const workspaceKey = panelOwnerKey(WORKSPACE_OWNER);

    expect(threadKey).toBe(scopedThreadKey(THREAD_REF));
    expect(workspaceKey).toBe(scopedWorkspaceKey(WORKSPACE_REF));
    expect(threadKey).not.toBe(workspaceKey);
    expect(Object.keys(byThreadKey).sort()).toEqual([threadKey, workspaceKey].sort());
    expect(byThreadKey[threadKey]).toEqual({
      kind: "branch",
      baseRef: "origin/main",
      headRef: null,
    });
    expect(byThreadKey[workspaceKey]).toEqual({ kind: "unstaged" });
    // Workspace ownership never fabricates a ThreadId / ScopedThreadRef.
    expect(WORKSPACE_OWNER).toEqual({ type: "workspace", workspaceRef: WORKSPACE_REF });
    expect(WORKSPACE_OWNER).not.toHaveProperty("threadId");
    expect(WORKSPACE_OWNER).not.toHaveProperty("threadRef");
  });

  it("migrates legacy synthetic workspace ThreadId keys to workspace owner keys", () => {
    const legacyWorkspaceKey = `${WORKSPACE_REF.environmentId}:workspace-root:${WORKSPACE_REF.workspaceRoot}`;
    const migrated = migratePersistedDiffPanelState({
      byThreadKey: {
        [legacyWorkspaceKey]: { kind: "branch", baseRef: "origin/main" },
        [scopedThreadKey(THREAD_REF)]: {
          kind: "turn",
          turnId: TurnId.make("turn-1"),
          filePath: null,
          revealRequestId: 1,
        },
      },
      branchBaseRefByThreadKey: {
        [legacyWorkspaceKey]: "origin/main",
      },
    });

    const expectedWorkspaceKey = panelOwnerKey(WORKSPACE_OWNER);
    expect(Object.keys(migrated.byThreadKey).sort()).toEqual(
      [expectedWorkspaceKey, scopedThreadKey(THREAD_REF)].sort(),
    );
    expect(migrated.byThreadKey[expectedWorkspaceKey]).toEqual({
      kind: "branch",
      baseRef: "origin/main",
      headRef: null,
    });
    expect(migrated.branchBaseRefByThreadKey[expectedWorkspaceKey]).toBe("origin/main");
    expect(migrated.branchHeadRefByThreadKey).toEqual({});
    expect(migrated.byThreadKey[scopedThreadKey(THREAD_REF)]).toMatchObject({ kind: "turn" });
  });

  it("migrates v3 branch selections with a null head ref", () => {
    const threadKey = scopedThreadKey(THREAD_REF);
    const migrated = migratePersistedDiffPanelState({
      byThreadKey: {
        [threadKey]: { kind: "branch", baseRef: "origin/main" },
      },
      branchBaseRefByThreadKey: {
        [threadKey]: "origin/main",
      },
    });

    expect(migrated.byThreadKey[threadKey]).toEqual({
      kind: "branch",
      baseRef: "origin/main",
      headRef: null,
    });
    expect(migrated.branchHeadRefByThreadKey).toEqual({});
  });
});
