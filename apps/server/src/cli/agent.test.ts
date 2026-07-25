import { assert, it } from "@effect/vitest";
import { NodeFileSystem } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { agentCommand, formatServerFailure, resolveText } from "./agent.ts";

const withFileSystem = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  effect.pipe(Effect.provide(NodeFileSystem.layer), Effect.provide(Path.layer));

it("surfaces the server's own explanation rather than a status code", () => {
  assert.equal(
    formatServerFailure(409, {
      error: "AgentConcurrencyLimitError",
      message: "Thread 'a' already has 3 sub-agents running.",
    }),
    "AgentConcurrencyLimitError: Thread 'a' already has 3 sub-agents running.",
  );
  assert.equal(formatServerFailure(500, {}), "The T3 Code server rejected the request (HTTP 500).");
  assert.equal(
    formatServerFailure(401, "not json"),
    "The T3 Code server rejected the request (HTTP 401).",
  );
});

it.effect("reads a task from a file so long tasks never pass through the command line", () =>
  withFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "task.md");
      yield* fileSystem.writeFileString(file, "Implement the seam\nwith detail");

      const task = yield* resolveText({ inline: undefined, file, label: "task" });
      assert.equal(task, "Implement the seam\nwith detail");
    }).pipe(Effect.scoped),
  ),
);

it.effect("prefers an explicit file over inline text", () =>
  withFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "task.md");
      yield* fileSystem.writeFileString(file, "from file");

      const task = yield* resolveText({ inline: "from flag", file, label: "task" });
      assert.equal(task, "from file");
    }).pipe(Effect.scoped),
  ),
);

it.effect("rejects an empty task file instead of starting a sub-agent with no task", () =>
  withFileSystem(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "empty.md");
      yield* fileSystem.writeFileString(file, "   \n  ");

      const failure = yield* Effect.flip(resolveText({ inline: undefined, file, label: "task" }));
      assert.match(failure.message, /empty/);
    }).pipe(Effect.scoped),
  ),
);

it.effect("explains a missing task file rather than failing opaquely", () =>
  withFileSystem(
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        resolveText({ inline: undefined, file: "/nonexistent/task.md", label: "task" }),
      );
      assert.match(failure.message, /Could not read task/);
    }),
  ),
);

it.effect("requires a task at all", () =>
  withFileSystem(
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        resolveText({ inline: "   ", file: undefined, label: "task" }),
      );
      assert.match(failure.message, /A task is required/);
    }),
  ),
);

it("offers no way to name the calling thread", () => {
  // Parent identity comes from the session credential. If a flag could set it, an
  // orchestrator could delegate as — or inspect — another thread, so the absence
  // of such a flag is a security property and worth pinning.
  const surface = JSON.stringify(agentCommand);
  for (const forbidden of ["parentThreadId", "parent-thread", "--parent", "asThread"]) {
    assert.ok(
      !surface.includes(forbidden),
      `the agent CLI must not expose '${forbidden}' as an input`,
    );
  }
});
