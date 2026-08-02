// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { assert, describe, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { makeServerShutdown, ServerShutdown } from "../serverShutdown.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  type DesktopTelemetryReceiverHealth,
  initialDesktopTelemetryContactAt,
  isDesktopTelemetryContactStale,
  make as makeDesktopTelemetryReceiver,
  recordDesktopTelemetrySampleHealth,
  requireDesktopTelemetryWriteProgress,
  resolveDesktopTelemetrySnapshotStaleAfterMs,
  writeAllToFileDescriptor,
} from "./DesktopTelemetryReceiver.ts";

describe("DesktopTelemetryReceiver", () => {
  it("degrades a hello-only stream after the first-sample deadline", () => {
    expect(isDesktopTelemetryContactStale(Option.some(1_000), 90_999)).toBe(false);
    expect(isDesktopTelemetryContactStale(Option.some(1_000), 91_000)).toBe(true);
    expect(isDesktopTelemetryContactStale(Option.none(), 1_000_000)).toBe(false);
  });

  it("starts the stale deadline as soon as a telemetry descriptor is opened", () => {
    expect(initialDesktopTelemetryContactAt(7, 1_000)).toEqual(Option.some(1_000));
    expect(initialDesktopTelemetryContactAt(undefined, 1_000)).toEqual(Option.none());
  });

  it("keeps the snapshot deadline beyond the configured idle polling interval", () => {
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(30_000, 120_000)).toBe(150_000);
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(60_000, 600_000)).toBe(630_000);
    expect(resolveDesktopTelemetrySnapshotStaleAfterMs(1_000, 1_000)).toBe(90_000);
  });

  it.effect("publishes the latest sample timestamp while health remains healthy", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initialSample = DateTime.makeUnsafe(1_000);
        const nextSample = DateTime.makeUnsafe(2_000);
        const health = yield* Ref.make<DesktopTelemetryReceiverHealth>({
          status: "healthy",
          lastSampleAt: Option.some(initialSample),
          lastError: Option.none<string>(),
        });
        const healthChanges = yield* PubSub.sliding<DesktopTelemetryReceiverHealth>(4);
        const subscription = yield* PubSub.subscribe(healthChanges);

        yield* recordDesktopTelemetrySampleHealth(health, healthChanges, nextSample);
        const published = yield* PubSub.take(subscription).pipe(Effect.timeout("1 second"));

        expect(DateTime.toEpochMillis(Option.getOrThrow(published.lastSampleAt))).toBe(2_000);
      }),
    ),
  );

  it.effect("writes control messages through the asynchronous descriptor path", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const directory = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "aqqua-desktop-telemetry-control-test-"),
        );
        const path = NodePath.join(directory, "control.ndjson");
        return {
          directory,
          path,
          fd: NodeFS.openSync(path, "w"),
        };
      }),
      ({ fd, path }) =>
        Effect.gen(function* () {
          const payload = Buffer.from('{"type":"setDiagnosticsDemand","enabled":true}\n');
          yield* writeAllToFileDescriptor(fd, payload);
          NodeFS.fsyncSync(fd);

          assert.equal(NodeFS.readFileSync(path, "utf8"), payload.toString("utf8"));
        }),
      ({ directory, fd }) =>
        Effect.sync(() => {
          NodeFS.closeSync(fd);
          NodeFS.rmSync(directory, { recursive: true, force: true });
        }),
    ),
  );

  it.effect("models a zero-byte control write as a stalled descriptor", () =>
    Effect.gen(function* () {
      const error = yield* requireDesktopTelemetryWriteProgress(7, 42, 0).pipe(Effect.flip);

      expect(error._tag).toBe("DesktopTelemetryControlStalled");
      expect(error.fd).toBe(7);
      expect(error.remainingBytes).toBe(42);
      expect(error.message).toBe(
        "Desktop telemetry control stalled on fd 7 with 42 bytes remaining.",
      );
      yield* requireDesktopTelemetryWriteProgress(7, 42, 1);
    }),
  );

  it.effect("requests server shutdown when the desktop telemetry descriptor reaches EOF", () =>
    Effect.scoped(
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const directory = NodeFS.mkdtempSync(
            NodePath.join(NodeOS.tmpdir(), "aqqua-desktop-parent-lease-test-"),
          );
          const path = NodePath.join(directory, "telemetry.ndjson");
          NodeFS.writeFileSync(path, "");
          return {
            directory,
            fd: NodeFS.openSync(path, "r"),
          };
        }),
        ({ fd }) =>
          Effect.gen(function* () {
            const baseConfig = yield* ServerConfig.ServerConfig;
            const shutdown = yield* makeServerShutdown;
            yield* makeDesktopTelemetryReceiver().pipe(
              Effect.provideService(
                ServerConfig.ServerConfig,
                ServerConfig.make({
                  ...baseConfig,
                  mode: "desktop",
                  desktopTelemetryFd: fd,
                }),
              ),
              Effect.provideService(ServerShutdown, shutdown),
            );

            expect(yield* shutdown.awaitRequest.pipe(Effect.timeout("2 seconds"))).toBe(
              "desktop-parent-disconnected",
            );
          }),
        ({ directory, fd }) =>
          Effect.sync(() => {
            try {
              NodeFS.closeSync(fd);
            } catch {
              // The receiver owns and closes the descriptor after EOF.
            }
            NodeFS.rmSync(directory, { recursive: true, force: true });
          }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettings.layerTest(),
            ServerConfig.layerTest(process.cwd(), {
              prefix: "aqqua-parent-lease-",
            }),
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      ),
    ),
  );

  it.live("does not request shutdown for a web server without a telemetry descriptor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const baseConfig = yield* ServerConfig.ServerConfig;
        const shutdown = yield* makeServerShutdown;
        yield* makeDesktopTelemetryReceiver().pipe(
          Effect.provideService(
            ServerConfig.ServerConfig,
            ServerConfig.make({
              ...baseConfig,
              mode: "web",
              desktopTelemetryFd: undefined,
            }),
          ),
          Effect.provideService(ServerShutdown, shutdown),
        );

        expect(
          Option.isNone(yield* shutdown.awaitRequest.pipe(Effect.timeoutOption("50 millis"))),
        ).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerSettings.layerTest(),
            ServerConfig.layerTest(process.cwd(), {
              prefix: "aqqua-web-no-parent-lease-",
            }),
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      ),
    ),
  );
});
