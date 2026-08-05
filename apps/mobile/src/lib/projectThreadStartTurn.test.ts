import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@aqqua/contracts";
import { vi } from "vite-plus/test";
vi.mock("./composerImages", () => ({
  toUploadChatImageAttachments: () => [],
}));

import { buildProjectThreadStartTurnInput } from "./projectThreadStartTurn";

const BASE_SPEC = {
  projectId: ProjectId.make("project-1"),
  projectCwd: "/repo",
  threadId: "thread-1",
  commandId: "command-1",
  messageId: "message-1",
  createdAt: "2026-08-04T12:00:00.000Z",
  text: "Continue the work",
  attachments: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex-main"),
    model: "gpt-5.4",
  },
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  workspaceMode: "local" as const,
  branch: "main",
  worktreePath: "/repo/.aqqua/worktrees/feature",
  startFromOrigin: false,
  worktreeBranchName: "aqqua/temp",
};

describe("buildProjectThreadStartTurnInput", () => {
  it("threads an adopted provider session through the fresh-thread bootstrap", () => {
    const input = buildProjectThreadStartTurnInput({
      ...BASE_SPEC,
      resumeSession: {
        instanceId: ProviderInstanceId.make("codex-main"),
        sessionId: "external-thread-1",
      },
    });

    expect(input.bootstrap.resumeSession).toEqual({
      instanceId: "codex-main",
      sessionId: "external-thread-1",
    });
    expect(input.bootstrap.createThread?.worktreePath).toBe("/repo/.aqqua/worktrees/feature");
    expect(input.bootstrap.prepareWorktree).toBeUndefined();
  });

  it("does not add resume metadata to ordinary new tasks", () => {
    const input = buildProjectThreadStartTurnInput(BASE_SPEC);
    expect(input.bootstrap.resumeSession).toBeUndefined();
  });
});
