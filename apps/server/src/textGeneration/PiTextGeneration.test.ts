import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import { PiSettings, ProviderInstanceId } from "@aqqua/contracts";
import { createModelSelection } from "@aqqua/shared/model";

import * as Stream from "effect/Stream";

import * as TextGeneration from "./TextGeneration.ts";
import { makePiTextGeneration, readStreamTail } from "./PiTextGeneration.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const PI_INSTANCE_ID = ProviderInstanceId.make("pi");

function piJsonOutput(assistantText: string): string {
  return [
    JSON.stringify({ type: "session", version: 3, id: "test-session" }),
    JSON.stringify({ type: "agent_start" }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      },
      entryId: "test-entry",
    }),
    JSON.stringify({ type: "agent_end", messages: [], willRetry: false }),
  ].join("\n");
}

function makeFakePiBinary(
  dir: string,
  input: { readonly output: string; readonly exitCode?: number; readonly stderr?: string },
) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binaryPath = path.join(dir, "pi");
    yield* fileSystem.writeFileString(
      binaryPath,
      [
        "#!/bin/sh",
        ': > "$AQQUA_PI_ARGS_LOG"',
        'for arg in "$@"; do',
        '  printf "%s\\n" "$arg" >> "$AQQUA_PI_ARGS_LOG"',
        "done",
        'printf "%s" "${PI_CODING_AGENT_DIR-}" > "$AQQUA_PI_HOME_LOG"',
        ...(input.stderr
          ? [
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              `printf "%s\\n" ${JSON.stringify(input.stderr)} >&2`,
            ]
          : []),
        "cat <<'__AQQUA_FAKE_PI_OUTPUT__'",
        input.output,
        "__AQQUA_FAKE_PI_OUTPUT__",
        `exit ${input.exitCode ?? 0}`,
        "",
      ].join("\n"),
    );
    yield* fileSystem.chmod(binaryPath, 0o755);
    return binaryPath;
  });
}

function withFakePi<A, E, R>(
  input: {
    readonly output: string;
    readonly exitCode?: number;
    readonly stderr?: string;
    readonly homePath?: string;
  },
  effectFn: (input: {
    readonly textGeneration: TextGeneration.TextGeneration["Service"];
    readonly argsLogPath: string;
    readonly homeLogPath: string;
  }) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aqqua-pi-text-" });
    const argsLogPath = path.join(tempDir, "args.log");
    const homeLogPath = path.join(tempDir, "home.log");
    const binaryPath = yield* makeFakePiBinary(tempDir, input);
    const settings = decodePiSettings({ binaryPath, homePath: input.homePath ?? "" });
    const textGeneration = yield* makePiTextGeneration(settings, {
      AQQUA_PI_ARGS_LOG: argsLogPath,
      AQQUA_PI_HOME_LOG: homeLogPath,
    });
    return yield* effectFn({ textGeneration, argsLogPath, homeLogPath });
  }).pipe(Effect.scoped);
}

it.layer(NodeServices.layer)("PiTextGeneration", (it) => {
  it.effect("runs one-shot JSON print mode, splits the model slug, and sanitizes commits", () =>
    withFakePi(
      {
        output: piJsonOutput(
          'Here is the result:\n```json\n{"subject":"  Improve pi text generation.\\nignored","body":"\\n- add pi\\n","branch":"Fix/Pi Output"}\n```\nDone.',
        ),
        homePath: "/tmp/aqqua-pi-home",
      },
      ({ textGeneration, argsLogPath, homeLogPath }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/pi",
            stagedSummary: "M PiTextGeneration.ts",
            stagedPatch: "diff --git a/PiTextGeneration.ts b/PiTextGeneration.ts",
            includeBranch: true,
            modelSelection: createModelSelection(PI_INSTANCE_ID, "openrouter/vendor/model/version"),
          });

          expect(generated).toEqual({
            subject: "Improve pi text generation",
            body: "- add pi",
            branch: "feature/fix/pi-output",
          });

          const fileSystem = yield* FileSystem.FileSystem;
          const args = (yield* fileSystem.readFileString(argsLogPath)).split("\n");
          expect(args.slice(0, 8)).toEqual([
            "-p",
            "--mode",
            "json",
            "--no-session",
            "--provider",
            "openrouter",
            "--model",
            "vendor/model/version",
          ]);
          expect(args.slice(8).join("\n")).toContain("You write concise git commit messages");
          expect(yield* fileSystem.readFileString(homeLogPath)).toBe("/tmp/aqqua-pi-home");
        }),
    ),
  );

  it.effect("generates and sanitizes PR content", () =>
    withFakePi(
      {
        output: piJsonOutput(
          JSON.stringify({
            title: "  Add pi text generation\nignored",
            body: "\n## Summary\n- add pi\n",
          }),
        ),
      },
      ({ textGeneration }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generatePrContent({
            cwd: process.cwd(),
            baseBranch: "main",
            headBranch: "feature/pi",
            commitSummary: "feat: add pi",
            diffSummary: "2 files changed",
            diffPatch: "diff --git a/a.ts b/a.ts",
            modelSelection: createModelSelection(PI_INSTANCE_ID, "anthropic/claude-sonnet-5"),
          });
          expect(generated).toEqual({
            title: "Add pi text generation",
            body: "## Summary\n- add pi",
          });
        }),
    ),
  );

  it.effect("generates sanitized branch names", () =>
    withFakePi(
      { output: piJsonOutput(JSON.stringify({ branch: "  Feat/Pi Output  " })) },
      ({ textGeneration }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateBranchName({
            cwd: process.cwd(),
            message: "Add pi text generation.",
            modelSelection: createModelSelection(PI_INSTANCE_ID, "anthropic/claude-sonnet-5"),
          });
          expect(generated.branch).toBe("feat/pi-output");
        }),
    ),
  );

  it.effect("generates sanitized thread titles", () =>
    withFakePi(
      {
        output: piJsonOutput(
          JSON.stringify({ title: '  "Investigate pi text generation output handling"  ' }),
        ),
      },
      ({ textGeneration }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Investigate pi text generation output handling.",
            modelSelection: createModelSelection(PI_INSTANCE_ID, "anthropic/claude-sonnet-5"),
          });
          expect(generated.title).toBe("Investigate pi text generation output handling");
        }),
    ),
  );

  it.effect("readStreamTail keeps the exact trailing window across many small chunks", () =>
    Effect.gen(function* () {
      const encoder = new TextEncoder();
      const pieces = Array.from({ length: 500 }, (_, index) => `chunk-${index};`);
      const tail = yield* readStreamTail(
        "generateThreadTitle",
        Stream.fromIterable(pieces.map((piece) => encoder.encode(piece))),
        64,
      );
      expect(tail).toBe(pieces.join("").slice(-64));

      const oversized = yield* readStreamTail(
        "generateThreadTitle",
        Stream.fromIterable([encoder.encode("x".repeat(200)), encoder.encode("tail-end")]),
        64,
      );
      expect(oversized).toBe(`${"x".repeat(56)}tail-end`);
    }),
  );

  it.effect("keeps the final assistant text when stdout exceeds the tail cap", () => {
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    const noiseLine = JSON.stringify({ type: "message_update", filler: "x".repeat(1024) });
    const noise = Array.from({ length: 4200 }, () => noiseLine).join("\n");
    return withFakePi(
      { output: `${noise}\n${piJsonOutput('{"title":"Cap survives the noise flood"}')}` },
      ({ textGeneration }) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Name this thread.",
            modelSelection: createModelSelection(PI_INSTANCE_ID, "anthropic/claude-sonnet-5"),
          });
          expect(generated.title).toBe("Cap survives the noise flood");
        }),
    );
  });

  it.effect("maps process failures to TextGenerationError", () =>
    withFakePi(
      { output: "", exitCode: 7, stderr: "provider credentials unavailable" },
      ({ textGeneration }) =>
        Effect.gen(function* () {
          const result = yield* textGeneration
            .generateThreadTitle({
              cwd: process.cwd(),
              message: "Name this thread.",
              modelSelection: createModelSelection(PI_INSTANCE_ID, "anthropic/claude-sonnet-5"),
            })
            .pipe(Effect.result);

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure._tag).toBe("TextGenerationError");
            expect(result.failure.operation).toBe("generateThreadTitle");
            expect(result.failure.detail).toContain("provider credentials unavailable");
          }
        }),
    ),
  );
});
