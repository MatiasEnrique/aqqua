/**
 * `aqqua agent` — delegate work to sub-agents from an orchestrator's own shell.
 *
 * This is the delegation front-end, and it is a CLI on purpose. An MCP toolkit
 * would put its tool schemas into the orchestrator's context on every turn; a
 * command the agent runs with the shell tool it already has costs nothing but the
 * one line of documentation that says it exists.
 *
 * Identity comes from the environment aqqua created for the calling provider session
 * (`AQQUA_AGENT_TOKEN`, `AQQUA_AGENT_API`), never from a flag. The server resolves the
 * parent thread from the token, so an agent cannot delegate as another thread even
 * though it writes its own command line.
 *
 * @module cli/agent
 */
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
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
  AgentProfilesResponse,
  type AgentProfilesResponse as AgentProfilesResponseType,
  AgentSendRequest,
  AgentSendResponse,
  AgentSpawnRequest,
  AgentSpawnResponse,
} from "@aqqua/contracts";

export const AGENT_TOKEN_ENV = "AQQUA_AGENT_TOKEN";
export const AGENT_API_ENV = "AQQUA_AGENT_API";

export class AgentCliError extends Schema.TaggedErrorClass<AgentCliError>()("AgentCliError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const NOT_IN_SESSION_HELP = [
  "This command must run inside an aqqua agent session.",
  "",
  `It reads ${AGENT_TOKEN_ENV} and ${AGENT_API_ENV} from the environment aqqua sets up for`,
  "each agent session. Those are absent here, which usually means the command was run",
  "from an ordinary terminal rather than from inside an agent's own shell.",
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
}

type ResponseDecoder<A, E> = (body: unknown) => Effect.Effect<A, E>;
const decodeAgentErrorResponse = Schema.decodeUnknownEffect(AgentErrorResponse);
const decodeAgentSpawnResponse = Schema.decodeUnknownEffect(AgentSpawnResponse);
const decodeAgentSendResponse = Schema.decodeUnknownEffect(AgentSendResponse);
const decodeAgentAwaitResponse = Schema.decodeUnknownEffect(AgentAwaitResponse);
const decodeAgentInterruptResponse = Schema.decodeUnknownEffect(AgentInterruptResponse);
const decodeAgentListResponse = Schema.decodeUnknownEffect(AgentListResponse);
const decodeAgentProfilesResponse = Schema.decodeUnknownEffect(AgentProfilesResponse);

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

const cliRuntime = Layer.mergeAll(FetchHttpClient.layer, NodeFileSystem.layer);

const spawnCommand = Command.make("spawn", {
  json: jsonFlag,
  profile: Flag.string("profile").pipe(
    Flag.withDescription(
      "Role to run the sub-agent as, e.g. implementer. See `aqqua agent profiles`.",
    ),
    Flag.withDefault("implementer"),
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
    Flag.withDescription("Optional sub-agent thread title."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Start a sub-agent on a task and return immediately."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const api = yield* agentApi();
      const task = yield* resolveText({
        inline: Option.getOrUndefined(flags.task),
        file: Option.getOrUndefined(flags.taskFile),
        label: "task",
      });
      const result = yield* api.spawn({
        profile: flags.profile,
        task,
        ...Option.match(flags.title, {
          onNone: () => ({}),
          onSome: (title) => ({ title }),
        }),
      });
      const threadId = result.threadId;
      yield* emit({
        json: flags.json,
        value: result,
        text: `Started ${flags.profile} sub-agent ${threadId}. Await it with: aqqua agent await ${threadId}`,
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

const profilesCommand = Command.make("profiles", { json: jsonFlag }).pipe(
  Command.withDescription("List the agent profiles this session can spawn."),
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
  Command.withDescription("Delegate work to sub-agents from inside an agent session."),
  Command.withSubcommands([
    spawnCommand,
    sendCommand,
    awaitCommand,
    interruptCommand,
    listCommand,
    profilesCommand,
    eventsCommand,
  ]),
);
