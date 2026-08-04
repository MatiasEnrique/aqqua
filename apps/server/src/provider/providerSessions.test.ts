import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderExternalSession,
  ThreadId,
} from "@aqqua/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchesClaudeResumeCursor } from "./Drivers/ClaudeSessions.ts";
import { excludeOwnedProviderSessions } from "./providerSessions.ts";

const externalSession = (sessionId: string): ProviderExternalSession => ({
  sessionId,
  title: `Session ${sessionId}`,
  cwd: "/repo",
  updatedAt: "2026-08-04T12:00:00.000Z",
  messageCount: 2,
});

describe("excludeOwnedProviderSessions", () => {
  it("drops a Claude CLI session already bound to the same provider instance", () => {
    const instanceId = ProviderInstanceId.make("claude-work");
    const ownedSessionId = "00000000-0000-4000-8000-000000000001";
    const availableSessionId = "00000000-0000-4000-8000-000000000002";

    expect(
      excludeOwnedProviderSessions(
        [externalSession(ownedSessionId), externalSession(availableSessionId)],
        { instanceId, matchesResumeCursor: matchesClaudeResumeCursor },
        [
          {
            threadId: ThreadId.make("thread-owned"),
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: instanceId,
            resumeCursor: { resume: ownedSessionId },
          },
        ],
      ).map((session) => session.sessionId),
    ).toEqual([availableSessionId]);
  });

  it("keeps a matching id owned by another provider instance", () => {
    const sharedSessionId = "00000000-0000-4000-8000-000000000003";
    expect(
      excludeOwnedProviderSessions(
        [externalSession(sharedSessionId)],
        {
          instanceId: ProviderInstanceId.make("claude-work"),
          matchesResumeCursor: matchesClaudeResumeCursor,
        },
        [
          {
            threadId: ThreadId.make("thread-other"),
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: ProviderInstanceId.make("claude-personal"),
            resumeCursor: { resume: sharedSessionId },
          },
        ],
      ).map((session) => session.sessionId),
    ).toEqual([sharedSessionId]);
  });
});
