import {
  EnvironmentHttpApi,
  type AuthEnvironmentScope,
  type ClientOrchestrationCommand,
  type OrchestrationReadModel,
} from "@aqqua/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import { GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import {
  clearPersistedServerRuntimeState,
  readPersistedServerRuntimeState,
} from "../serverRuntimeState.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

export type EnvironmentAccessMode = "live" | "offline";
export type EnvironmentOrchestrationCommand = Exclude<
  ClientOrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;

const EnvironmentCliRuntimeLive = Layer.mergeAll(
  WorkspacePaths.layer,
  OrchestrationLayerLive.pipe(
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceLayerLive),
  ),
);

const ENVIRONMENT_CLI_LIVE_SERVER_TIMEOUT = Duration.seconds(1);

export const withEnvironmentCliSessionToken = <A, E, R>(
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  options: {
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    readonly label: string;
  },
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    environmentAuth.issueSession({ scopes: options.scopes, label: options.label }),
    (issued) => run(issued.token),
    (issued) => environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const withEnvironmentCliLiveServerTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeout(ENVIRONMENT_CLI_LIVE_SERVER_TIMEOUT));

const makeLiveServerClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, {
    baseUrl: origin,
  });

export const fetchLiveOrchestrationSnapshot = Effect.fn("fetchLiveOrchestrationSnapshot")(
  function* <E>(origin: string, bearerToken: string, _mapError: (cause: unknown) => E) {
    const client = yield* makeLiveServerClient(origin);
    return yield* client.orchestration.snapshot({
      headers: { authorization: `Bearer ${bearerToken}` },
    });
  },
  (effect, _origin, _bearerToken, mapError) =>
    effect.pipe(withEnvironmentCliLiveServerTimeout, Effect.mapError(mapError)),
);

export const dispatchLiveOrchestrationCommand = Effect.fn("dispatchLiveOrchestrationCommand")(
  function* <E>(
    origin: string,
    bearerToken: string,
    command: ClientOrchestrationCommand,
    _mapError: (cause: unknown) => E,
  ) {
    const client = yield* makeLiveServerClient(origin);
    yield* client.orchestration.dispatch({
      headers: { authorization: `Bearer ${bearerToken}` },
      payload: command,
    } as Parameters<typeof client.orchestration.dispatch>[0]);
  },
  (effect, _origin, _bearerToken, _command, mapError) =>
    effect.pipe(withEnvironmentCliLiveServerTimeout, Effect.mapError(mapError)),
);

export const getOfflineOrchestrationSnapshot = Effect.fn("getOfflineOrchestrationSnapshot")(
  function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    return yield* projectionSnapshotQuery.getSnapshot();
  },
);

export const tryResolveLiveEnvironment = Effect.fn("tryResolveLiveEnvironment")(function* <E>(
  environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"],
  config: ServerConfig.ServerConfig["Service"],
  options: {
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    readonly label: string;
    readonly mapLiveServerError: (cause: unknown) => E;
    readonly connectionFailureLogMessage?: string;
  },
) {
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return Option.none<{ readonly origin: string }>();
  }

  const attempt = withEnvironmentCliSessionToken(environmentAuth, options, (token) =>
    fetchLiveOrchestrationSnapshot(
      runtimeState.value.origin,
      token,
      options.mapLiveServerError,
    ).pipe(
      Effect.as({
        origin: runtimeState.value.origin,
      }),
    ),
  );

  const attempted = yield* Effect.result(attempt);
  if (attempted._tag === "Success") {
    return Option.some(attempted.success);
  }

  yield* Effect.logDebug(
    options.connectionFailureLogMessage ?? "Failed to connect to the persisted CLI server.",
    {
      origin: runtimeState.value.origin,
      cause: attempted.failure,
    },
  );
  yield* clearPersistedServerRuntimeState(config.serverRuntimeStatePath);
  return Option.none<{ readonly origin: string }>();
});

export const runWithEnvironmentAccess = Effect.fn("runWithEnvironmentAccess")(function* <
  Command extends EnvironmentOrchestrationCommand,
  Output extends string,
  RunError,
  RunRequirements,
  LiveServerError extends Error,
>(
  flags: CliAuthLocationFlags,
  options: {
    readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    readonly label: string;
    readonly mapLiveServerError: (cause: unknown) => LiveServerError;
    readonly connectionFailureLogMessage?: string;
  },
  run: (input: {
    readonly snapshot: OrchestrationReadModel;
    readonly dispatch: (
      command: Command,
    ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
    readonly mode: EnvironmentAccessMode;
  }) => Effect.Effect<Output, RunError, RunRequirements>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;

  return yield* Effect.gen(function* () {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const liveMode = yield* tryResolveLiveEnvironment(environmentAuth, config, options);

    if (Option.isSome(liveMode)) {
      return yield* withEnvironmentCliSessionToken(environmentAuth, options, (token) =>
        Effect.gen(function* () {
          const snapshot = yield* fetchLiveOrchestrationSnapshot(
            liveMode.value.origin,
            token,
            options.mapLiveServerError,
          );
          const output = yield* run({
            snapshot,
            dispatch: (command) =>
              dispatchLiveOrchestrationCommand(
                liveMode.value.origin,
                token,
                command,
                options.mapLiveServerError,
              ),
            mode: "live",
          });
          yield* Console.log(output);
        }),
      );
    }

    const offlineRuntimeLayer = EnvironmentCliRuntimeLive.pipe(
      Layer.provide(ServerConfig.layer(config)),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
    );

    return yield* Effect.gen(function* () {
      const snapshot = yield* getOfflineOrchestrationSnapshot();
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const output = yield* run({
        snapshot,
        dispatch: (command) => orchestrationEngine.dispatch(command),
        mode: "offline",
      });
      yield* Console.log(output);
    }).pipe(Effect.provide(offlineRuntimeLayer));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(EnvironmentAuth.runtimeLayer, WorkspacePaths.layer).pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      ),
    ),
  );
});
