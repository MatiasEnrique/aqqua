/**
 * Agent-control HTTP surface.
 *
 * The `3T agent` CLI runs inside a provider session's own shell and calls these
 * routes. They are authenticated with the same provider-scoped bearer credential
 * the MCP server uses (`McpSessionRegistry`), which is what makes the parent
 * thread trustworthy: it comes from the credential T3 minted for that session, not
 * from anything the calling model wrote on the command line.
 *
 * @module agent-control/http
 */
import {
  AgentAwaitRequest,
  AgentAwaitResponse,
  AgentErrorResponse,
  AgentInterruptRequest,
  AgentInterruptResponse,
  AgentListResponse,
  AgentProfileName,
  AgentSendRequest,
  AgentSendResponse,
  AgentSpawnRequest,
  AgentSpawnResponse,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { AgentControl } from "./Services/AgentControl.ts";

export const AGENT_API_PREFIX = "/api/agents";

const response = <A, I>(
  schema: Schema.Codec<A, I>,
  value: A,
  options?: Parameters<typeof HttpServerResponse.jsonUnsafe>[1],
) => HttpServerResponse.jsonUnsafe(Schema.encodeSync(schema)(value), options);

const unauthorized = response(
  AgentErrorResponse,
  {
    error: "invalid_agent_credential",
    message:
      "A valid provider-scoped credential is required. Run `3T agent` from inside a T3 Code agent session.",
  },
  { status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" } },
);

/**
 * Resolve the calling thread from the bearer credential.
 *
 * Deliberately not a parameter: the parent identity must not be forgeable by the
 * agent that invokes the CLI.
 */
const authenticate = Effect.fn("agentControl.authenticate")(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const authorization = request.headers.authorization;
  const token =
    authorization?.startsWith("Bearer ") === true
      ? authorization.slice("Bearer ".length).trim()
      : "";
  const scope = yield* McpSessionRegistry.resolveActiveMcpScope(token);
  if (!scope) {
    return { _tag: "unauthorized" } as const;
  }
  return { _tag: "ok", parentThreadId: scope.threadId } as const;
});

/** Agent-control failures are the agent's to read, so they are shaped for a model. */
const failureResponse = (error: { readonly _tag: string; readonly message: string }) =>
  response(
    AgentErrorResponse,
    { error: error._tag, message: error.message },
    {
      status: error._tag === "AgentNotOwnedError" ? 403 : 409,
      headers: { "cache-control": "no-store" },
    },
  );

const decodeBody = <A, I>(schema: Schema.Codec<A, I>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const json = yield* request.json;
    return yield* Schema.decodeUnknownEffect(schema)(json);
  });

const invalidBody = response(
  AgentErrorResponse,
  { error: "invalid_request", message: "The request body was not understood." },
  { status: 400, headers: { "cache-control": "no-store" } },
);

/** Wrap a handler with authentication and uniform failure shaping. */
const route = <A, I>(
  responseSchema: Schema.Codec<A, I>,
  handler: (
    parentThreadId: ThreadId,
  ) => Effect.Effect<
    A,
    { readonly _tag: string; readonly message: string },
    HttpServerRequest.HttpServerRequest
  >,
) =>
  Effect.gen(function* () {
    const auth = yield* authenticate();
    if (auth._tag === "unauthorized") return unauthorized;
    return yield* handler(auth.parentThreadId).pipe(
      Effect.map((value) => response(responseSchema, value, { status: 200 })),
      Effect.catch((error) => Effect.succeed(failureResponse(error))),
    );
  }).pipe(Effect.catchCause(() => Effect.succeed(invalidBody)));

/**
 * Services are taken in the layer effect and closed over, not read inside each
 * handler: `HttpRouter` handler requirements surface as a phantom marker that
 * `Layer.provide` does not discharge. `websocketRpcRouteLayer` is built the same
 * way for the same reason.
 */
export const agentControlRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const agents = yield* AgentControl;
    return HttpRouter.addAll([
      HttpRouter.route(
        "POST",
        `${AGENT_API_PREFIX}/spawn`,
        route(AgentSpawnResponse, (parentThreadId) =>
          decodeBody(AgentSpawnRequest).pipe(
            Effect.orDie,
            Effect.flatMap((body) =>
              agents.spawn({
                parentThreadId,
                profile: AgentProfileName.make(body.profile),
                task: body.task,
                ...(body.title === undefined ? {} : { title: body.title }),
              }),
            ),
          ),
        ),
      ),
      HttpRouter.route(
        "POST",
        `${AGENT_API_PREFIX}/send`,
        route(AgentSendResponse, (parentThreadId) =>
          decodeBody(AgentSendRequest).pipe(
            Effect.orDie,
            Effect.flatMap((body) =>
              agents.send({
                parentThreadId,
                childThreadId: ThreadId.make(body.threadId),
                message: body.message,
              }),
            ),
          ),
        ),
      ),
      HttpRouter.route(
        "POST",
        `${AGENT_API_PREFIX}/await`,
        route(AgentAwaitResponse, (parentThreadId) =>
          decodeBody(AgentAwaitRequest).pipe(
            Effect.orDie,
            Effect.flatMap((body) =>
              agents.awaitTurn({
                parentThreadId,
                childThreadId: ThreadId.make(body.threadId),
                ...(body.timeoutMs === undefined
                  ? {}
                  : { timeout: Duration.millis(body.timeoutMs) }),
              }),
            ),
          ),
        ),
      ),
      HttpRouter.route(
        "POST",
        `${AGENT_API_PREFIX}/interrupt`,
        route(AgentInterruptResponse, (parentThreadId) =>
          decodeBody(AgentInterruptRequest).pipe(
            Effect.orDie,
            Effect.flatMap((body) =>
              agents
                .interrupt({ parentThreadId, childThreadId: ThreadId.make(body.threadId) })
                .pipe(Effect.as({ interrupted: body.threadId })),
            ),
          ),
        ),
      ),
      HttpRouter.route(
        "GET",
        AGENT_API_PREFIX,
        route(AgentListResponse, (parentThreadId) =>
          agents.list({ parentThreadId }).pipe(Effect.map((list) => ({ agents: list }))),
        ),
      ),
    ]);
  }),
);
