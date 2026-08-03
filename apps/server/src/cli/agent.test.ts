import { assert, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { AgentListResponse } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  type AgentApi,
  agentCommand,
  decodeServerResponse,
  formatSpawnStarted,
  formatProfileLine,
  formatServerFailure,
  resolveText,
  resolveSpawnTransport,
  watchTransitions,
} from "./agent.ts";

it("uses the local desktop environment when spawn runs outside an agent session", () => {
  assert.equal(resolveSpawnTransport({}, "ordinary-terminal"), "standalone");
  assert.equal(
    resolveSpawnTransport({
      AQQUA_AGENT_TOKEN: "token",
      AQQUA_AGENT_API: "http://127.0.0.1:5173",
      AQQUA_THREAD_ID: "thread-1",
    }),
    "session",
  );
});

it("does not enter standalone mode when an agent-originated process deletes every identity variable", () => {
  assert.equal(resolveSpawnTransport({}, "agent-session"), "agent-origin");
});

it("fails closed when only part of an agent session environment remains", () => {
  assert.equal(resolveSpawnTransport({ AQQUA_AGENT_TOKEN: "token" }), "invalid-session");
  assert.equal(
    resolveSpawnTransport({
      AQQUA_AGENT_API: "http://127.0.0.1:5173",
      AQQUA_THREAD_ID: "thread-1",
    }),
    "invalid-session",
  );
});

it("does not recommend the session-only await command after a standalone spawn", () => {
  const output = formatSpawnStarted({
    profile: "implementer",
    threadId: "thread-1",
    transport: "standalone",
  });
  assert.include(output, "Open it in aqqua");
  assert.notInclude(output, "agent await");
});

const withFileSystem = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  effect.pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, Path.layer)));
const decodeAgentListResponse = Schema.decodeUnknownEffect(AgentListResponse);

it("surfaces the server's own explanation rather than a status code", () => {
  assert.equal(
    formatServerFailure({
      error: "AgentConcurrencyLimitError",
      message: "Thread 'a' already has 3 sub-agents running.",
    }),
    "AgentConcurrencyLimitError: Thread 'a' already has 3 sub-agents running.",
  );
});

it.effect("reports one clear diagnostic for an undecodable server response", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      decodeServerResponse(decodeAgentListResponse, 200, "/api/agents", { agents: [{}] }),
    );
    assert.equal(
      failure.message,
      "The aqqua server returned an invalid response for /api/agents (HTTP 200).",
    );
  }),
);

const profile = (overrides: Partial<Parameters<typeof formatProfileLine>[0]> = {}) => ({
  name: "codex",
  runtime: "session",
  driver: "codex",
  model: "gpt-5.6-sol",
  pinsModel: true,
  titlePrefix: "codex",
  unavailable: null,
  ...overrides,
});

it("shows the model a pinned profile would actually run", () => {
  assert.equal(formatProfileLine(profile()), "codex          gpt-5.6-sol            driver=codex");
});

it("flags a profile that inherits its model instead of pinning one", () => {
  const line = formatProfileLine(profile({ name: "implementer", pinsModel: false, driver: null }));
  assert.include(line, "inherits the project default model");
});

it("reports why an unusable profile cannot be spawned instead of naming a model", () => {
  const line = formatProfileLine(
    profile({
      name: "fable",
      model: null,
      unavailable: "Agent profile 'fable' is not usable: no 'claudeAgent' provider is configured.",
    }),
  );
  assert.include(line, "UNAVAILABLE");
  assert.include(line, "no 'claudeAgent' provider is configured.");
  assert.notInclude(line, "gpt-5.6-sol");
});

const unused = () => Effect.die("unused");
const makeApi = (list: AgentApi["list"]): AgentApi => ({
  spawn: unused,
  send: unused,
  await: unused,
  interrupt: unused,
  list,
  profiles: unused,
});

it.effect("follow exits after an empty first snapshot", () =>
  Effect.gen(function* () {
    let polls = 0;
    const api = makeApi(() =>
      Effect.sync(() => {
        polls += 1;
        return { agents: [] };
      }),
    );

    yield* watchTransitions({ api, follow: true, intervalMillis: 0 });
    assert.equal(polls, 1);
  }),
);

it.effect("follow exits when the last running agent disappears", () =>
  Effect.gen(function* () {
    let polls = 0;
    const api = makeApi(() =>
      Effect.sync(() => {
        polls += 1;
        return polls === 1
          ? {
              agents: [
                {
                  threadId: "thread-1",
                  profile: "implementer",
                  title: "Fix lane B",
                  status: "running" as const,
                  updatedAt: "2026-07-25T21:00:00.000Z",
                },
              ],
            }
          : { agents: [] };
      }),
    );

    yield* watchTransitions({ api, follow: true, intervalMillis: 0 });
    assert.equal(polls, 2);
  }),
);

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
