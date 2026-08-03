import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthOrchestrationOperateScope, AuthSessionId } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { requireStandaloneUserPresence, withStandaloneAgentSession } from "./agentStandalone.ts";

it.effect("requires an attached interactive terminal before standalone authorization", () =>
  Effect.gen(function* () {
    let confirmationRequested = false;
    const failure = yield* Effect.flip(
      requireStandaloneUserPresence({
        interactive: false,
        confirm: Effect.sync(() => {
          confirmationRequested = true;
          return true;
        }),
      }),
    );

    assert.match(failure.message, /interactive terminal/);
    assert.isFalse(confirmationRequested);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("requires explicit confirmation before a standalone spawn", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      requireStandaloneUserPresence({ interactive: true, confirm: Effect.succeed(false) }),
    );
    assert.match(failure.message, /cancelled/);

    yield* requireStandaloneUserPresence({ interactive: true, confirm: Effect.succeed(true) });
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("uses only orchestration scope and always revokes the temporary session", () => {
  const sessionId = AuthSessionId.make("agent-cli-session");
  let issuedInput: Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["issueSession"]>[0];
  const revoked: Array<string> = [];
  const auth = {
    issueSession: (input: typeof issuedInput) =>
      Effect.sync(() => {
        issuedInput = input;
        return { sessionId, token: "temporary-token" } as never;
      }),
    revokeSession: (id: AuthSessionId) =>
      Effect.sync(() => {
        revoked.push(id);
        return true;
      }),
  } as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

  return Effect.gen(function* () {
    const result = yield* withStandaloneAgentSession((token) => Effect.succeed(`used:${token}`));

    assert.equal(result, "used:temporary-token");
    assert.deepEqual(issuedInput, {
      scopes: [AuthOrchestrationOperateScope],
      label: "aqqua agent cli",
    });
    assert.deepEqual(revoked, [sessionId]);
  }).pipe(Effect.provide(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)));
});

it.effect("revokes the temporary session when the live request fails", () => {
  const sessionId = AuthSessionId.make("agent-cli-failed-session");
  const revoked: Array<string> = [];
  const auth = {
    issueSession: () => Effect.succeed({ sessionId, token: "temporary-token" } as never),
    revokeSession: (id: AuthSessionId) =>
      Effect.sync(() => {
        revoked.push(id);
        return true;
      }),
  } as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

  return Effect.gen(function* () {
    const failure = yield* Effect.flip(
      withStandaloneAgentSession(() => Effect.fail("request failed")),
    );

    assert.equal(failure, "request failed");
    assert.deepEqual(revoked, [sessionId]);
  }).pipe(Effect.provide(Layer.succeed(EnvironmentAuth.EnvironmentAuth, auth)));
});
