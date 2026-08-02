import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

export type ServerShutdownReason = "desktop-parent-disconnected";

export interface ServerShutdownShape {
  readonly request: (reason: ServerShutdownReason) => Effect.Effect<void>;
  readonly awaitRequest: Effect.Effect<ServerShutdownReason>;
}

export class ServerShutdown extends Context.Service<ServerShutdown, ServerShutdownShape>()(
  "aqqua/serverShutdown",
) {}

export const makeServerShutdown = Effect.gen(function* () {
  const requested = yield* Deferred.make<ServerShutdownReason>();
  return ServerShutdown.of({
    request: (reason) => Deferred.succeed(requested, reason).pipe(Effect.asVoid),
    awaitRequest: Deferred.await(requested),
  });
});

export const runUntilServerShutdown = <E, R>(
  server: Effect.Effect<never, E, R>,
  shutdown: ServerShutdownShape,
): Effect.Effect<void, E, R> => Effect.raceFirst(server, shutdown.awaitRequest.pipe(Effect.asVoid));
