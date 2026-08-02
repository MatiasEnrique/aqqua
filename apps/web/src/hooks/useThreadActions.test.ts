import { EnvironmentId, ThreadId } from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { THREAD_DELETION_CLEANUP_BOUNDARY, ThreadArchiveBlockedError } from "./useThreadActions";

describe("ThreadArchiveBlockedError", () => {
  it("keeps the blocked thread context with the fixed message", () => {
    const error = new ThreadArchiveBlockedError({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });

    expect(error).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
    });
    expect(error.message).toBe("Cannot archive a running thread.");
  });
});

describe("THREAD_DELETION_CLEANUP_BOUNDARY", () => {
  it("documents server-owned session/terminal cleanup and client best-effort worktrees", () => {
    // Delete is not an atomic client operation: conversation deletion succeeds
    // independently of reactor cleanup and optional worktree removal.
    expect(THREAD_DELETION_CLEANUP_BOUNDARY).toEqual({
      conversationDelete: "server-command",
      providerSessionStop: "thread-deletion-reactor",
      terminalCloseWithHistory: "thread-deletion-reactor",
      worktreeRemoval: "client-best-effort-after-delete",
    });
    expect(THREAD_DELETION_CLEANUP_BOUNDARY.providerSessionStop).not.toBe("client-before-delete");
    expect(THREAD_DELETION_CLEANUP_BOUNDARY.terminalCloseWithHistory).not.toBe(
      "client-before-delete",
    );
  });
});
