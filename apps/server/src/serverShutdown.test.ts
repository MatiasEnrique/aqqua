// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import { expect } from "vite-plus/test";

import { makeServerShutdown, runUntilServerShutdown } from "./serverShutdown.ts";

it.effect("ServerShutdown publishes the first request and remains idempotent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* makeServerShutdown;
      const waiting = yield* Effect.forkChild(shutdown.awaitRequest);

      yield* shutdown.request("desktop-parent-disconnected");
      yield* shutdown.request("desktop-parent-disconnected");

      expect(yield* Fiber.join(waiting)).toBe("desktop-parent-disconnected");
      expect(yield* shutdown.awaitRequest).toBe("desktop-parent-disconnected");
    }),
  ),
);

it.effect("ServerShutdown interrupts the server scope and waits for finalizers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shutdown = yield* makeServerShutdown;
      const started = yield* Deferred.make<void>();
      const finalized = yield* Ref.make(false);
      const server = Effect.acquireUseRelease(
        Deferred.succeed(started, undefined),
        () => Effect.never,
        () => Ref.set(finalized, true),
      );
      const running = yield* runUntilServerShutdown(server, shutdown).pipe(Effect.forkChild);

      yield* Deferred.await(started);
      yield* shutdown.request("desktop-parent-disconnected");
      yield* Fiber.join(running);

      expect(yield* Ref.get(finalized)).toBe(true);
    }),
  ),
);

it("keeps a child backend alive after malformed telemetry, then finalizes on EOF", async () => {
  const fixturePath = fileURLToPath(
    new URL("./testing/DesktopParentLeaseFixture.ts", import.meta.url),
  );
  const child = NodeChildProcess.spawn(process.execPath, [fixturePath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe", "ignore", "pipe"],
  });
  const telemetryWriter = child.stdio[4];
  if (!(telemetryWriter instanceof Writable)) {
    child.kill("SIGTERM");
    throw new Error("Child telemetry writer was not created.");
  }

  let stderr = "";
  let stdout = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  const ready = new Promise<void>((resolve, reject) => {
    const checkReady = () => {
      if (stdout.includes("READY\n")) {
        resolve();
      }
    };
    child.stdout?.on("data", checkReady);
    child.once("error", reject);
    checkReady();
  });

  try {
    await Promise.race([
      ready,
      delay(5_000).then(() => {
        throw new Error(`Child backend did not become ready.\n${stderr}`);
      }),
    ]);
    telemetryWriter.write("not-json\n");
    await delay(100);
    if (child.exitCode !== null) {
      throw new Error(`Child backend exited on telemetry decode failure.\n${stderr}`);
    }
    telemetryWriter.end();

    const { code, signal } = await Promise.race([
      exited,
      delay(5_000).then(() => {
        throw new Error(`Child backend did not exit after telemetry EOF.\n${stderr}`);
      }),
    ]);
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(stdout).toContain("SERVER_FINALIZED\n");
    expect(stdout).toContain("SCOPE_FINALIZED\n");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
});
