import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { type ModelSelection, type PiSettings, TextGenerationError } from "@aqqua/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@aqqua/shared/git";
import { extractJsonObject } from "@aqqua/shared/schemaJson";
import { resolveSpawnCommand } from "@aqqua/shared/shell";

import { piEnvironment, piExecutable, splitPiModelSlug } from "../provider/pi/piSpawnSettings.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const PI_TIMEOUT_MS = 180_000;
// The final assistant text sits at the end of pi's JSONL transcript, so the
// collectors keep a bounded tail instead of the whole stream; a line cut at
// the buffer head fails decoding and is skipped.
const PI_STDOUT_TAIL_CHARACTERS = 4_000_000;
const PI_STDERR_TAIL_CHARACTERS = 16_384;

type PiTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const PiMessageContentPart = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
});

const PiAssistantMessageEndEvent = Schema.Struct({
  type: Schema.Literal("message_end"),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Union([Schema.String, Schema.Array(PiMessageContentPart)]),
  }),
});

const decodePiAssistantMessageEndEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(PiAssistantMessageEndEvent),
);

function extractFinalAssistantText(stdout: string): string | undefined {
  let finalText: string | undefined;

  for (const line of stdout.split(/\r?\n/g)) {
    const event = decodePiAssistantMessageEndEvent(line);
    if (Option.isNone(event)) {
      continue;
    }

    const content = event.value.message.content;
    const text =
      typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text" && part.text !== undefined)
            .map((part) => part.text)
            .join("");
    if (text.trim().length > 0) {
      finalText = text;
    }
  }

  return finalText;
}

function piModelArgs(
  operation: PiTextGenerationOperation,
  modelSelection: ModelSelection,
): Effect.Effect<ReadonlyArray<string>, TextGenerationError> {
  const slug = modelSelection.model.trim();
  if (slug.length === 0) {
    return Effect.succeed([]);
  }

  const parsed = splitPiModelSlug(slug);
  if (parsed === null) {
    return Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Pi model selection must use the 'provider/model' format.",
      }),
    );
  }

  return Effect.succeed(["--provider", parsed.provider, "--model", parsed.modelId]);
}

/** Build one-shot pi text generation bound to a specific provider instance's settings. */
export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  piSettings: PiSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const readStreamTail = <E>(
    operation: PiTextGenerationOperation,
    stream: Stream.Stream<Uint8Array, E>,
    tailCharacters: number,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => {
          const next = acc + chunk;
          return next.length <= tailCharacters ? next : next.slice(-tailCharacters);
        },
      ),
      Effect.mapError((cause) =>
        normalizeCliError("pi", operation, cause, "Failed to collect pi process output"),
      ),
    );

  const runPiJson = Effect.fn("runPiJson")(function* <S extends Schema.Top>(input: {
    readonly operation: PiTextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: ModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const modelArgs = yield* piModelArgs(input.operation, input.modelSelection);
    const childEnvironment = piEnvironment(piSettings, resolvedEnvironment);
    const spawnCommand = yield* resolveSpawnCommand(
      piExecutable(piSettings),
      ["-p", "--mode", "json", "--no-session", ...modelArgs, input.prompt],
      { env: childEnvironment },
    ).pipe(
      Effect.mapError((cause) =>
        normalizeCliError("pi", input.operation, cause, "Failed to resolve pi CLI command"),
      ),
    );
    const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: input.cwd,
      env: childEnvironment,
      shell: spawnCommand.shell,
    });

    const runCommand = Effect.gen(function* () {
      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("pi", input.operation, cause, "Failed to spawn pi CLI process"),
          ),
        );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamTail(input.operation, child.stdout, PI_STDOUT_TAIL_CHARACTERS),
          readStreamTail(input.operation, child.stderr, PI_STDERR_TAIL_CHARACTERS),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("pi", input.operation, cause, "Failed to read pi CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const detail = stderr.trim() || stdout.trim();
        return yield* new TextGenerationError({
          operation: input.operation,
          detail:
            detail.length > 0
              ? `Pi CLI command failed: ${detail}`
              : `Pi CLI command failed with code ${exitCode}.`,
        });
      }

      const assistantText = extractFinalAssistantText(stdout);
      if (!assistantText) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "Pi returned no final assistant text.",
        });
      }
      return assistantText;
    }).pipe(Effect.scoped);

    const rawOutput = yield* runCommand.pipe(
      Effect.timeoutOption(PI_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({
                operation: input.operation,
                detail: "Pi CLI request timed out.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

    const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson));
    return yield* decodeOutput(extractJsonObject(rawOutput)).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation: input.operation,
              detail: "Pi returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("PiTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runPiJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("PiTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runPiJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("PiTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runPiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("PiTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runPiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
