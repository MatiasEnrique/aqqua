import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfileName,
  AuthAccessReadScope,
  AuthAccessWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentSettingsHttpApi,
  type ServerSettings,
} from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { environmentAuthenticatedAuthLayer } from "./auth/http.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { settingsEnvironmentHttpApiLayer } from "./settingsHttp.ts";

class SettingsHttpApi extends HttpApi.make("environment").add(EnvironmentSettingsHttpApi) {}

const profile = {
  target: { kind: "driver" as const, driver: "codex" },
  model: "gpt-5.6-sol",
};

const makeConfigLayer = () =>
  ServerConfig.layerTest(process.cwd(), { prefix: "aqqua-settings-http-test-" });

const makeAuthLayer = () =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeConfigLayer()),
  );

const makeAppLayer = (service: ServerSettingsService["Service"]) =>
  HttpRouter.serve(
    HttpApiBuilder.layer(SettingsHttpApi).pipe(
      Layer.provide(settingsEnvironmentHttpApiLayer),
      Layer.provide(environmentAuthenticatedAuthLayer),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(
    Layer.provide(Layer.succeed(ServerSettingsService, service)),
    Layer.provideMerge(makeAuthLayer()),
  );

const request = (
  method: "GET" | "PUT" | "DELETE",
  path: string,
  token?: string,
  payload?: unknown,
) =>
  Effect.gen(function* () {
    const httpRequest = HttpClientRequest.make(method)(path, {
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    }).pipe(
      payload === undefined ? (request) => request : HttpClientRequest.bodyJsonUnsafe(payload),
    );
    const response = yield* HttpClient.execute(httpRequest);
    return { response, body: (yield* response.json) as Record<string, unknown> };
  });

const withApp = <A, E, R>(
  service: ServerSettingsService["Service"],
  effect: Effect.Effect<A, E, R | EnvironmentAuth.EnvironmentAuth>,
) =>
  effect.pipe(
    Effect.provide(makeAppLayer(service).pipe(Layer.provideMerge(NodeHttpServer.layerTest))),
  );

it.layer(NodeServices.layer)("agent profile settings HTTP boundary", (it) => {
  it.effect("rejects anonymous and insufficient-scope requests before reading settings", () => {
    let reads = 0;
    const service = ServerSettingsService.of({
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.sync(() => {
        reads += 1;
        return DEFAULT_SERVER_SETTINGS;
      }),
      updateSettings: () => Effect.die("updateSettings must not be called"),
      modifySettings: () => Effect.die("modifySettings must not be called"),
      streamChanges: Effect.die("unused") as never,
      subscribeChanges: Effect.die("unused"),
    });
    return withApp(
      service,
      Effect.gen(function* () {
        const anonymous = yield* request("GET", "/api/settings/agent-profiles");
        assert.equal(anonymous.response.status, 401);

        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({ scopes: [AuthAccessReadScope] });
        const forbidden = yield* request("GET", "/api/settings/agent-profiles", session.token);
        assert.equal(forbidden.response.status, 403);
        assert.equal(forbidden.body.requiredScope, AuthAccessWriteScope);
        assert.equal(reads, 0);
      }),
    );
  });

  it.effect("upserts and deletes profiles with whole-map settings updates", () => {
    let current: ServerSettings = DEFAULT_SERVER_SETTINGS;
    const service = ServerSettingsService.of({
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.sync(() => current),
      updateSettings: (patch) =>
        Effect.sync(() => {
          current = { ...current, agentProfiles: patch.agentProfiles ?? current.agentProfiles };
          return current;
        }),
      modifySettings: (modify) =>
        Effect.gen(function* () {
          const { patch, value } = yield* modify(current);
          current = { ...current, agentProfiles: patch.agentProfiles ?? current.agentProfiles };
          return { settings: current, value };
        }),
      streamChanges: Effect.die("unused") as never,
      subscribeChanges: Effect.die("unused"),
    });
    return withApp(
      service,
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({ scopes: [AuthAccessWriteScope] });
        const put = yield* request(
          "PUT",
          "/api/settings/agent-profiles/reviewer",
          session.token,
          profile,
        );
        assert.equal(put.response.status, 200);
        assert.equal((put.body.profile as Record<string, unknown>).model, "gpt-5.6-sol");
        assert.isDefined(current.agentProfiles[AgentProfileName.make("reviewer")]);

        const listed = yield* request("GET", "/api/settings/agent-profiles", session.token);
        assert.equal(listed.response.status, 200);
        assert.equal(listed.body.implicitDefaultName, "implementer");
        assert.isDefined((listed.body.profiles as Record<string, unknown>).reviewer);

        const deleted = yield* request(
          "DELETE",
          "/api/settings/agent-profiles/reviewer",
          session.token,
        );
        assert.equal(deleted.response.status, 200);
        assert.isUndefined(current.agentProfiles[AgentProfileName.make("reviewer")]);
      }),
    );
  });

  it.effect("returns model-friendly 400 and typed 404 errors", () => {
    const service = ServerSettingsService.of({
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      updateSettings: () => Effect.die("updateSettings must not be called"),
      modifySettings: (modify) =>
        modify(DEFAULT_SERVER_SETTINGS).pipe(
          Effect.map(({ value }) => ({ settings: DEFAULT_SERVER_SETTINGS, value })),
        ),
      streamChanges: Effect.die("unused") as never,
      subscribeChanges: Effect.die("unused"),
    });
    return withApp(
      service,
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const session = yield* auth.issueSession({ scopes: [AuthAccessWriteScope] });
        const malformed = yield* request(
          "DELETE",
          "/api/settings/agent-profiles/9bad!",
          session.token,
        );
        assert.equal(malformed.response.status, 400);
        assert.include(String(malformed.body.message), "must start with a letter");

        const missing = yield* request(
          "DELETE",
          "/api/settings/agent-profiles/missing",
          session.token,
        );
        assert.equal(missing.response.status, 404);
        assert.equal(missing.body._tag, "EnvironmentHttpNotFoundError");
      }),
    );
  });
});
