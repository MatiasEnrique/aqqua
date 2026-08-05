import { assert, describe, it } from "@effect/vitest";
import type * as CodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexThreadListParams,
  matchesCodexResumeCursor,
  parseCodexReadSession,
} from "./CodexProvider.ts";

describe("Codex external sessions", () => {
  it("pins CLI-only exact-cwd state DB thread/list params", () => {
    assert.deepEqual(buildCodexThreadListParams(["/repo", "/repo-worktree"]), {
      cwd: ["/repo", "/repo-worktree"],
      sourceKinds: ["cli"],
      useStateDbOnly: true,
      limit: 100,
    });
  });

  it("matches only the provider-native thread id cursor", () => {
    assert.isTrue(matchesCodexResumeCursor("thread-1", { threadId: "thread-1" }));
    assert.isFalse(matchesCodexResumeCursor("thread-1", { resume: "thread-1" }));
  });

  it("maps only visible user and assistant messages and honors the boundary", () => {
    const response = {
      thread: {
        id: "thread-1",
        sessionId: "session-tree-1",
        source: "cli",
        cwd: "/repo",
        name: null,
        preview: "First question",
        cliVersion: "1.0.0",
        createdAt: 100,
        updatedAt: 200,
        ephemeral: false,
        modelProvider: "openai",
        status: { type: "idle" },
        turns: [
          {
            id: "turn-1",
            status: "completed",
            startedAt: 100,
            items: [
              { id: "u1", type: "userMessage", content: [{ type: "text", text: "Question" }] },
              { id: "tool1", type: "contextCompaction" },
              { id: "a1", type: "agentMessage", text: "Answer" },
              { id: "u2", type: "userMessage", content: [{ type: "text", text: "Later" }] },
            ],
          },
        ],
      },
    } satisfies CodexSchema.V2ThreadReadResponse;

    const result = parseCodexReadSession(response, "a1");

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["u1", "a1"],
    );
    assert.equal(result.session.sessionId, "thread-1");
    assert.equal(result.session.messageCount, 2);
    assert.equal(result.boundaryUuid, "a1");
  });

  it("re-reads a thread adopted while it held no visible messages", () => {
    const empty = makeCodexThreadResponse([]);
    const adopted = parseCodexReadSession(empty, undefined);
    // With nothing to point at, adoption records the thread id itself.
    assert.equal(adopted.boundaryUuid, "thread-1");
    assert.deepEqual(adopted.messages, []);

    // That boundary matches no item, so a later read must still succeed rather
    // than report the adopted history as lost.
    const laterRead = parseCodexReadSession(
      makeCodexThreadResponse([
        { id: "u1", type: "userMessage", content: [{ type: "text", text: "Question" }] },
      ]),
      adopted.boundaryUuid,
    );
    assert.deepEqual(
      laterRead.messages.map((message) => message.messageId),
      ["u1"],
    );
  });

  it("treats a boundary that no longer renders as text as found", () => {
    const response = makeCodexThreadResponse([
      { id: "u1", type: "userMessage", content: [{ type: "text", text: "Question" }] },
      { id: "a1", type: "agentMessage", text: "" },
    ]);

    const result = parseCodexReadSession(response, "a1");

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["u1"],
    );
  });
});

function makeCodexThreadResponse(items: ReadonlyArray<unknown>): CodexSchema.V2ThreadReadResponse {
  return {
    thread: {
      id: "thread-1",
      sessionId: "session-tree-1",
      source: "cli",
      cwd: "/repo",
      name: null,
      preview: "First question",
      cliVersion: "1.0.0",
      createdAt: 100,
      updatedAt: 200,
      ephemeral: false,
      modelProvider: "openai",
      status: { type: "idle" },
      turns: [{ id: "turn-1", status: "completed", startedAt: 100, items }],
    },
  } as CodexSchema.V2ThreadReadResponse;
}
