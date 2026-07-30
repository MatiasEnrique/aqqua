// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { make as makeDesktopTelemetryReceiver } from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import { makeServerShutdown, runUntilServerShutdown, ServerShutdown } from "../serverShutdown.ts";
import * as ServerSettings from "../serverSettings.ts";

const fixture = Effect.scoped(
  Effect.gen(function* () {
    const baseConfig = yield* ServerConfig.ServerConfig;
    const shutdown = yield* makeServerShutdown;
    yield* makeDesktopTelemetryReceiver().pipe(
      Effect.provideService(
        ServerConfig.ServerConfig,
        ServerConfig.make({
          ...baseConfig,
          mode: "desktop",
          desktopTelemetryFd: 4,
        }),
      ),
      Effect.provideService(ServerShutdown, shutdown),
    );
    yield* Effect.sync(() => NodeFS.writeSync(1, "READY\n"));
    yield* runUntilServerShutdown(
      Effect.acquireUseRelease(
        Effect.void,
        () => Effect.never,
        () => Effect.sync(() => NodeFS.writeSync(1, "SERVER_FINALIZED\n")),
      ),
      shutdown,
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerSettings.layerTest(),
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-desktop-parent-child-",
        }),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
).pipe(Effect.ensuring(Effect.sync(() => NodeFS.writeSync(1, "SCOPE_FINALIZED\n"))));

Effect.runPromise(fixture).catch((error: unknown) => {
  NodeFS.writeSync(2, `${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
