import { AuthOrchestrationOperateScope, EnvironmentHttpApi } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { AgentCliError } from "./agentCliError.ts";
import { type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

export const withStandaloneAgentSession = Effect.fn("agentCli.withStandaloneAgentSession")(
  function* <A, E, R>(run: (token: string) => Effect.Effect<A, E, R>) {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* Effect.acquireUseRelease(
      environmentAuth.issueSession({
        scopes: [AuthOrchestrationOperateScope],
        label: "aqqua agent cli",
      }),
      (issued) => run(issued.token),
      (issued) =>
        environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
    );
  },
);

export const spawnStandaloneAgent = Effect.fn("agentCli.spawnStandalone")(function* (input: {
  readonly flags: CliAuthLocationFlags;
  readonly profile: string;
  readonly task: string;
  readonly title?: string;
}) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(input.flags, logLevel);
  const runtimeState = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(runtimeState)) {
    return yield* new AgentCliError({
      detail:
        "No running aqqua desktop environment was found. Open the desktop app and try again, " +
        "or pass --base-dir for a non-default aqqua home.",
    });
  }

  return yield* withStandaloneAgentSession((token) =>
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
        baseUrl: runtimeState.value.origin,
      });
      return yield* client.agents.standaloneSpawn({
        headers: { authorization: `Bearer ${token}` },
        payload: {
          profile: input.profile,
          task: input.task,
          cwd: process.cwd(),
          ...(input.title === undefined ? {} : { title: input.title }),
        },
      });
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new AgentCliError({
          detail:
            cause instanceof Error
              ? cause.message
              : `Could not reach the aqqua desktop environment at ${runtimeState.value.origin}.`,
        }),
    ),
    Effect.provide(
      EnvironmentAuth.runtimeLayer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});
