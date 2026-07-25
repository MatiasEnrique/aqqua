/**
 * `t3 agent` — delegate work to sub-agents from an orchestrator's own shell.
 *
 * This is the delegation front-end, and it is a CLI on purpose. An MCP toolkit
 * would put its tool schemas into the orchestrator's context on every turn; a
 * command the agent runs with the shell tool it already has costs nothing but the
 * one line of documentation that says it exists.
 *
 * Identity comes from the environment T3 created for the calling provider session
 * (`T3_AGENT_TOKEN`, `T3_AGENT_API`), never from a flag. The server resolves the
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
import { NodeFileSystem } from "@effect/platform-node";

export const AGENT_TOKEN_ENV = "T3_AGENT_TOKEN";
export const AGENT_API_ENV = "T3_AGENT_API";

export class AgentCliError extends Schema.TaggedErrorClass<AgentCliError>()("AgentCliError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const NOT_IN_SESSION_HELP = [
  "This command must run inside a T3 Code agent session.",
  "",
  `It reads ${AGENT_TOKEN_ENV} and ${AGENT_API_ENV} from the environment T3 Code sets up for`,
  "each agent session. Those are absent here, which usually means the command was run",
  "from an ordinary terminal rather than from inside an agent's own shell.",
].join("\n");

interface AgentApi {
  readonly post: (path: string, body: unknown) => Effect.Effect<unknown, AgentCliError>;
  readonly get: (path: string) => Effect.Effect<unknown, AgentCliError>;
}

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

  const send = <E>(
    request: Effect.Effect<HttpClientResponse.HttpClientResponse, E>,
    path: string,
  ) =>
    request.pipe(
      Effect.flatMap((response) =>
        response.json.pipe(
          Effect.map((body) => ({ status: response.status, body })),
          Effect.orElseSucceed(() => ({ status: response.status, body: undefined as unknown })),
        ),
      ),
      Effect.mapError(
        (cause) =>
          new AgentCliError({
            detail: `Could not reach the T3 Code server at ${origin}${path}: ${String(cause)}`,
          }),
      ),
      Effect.flatMap(({ body, status }) =>
        status >= 200 && status < 300
          ? Effect.succeed(body)
          : new AgentCliError({ detail: formatServerFailure(status, body) }),
      ),
    );

  return {
    post: (path, body) =>
      send(
        client.post(`${origin}${path}`, {
          headers: { authorization: `Bearer ${token}` },
          body: HttpBody.jsonUnsafe(body),
        }),
        path,
      ),
    get: (path) =>
      send(
        client.get(`${origin}${path}`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        path,
      ),
  } satisfies AgentApi;
});

/** Server failures are written for the agent reading stderr, not for a log. */
export const formatServerFailure = (status: number, body: unknown): string => {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof record.message === "string" ? record.message : undefined;
  const error = typeof record.error === "string" ? record.error : undefined;
  if (message) {
    return error ? `${error}: ${message}` : message;
  }
  return `The T3 Code server rejected the request (HTTP ${status}).`;
};

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

const readField = (value: unknown, key: string): string => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const field = record[key];
  return typeof field === "string" ? field : "";
};

const cliRuntime = Layer.mergeAll(FetchHttpClient.layer, NodeFileSystem.layer);

const spawnCommand = Command.make("spawn", {
  json: jsonFlag,
  profile: Flag.string("profile").pipe(
    Flag.withDescription("Role to run the sub-agent as, e.g. implementer."),
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
      const result = yield* api.post("/api/agents/spawn", {
        profile: flags.profile,
        task,
        ...Option.match(flags.title, {
          onNone: () => ({}),
          onSome: (title) => ({ title }),
        }),
      });
      const threadId = readField(result, "threadId");
      yield* emit({
        json: flags.json,
        value: result,
        text: `Started ${flags.profile} sub-agent ${threadId}. Await it with: t3 agent await ${threadId}`,
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
      const result = yield* api.post("/api/agents/send", {
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
      const result = yield* api.post("/api/agents/await", {
        threadId: flags.threadId,
        ...Option.match(flags.timeoutSeconds, {
          onNone: () => ({}),
          onSome: (seconds) => ({ timeoutMs: seconds * 1000 }),
        }),
      });
      const status = readField(result, "status");
      const finalMessage = readField(result, "finalMessage");
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
      const result = yield* api.post("/api/agents/interrupt", { threadId: flags.threadId });
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
      const result = yield* api.get("/api/agents");
      const record =
        typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
      const agents = Array.isArray(record.agents) ? record.agents : [];
      yield* emit({
        json: flags.json,
        value: result,
        text:
          agents.length === 0
            ? "No sub-agents."
            : agents
                .map(
                  (agent) =>
                    `${readField(agent, "status").padEnd(11)} ${readField(agent, "threadId")}  ${readField(agent, "title")}`,
                )
                .join("\n"),
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
const watchTransitions = Effect.fn("agentCli.watch")(function* (input: {
  readonly api: AgentApi;
  readonly follow: boolean;
  readonly intervalMillis: number;
}) {
  const previous = new Map<string, string>();
  let firstPass = true;

  while (true) {
    const result = yield* input.api.get("/api/agents");
    const record =
      typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
    const agents = Array.isArray(record.agents) ? record.agents : [];
    const seen = new Set<string>();

    for (const agent of agents) {
      const threadId = readField(agent, "threadId");
      if (threadId.length === 0) continue;
      seen.add(threadId);
      const status = readField(agent, "status");
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
          title: readField(agent, "title"),
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
    if (agents.length > 0 && [...previous.values()].every((status) => status !== "running")) {
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
    eventsCommand,
  ]),
);
