import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { PiSettings, ProviderInstanceId, ProviderListSkillsError } from "@aqqua/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makePiRpcMockPeer } from "../testUtils/piRpcMockPeer.ts";
import {
  buildInitialPiProviderSnapshot,
  checkPiProviderStatus,
  listPiSkills,
  parsePiListModelsOutput,
} from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

describe("parsePiListModelsOutput", () => {
  it("parses provider/model rows and preserves slashes inside model ids", () => {
    const models = parsePiListModelsOutput(
      [
        "provider    model                              context  max-out  thinking  images",
        "anthropic   claude-sonnet-5                    200k     64k      yes       yes",
        "openrouter  anthropic/claude-sonnet-5          200k     64k      yes       yes",
        "google      gemini-2.5-flash                   1m       64k      no        yes",
      ].join("\n"),
    );

    expect(models.map((model) => model.slug)).toEqual([
      "anthropic/claude-sonnet-5",
      "openrouter/anthropic/claude-sonnet-5",
      "google/gemini-2.5-flash",
    ]);
    expect(models[0]?.isDefault).toBe(true);
    expect(models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({
      id: "reasoningEffort",
      options: [{ id: "off" }, { id: "minimal" }, { id: "low" }, { id: "medium" }, { id: "high" }],
    });
  });
});

describe("buildInitialPiProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when pi is disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({ enabled: false }));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.displayName).toBe("pi");
    }),
  );

  it.effect("returns a pending snapshot with the default model", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPiProviderSnapshot(decodePiSettings({}));
      expect(snapshot.status).toBe("warning");
      expect(snapshot.models.map((model) => model.slug)).toContain("anthropic/claude-sonnet-5");
      expect(snapshot.badgeLabel).toBe("Early Access");
      expect(snapshot.showInteractionModeToggle).toBe(false);
    }),
  );
});

it.layer(NodeServices.layer)("checkPiProviderStatus", (it) => {
  it.effect("reports a missing binary as not installed", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(
        decodePiSettings({ binaryPath: "/definitely/not/installed/pi-binary" }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH/);
    }),
  );

  it.effect("reports a non-zero version probe without leaking stderr", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "aqqua-pi-error-" });
        const executable = path.join(dir, "pi");
        yield* fs.writeFileString(
          executable,
          ["#!/bin/sh", 'printf "secret pi failure\\n" >&2', "exit 7", ""].join("\n"),
        );
        yield* fs.chmod(executable, 0o755);

        const snapshot = yield* checkPiProviderStatus(decodePiSettings({ binaryPath: executable }));
        expect(snapshot.installed).toBe(true);
        expect(snapshot.status).toBe("error");
        expect(snapshot.message).toBe("pi CLI is installed but failed to run `pi --version`.");
        expect(snapshot.message).not.toContain("secret pi failure");
      }),
    ),
  );

  it.effect("reports ready models and merges configured custom models", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "aqqua-pi-ready-" });
        const executable = path.join(dir, "pi");
        yield* fs.writeFileString(
          executable,
          [
            "#!/bin/sh",
            'if [ "$1" = "--version" ]; then',
            '  printf "pi 0.52.1\\n"',
            'elif [ "$1" = "--list-models" ]; then',
            '  printf "provider    model                         context  max-out  thinking  images\\n"',
            '  printf "anthropic   claude-sonnet-5               200k     64k      yes       yes\\n"',
            '  printf "openrouter  anthropic/claude-sonnet-5     200k     64k      yes       yes\\n"',
            "else",
            "  exit 2",
            "fi",
            "",
          ].join("\n"),
        );
        yield* fs.chmod(executable, 0o755);

        const snapshot = yield* checkPiProviderStatus(
          decodePiSettings({
            binaryPath: executable,
            homePath: path.join(dir, "pi-home"),
            customModels: ["custom/provider/model"],
          }),
        );
        expect(snapshot.status).toBe("ready");
        expect(snapshot.version).toBe("0.52.1");
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "anthropic/claude-sonnet-5",
          "openrouter/anthropic/claude-sonnet-5",
          "custom/provider/model",
        ]);
      }),
    ),
  );
});

const timeoutHandle = ChildProcessSpawner.makeHandle({
  pid: ChildProcessSpawner.ProcessId(52_052),
  exitCode: Effect.never,
  isRunning: Effect.succeed(true),
  kill: () => Effect.void,
  unref: Effect.succeed(Effect.void),
  stdin: Sink.drain,
  stdout: Stream.never,
  stderr: Stream.never,
  all: Stream.never,
  getInputFd: () => Sink.drain,
  getOutputFd: () => Stream.never,
});
const TimeoutSpawnerLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.succeed(timeoutHandle)),
);
it.effect("reports a timed-out version probe", () =>
  Effect.gen(function* () {
    const probeFiber = yield* checkPiProviderStatus(
      decodePiSettings({ binaryPath: "/fake/pi" }),
    ).pipe(Effect.provide(TimeoutSpawnerLayer), Effect.forkChild);
    yield* TestClock.adjust(Duration.seconds(5));
    const snapshot = yield* Fiber.join(probeFiber);
    expect(snapshot.installed).toBe(true);
    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toContain("timed out");
  }).pipe(Effect.provide(TestClock.layer())),
);

describe("listPiSkills", () => {
  const instanceId = ProviderInstanceId.make("pi_test");
  const settings = decodePiSettings({
    binaryPath: "pi",
    homePath: "/tmp/pi-home",
    trustProjectFiles: true,
  });

  it.effect("maps get_commands entries to provider skills", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const listing = yield* listPiSkills(settings, instanceId, "/repo", {}).pipe(
        Effect.provide(peer.layer),
        Effect.forkChild,
      );
      const command = yield* peer.takeCommand;
      expect(command).toMatchObject({ type: "get_commands" });
      yield* peer.respond(command, {
        commands: [
          {
            name: "skill:search",
            description: "Search the web",
            source: "skill",
            location: "project",
            path: "/repo/.pi/skills/search/SKILL.md",
          },
          {
            name: "fix-tests",
            source: "prompt",
            location: "user",
            path: "/tmp/pi-home/prompts/fix-tests.md",
          },
          { name: "session-name", source: "extension" },
        ],
      });

      expect(yield* Fiber.join(listing)).toEqual([
        {
          name: "skill:search",
          description: "Search the web",
          path: "/repo/.pi/skills/search/SKILL.md",
          scope: "project",
          enabled: true,
        },
        {
          name: "fix-tests",
          path: "/tmp/pi-home/prompts/fix-tests.md",
          scope: "user",
          enabled: true,
        },
        {
          name: "session-name",
          path: "extension:session-name",
          scope: "extension",
          enabled: true,
        },
      ]);
    }),
  );

  it.effect("surfaces RPC failures as ProviderListSkillsError", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const listing = yield* listPiSkills(settings, instanceId, "/repo", {}).pipe(
        Effect.provide(peer.layer),
        Effect.forkChild,
      );
      const command = yield* peer.takeCommand;
      yield* peer.fail(command, "command inventory unavailable");

      const error = yield* Fiber.join(listing).pipe(Effect.flip);
      expect(error).toBeInstanceOf(ProviderListSkillsError);
      expect(error.instanceId).toBe(instanceId);
      expect(error.reason).toContain("command inventory unavailable");
    }),
  );
});

describe("pi reasoning capability metadata", () => {
  it("marks its reasoningEffort descriptor as the semantic reasoning control", () => {
    const models = parsePiListModelsOutput(
      [
        "provider    model                              context  max-out  thinking  images",
        "anthropic   claude-sonnet-5                    200k     64k      yes       yes",
      ].join("\n"),
    );

    const descriptor = models[0]?.capabilities?.optionDescriptors?.find(
      (candidate) => candidate.semantic === "reasoning",
    );
    expect(descriptor?.id).toBe("reasoningEffort");
  });
});
