import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AgentAwaitResponse,
  AgentErrorResponse,
  AgentListResponse,
  AgentModelsResponse,
  AgentRunStatus,
  AgentSpawnRequest,
  AgentSpawnResponse,
  AgentStandaloneSpawnRequest,
} from "./agentControl.ts";

const decodeAgentModelsResponse = Schema.decodeUnknownSync(AgentModelsResponse);
const decodeAgentSpawnResponse = Schema.decodeUnknownSync(AgentSpawnResponse);

it("decodes a canonical spawn that names an exact provider instance and model", () => {
  const request = decodeAgentSpawnRequest({
    task: "port the resolver",
    modelSelection: { instanceId: "pi_work", model: "anthropic/claude-sonnet-5" },
    reasoning: "high",
  });

  // Slugs carry dots and slashes; the wire must not normalize them away.
  assert.equal(request.modelSelection?.model, "anthropic/claude-sonnet-5");
  assert.equal(request.modelSelection?.instanceId, "pi_work");
  assert.equal(request.reasoning, "high");
  assert.equal(request.profile, undefined);
});

it("treats a spawn with no selector as canonical rather than rejecting it", () => {
  const request = decodeAgentSpawnRequest({ task: "x" });

  assert.equal(request.profile, undefined);
  assert.equal(request.modelSelection, undefined);
  assert.equal(request.reasoning, undefined);
});

it("still decodes a legacy profile spawn from an un-migrated client", () => {
  const request = decodeAgentSpawnRequest({ profile: "implementer", task: "x" });

  assert.equal(request.profile, "implementer");
  assert.equal(request.modelSelection, undefined);
});

it("rejects a blank reasoning level instead of treating it as 'no override'", () => {
  assert.throws(() => decodeAgentSpawnRequest({ task: "x", reasoning: "   " }));
});

it("keeps the spawn response shape old clients already read", () => {
  assert.deepEqual(
    decodeAgentSpawnResponse({ threadId: "thread-1", profile: "implementer", terminalId: null }),
    { threadId: "thread-1", profile: "implementer", terminalId: null },
  );
  assert.throws(() => decodeAgentSpawnResponse({ threadId: "thread-1", terminalId: null }));
});

it("lists a catalog row with its provider identity, availability, and default marker", () => {
  const response = decodeAgentModelsResponse({
    models: [
      {
        instanceId: "grok",
        driver: "grok",
        providerName: "Grok",
        model: {
          slug: "grok-build",
          name: "Grok Build",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning",
                type: "select",
                semantic: "reasoning",
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
        available: true,
        unavailableReason: null,
        isProjectDefault: true,
      },
      {
        instanceId: "opencode",
        driver: "opencode",
        providerName: "OpenCode",
        model: { slug: "openai/gpt-5", name: "GPT-5", isCustom: false, capabilities: null },
        available: false,
        unavailableReason: "OpenCode CLI is not installed.",
        isProjectDefault: false,
      },
    ],
  });

  const [grok, opencode] = response.models;
  assert.equal(grok?.model.capabilities?.optionDescriptors?.[0]?.semantic, "reasoning");
  assert.equal(grok?.isProjectDefault, true);
  // Known-but-unspawnable rows stay visible with an honest reason.
  assert.equal(opencode?.available, false);
  assert.equal(opencode?.unavailableReason, "OpenCode CLI is not installed.");
});

const decodeAgentRunStatus = Schema.decodeUnknownSync(AgentRunStatus);
const decodeAgentSpawnRequest = Schema.decodeUnknownSync(AgentSpawnRequest);
const decodeAgentStandaloneSpawnRequest = Schema.decodeUnknownSync(AgentStandaloneSpawnRequest);
const decodeAgentAwaitResponse = Schema.decodeUnknownSync(AgentAwaitResponse);
const decodeAgentListResponse = Schema.decodeUnknownSync(AgentListResponse);
const decodeAgentErrorResponse = Schema.decodeUnknownSync(AgentErrorResponse);

it("accepts every agent run status and rejects values outside the wire union", () => {
  for (const status of ["completed", "failed", "interrupted", "running"]) {
    assert.equal(decodeAgentRunStatus(status), status);
  }
  assert.throws(() => decodeAgentRunStatus("queued"));
});

it("decodes a standalone spawn with an explicit CLI working directory", () => {
  assert.deepEqual(
    decodeAgentStandaloneSpawnRequest({
      profile: "implementer",
      task: "x",
      cwd: "/workspace/apps/server",
    }),
    {
      profile: "implementer",
      task: "x",
      cwd: "/workspace/apps/server",
    },
  );
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
