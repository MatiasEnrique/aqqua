import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfileName,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAgentHttpApi,
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

const makeAppLayer = (spawnStandalone: AgentControl["Service"]["spawnStandalone"]) => {
  const routesLayer = HttpApiBuilder.layer(AgentHttpApi).pipe(
    Layer.provide(agentEnvironmentHttpApiLayer),
    Layer.provide(environmentAuthenticatedAuthLayer),
  );

  return HttpRouter.serve(routesLayer, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(
    Layer.provide(Layer.mock(AgentControl)({ spawnStandalone })),
    Layer.provideMerge(makeAuthLayer()),
  );
};

const postStandalone = (token?: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.post("/api/agents/standalone", {
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: yield* HttpBody.json(requestPayload),
    });
    const body = (yield* response.json) as Record<string, unknown>;
    return { response, body };
  });

const withAgentHttpApp = <A, E, R>(
  spawnStandalone: AgentControl["Service"]["spawnStandalone"],
  effect: Effect.Effect<A, E, R | EnvironmentAuth.EnvironmentAuth>,
) =>
  effect.pipe(
    Effect.provide(
      makeAppLayer(spawnStandalone).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    ),
  );

it.layer(NodeServices.layer)("standalone agent HTTP boundary", (it) => {
  it.effect("rejects anonymous requests before calling AgentControl", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      () => {
        spawnCalls += 1;
        return Effect.die("spawnStandalone must not be called");
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
      () => {
        spawnCalls += 1;
        return Effect.die("spawnStandalone must not be called");
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
      () => {
        spawnCalls += 1;
        return Effect.die("spawnStandalone must not be called");
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
    let received: Parameters<AgentControl["Service"]["spawnStandalone"]>[0] | undefined;
    const handle = {
      threadId: ThreadId.make("standalone-http-thread"),
      profile: AgentProfileName.make("implementer"),
      terminalId: null,
    } as const;

    return withAgentHttpApp(
      (input) =>
        Effect.sync(() => {
          received = input;
          return handle;
        }),
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

  it.effect("classifies AgentDispatchError as an internal error instead of a conflict", () => {
    let spawnCalls = 0;
    return withAgentHttpApp(
      () => {
        spawnCalls += 1;
        return Effect.fail(
          new AgentDispatchError({
            operation: "spawnStandalone",
            detail: "database unavailable",
          }),
        );
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
});
