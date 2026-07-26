import { describe, expect, it } from "vite-plus/test";
import {
  type OrchestrationSession,
  type OrchestrationSessionStatus,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import {
  claimedThreadIdsFromBindings,
  ORPHANED_SESSION_DETAIL,
  selectOrphanedSessions,
  type OrphanedSessionCandidate,
} from "./orphanedSessions.ts";

const stoppedAt = "2026-07-25T23:32:01.000Z";
const nothingClaimed: ReadonlySet<string> = new Set();

function session(overrides: {
  readonly threadId: string;
  readonly status: OrchestrationSessionStatus;
  readonly activeTurnId?: string | null;
}): OrchestrationSession {
  return {
    threadId: ThreadId.make(overrides.threadId),
    status: overrides.status,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex-default"),
    runtimeMode: "full-access",
    activeTurnId:
      overrides.activeTurnId === undefined || overrides.activeTurnId === null
        ? null
        : TurnId.make(overrides.activeTurnId),
    lastError: null,
    updatedAt: "2026-07-25T23:26:01.838Z",
  };
}

function thread(id: string, sessionValue: OrchestrationSession | null): OrphanedSessionCandidate {
  return { id: ThreadId.make(id), session: sessionValue };
}

const running = (id: string, turnId: string) =>
  thread(id, session({ threadId: id, status: "running", activeTurnId: turnId }));

describe("selectOrphanedSessions", () => {
  it("stops a running session and drops the turn no provider will complete", () => {
    const orphaned = selectOrphanedSessions({
      threads: [running("thread-1", "turn-1")],
      claimedThreadIds: nothingClaimed,
      stoppedAt,
    });

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.threadId).toBe("thread-1");
    expect(orphaned[0]?.session.status).toBe("stopped");
    expect(orphaned[0]?.session.activeTurnId).toBeNull();
    expect(orphaned[0]?.session.lastError).toBe(ORPHANED_SESSION_DETAIL);
    expect(orphaned[0]?.session.updatedAt).toBe(stoppedAt);
  });

  it("stops a starting session, which strands a thread just as running does", () => {
    const orphaned = selectOrphanedSessions({
      threads: [thread("thread-1", session({ threadId: "thread-1", status: "starting" }))],
      claimedThreadIds: nothingClaimed,
      stoppedAt,
    });

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.session.status).toBe("stopped");
  });

  it("preserves the provider binding so the thread can resume on the next turn", () => {
    const orphaned = selectOrphanedSessions({
      threads: [running("thread-1", "turn-1")],
      claimedThreadIds: nothingClaimed,
      stoppedAt,
    });

    expect(orphaned[0]?.session.providerName).toBe("codex");
    expect(orphaned[0]?.session.providerInstanceId).toBe("codex-default");
    expect(orphaned[0]?.session.runtimeMode).toBe("full-access");
  });

  it("leaves a claimed thread alone so a second server's live session survives", () => {
    const orphaned = selectOrphanedSessions({
      threads: [running("thread-1", "turn-1"), running("thread-2", "turn-2")],
      claimedThreadIds: new Set(["thread-1"]),
      stoppedAt,
    });

    expect(orphaned.map((entry) => entry.threadId)).toEqual(["thread-2"]);
  });

  it("leaves settled sessions alone so a clean boot issues no commands", () => {
    const threads = [
      thread("thread-1", session({ threadId: "thread-1", status: "ready" })),
      thread("thread-2", session({ threadId: "thread-2", status: "stopped" })),
      thread("thread-3", session({ threadId: "thread-3", status: "error" })),
      thread("thread-4", session({ threadId: "thread-4", status: "interrupted" })),
      thread("thread-5", session({ threadId: "thread-5", status: "idle" })),
      thread("thread-6", null),
    ];

    expect(
      selectOrphanedSessions({ threads, claimedThreadIds: nothingClaimed, stoppedAt }),
    ).toEqual([]);
  });

  it("collects every stranded thread, not just the first", () => {
    const threads = [
      running("thread-1", "turn-1"),
      thread("thread-2", session({ threadId: "thread-2", status: "ready" })),
      running("thread-3", "turn-3"),
      thread("thread-4", session({ threadId: "thread-4", status: "starting" })),
    ];

    const orphaned = selectOrphanedSessions({
      threads,
      claimedThreadIds: nothingClaimed,
      stoppedAt,
    });

    expect(orphaned.map((entry) => entry.threadId)).toEqual(["thread-1", "thread-3", "thread-4"]);
  });
});

describe("claimedThreadIdsFromBindings", () => {
  it("treats a released binding as unclaimed and everything else as claimed", () => {
    const claimed = claimedThreadIdsFromBindings([
      { threadId: ThreadId.make("thread-stopped"), status: "stopped" },
      { threadId: ThreadId.make("thread-running"), status: "running" },
      { threadId: ThreadId.make("thread-starting"), status: "starting" },
    ]);

    expect(claimed.has("thread-stopped")).toBe(false);
    expect(claimed.has("thread-running")).toBe(true);
    expect(claimed.has("thread-starting")).toBe(true);
  });

  it("treats a binding with no status as claimed rather than guessing it is dead", () => {
    const claimed = claimedThreadIdsFromBindings([
      { threadId: ThreadId.make("thread-unknown"), status: undefined },
    ]);

    expect(claimed.has("thread-unknown")).toBe(true);
  });

  it("claims nothing when the directory is empty", () => {
    expect(claimedThreadIdsFromBindings([]).size).toBe(0);
  });
});
