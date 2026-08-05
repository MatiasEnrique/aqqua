/**
 * `aqqua agent` — delegate work to sub-agents from an orchestrator's own shell.
 *
 * This is the delegation front-end, and it is a CLI on purpose. An MCP toolkit
 * would put its tool schemas into the orchestrator's context on every turn; a
 * command the agent runs with the shell tool it already has costs nothing but the
 * one line of documentation that says it exists.
 *
 * Inside a provider session, identity comes from the environment aqqua created,
 * never from a flag. Process ancestry prevents deleting that child environment
 * from turning an agent into a standalone caller. A genuine standalone spawn
 * additionally requires explicit confirmation in an interactive terminal before
 * it uses a short-lived local credential to create an unparented thread.
 *
 * @module cli/agent
 */
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { AgentCliError } from "./agentCliError.ts";
import {
  AGENT_API_ENV,
  AGENT_THREAD_ENV,
  AGENT_TOKEN_ENV,
  type AgentInvocationAncestry,
  detectAgentInvocationAncestry,
} from "./agentInvocationIdentity.ts";
import { spawnStandaloneAgent } from "./agentStandalone.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { withEnvironmentCliSessionToken } from "./environmentAccess.ts";

export { AgentCliError } from "./agentCliError.ts";
import {
  AgentAwaitRequest,
  AgentAwaitResponse,
  type AgentAwaitResponse as AgentAwaitResponseType,
  AgentErrorResponse,
  type AgentErrorResponse as AgentErrorResponseType,
  AgentInterruptRequest,
  AgentInterruptResponse,
  AgentListResponse,
  type AgentListResponse as AgentListResponseType,
  AgentModelsResponse,
  type AgentModelsResponse as AgentModelsResponseType,
  AgentProfilesResponse,
  type AgentProfilesResponse as AgentProfilesResponseType,
  AgentSendRequest,
  AgentSendResponse,
  AgentSpawnRequest,
  AgentSpawnResponse,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  ProviderInstanceId,
} from "@aqqua/contracts";
import { findReasoningDescriptor } from "../agent-control/ModelCatalog.ts";

export { AGENT_API_ENV, AGENT_THREAD_ENV, AGENT_TOKEN_ENV } from "./agentInvocationIdentity.ts";

export type AgentSpawnTransport = "session" | "standalone" | "invalid-session" | "agent-origin";

export const resolveSpawnTransport = (
  env: NodeJS.ProcessEnv,
  ancestry: AgentInvocationAncestry = "unknown",
): AgentSpawnTransport => {
  const hasToken = Boolean(env[AGENT_TOKEN_ENV]?.trim());
  const hasApi = Boolean(env[AGENT_API_ENV]?.trim());
  const hasThread = Boolean(env[AGENT_THREAD_ENV]?.trim());
  if (hasToken && hasApi && hasThread) return "session";
  if (hasToken || hasApi || hasThread) return "invalid-session";
  if (ancestry === "agent-session") return "agent-origin";
  return "standalone";
};

export const formatSpawnStarted = (input: {
  readonly label: string;
  readonly selector: "model" | "profile";
  readonly threadId: string;
  readonly transport: "session" | "standalone";
}): string =>
  input.transport === "session"
    ? `Started ${input.selector} ${input.label} as sub-agent ${input.threadId}. Await it with: aqqua agent await ${input.threadId}`
    : `Started ${input.selector} ${input.label} as agent ${input.threadId}. Open it in aqqua to follow its progress.`;

const NOT_IN_SESSION_HELP = [
  "This command must run inside an aqqua agent session.",
  "",
  `It reads ${AGENT_TOKEN_ENV} and ${AGENT_API_ENV} from the environment aqqua sets up for`,
  "each agent session. Those are absent here, which usually means the command was run",
  "from an ordinary terminal rather than from inside an agent's own shell.",
].join("\n");

const INCOMPLETE_SESSION_HELP = [
  "The aqqua agent session environment is incomplete.",
  "",
  `Expected ${AGENT_TOKEN_ENV}, ${AGENT_API_ENV}, and ${AGENT_THREAD_ENV} together.`,
  "Start a fresh agent terminal instead of removing or overriding these variables.",
].join("\n");

const AGENT_ORIGIN_HELP = [
  "Standalone agent spawn is unavailable from an aqqua provider session.",
  "",
  `Removing ${AGENT_TOKEN_ENV}, ${AGENT_API_ENV}, and ${AGENT_THREAD_ENV} does not turn an`,
  "agent shell into a human terminal. Use the session delegation command so parent recursion",
  "and concurrency rules remain enforced.",
].join("\n");

export interface AgentApi {
  readonly spawn: (body: AgentSpawnRequest) => Effect.Effect<AgentSpawnResponse, AgentCliError>;
  readonly send: (body: AgentSendRequest) => Effect.Effect<AgentSendResponse, AgentCliError>;
  readonly await: (body: AgentAwaitRequest) => Effect.Effect<AgentAwaitResponseType, AgentCliError>;
  readonly interrupt: (
    body: AgentInterruptRequest,
  ) => Effect.Effect<AgentInterruptResponse, AgentCliError>;
  readonly list: () => Effect.Effect<AgentListResponseType, AgentCliError>;
  readonly profiles: () => Effect.Effect<AgentProfilesResponseType, AgentCliError>;
  readonly models: () => Effect.Effect<AgentModelsResponseType, AgentCliError>;
}

type ResponseDecoder<A, E> = (body: unknown) => Effect.Effect<A, E>;
const decodeAgentErrorResponse = Schema.decodeUnknownEffect(AgentErrorResponse);
const decodeAgentSpawnResponse = Schema.decodeUnknownEffect(AgentSpawnResponse);
const decodeAgentSendResponse = Schema.decodeUnknownEffect(AgentSendResponse);
const decodeAgentAwaitResponse = Schema.decodeUnknownEffect(AgentAwaitResponse);
const decodeAgentInterruptResponse = Schema.decodeUnknownEffect(AgentInterruptResponse);
const decodeAgentListResponse = Schema.decodeUnknownEffect(AgentListResponse);
const decodeAgentProfilesResponse = Schema.decodeUnknownEffect(AgentProfilesResponse);
const decodeAgentModelsResponse = Schema.decodeUnknownEffect(AgentModelsResponse);

const invalidServerResponse = (status: number, path: string) =>
  new AgentCliError({
    detail: `The aqqua server returned an invalid response for ${path} (HTTP ${status}).`,
  });

export const decodeServerResponse = <A, E>(
  decode: ResponseDecoder<A, E>,
  status: number,
  path: string,
  body: unknown,
): Effect.Effect<A, AgentCliError> =>
  status >= 200 && status < 300
    ? decode(body).pipe(Effect.mapError(() => invalidServerResponse(status, path)))
    : decodeAgentErrorResponse(body).pipe(
        Effect.mapError(() => invalidServerResponse(status, path)),
        Effect.flatMap(
          (failure) =>
            new AgentCliError({
              detail: formatServerFailure(failure),
            }),
        ),
      );

/**
 * Resolve the session credential.
 *
 * Delegation has no offline mode: a sub-agent's turn is started by the server's
 * provider reactor, so there must be a live server. Failing loudly here is better
 * than opening the database behind a running server's back.
 */
const agentApi = Effect.fn("agentCli.api")(function* () {
  const token = process.env[AGENT_TOKEN_ENV]?.trim();
  const origin = process.env[AGENT_API_ENV]?.trim();
  if (!token || !origin) {
    return yield* new AgentCliError({ detail: NOT_IN_SESSION_HELP });
  }
  const client = yield* HttpClient.HttpClient;

  const send = <A, DecodeError, RequestError>(
    request: Effect.Effect<HttpClientResponse.HttpClientResponse, RequestError>,
    path: string,
    decode: ResponseDecoder<A, DecodeError>,
  ) =>
    request.pipe(
      Effect.mapError(
        (cause) =>
          new AgentCliError({
            detail: `Could not reach the aqqua server at ${origin}${path}: ${String(cause)}`,
          }),
      ),
      Effect.flatMap((response) =>
        response.json.pipe(
          Effect.mapError(() => invalidServerResponse(response.status, path)),
          Effect.flatMap((body) => decodeServerResponse(decode, response.status, path, body)),
        ),
      ),
    );

  const post = <RequestA, RequestI, ResponseA, DecodeError>(
    path: string,
    requestSchema: Schema.Codec<RequestA, RequestI>,
    decodeResponse: ResponseDecoder<ResponseA, DecodeError>,
    body: RequestA,
  ) =>
    send(
      client.post(`${origin}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        body: HttpBody.jsonUnsafe(Schema.encodeSync(requestSchema)(body)),
      }),
      path,
      decodeResponse,
    );

  return {
    spawn: (body) => post("/api/agents/spawn", AgentSpawnRequest, decodeAgentSpawnResponse, body),
    send: (body) => post("/api/agents/send", AgentSendRequest, decodeAgentSendResponse, body),
    await: (body) => post("/api/agents/await", AgentAwaitRequest, decodeAgentAwaitResponse, body),
    interrupt: (body) =>
      post("/api/agents/interrupt", AgentInterruptRequest, decodeAgentInterruptResponse, body),
    list: () =>
      send(
        client.get(`${origin}/api/agents`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        "/api/agents",
        decodeAgentListResponse,
      ),
    profiles: () =>
      send(
        client.get(`${origin}/api/agents/profiles`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        "/api/agents/profiles",
        decodeAgentProfilesResponse,
      ),
    models: () =>
      send(
        client.get(`${origin}/api/agents/models`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        "/api/agents/models",
        decodeAgentModelsResponse,
      ),
  } satisfies AgentApi;
});

/** Server failures are written for the agent reading stderr, not for a log. */
export const formatServerFailure = (body: AgentErrorResponseType): string =>
  `${body.error}: ${body.message}`;

/**
 * Read task text from a file, or take it inline.
 *
 * `--task-file` exists so a long task never round-trips through the
 * orchestrator's context just to be passed as an argument.
 */
export const resolveText = Effect.fn("agentCli.resolveText")(function* (input: {
  readonly inline: string | undefined;
  readonly file: string | undefined;
  readonly label: string;
}) {
  if (input.file !== undefined) {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFileString(input.file).pipe(
      Effect.mapError(
        (cause) =>
          new AgentCliError({
            detail: `Could not read ${input.label} from '${input.file}': ${cause}`,
          }),
      ),
    );
    if (contents.trim().length === 0) {
      return yield* new AgentCliError({ detail: `${input.label} file '${input.file}' is empty.` });
    }
    return contents;
  }
  if (input.inline !== undefined && input.inline.trim().length > 0) {
    return input.inline;
  }
  return yield* new AgentCliError({
    detail: `A ${input.label} is required. Pass it inline or with --${input.label === "task" ? "task" : "message"}-file.`,
  });
});

/** Schema-backed JSON encoding, so output shape is declared rather than implied. */
const toJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit a single JSON object instead of human-readable text."),
);

const emit = (input: { readonly json: boolean; readonly value: unknown; readonly text: string }) =>
  Console.log(input.json ? toJsonLine(input.value) : input.text);

const cliRuntime = Layer.merge(FetchHttpClient.layer, NodeServices.layer);

export const listStandaloneAgentModels = Effect.fn("agentCli.listStandaloneModels")(
  function* (input: { readonly flags: CliAuthLocationFlags; readonly cwd?: string }) {
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

    return yield* Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      return yield* withEnvironmentCliSessionToken(
        environmentAuth,
        { scopes: [AuthOrchestrationReadScope], label: "aqqua agent models cli" },
        (token) =>
          Effect.gen(function* () {
            const client = yield* HttpApiClient.make(EnvironmentHttpApi, {
              baseUrl: runtimeState.value.origin,
            });
            return yield* client.agents.standaloneModels({
              headers: { authorization: `Bearer ${token}` },
              payload: { cwd: input.cwd ?? process.cwd() },
            });
          }),
      );
    }).pipe(
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
  },
);

export const resolveSpawnSelector = Effect.fn("agentCli.resolveSpawnSelector")(function* (input: {
  readonly profile: string | undefined;
  readonly instance: string | undefined;
  readonly model: string | undefined;
  readonly reasoning: string | undefined;
}) {
  if (
    input.profile !== undefined &&
    (input.instance !== undefined || input.model !== undefined || input.reasoning !== undefined)
  ) {
    return yield* new AgentCliError({
      detail: "--profile cannot be combined with --instance, --model, or --reasoning.",
    });
  }
  if ((input.instance === undefined) !== (input.model === undefined)) {
    return yield* new AgentCliError({
      detail: "--instance and --model must be provided together.",
    });
  }
  if (input.profile !== undefined) return { profile: input.profile } as const;
  return {
    ...(input.instance === undefined || input.model === undefined
      ? {}
      : {
          modelSelection: {
            instanceId: ProviderInstanceId.make(input.instance),
            model: input.model,
          },
        }),
    ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
  } as const;
});

const spawnCommand = Command.make("spawn", {
  ...projectLocationFlags,
  json: jsonFlag,
  profile: Flag.string("profile").pipe(
    Flag.withDescription("Deprecated profile compatibility selector."),
    Flag.optional,
  ),
  instance: Flag.string("instance").pipe(
    Flag.withDescription("Exact provider instance id; requires --model."),
    Flag.optional,
  ),
  model: Flag.string("model").pipe(
    Flag.withDescription("Exact model slug; requires --instance."),
    Flag.optional,
  ),
  reasoning: Flag.string("reasoning").pipe(
    Flag.withDescription("Semantic reasoning choice advertised by the selected model."),
    Flag.optional,
  ),
  task: Flag.string("task").pipe(
    Flag.withDescription("Task text. Prefer --task-file for anything long."),
    Flag.optional,
  ),
  taskFile: Flag.string("task-file").pipe(
    Flag.withDescription("Path to a file holding the task."),
    Flag.optional,
  ),
  title: Flag.string("title").pipe(
    Flag.withDescription("Optional agent thread title."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Start an agent on a task and return immediately."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const task = yield* resolveText({
        inline: Option.getOrUndefined(flags.task),
        file: Option.getOrUndefined(flags.taskFile),
        label: "task",
      });
      const title = Option.getOrUndefined(flags.title);
      const selector = yield* resolveSpawnSelector({
        profile: Option.getOrUndefined(flags.profile),
        instance: Option.getOrUndefined(flags.instance),
        model: Option.getOrUndefined(flags.model),
        reasoning: Option.getOrUndefined(flags.reasoning),
      });
      const directTransport = resolveSpawnTransport(process.env);
      const transport =
        directTransport === "standalone"
          ? resolveSpawnTransport(process.env, yield* detectAgentInvocationAncestry())
          : directTransport;
      if (transport === "invalid-session") {
        return yield* new AgentCliError({ detail: INCOMPLETE_SESSION_HELP });
      }
      if (transport === "agent-origin") {
        return yield* new AgentCliError({ detail: AGENT_ORIGIN_HELP });
      }
      const result =
        transport === "session"
          ? yield* (yield* agentApi()).spawn({
              ...selector,
              task,
              ...(title === undefined ? {} : { title }),
            })
          : yield* spawnStandaloneAgent({
              flags,
              ...selector,
              task,
              ...(title === undefined ? {} : { title }),
            });
      const threadId = result.threadId;
      yield* emit({
        json: flags.json,
        value: result,
        text: formatSpawnStarted({
          label: result.profile,
          selector: "profile" in selector ? "profile" : "model",
          threadId,
          transport,
        }),
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

const sendCommand = Command.make("send", {
  json: jsonFlag,
  threadId: Argument.string("threadId").pipe(
    Argument.withDescription("Sub-agent thread id returned by spawn."),
  ),
  message: Flag.string("message").pipe(
    Flag.withDescription("Follow-up text. Prefer --message-file for anything long."),
    Flag.optional,
  ),
  messageFile: Flag.string("message-file").pipe(
    Flag.withDescription("Path to a file holding the follow-up."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Continue an existing sub-agent, preserving its context."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const message = yield* resolveText({
        inline: Option.getOrUndefined(flags.message),
        file: Option.getOrUndefined(flags.messageFile),
        label: "message",
      });
      const result = yield* api.send({
        threadId: flags.threadId,
        message,
      });
      yield* emit({
        json: flags.json,
        value: result,
        text: `Sent a follow-up to sub-agent ${flags.threadId}.`,
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

const awaitCommand = Command.make("await", {
  json: jsonFlag,
  threadId: Argument.string("threadId").pipe(
    Argument.withDescription("Sub-agent thread id to wait for."),
  ),
  timeoutSeconds: Flag.integer("timeout").pipe(
    Flag.withDescription("Seconds to wait before reporting that it is still running."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Wait for a sub-agent's current task to finish."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const result = yield* api.await({
        threadId: flags.threadId,
        ...Option.match(flags.timeoutSeconds, {
          onNone: () => ({}),
          onSome: (seconds) => ({ timeoutMs: seconds * 1000 }),
        }),
      });
      const { status, finalMessage } = result;
      yield* emit({
        json: flags.json,
        value: result,
        text:
          status === "running"
            ? `Sub-agent ${flags.threadId} is still working. Await it again to keep waiting.`
            : `Sub-agent ${flags.threadId} ${status}.${finalMessage ? `\n\n${finalMessage}` : ""}`,
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

const interruptCommand = Command.make("interrupt", {
  json: jsonFlag,
  threadId: Argument.string("threadId").pipe(
    Argument.withDescription("Sub-agent thread id to interrupt."),
  ),
}).pipe(
  Command.withDescription("Stop a sub-agent's current task."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const result = yield* api.interrupt({ threadId: flags.threadId });
      yield* emit({
        json: flags.json,
        value: result,
        text: `Asked sub-agent ${flags.threadId} to stop.`,
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

const listCommand = Command.make("list", { json: jsonFlag }).pipe(
  Command.withDescription("List this orchestrator's sub-agents and their statuses."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const result = yield* api.list();
      const { agents } = result;
      yield* emit({
        json: flags.json,
        value: result,
        text:
          agents.length === 0
            ? "No sub-agents."
            : agents
                .map((agent) => `${agent.status.padEnd(11)} ${agent.threadId}  ${agent.title}`)
                .join("\n"),
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

/**
 * One profile per line: the name to pass to `--profile`, then the model a spawn
 * would actually run, then whatever is worth knowing before choosing it.
 */
export const formatProfileLine = (
  profile: AgentProfilesResponseType["profiles"][number],
): string => {
  const model = profile.unavailable === null ? (profile.model ?? "?") : "-";
  const notes = [
    profile.driver === null ? undefined : `driver=${profile.driver}`,
    profile.runtime === "session" ? undefined : `runtime=${profile.runtime}`,
    profile.pinsModel ? undefined : "inherits the project default model",
    profile.unavailable === null ? undefined : `UNAVAILABLE: ${profile.unavailable}`,
  ].filter((note) => note !== undefined);
  return `${profile.name.padEnd(14)} ${model.padEnd(22)} ${notes.join("  ")}`.trimEnd();
};

export const formatModelLine = (model: AgentModelsResponseType["models"][number]): string => {
  const reasoning = findReasoningDescriptor(model.model);
  const notes = [
    model.isProjectDefault ? "DEFAULT" : undefined,
    reasoning === undefined || reasoning.type !== "select"
      ? undefined
      : `reasoning=${reasoning.options.map((option) => option.id).join(",")}`,
    model.available ? undefined : `UNAVAILABLE: ${model.unavailableReason ?? "unknown reason"}`,
  ].filter((note) => note !== undefined);
  return `${model.providerName} (${model.instanceId}, ${model.driver})  ${model.model.slug}  ${model.model.name}${notes.length === 0 ? "" : `  ${notes.join("  ")}`}`;
};

export const renderModelsOutput = (result: AgentModelsResponseType, json: boolean): string =>
  json
    ? toJsonLine(result)
    : result.models.length === 0
      ? "No provider models are available."
      : result.models.map(formatModelLine).join("\n");

export const loadAgentModels = <
  SessionError,
  SessionRequirements,
  StandaloneError,
  StandaloneRequirements,
>(input: {
  readonly transport: "session" | "standalone";
  readonly session: () => Effect.Effect<AgentModelsResponseType, SessionError, SessionRequirements>;
  readonly standalone: () => Effect.Effect<
    AgentModelsResponseType,
    StandaloneError,
    StandaloneRequirements
  >;
}): Effect.Effect<
  AgentModelsResponseType,
  SessionError | StandaloneError,
  SessionRequirements | StandaloneRequirements
> => (input.transport === "session" ? input.session() : input.standalone());

const modelsCommand = Command.make("models", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List the live model catalog this orchestrator can spawn."),
  Command.withHandler(
    Effect.fn("agentCli.models")(function* (flags) {
      return yield* Effect.gen(function* () {
        const directTransport = resolveSpawnTransport(process.env);
        const transport =
          directTransport === "standalone"
            ? resolveSpawnTransport(process.env, yield* detectAgentInvocationAncestry())
            : directTransport;
        if (transport === "invalid-session") {
          return yield* new AgentCliError({ detail: INCOMPLETE_SESSION_HELP });
        }
        if (transport === "agent-origin") {
          return yield* new AgentCliError({ detail: AGENT_ORIGIN_HELP });
        }
        const result = yield* loadAgentModels({
          transport,
          session: () => agentApi().pipe(Effect.flatMap((api) => api.models())),
          standalone: () => listStandaloneAgentModels({ flags }),
        });
        yield* Console.log(renderModelsOutput(result, flags.json));
      }).pipe(Effect.provide(cliRuntime));
    }),
  ),
);

const profilesCommand = Command.make("profiles", { json: jsonFlag }).pipe(
  Command.withDescription(
    "Legacy/deprecated: list agent profiles. Use 'aqqua agent models' for model-first orchestration.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const result = yield* api.profiles();
      const { profiles } = result;
      yield* emit({
        json: flags.json,
        value: result,
        text:
          profiles.length === 0
            ? "No agent profiles are configured."
            : profiles.map(formatProfileLine).join("\n"),
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

/**
 * Emit sub-agent lifecycle transitions as NDJSON.
 *
 * Transitions are derived from real projected state rather than replayed from
 * activity rows, so an orchestrator sees a sub-agent finish whether or not anyone
 * awaited it. The diff is held here, which keeps the server stateless and means
 * two orchestrators watching the same sub-agents cannot interfere.
 */
export const watchTransitions = Effect.fn("agentCli.watch")(function* (input: {
  readonly api: AgentApi;
  readonly follow: boolean;
  readonly intervalMillis: number;
}) {
  const previous = new Map<string, string>();
  let firstPass = true;

  while (true) {
    const { agents } = yield* input.api.list();
    const seen = new Set<string>();

    for (const agent of agents) {
      const { threadId, status } = agent;
      seen.add(threadId);
      const before = previous.get(threadId);
      if (before === status) continue;
      previous.set(threadId, status);
      // The first pass reports current state so a late watcher is not blind to
      // sub-agents that already exist; later passes report only changes.
      yield* Console.log(
        toJsonLine({
          kind:
            before === undefined
              ? firstPass
                ? "agent.observed"
                : "agent.started"
              : "agent.changed",
          threadId,
          status,
          title: agent.title,
          ...(before === undefined ? {} : { previousStatus: before }),
        }),
      );
    }

    for (const [threadId, status] of previous) {
      if (seen.has(threadId)) continue;
      previous.delete(threadId);
      yield* Console.log(toJsonLine({ kind: "agent.removed", threadId, status }));
    }

    firstPass = false;
    if (!input.follow) return;
    // Every sub-agent settled and nothing left to report: stop rather than poll a
    // quiet server forever.
    // Follow drains the frontier visible after each poll. Once that frontier has
    // no running agents (including an empty first snapshot), later spawns belong
    // to a new invocation.
    if ([...previous.values()].every((status) => status !== "running")) {
      return;
    }
    yield* Effect.sleep(Duration.millis(input.intervalMillis));
  }
});

const eventsCommand = Command.make("events", {
  follow: Flag.boolean("follow").pipe(
    Flag.withDescription("Keep streaming until every sub-agent has settled."),
  ),
  intervalSeconds: Flag.integer("interval").pipe(
    Flag.withDescription("Seconds between checks while following."),
    Flag.withDefault(2),
  ),
}).pipe(
  Command.withDescription("Stream sub-agent lifecycle transitions as NDJSON."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      yield* watchTransitions({
        api,
        follow: flags.follow,
        intervalMillis: Math.max(1, flags.intervalSeconds) * 1000,
      });
    }).pipe(Effect.provide(cliRuntime)),
  ),
);

export const agentCommand = Command.make("agent").pipe(
  Command.withDescription(
    "Start agents from a terminal or control sub-agents from an agent session.",
  ),
  Command.withSubcommands([
    spawnCommand,
    sendCommand,
    awaitCommand,
    interruptCommand,
    listCommand,
    modelsCommand,
    profilesCommand,
    eventsCommand,
  ]),
);
