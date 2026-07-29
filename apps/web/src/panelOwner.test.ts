import {
  scopeThreadRef,
  scopedThreadKey,
  scopedWorkspaceKey,
} from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  migratePanelOwnerKeyRecord,
  migratePanelOwnerStorageKey,
  panelOwnerKey,
  resolvePanelOwner,
  threadPanelOwner,
  workspacePanelOwner,
} from "./panelOwner";

const threadRef = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const workspaceRef = {
  environmentId: threadRef.environmentId,
  workspaceRoot: "/tmp/project/.worktrees/feature",
};

describe("panelOwner", () => {
  it("keys thread and workspace owners distinctly without fabricating ThreadIds", () => {
    const threadOwner = threadPanelOwner(threadRef);
    const workspaceOwner = workspacePanelOwner(workspaceRef)!;

    expect(panelOwnerKey(threadOwner)).toBe(scopedThreadKey(threadRef));
    expect(panelOwnerKey(workspaceOwner)).toBe(scopedWorkspaceKey(workspaceRef));
    expect(panelOwnerKey(threadOwner)).not.toBe(panelOwnerKey(workspaceOwner));
    expect(workspaceOwner).toEqual({ type: "workspace", workspaceRef });
    expect(workspaceOwner).not.toHaveProperty("threadId");
    expect(workspaceOwner).not.toHaveProperty("threadRef");
  });

  it("treats bare ScopedThreadRef as a thread owner", () => {
    expect(resolvePanelOwner(threadRef)).toEqual({ type: "thread", threadRef });
    expect(panelOwnerKey(threadRef)).toBe(scopedThreadKey(threadRef));
  });

  it("migrates legacy synthetic workspace ThreadId keys", () => {
    const legacyKey = `${threadRef.environmentId}:workspace-root:${workspaceRef.workspaceRoot}`;
    const expected = scopedWorkspaceKey(workspaceRef);
    expect(migratePanelOwnerStorageKey(legacyKey)).toBe(expected);
    expect(migratePanelOwnerStorageKey(scopedThreadKey(threadRef))).toBe(
      scopedThreadKey(threadRef),
    );
  });

  it("migrates key records with first-write-wins on collisions", () => {
    const legacyKey = `${threadRef.environmentId}:workspace-root:${workspaceRef.workspaceRoot}`;
    const canonical = scopedWorkspaceKey(workspaceRef);
    const migrated = migratePanelOwnerKeyRecord({
      [legacyKey]: "legacy",
      [canonical]: "canonical",
      [scopedThreadKey(threadRef)]: "thread",
    });
    expect(migrated).toEqual({
      [canonical]: "legacy",
      [scopedThreadKey(threadRef)]: "thread",
    });
  });
});
