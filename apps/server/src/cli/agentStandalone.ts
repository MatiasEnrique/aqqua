import {
  type AuthEnvironmentScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type AgentStandaloneSpawnRequest,
  type ModelSelection,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Terminal from "effect/Terminal";
import { GlobalFlag } from "effect/unstable/cli";
import { Prompt } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { AgentCliError } from "./agentCliError.ts";
import { type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { withEnvironmentCliSessionToken } from "./environmentAccess.ts";

const standalonePresenceError = (detail: string) => new AgentCliError({ detail });

export const standaloneSpawnPayload = (input: {
  readonly cwd: string;
  readonly profile?: string;
  readonly modelSelection?: ModelSelection;
  readonly reasoning?: string;
  readonly task: string;
  readonly title?: string;
}): AgentStandaloneSpawnRequest => ({
  cwd: input.cwd,
  task: input.task,
  ...(input.profile === undefined ? {} : { profile: input.profile }),
  ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
  ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
  ...(input.title === undefined ? {} : { title: input.title }),
});

/**
 * Standalone spawn is a human action, not an alternate agent identity path.
 *
 * Same-user provider processes can read local aqqua state, so no additional
 * environment variable or local secret would be an honest authentication
 * boundary. Require a foreground interactive terminal and an explicit,
 * default-deny confirmation before minting the temporary server credential.
 */
export const requireStandaloneUserPresence = Effect.fn("agentCli.requireStandaloneUserPresence")(
  function* (options?: {
    readonly interactive?: boolean;
    readonly confirm?: Effect.Effect<boolean, Terminal.QuitError, Terminal.Terminal>;
  }) {
    const interactive =
      options?.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) {
      return yield* standalonePresenceError(
        "Standalone agent spawn requires an interactive terminal. Run this command directly in a terminal and confirm the prompt.",
      );
    }

    const confirmed = yield* (
      options?.confirm ??
      Prompt.run(
        Prompt.confirm({
          message: "Start an unparented agent outside the current aqqua session?",
          initial: false,
        }),
      )
    ).pipe(Effect.mapError(() => standalonePresenceError("Standalone agent spawn was cancelled.")));
    if (!confirmed) {
      return yield* standalonePresenceError("Standalone agent spawn was cancelled.");
    }
  },
);

export const withStandaloneAgentSession = Effect.fn("agentCli.withStandaloneAgentSession")(
  function* <A, E, R>(
    run: (token: string) => Effect.Effect<A, E, R>,
    options?: {
      readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
      readonly label?: string;
    },
  ) {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* withEnvironmentCliSessionToken(
      environmentAuth,
      {
        scopes: options?.scopes ?? [AuthOrchestrationOperateScope],
        label: options?.label ?? "aqqua agent cli",
      },
      run,
    );
  },
);

const makeStandaloneEnvironmentClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });

type StandaloneEnvironmentClient = Effect.Success<
  ReturnType<typeof makeStandaloneEnvironmentClient>
>;

/** Common authenticated client boundary for ordinary-terminal agent commands. */
export const withStandaloneEnvironmentClient = <A, E, R, BeforeE, BeforeR>(input: {
  readonly flags: CliAuthLocationFlags;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly label: string;
  readonly beforeSession: Effect.Effect<void, BeforeE, BeforeR>;
  readonly run: (client: StandaloneEnvironmentClient, token: string) => Effect.Effect<A, E, R>;
}) =>
  Effect.gen(function* () {
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
    yield* input.beforeSession;

    const origin = runtimeState.value.origin;
    return yield* withStandaloneAgentSession(
      (token) =>
        Effect.gen(function* () {
          const client = yield* makeStandaloneEnvironmentClient(origin);
          return yield* input.run(client, token);
        }),
      { scopes: input.scopes, label: input.label },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new AgentCliError({
            detail:
              cause instanceof Error
                ? cause.message
                : `Could not reach the aqqua desktop environment at ${origin}.`,
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

export const listStandaloneAgentModels = Effect.fn("agentCli.listStandaloneModels")(
  function* (input: { readonly flags: CliAuthLocationFlags; readonly cwd?: string }) {
    return yield* withStandaloneEnvironmentClient({
      flags: input.flags,
      scopes: [AuthOrchestrationReadScope],
      label: "aqqua agent models cli",
      beforeSession: Effect.void,
      run: (client, token) =>
        client.agents.standaloneModels({
          headers: { authorization: `Bearer ${token}` },
          payload: { cwd: input.cwd ?? process.cwd() },
        }),
    });
  },
);

export const spawnStandaloneAgent = Effect.fn("agentCli.spawnStandalone")(function* (input: {
  readonly flags: CliAuthLocationFlags;
  readonly profile?: string;
  readonly modelSelection?: ModelSelection;
  readonly reasoning?: string;
  readonly task: string;
  readonly title?: string;
}) {
  return yield* withStandaloneEnvironmentClient({
    flags: input.flags,
    scopes: [AuthOrchestrationOperateScope],
    label: "aqqua agent cli",
    beforeSession: requireStandaloneUserPresence(),
    run: (client, token) =>
      client.agents.standaloneSpawn({
        headers: { authorization: `Bearer ${token}` },
        payload: standaloneSpawnPayload({ ...input, cwd: process.cwd() }),
      }),
  });
});
