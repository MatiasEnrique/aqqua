import {
  DEFAULT_MODEL_BY_PROVIDER,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderListSkillsError,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@aqqua/contracts";
import { causeErrorTag } from "@aqqua/shared/observability";
import { createModelCapabilities } from "@aqqua/shared/model";
import { resolveSpawnCommand } from "@aqqua/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { spawnPiRpcClient } from "../pi/PiRpcClient.ts";
import { piEnvironment, piExecutable } from "../pi/piSpawnSettings.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const DRIVER_KIND = ProviderDriverKind.make("pi");
const PI_PRESENTATION = {
  displayName: "pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
} as const;
const PI_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_PI_MODEL = DEFAULT_MODEL_BY_PROVIDER[DRIVER_KIND] ?? "anthropic/claude-sonnet-5";

// pi's --list-models only advertises thinking support as yes/no, so the
// model-dependent xhigh/max levels cannot be offered reliably; the adapter
// still accepts them for models that take them.
const PI_MODEL_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Thinking",
      type: "select",
      options: [
        { id: "off", label: "Off" },
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
    },
  ],
});

const PiCommandsData = Schema.Struct({
  commands: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
      // pi is Early Access and grows new command sources; an unknown source
      // must not fail the whole listing, so this stays an open string.
      source: Schema.String,
      location: Schema.optional(Schema.String),
      path: Schema.optional(Schema.String),
    }),
  ),
});
const decodePiCommandsData = Schema.decodeUnknownEffect(PiCommandsData, {
  onExcessProperty: "preserve",
});

const runPiCommand = Effect.fn("runPiCommand")(function* (
  settings: PiSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const executable = piExecutable(settings);
  const spawnCommand = yield* resolveSpawnCommand(executable, args, { env: environment });
  return yield* spawnAndCollect(
    executable,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  );
});

function piModelsFromSettings(
  customModels: ReadonlyArray<string>,
  discoveredModels: ReadonlyArray<ServerProviderModel> = [
    {
      slug: DEFAULT_PI_MODEL,
      name: DEFAULT_PI_MODEL,
      isCustom: false,
      isDefault: true,
      capabilities: PI_MODEL_CAPABILITIES,
    },
  ],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(discoveredModels, customModels, PI_MODEL_CAPABILITIES);
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point here.
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

/** Parse the padded text table emitted by `pi --list-models`. */
export function parsePiListModelsOutput(output: string): ReadonlyArray<ServerProviderModel> {
  const lines = stripAnsi(output)
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const headerIndex = lines.findIndex((line) => {
    const columns = line.trim().split(/\s{2,}/g);
    return columns[0] === "provider" && columns[1] === "model";
  });
  if (headerIndex < 0) return [];

  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const columns = line.trim().split(/\s{2,}/g);
    const provider = columns[0]?.trim() ?? "";
    const modelId = columns[1]?.trim() ?? "";
    if (!provider || !modelId) continue;
    const slug = `${provider}/${modelId}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      slug,
      name: modelId,
      isCustom: false,
      ...(slug === DEFAULT_PI_MODEL ? { isDefault: true } : {}),
      capabilities: PI_MODEL_CAPABILITIES,
    });
  }
  return models;
}

export const buildInitialPiProviderSnapshot = Effect.fn("buildInitialPiProviderSnapshot")(
  function* (settings: PiSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = piModelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "pi is disabled in aqqua settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking pi CLI availability...",
      },
    });
  },
);

function failedProbe(input: {
  readonly settings: PiSettings;
  readonly checkedAt: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly installed: boolean;
  readonly version?: string | null;
  readonly message: string;
}): ServerProviderDraft {
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: input.settings.enabled,
    checkedAt: input.checkedAt,
    models: input.models,
    probe: {
      installed: input.installed,
      version: input.version ?? null,
      status: "error",
      auth: { status: "unknown" },
      message: input.message,
    },
  });
}

const runTimedPiCommand = (
  settings: PiSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) => runPiCommand(settings, args, environment).pipe(Effect.timeoutOption(PI_PROBE_TIMEOUT_MS));

function commandFailureMessage(command: "--version" | "--list-models"): string {
  return `pi CLI is installed but failed to run \`pi ${command}\`.`;
}

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = piModelsFromSettings(settings.customModels);
  if (!settings.enabled) return yield* buildInitialPiProviderSnapshot(settings);

  const childEnvironment = piEnvironment(settings, environment);
  const versionResult = yield* runTimedPiCommand(settings, ["--version"], childEnvironment).pipe(
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const missing = isCommandMissingCause(versionResult.failure);
    yield* Effect.logWarning("pi CLI health check failed", {
      errorTag: versionResult.failure._tag,
    });
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: !missing,
      message: missing
        ? "pi CLI (`pi`) is not installed or not on PATH."
        : "Failed to execute pi CLI health check.",
    });
  }
  if (Option.isNone(versionResult.success)) {
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: true,
      message: "pi CLI is installed but timed out while running `pi --version`.",
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    yield* Effect.logWarning("pi CLI version probe exited with a non-zero status", {
      exitCode: versionOutput.code,
      stdoutLength: versionOutput.stdout.length,
      stderrLength: versionOutput.stderr.length,
    });
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: true,
      version,
      message: commandFailureMessage("--version"),
    });
  }

  const modelsResult = yield* runTimedPiCommand(settings, ["--list-models"], childEnvironment).pipe(
    Effect.result,
  );
  if (Result.isFailure(modelsResult)) {
    yield* Effect.logWarning("pi model discovery failed", {
      errorTag: modelsResult.failure._tag,
    });
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: true,
      version,
      message: commandFailureMessage("--list-models"),
    });
  }
  if (Option.isNone(modelsResult.success)) {
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: true,
      version,
      message: "pi CLI is installed but timed out while running `pi --list-models`.",
    });
  }

  const modelsOutput = modelsResult.success.value;
  if (modelsOutput.code !== 0) {
    return failedProbe({
      settings,
      checkedAt,
      models: fallbackModels,
      installed: true,
      version,
      message: commandFailureMessage("--list-models"),
    });
  }
  const discoveredModels = parsePiListModelsOutput(modelsOutput.stdout);
  const models =
    discoveredModels.length === 0
      ? fallbackModels
      : piModelsFromSettings(settings.customModels, discoveredModels);
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mapPiCommandsToSkills(
  data: typeof PiCommandsData.Type,
): ReadonlyArray<ServerProviderSkill> {
  return data.commands.flatMap((command) => {
    const name = nonEmpty(command.name);
    if (!name) return [];
    const location = nonEmpty(command.location);
    const path = nonEmpty(command.path) ?? `${command.source}:${location ?? name}`;
    return [
      {
        name,
        ...(nonEmpty(command.description) ? { description: nonEmpty(command.description) } : {}),
        path,
        scope: location ?? command.source,
        enabled: true,
      },
    ];
  });
}

function listSkillsReason(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.trim().length > 0
  ) {
    return cause.message.trim();
  }
  return "no failure detail available";
}

/** Discover pi commands for one active project using a scoped RPC process. */
export const listPiSkills = Effect.fn("listPiSkills")(function* (
  settings: PiSettings,
  instanceId: ProviderInstanceId,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ReadonlyArray<ServerProviderSkill>,
  ProviderListSkillsError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const childEnvironment = piEnvironment(settings, environment);
      const client = yield* spawnPiRpcClient({
        executable: piExecutable(settings),
        args: [
          "--mode",
          "rpc",
          "--no-session",
          ...(settings.trustProjectFiles ? ["--approve"] : []),
        ],
        cwd,
        env: childEnvironment,
      });
      const response = yield* client.request({ type: "get_commands" });
      const data = yield* decodePiCommandsData(response.data);
      return mapPiCommandsToSkills(data);
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderListSkillsError({
          instanceId,
          reason: `pi get_commands failed: ${listSkillsReason(cause)}`,
          cause,
        }),
    ),
  );
});

export const enrichPiSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap(input.publishSnapshot),
    Effect.catchCause((cause) =>
      Effect.logWarning("pi version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
