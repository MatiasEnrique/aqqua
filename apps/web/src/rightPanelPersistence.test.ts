import { describe, expect, it } from "vite-plus/test";

import { panelOwnerKey, workspacePanelOwner } from "./panelOwner";
import { migratePersistedRightPanelState } from "./rightPanelPersistence";
import { type EnvironmentId } from "@aqqua/contracts";

describe("rightPanelPersistence", () => {
  it("rewrites legacy synthetic workspace keys while preserving surfaces", () => {
    const environmentId = "env-1" as EnvironmentId;
    const workspaceRoot = "/tmp/project/.worktrees/feature";
    const legacyWorkspaceKey = `${environmentId}:workspace-root:${workspaceRoot}`;
    const expectedKey = panelOwnerKey(workspacePanelOwner({ environmentId, workspaceRoot })!);

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

    expect(Object.keys(migrated.byThreadKey)).toEqual([expectedKey]);
    expect(migrated.byThreadKey[expectedKey]).toMatchObject({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        { kind: "terminal", originThreadId: "thread-A", terminalIds: ["term-1"] },
      ],
    });
  });

  it("drops terminals that only have a synthetic workspace origin", () => {
    const migrated = migratePersistedRightPanelState({
      byThreadKey: {
        "env-1:workspace-root:/repo": {
          isOpen: true,
          activeSurfaceId: "terminal:term-1",
          surfaces: [
            {
              id: "terminal:term-1",
              kind: "terminal",
              resourceId: "term-1",
              // no originThreadId — legacy key must not become origin
            },
          ],
        },
      },
    });

    const state = Object.values(migrated.byThreadKey)[0];
    expect(state?.surfaces).toEqual([]);
    expect(state?.activeSurfaceId).toBeNull();
  });
});
