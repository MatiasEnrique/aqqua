import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfileName,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAgentHttpApi,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/unstable/http";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { environmentAuthenticatedAuthLayer } from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AgentDispatchError } from "./Errors.ts";
import { agentEnvironmentHttpApiLayer } from "./environmentHttp.ts";
import { AgentControl } from "./Services/AgentControl.ts";

class AgentHttpApi extends HttpApi.make("environment").add(EnvironmentAgentHttpApi) {}

const requestPayload = {
  cwd: "/tmp/aqqua-agent-http-test",
  profile: AgentProfileName.make("implementer"),
  task: "Exercise the standalone HTTP boundary",
  title: "Standalone HTTP integration",
};

const makeConfigLayer = () =>
  ServerConfig.layerTest(process.cwd(), {
    prefix: "aqqua-agent-http-integration-test-",
  });

const makeAuthLayer = () =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeConfigLayer()),
  );

const makeAppLayer = (agents: Partial<AgentControl["Service"]>) => {
  const routesLayer = HttpApiBuilder.layer(AgentHttpApi).pipe(
    Layer.provide(agentEnvironmentHttpApiLayer),
    Layer.provide(environmentAuthenticatedAuthLayer),
  );

  return HttpRouter.serve(routesLayer, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.provide(Layer.mock(AgentControl)(agents)), Layer.provideMerge(makeAuthLayer()));
};

const postStandalone = (token?: string, payload: Record<string, unknown> = requestPayload) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post("/api/agents/standalone", {
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: yield* HttpBody.json(payload),
    });
    const body = (yield* response.json) as Record<string, unknown>;
    return { response, body };
  });

const postModels = (token?: string, cwd = "/tmp/aqqua-agent-http-test") =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post("/api/agents/models", {
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: yield* HttpBody.json({ cwd }),
    });
    const body = (yield* response.json) as Record<string, unknown>;
    return { response, body };
  });

const withAgentHttpApp = <A, E, R>(
  agents: Partial<AgentControl["Service"]>,
  effect: Effect.Effect<A, E, R | EnvironmentAuth.EnvironmentAuth>,
) =>
  effect.pipe(
    Effect.provide(makeAppLayer(agents).pipe(Layer.provideMerge(NodeHttpServer.layerTest))),
  );

it.layer(NodeServices.layer)("standalone agent HTTP boundary", (it) => {
  it.effect("rejects anonymous requests before calling AgentControl", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      {
        spawnStandaloneProfile: () => {
          spawnCalls += 1;
          return Effect.die("spawnStandalone must not be called");
        },
      },
      Effect.gen(function* () {
        const { response, body } = yield* postStandalone();

        assert.equal(response.status, 401);
        assert.equal(body._tag, "EnvironmentAuthInvalidError");
        assert.equal(body.code, "auth_invalid");
        assert.equal(body.reason, "missing_credential");
        assert.equal(spawnCalls, 0);
      }),
    );
  });

  it.effect("rejects forged bearer credentials before calling AgentControl", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      {
        spawnStandaloneProfile: () => {
          spawnCalls += 1;
          return Effect.die("spawnStandalone must not be called");
        },
      },
      Effect.gen(function* () {
        const { response, body } = yield* postStandalone("forged-bearer-credential");

        assert.equal(response.status, 401);
        assert.equal(body._tag, "EnvironmentAuthInvalidError");
        assert.equal(body.code, "auth_invalid");
        assert.equal(body.reason, "invalid_credential");
        assert.equal(spawnCalls, 0);
      }),
    );
  });

  it.effect("rejects bearer sessions without orchestration operate scope", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      {
        spawnStandaloneProfile: () => {
          spawnCalls += 1;
          return Effect.die("spawnStandalone must not be called");
        },
      },
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "read-only-test-client",
          scopes: [AuthOrchestrationReadScope],
        });
        const { response, body } = yield* postStandalone(session.token);

        assert.equal(response.status, 403);
        assert.equal(body._tag, "EnvironmentScopeRequiredError");
        assert.equal(body.code, "insufficient_scope");
        assert.equal(body.requiredScope, AuthOrchestrationOperateScope);
        assert.equal(spawnCalls, 0);
      }),
    );
  });

  it.effect("dispatches correctly scoped bearer requests through AgentControl", () => {
    let received: Parameters<AgentControl["Service"]["spawnStandaloneProfile"]>[0] | undefined;
    const handle = {
      threadId: ThreadId.make("standalone-http-thread"),
      profile: AgentProfileName.make("implementer"),
      terminalId: null,
    } as const;

    return withAgentHttpApp(
      {
        spawnStandaloneProfile: (input) =>
          Effect.sync(() => {
            received = input;
            return handle;
          }),
      },
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "operate-test-client",
          scopes: [AuthOrchestrationOperateScope],
        });
        const { response, body } = yield* postStandalone(session.token);

        assert.equal(response.status, 200);
        assert.deepEqual(body, handle);
        assert.deepEqual(received, requestPayload);
      }),
    );
  });

  it.effect("forwards canonical model selection and reasoning to standalone AgentControl", () => {
    let received: Parameters<AgentControl["Service"]["spawnStandalone"]>[0] | undefined;
    const handle = {
      threadId: ThreadId.make("standalone-model-thread"),
      profile: "gpt-5.6-sol",
      terminalId: null,
    } as const;
    const payload = {
      cwd: requestPayload.cwd,
      task: requestPayload.task,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex-work"),
        model: "gpt-5.6-sol",
        options: [{ id: "serviceTier", value: "priority" }],
      },
      reasoning: "high",
    };

    return withAgentHttpApp(
      {
        spawnStandalone: (input) =>
          Effect.sync(() => {
            received = input;
            return handle;
          }),
      },
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "model-test-client",
          scopes: [AuthOrchestrationOperateScope],
        });
        const { response } = yield* postStandalone(session.token, payload);

        assert.equal(response.status, 200);
        assert.deepEqual(received, {
          cwd: payload.cwd,
          task: payload.task,
          selection: { model: payload.modelSelection, reasoning: "high" },
        });
      }),
    );
  });

  it.effect("rejects conflicting standalone selectors before AgentControl", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      {
        spawnStandalone: () => {
          spawnCalls += 1;
          return Effect.die("must not call canonical spawn");
        },
        spawnStandaloneProfile: () => {
          spawnCalls += 1;
          return Effect.die("must not call legacy spawn");
        },
      },
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "conflict-test-client",
          scopes: [AuthOrchestrationOperateScope],
        });
        const { response, body } = yield* postStandalone(session.token, {
          ...requestPayload,
          reasoning: "high",
        });

        assert.equal(response.status, 400);
        assert.equal(body._tag, "EnvironmentHttpBadRequestError");
        assert.equal(spawnCalls, 0);
      }),
    );
  });

  it.effect("classifies AgentDispatchError as an internal error instead of a conflict", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      {
        spawnStandaloneProfile: () => {
          spawnCalls += 1;
          return Effect.fail(
            new AgentDispatchError({
              operation: "spawnStandalone",
              detail: "database unavailable",
            }),
          );
        },
      },
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "internal-error-test-client",
          scopes: [AuthOrchestrationOperateScope],
        });
        const { response, body } = yield* postStandalone(session.token);

        assert.equal(response.status, 500);
        assert.notEqual(response.status, 409);
        assert.equal(body._tag, "EnvironmentInternalError");
        assert.equal(body.code, "internal_error");
        assert.equal(body.reason, "internal_error");
        assert.equal(spawnCalls, 1);
      }),
    );
  });

  it.effect("lists project-scoped models through the read-scoped environment route", () => {
    const models = [
      {
        instanceId: ProviderInstanceId.make("codex-work"),
        driver: ProviderDriverKind.make("codex"),
        providerName: "Codex Work",
        model: {
          slug: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          isCustom: false,
          capabilities: null,
        },
        available: true,
        unavailableReason: null,
        isProjectDefault: true,
      },
    ] as const;
    let receivedCwd: string | undefined;

    return withAgentHttpApp(
      {
        modelsStandalone: ({ cwd }) =>
          Effect.sync(() => {
            receivedCwd = cwd;
            return models;
          }),
      },
      Effect.gen(function* () {
        const anonymous = yield* postModels();
        assert.equal(anonymous.response.status, 401);
        assert.equal(receivedCwd, undefined);

        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({
          subject: "models-read-client",
          scopes: [AuthOrchestrationReadScope],
        });
        const { response, body } = yield* postModels(session.token);

        assert.equal(response.status, 200);
        assert.deepEqual(body, { models });
        assert.equal(receivedCwd, "/tmp/aqqua-agent-http-test");
      }),
    );
  });
});
