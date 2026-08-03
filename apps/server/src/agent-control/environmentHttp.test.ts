import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentAuthenticatedPrincipal,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AgentDispatchError, AgentWorkspaceNotFoundError } from "./Errors.ts";
import { handleStandaloneSpawn, mapStandaloneSpawnError } from "./environmentHttp.ts";
import { AgentControl } from "./Services/AgentControl.ts";

it.effect("reports standalone workspace selection failures as conflicts", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      mapStandaloneSpawnError(new AgentWorkspaceNotFoundError({})),
    );

    assert.equal(failure._tag, "EnvironmentHttpConflictError");
  }),
);

it.effect("reports standalone dispatch defects as internal server failures", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      mapStandaloneSpawnError(
        new AgentDispatchError({ operation: "spawnStandalone", detail: "database unavailable" }),
      ),
    );

    assert.equal(failure._tag, "EnvironmentInternalError");
    if (failure._tag !== "EnvironmentInternalError") return;
    assert.equal(failure.code, "internal_error");
  }),
);

it.effect("rejects a standalone spawn session without orchestration operate scope", () => {
  let spawnCalled = false;
  const agents = {
    spawnStandalone: () =>
      Effect.sync(() => {
        spawnCalled = true;
        return null as never;
      }),
  } as unknown as AgentControl["Service"];
  const principal = {
    sessionId: AuthSessionId.make("read-only-session"),
    subject: "test",
    method: "bearer-access-token" as const,
    scopes: new Set([AuthOrchestrationReadScope]),
  };

  return Effect.gen(function* () {
    const failure = yield* Effect.flip(
      handleStandaloneSpawn({
        cwd: "/tmp/project",
        profile: "implementer",
        task: "must not start",
      }),
    );

    assert.equal(failure._tag, "EnvironmentScopeRequiredError");
    assert.isFalse(spawnCalled);
  }).pipe(
    Effect.provide(
      Layer.merge(
        Layer.succeed(AgentControl, agents),
        Layer.succeed(EnvironmentAuthenticatedPrincipal, principal),
      ),
    ),
  );
});
