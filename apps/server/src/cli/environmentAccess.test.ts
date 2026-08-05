import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthAdministrativeScopes, AuthSessionId } from "@aqqua/contracts";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";
import { FetchHttpClient } from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type * as ServerConfig from "../config.ts";
import * as ServerRuntimeState from "../serverRuntimeState.ts";
import { isLiveServerTransportFailure, tryResolveLiveEnvironment } from "./environmentAccess.ts";

it("classifies only transport-level live probe failures as offline candidates", () => {
  const request = HttpClientRequest.get("http://127.0.0.1:9/api/orchestration/snapshot");
  assert.isTrue(
    isLiveServerTransportFailure(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          description: "connection refused",
        }),
      }),
    ),
  );
  assert.isTrue(isLiveServerTransportFailure(new Cause.TimeoutError()));
  assert.isFalse(
    isLiveServerTransportFailure(
      new Error("declared protocol failure must not clear live runtime state"),
    ),
  );
});

it.effect("preserves a registered server marker and fails instead of opening offline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "aqqua-environment-access-test-",
      });
      const statePath = path.join(root, "server-runtime.json");
      yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        state: {
          version: 1,
          pid: 123,
          port: 1,
          origin: "http://127.0.0.1:1",
          startedAt: "2026-08-05T12:00:00.000Z",
        },
      });

      const environmentAuth = {
        issueSession: () =>
          Effect.succeed({
            sessionId: AuthSessionId.make("test-session"),
            token: "test-token",
          }),
        revokeSession: () => Effect.void,
      } as unknown as EnvironmentAuth.EnvironmentAuth["Service"];
      const config = {
        serverRuntimeStatePath: statePath,
      } as ServerConfig.ServerConfig["Service"];

      const failure = yield* Effect.flip(
        tryResolveLiveEnvironment(environmentAuth, config, {
          scopes: AuthAdministrativeScopes,
          label: "test",
          mapLiveServerError: () => new Cause.TimeoutError("registered server unavailable"),
        }),
      );
      assert.isTrue(Cause.isTimeoutError(failure));

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);
      assert.isTrue(Option.isSome(restored));
    }),
  ).pipe(Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer))),
);
