/**
 * Agent-control HTTP surface.
 *
 * The `aqqua agent` CLI runs inside a provider session's own shell and calls these
 * routes. They are authenticated with the same provider-scoped bearer credential
 * the MCP server uses (`McpSessionRegistry`), which is what makes the parent
 * thread trustworthy: it comes from the credential aqqua minted for that session, not
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
  AgentProfilesResponse,
  AgentSendRequest,
  AgentSendResponse,
  AgentSpawnRequest,
  AgentSpawnResponse,
  ThreadId,
} from "@aqqua/contracts";
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
      "A valid provider-scoped credential is required. Run `aqqua agent` from inside an aqqua agent session.",
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

const INVALID_PROFILE_NAME_TAG = "InvalidAgentProfileNameError";

const failureStatus = (tag: string): number => {
  if (tag === "AgentNotOwnedError") return 403;
  if (tag === INVALID_PROFILE_NAME_TAG) return 400;
  return 409;
};

/** Agent-control failures are the agent's to read, so they are shaped for a model. */
const failureResponse = (error: { readonly _tag: string; readonly message: string }) =>
  response(
    AgentErrorResponse,
    { error: error._tag, message: error.message },
    {
      status: failureStatus(error._tag),
      headers: { "cache-control": "no-store" },
    },
  );

/**
 * Validate the requested role name before it reaches profile resolution.
 *
 * `AgentProfileName.make` throws on a malformed name, which the catch-all below
 * would flatten into "the request body was not understood" — true, but it names
 * neither the offending field nor the rule. A caller that mistypes a profile
 * should be told which of the two things went wrong: the name is not a legal
 * name, or the name is legal but not configured.
 */
const decodeAgentProfileName = Schema.decodeUnknownEffect(AgentProfileName);

const decodeProfileName = (value: string) =>
  decodeAgentProfileName(value).pipe(
    Effect.mapError(() => ({
      _tag: INVALID_PROFILE_NAME_TAG,
      message:
        `'${value}' is not a valid agent profile name: it must start with a letter and ` +
        "use only letters, digits, '-' or '_'. Run `aqqua agent profiles` to see the configured profiles.",
    })),
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
              decodeProfileName(body.profile).pipe(
                Effect.flatMap((profile) =>
                  agents.spawn({
                    parentThreadId,
                    profile,
                    task: body.task,
                    ...(body.title === undefined ? {} : { title: body.title }),
                  }),
                ),
              ),
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
        `${AGENT_API_PREFIX}/profiles`,
        route(AgentProfilesResponse, (parentThreadId) =>
          agents.profiles({ parentThreadId }).pipe(
            Effect.map((profiles) => ({
              profiles: profiles.map((profile) => ({
                ...profile,
                name: profile.name as string,
              })),
            })),
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
