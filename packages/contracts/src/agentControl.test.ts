import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AgentAwaitResponse,
  AgentErrorResponse,
  AgentListResponse,
  AgentRunStatus,
  AgentSpawnRequest,
} from "./agentControl.ts";

const decodeAgentRunStatus = Schema.decodeUnknownSync(AgentRunStatus);
const decodeAgentSpawnRequest = Schema.decodeUnknownSync(AgentSpawnRequest);
const decodeAgentAwaitResponse = Schema.decodeUnknownSync(AgentAwaitResponse);
const decodeAgentListResponse = Schema.decodeUnknownSync(AgentListResponse);
const decodeAgentErrorResponse = Schema.decodeUnknownSync(AgentErrorResponse);

it("accepts every agent run status and rejects values outside the wire union", () => {
  for (const status of ["completed", "failed", "interrupted", "running"]) {
    assert.equal(decodeAgentRunStatus(status), status);
  }
  assert.throws(() => decodeAgentRunStatus("queued"));
});

it("decodes request and response envelopes", () => {
  assert.deepEqual(decodeAgentSpawnRequest({ profile: "implementer", task: "x" }), {
    profile: "implementer",
    task: "x",
  });
  assert.deepEqual(
    decodeAgentAwaitResponse({
      threadId: "thread-1",
      status: "completed",
      finalMessage: "done",
      sequence: 2,
    }),
    {
      threadId: "thread-1",
      status: "completed",
      finalMessage: "done",
      sequence: 2,
    },
  );
  assert.deepEqual(
    decodeAgentListResponse({
      agents: [
        {
          threadId: "thread-1",
          profile: "implementer",
          title: "Fix the seam",
          status: "running",
          updatedAt: "2026-07-25T21:00:00.000Z",
        },
      ],
    }).agents[0]?.status,
    "running",
  );
  assert.deepEqual(decodeAgentErrorResponse({ error: "invalid_request", message: "bad body" }), {
    error: "invalid_request",
    message: "bad body",
  });
});

it("rejects incomplete response envelopes", () => {
  assert.throws(() =>
    decodeAgentAwaitResponse({
      threadId: "thread-1",
      status: "completed",
      finalMessage: null,
    }),
  );
  assert.throws(() => decodeAgentListResponse({ agents: [{}] }));
});
