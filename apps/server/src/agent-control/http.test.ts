import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { AgentModelInstanceUnknownError, AgentModelUnknownError } from "./Errors.ts";
import { agentControlRouteLayer, agentFailureStatus, dispatchAgentSpawn } from "./http.ts";
import { AgentControl } from "./Services/AgentControl.ts";

const parentThreadId = ThreadId.make("parent-thread");
const handle = { threadId: ThreadId.make("child-thread"), profile: "model", terminalId: null };

it.effect("routes canonical, bare, and legacy session spawn requests explicitly", () => {
  const received: Array<{ readonly method: string; readonly input: unknown }> = [];
  const agents = {
    spawn: (input) =>
      Effect.sync(() => {
        received.push({ method: "spawn", input });
        return handle;
      }),
    spawnProfile: (input) =>
      Effect.sync(() => {
        received.push({ method: "spawnProfile", input });
        return handle;
      }),
  } satisfies Pick<AgentControl["Service"], "spawn" | "spawnProfile">;

  return Effect.gen(function* () {
    yield* dispatchAgentSpawn({
      agents,
      parentThreadId,
      body: {
        task: "exact",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi-work"),
          model: "openrouter/anthropic/claude-sonnet-5",
        },
        reasoning: "high",
      },
    });
    yield* dispatchAgentSpawn({ agents, parentThreadId, body: { task: "bare" } });
    yield* dispatchAgentSpawn({
      agents,
      parentThreadId,
      body: { task: "legacy", profile: "implementer" },
    });

    assert.deepEqual(received, [
      {
        method: "spawn",
        input: {
          parentThreadId,
          task: "exact",
          selection: {
            model: {
              instanceId: ProviderInstanceId.make("pi-work"),
              model: "openrouter/anthropic/claude-sonnet-5",
            },
            reasoning: "high",
          },
        },
      },
      {
        method: "spawn",
        input: { parentThreadId, task: "bare", selection: { model: null } },
      },
      {
        method: "spawnProfile",
        input: { parentThreadId, task: "legacy", profile: "implementer" },
      },
    ]);
  });
});

it.effect("rejects conflicting session selectors as a bad request before spawning", () => {
  let spawnCalls = 0;
  const agents = {
    spawn: () =>
      Effect.sync(() => {
        spawnCalls += 1;
        return handle;
      }),
    spawnProfile: () =>
      Effect.sync(() => {
        spawnCalls += 1;
        return handle;
      }),
  } satisfies Pick<AgentControl["Service"], "spawn" | "spawnProfile">;

  return Effect.gen(function* () {
    const failure = yield* Effect.flip(
      dispatchAgentSpawn({
        agents,
        parentThreadId,
        body: { task: "conflict", profile: "implementer", reasoning: "high" },
      }),
    );

    assert.equal(failure._tag, "AgentSpawnSelectorConflictError");
    assert.equal(agentFailureStatus(failure._tag), 400);
    assert.match(failure.message, /cannot be combined/);
    assert.equal(spawnCalls, 0);
  });
});

it("maps unknown model catalog identities to HTTP 404", () => {
  assert.equal(agentFailureStatus("AgentModelInstanceUnknownError"), 404);
  assert.equal(agentFailureStatus("AgentModelUnknownError"), 404);
});

const environment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(EnvironmentId.make("agent-http-test")),
  getDescriptor: Effect.die("unused"),
});

const withAgentRoutes = <A, E, R>(
  agents: Partial<AgentControl["Service"]>,
  effect: Effect.Effect<A, E, R | McpSessionRegistry.McpSessionRegistry>,
) =>
  effect.pipe(
    Effect.provide(
      HttpRouter.serve(agentControlRouteLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provide(Layer.mock(AgentControl)(agents)),
        Layer.provideMerge(McpSessionRegistry.layer),
        Layer.provide(Layer.succeed(ServerEnvironment.ServerEnvironment, environment)),
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const issueCredential = Effect.gen(function* () {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const issued = yield* registry.issue({
    threadId: parentThreadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
  });
  return issued.config.authorizationHeader;
});

it.effect("serves the authenticated model catalog route and rejects missing credentials", () => {
  let modelCalls = 0;
  const models = [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      providerName: "Codex",
      model: { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isCustom: false, capabilities: null },
      available: true,
      unavailableReason: null,
      isProjectDefault: true,
    },
  ] as const;

  return withAgentRoutes(
    {
      models: () =>
        Effect.sync(() => {
          modelCalls += 1;
          return models;
        }),
    },
    Effect.gen(function* () {
      const anonymous = yield* HttpClient.get("/api/agents/models");
      assert.equal(anonymous.status, 401);
      assert.equal(modelCalls, 0);

      const authorization = yield* issueCredential;
      const response = yield* HttpClient.get("/api/agents/models", {
        headers: { authorization },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(yield* response.json, { models });
      assert.equal(modelCalls, 1);
    }),
  );
});

it.effect("returns HTTP 400 for conflicting selectors without spawning", () => {
  let spawnCalls = 0;
  return withAgentRoutes(
    {
      spawn: () => Effect.sync(() => void (spawnCalls += 1)) as never,
      spawnProfile: () => Effect.sync(() => void (spawnCalls += 1)) as never,
    },
    Effect.gen(function* () {
      const authorization = yield* issueCredential;
      const response = yield* HttpClient.post("/api/agents/spawn", {
        headers: { authorization, "content-type": "application/json" },
        body: yield* HttpBody.json({
          task: "conflict",
          profile: "implementer",
          reasoning: "high",
        }),
      });
      assert.equal(response.status, 400);
      assert.equal(spawnCalls, 0);
    }),
  );
});

it.effect("returns HTTP 404 for typed unknown instance and model failures", () =>
  withAgentRoutes(
    {
      spawn: ({ selection }) =>
        selection.model?.instanceId === ProviderInstanceId.make("missing-instance")
          ? Effect.fail(
              new AgentModelInstanceUnknownError({
                instanceId: ProviderInstanceId.make("missing-instance"),
                availableInstanceIds: [ProviderInstanceId.make("codex")],
              }),
            )
          : Effect.fail(
              new AgentModelUnknownError({
                instanceId: ProviderInstanceId.make("codex"),
                model: "missing-model",
                availableModels: ["gpt-5.6-sol"],
              }),
            ),
    },
    Effect.gen(function* () {
      const authorization = yield* issueCredential;
      for (const modelSelection of [
        { instanceId: "missing-instance", model: "any-model" },
        { instanceId: "codex", model: "missing-model" },
      ]) {
        const response = yield* HttpClient.post("/api/agents/spawn", {
          headers: { authorization, "content-type": "application/json" },
          body: yield* HttpBody.json({ task: "unknown selection", modelSelection }),
        });
        assert.equal(response.status, 404);
      }
    }),
  ),
);
