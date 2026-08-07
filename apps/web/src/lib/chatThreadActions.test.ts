import { scopeProjectRef } from "@aqqua/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@aqqua/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  resolveConversationTabNewThreadAction,
  resolveThreadActionProjectRef,
  resolveNewDraftStartFromOrigin,
  startNewThreadFromContext,
  type ChatThreadActionContext,
} from "./chatThreadActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");

function createContext(overrides: Partial<ChatThreadActionContext> = {}): ChatThreadActionContext {
  return {
    activeDraftThread: null,
    activeThread: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    handleNewThread: async () => {},
    ...overrides,
  };
}

describe("chatThreadActions", () => {
  it("targets the selected worktree's project instead of a different active conversation", () => {
    expect(
      resolveConversationTabNewThreadAction({
        activeProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
        activeWorktree: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          isProjectCheckout: false,
          label: "feature/header-refactor",
          workspaceRoot: "/repo/.aqqua/worktrees/header-refactor",
        },
      }),
    ).toEqual({
      _tag: "create",
      projectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      options: {
        branch: "feature/header-refactor",
        worktreePath: "/repo/.aqqua/worktrees/header-refactor",
        envMode: "worktree",
        startFromOrigin: false,
      },
    });
  });

  it("starts a project checkout's thread in the project itself, not in a worktree", () => {
    expect(
      resolveConversationTabNewThreadAction({
        activeProjectRef: null,
        activeWorktree: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          isProjectCheckout: true,
          label: "main",
          workspaceRoot: "/repo",
        },
      }),
    ).toEqual({
      _tag: "create",
      projectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      options: {
        branch: "main",
        // `local` with no path: the checkout already exists, so the send path
        // must reuse it rather than cutting a worktree named after it.
        worktreePath: null,
        envMode: "local",
        startFromOrigin: false,
      },
    });
  });

  it("carries no worktree options for a worktree that has not been created yet", () => {
    expect(
      resolveConversationTabNewThreadAction({
        activeProjectRef: null,
        activeWorktree: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          isProjectCheckout: false,
          label: "New worktree · draft",
          workspaceRoot: null,
        },
      }),
      // Naming a branch for a tree with no path would ask the send path to
      // reuse a worktree that does not exist.
    ).toEqual({ _tag: "create", projectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID) });
  });

  it("asks for a project when neither a conversation nor worktree is selected", () => {
    expect(
      resolveConversationTabNewThreadAction({
        activeProjectRef: null,
        activeWorktree: null,
      }),
    ).toEqual({ _tag: "choose-project" });
  });

  it("uses the active conversation's project when no worktree is selected", () => {
    const activeProjectRef = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

    expect(
      resolveConversationTabNewThreadAction({
        activeProjectRef,
        activeWorktree: null,
      }),
    ).toEqual({ _tag: "create", projectRef: activeProjectRef });
  });

  it("only applies the start-from-origin default to new worktree drafts", () => {
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "worktree",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(true);
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "local",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(false);
  });

  it("prefers the active thread project when resolving thread actions", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the active draft thread project when there is no active thread", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the default project ref when there is no active thread context", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("inherits only the project from context, never branch or worktree state", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("does not start a thread when there is no project context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        defaultProjectRef: null,
        handleNewThread,
      }),
    );

    expect(didStart).toBe(false);
    expect(handleNewThread).not.toHaveBeenCalled();
  });
});
