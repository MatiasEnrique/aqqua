import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfile,
  AgentProfileName,
  AuthAdministrativeScopes,
  DEFAULT_AGENT_PROFILE_DRIVER,
  DEFAULT_AGENT_PROFILE_NAME,
  DEFAULT_AGENT_PROFILE_RUNTIME,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentHttpApi,
  type AgentProfileMap,
  type ServerSettings,
} from "@aqqua/contracts";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { loadServerSettingsFromFileStrict, writeServerSettingsToFile } from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { tryResolveLiveEnvironment, withEnvironmentCliSessionToken } from "./environmentAccess.ts";

export class ProfileCliError extends Schema.TaggedErrorClass<ProfileCliError>()("ProfileCliError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

export const IMPLICIT_DEFAULT_PROFILE: AgentProfile = {
  runtime: DEFAULT_AGENT_PROFILE_RUNTIME,
  target: { kind: "driver", driver: DEFAULT_AGENT_PROFILE_DRIVER },
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
};

export type ProfileMutation =
  | { readonly kind: "upsert"; readonly name: AgentProfileName; readonly profile: AgentProfile }
  | { readonly kind: "delete"; readonly name: AgentProfileName };

export interface ProfileApi<Requirements = never> {
  readonly read: Effect.Effect<ServerSettings, ProfileCliError>;
  readonly mutate: (
    mutation: ProfileMutation,
  ) => Effect.Effect<"live" | "offline", ProfileCliError, Requirements>;
}

const decodeProfileName = Schema.decodeUnknownEffect(AgentProfileName);
const decodeProfileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentProfile));
const encodeProfile = Schema.encodeSync(AgentProfile);
const toJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isProfileCliError = Schema.is(ProfileCliError);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit one JSON value instead of human-readable text."),
);
const profileNameArgument = Argument.string("name").pipe(
  Argument.withDescription("Agent profile name."),
);
const profileFileFlag = Flag.string("file").pipe(
  Flag.withDescription("Path to a JSON agent profile definition."),
);

const emit = (input: { readonly json: boolean; readonly value: unknown; readonly text: string }) =>
  Console.log(input.json ? toJsonLine(input.value) : input.text);

export const validateProfileName = Effect.fn("profileCli.validateProfileName")(function* (
  value: string,
) {
  return yield* decodeProfileName(value).pipe(
    Effect.mapError(
      () =>
        new ProfileCliError({
          detail:
            `Agent profile name '${value}' is invalid. Names must start with a letter, use only ` +
            "letters, digits, '-' or '_', and contain at most 64 characters.",
        }),
    ),
  );
});

export const decodeProfileFile = Effect.fn("profileCli.decodeProfileFile")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const contents = yield* fs.readFileString(file).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileCliError({
          detail: `Could not read agent profile file '${file}'.`,
          cause,
        }),
    ),
  );
  if (contents.trim().length === 0) {
    return yield* new ProfileCliError({ detail: `Agent profile file '${file}' is empty.` });
  }
  return yield* decodeProfileJson(contents).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileCliError({
          detail: `Agent profile file '${file}' is not a valid agent profile definition.`,
          cause,
        }),
    ),
  );
});

const existingNamesText = (profiles: AgentProfileMap) => {
  const names = [...new Set([...Object.keys(profiles), DEFAULT_AGENT_PROFILE_NAME])].toSorted();
  return `Existing profiles: ${names.join(", ")}.`;
};

export const assertProfileCanCreate = (
  profiles: AgentProfileMap,
  name: AgentProfileName,
): Effect.Effect<void, ProfileCliError> =>
  profiles[name] === undefined
    ? Effect.void
    : new ProfileCliError({
        detail: `Agent profile '${name}' already exists. Use 'aqqua profile update ${name} --file <path>' to replace it.`,
      });

export const assertProfileCanUpdate = (
  profiles: AgentProfileMap,
  name: AgentProfileName,
): Effect.Effect<void, ProfileCliError> =>
  profiles[name] !== undefined || name === DEFAULT_AGENT_PROFILE_NAME
    ? Effect.void
    : new ProfileCliError({
        detail: `Agent profile '${name}' is not stored. ${existingNamesText(profiles)}`,
      });

export const assertProfileCanDelete = (
  profiles: AgentProfileMap,
  name: AgentProfileName,
): Effect.Effect<AgentProfile, ProfileCliError> => {
  const profile = profiles[name];
  if (profile !== undefined) return Effect.succeed(profile);
  if (name === DEFAULT_AGENT_PROFILE_NAME) {
    return new ProfileCliError({
      detail:
        "Agent profile 'implementer' is built in and has not been customized, so it cannot be deleted.",
    });
  }
  return new ProfileCliError({
    detail: `Agent profile '${name}' is not stored. ${existingNamesText(profiles)}`,
  });
};

export const executeProfileUpsert = Effect.fn("profileCli.executeProfileUpsert")(function* <R>(
  api: ProfileApi<R>,
  kind: "create" | "update",
  name: AgentProfileName,
  profile: AgentProfile,
) {
  const settings = yield* api.read;
  yield* kind === "create"
    ? assertProfileCanCreate(settings.agentProfiles, name)
    : assertProfileCanUpdate(settings.agentProfiles, name);
  return yield* api.mutate({ kind: "upsert", name, profile });
});

export const executeProfileDelete = Effect.fn("profileCli.executeProfileDelete")(function* <R>(
  api: ProfileApi<R>,
  name: AgentProfileName,
) {
  const settings = yield* api.read;
  yield* assertProfileCanDelete(settings.agentProfiles, name);
  return yield* api.mutate({ kind: "delete", name });
});

export const profileRows = (profiles: AgentProfileMap) => {
  const entries = Object.entries(profiles).map(([name, profile]) => ({
    name,
    builtIn: false,
    profile,
  }));
  if (profiles[DEFAULT_AGENT_PROFILE_NAME] === undefined) {
    entries.push({
      name: DEFAULT_AGENT_PROFILE_NAME,
      builtIn: true,
      profile: IMPLICIT_DEFAULT_PROFILE,
    });
  }
  return entries.toSorted((left, right) => left.name.localeCompare(right.name));
};

export const formatProfileTarget = (profile: AgentProfile) =>
  profile.target.kind === "driver"
    ? `driver:${profile.target.driver}`
    : `instance:${profile.target.instanceId}`;

export const formatProfileList = (profiles: AgentProfileMap) =>
  profileRows(profiles)
    .map(({ name, builtIn, profile }) =>
      [
        name,
        formatProfileTarget(profile),
        profile.model ?? "inherit",
        profile.runtime,
        profile.runtimeMode,
        builtIn ? "built-in" : "",
      ]
        .filter((value) => value.length > 0)
        .join("\t"),
    )
    .join("\n");

export const resolveProfileForShow = (profiles: AgentProfileMap, name: AgentProfileName) => {
  const stored = profiles[name];
  if (stored !== undefined) return Effect.succeed({ name, builtIn: false, profile: stored });
  if (name === DEFAULT_AGENT_PROFILE_NAME) {
    return Effect.succeed({ name, builtIn: true, profile: IMPLICIT_DEFAULT_PROFILE });
  }
  return new ProfileCliError({
    detail: `Agent profile '${name}' is not stored. ${existingNamesText(profiles)}`,
  });
};

const applyMutation = (settings: ServerSettings, mutation: ProfileMutation): ServerSettings => {
  if (mutation.kind === "upsert") {
    return {
      ...settings,
      agentProfiles: {
        ...settings.agentProfiles,
        [mutation.name]: mutation.profile,
      },
    };
  }
  const { [mutation.name]: _removed, ...agentProfiles } = settings.agentProfiles;
  return { ...settings, agentProfiles };
};

export const mutateProfileFile = Effect.fn("profileCli.mutateProfileFile")(function* (
  settingsPath: string,
  mutation: ProfileMutation,
) {
  const current = yield* loadServerSettingsFromFileStrict(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileCliError({
          detail:
            `Cannot update agent profiles because '${settingsPath}' could not be decoded. ` +
            "Fix the settings file and try again.",
          cause,
        }),
    ),
  );
  yield* writeServerSettingsToFile(settingsPath, applyMutation(current, mutation)).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileCliError({
          detail: `Could not write agent profiles to '${settingsPath}'.`,
          cause,
        }),
    ),
  );
});

/**
 * Offline fallback is only for unreachable or older servers. A timeout leaves
 * the server write outcome unknown, so falling back would race two writers on
 * the same settings file — surface the timeout instead.
 */
export const liveMutationShouldFallBack = (cause: unknown) =>
  HttpClientError.isHttpClientError(cause) &&
  (cause.response === undefined || cause.response.status === 404);

const callLiveMutation = Effect.fn("profileCli.callLiveMutation")(function* (
  origin: string,
  token: string,
  mutation: ProfileMutation,
) {
  const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
  if (mutation.kind === "upsert") {
    // HttpApiClient expects the schema Type and encodes the payload itself.
    yield* client.settings.upsertAgentProfile({
      headers: { authorization: `Bearer ${token}` },
      params: { name: mutation.name },
      payload: mutation.profile,
    });
    return;
  }
  yield* client.settings.deleteAgentProfile({
    headers: { authorization: `Bearer ${token}` },
    params: { name: mutation.name },
  });
});

const makeProfileApi = Effect.fn("profileCli.makeProfileApi")(function* (
  flags: CliAuthLocationFlags,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const minimumLogLevel = config.logLevel;
  const authLayer = Layer.mergeAll(EnvironmentAuth.runtimeLayer, WorkspacePaths.layer).pipe(
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(ServerConfig.layer(config)),
    Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
  );

  const read = loadServerSettingsFromFileStrict(config.settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ProfileCliError({
          detail: `Could not load agent profiles from '${config.settingsPath}'.`,
          cause,
        }),
    ),
    Effect.provide(NodeServices.layer),
  );

  const mutateWithServices = Effect.fn("mutateWithServices")(function* (mutation: ProfileMutation) {
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const live = yield* tryResolveLiveEnvironment(environmentAuth, config, {
      scopes: AuthAdministrativeScopes,
      label: "aqqua profile cli",
      mapLiveServerError: (cause) =>
        new ProfileCliError({ detail: "Failed to probe the running aqqua server.", cause }),
      connectionFailureLogMessage: "Failed to connect to the persisted profile CLI server.",
    });

    if (Option.isSome(live)) {
      const attempt = yield* Effect.result(
        withEnvironmentCliSessionToken(
          environmentAuth,
          { scopes: AuthAdministrativeScopes, label: "aqqua profile cli" },
          (token) =>
            callLiveMutation(live.value.origin, token, mutation).pipe(
              Effect.timeout(Duration.seconds(1)),
            ),
        ),
      );
      if (attempt._tag === "Success") return "live" as const;
      if (!liveMutationShouldFallBack(attempt.failure)) {
        return yield* new ProfileCliError({
          detail: `The running aqqua server rejected the agent profile ${mutation.kind === "upsert" ? "update" : "delete"}.`,
          cause: attempt.failure,
        });
      }
    }

    yield* mutateProfileFile(config.settingsPath, mutation);
    return "offline" as const;
  });
  const mutate = (mutation: ProfileMutation) =>
    mutateWithServices(mutation).pipe(
      Effect.provide(authLayer),
      Effect.mapError((cause) =>
        isProfileCliError(cause)
          ? cause
          : new ProfileCliError({
              detail: "Could not access the aqqua environment for this agent profile mutation.",
              cause,
            }),
      ),
    );

  return {
    read,
    mutate,
  } satisfies ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>;
});

const runWithProfileApi = Effect.fn("runWithProfileApi")(
  function* <A>(
    flags: CliAuthLocationFlags,
    run: (
      api: ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
    ) => Effect.Effect<A, ProfileCliError, Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
  ) {
    const api = yield* makeProfileApi(flags);
    return yield* run(api);
  },
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
);

const listProfiles = Effect.fn("listProfiles")(function* (
  api: ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
  json: boolean,
) {
  const settings = yield* api.read;
  const rows = profileRows(settings.agentProfiles);
  yield* emit({
    json,
    value: {
      profiles: rows.map(({ name, builtIn, profile }) => ({
        name,
        builtIn,
        target: profile.target,
        model: profile.model ?? null,
        runtime: profile.runtime,
        runtimeMode: profile.runtimeMode,
      })),
    },
    text: formatProfileList(settings.agentProfiles),
  });
});

const listCommand = Command.make("list", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List stored agent profiles and the implicit built-in implementer."),
  Command.withHandler((flags) => runWithProfileApi(flags, (api) => listProfiles(api, flags.json))),
);

const showProfile = Effect.fn("showProfile")(function* (
  api: ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
  nameValue: string,
  json: boolean,
) {
  const name = yield* validateProfileName(nameValue);
  const settings = yield* api.read;
  const resolved = yield* resolveProfileForShow(settings.agentProfiles, name);
  const source = encodeProfile(resolved.profile);
  yield* emit({
    json,
    value: { name, builtIn: resolved.builtIn, profile: source },
    text: `${name}${resolved.builtIn ? " (built-in)" : ""}\n${toJsonLine(source)}`,
  });
});

const showCommand = Command.make("show", {
  ...projectLocationFlags,
  json: jsonFlag,
  name: profileNameArgument,
}).pipe(
  Command.withDescription("Show one agent profile definition."),
  Command.withHandler((flags) =>
    runWithProfileApi(flags, (api) => showProfile(api, flags.name, flags.json)),
  ),
);

const writeProfile = Effect.fn("writeProfile")(function* (
  api: ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
  kind: "create" | "update",
  input: { readonly name: string; readonly file: string; readonly json: boolean },
) {
  const name = yield* validateProfileName(input.name);
  const profile = yield* decodeProfileFile(input.file);
  const transport = yield* executeProfileUpsert(api, kind, name, profile);
  yield* emit({
    json: input.json,
    value: { action: kind, name, profile: encodeProfile(profile), transport },
    text: `${kind === "create" ? "Created" : "Updated"} agent profile '${name}'.`,
  });
});

const makeWriteCommand = (kind: "create" | "update") =>
  Command.make(kind, {
    ...projectLocationFlags,
    json: jsonFlag,
    name: profileNameArgument,
    file: profileFileFlag,
  }).pipe(
    Command.withDescription(`${kind === "create" ? "Create" : "Replace"} an agent profile.`),
    Command.withHandler((flags) =>
      runWithProfileApi(flags, (api) => writeProfile(api, kind, flags)),
    ),
  );

const removeProfile = Effect.fn("removeProfile")(function* (
  api: ProfileApi<Crypto.Crypto | FileSystem.FileSystem | Path.Path>,
  nameValue: string,
  json: boolean,
) {
  const name = yield* validateProfileName(nameValue);
  const transport = yield* executeProfileDelete(api, name);
  const revertsToBuiltIn = name === DEFAULT_AGENT_PROFILE_NAME;
  yield* emit({
    json,
    value: { action: "delete", name, revertsToBuiltIn, transport },
    text: revertsToBuiltIn
      ? "Deleted customized agent profile 'implementer'; it now uses the built-in default."
      : `Deleted agent profile '${name}'.`,
  });
});

const deleteCommand = Command.make("delete", {
  ...projectLocationFlags,
  json: jsonFlag,
  name: profileNameArgument,
}).pipe(
  Command.withDescription("Delete a stored agent profile."),
  Command.withHandler((flags) =>
    runWithProfileApi(flags, (api) => removeProfile(api, flags.name, flags.json)),
  ),
);

export const PROFILE_SCHEMA_HELP = {
  fields: {
    target: "Required: {kind:'driver',driver} or {kind:'instance',instanceId}.",
    model: "Optional free-form model slug; omission means inherit.",
    options: "Optional array of {id,value} provider option selections.",
    runtime: "Optional: session or terminal. Defaults to session.",
    runtimeMode: "Optional: approval-required, auto-accept-edits, auto, or full-access.",
    interactionMode: "Optional: default or plan.",
    titlePrefix: "Optional non-empty title prefix.",
  },
  optionIds: {
    codexCursorGrok: "reasoningEffort",
    claude: "effort",
    // OpenCode and pi accept no provider option ids today; omit `options` for those targets.
    opencode: "none — omit options",
    pi: "none — omit options",
  },
  namePattern: "^[a-zA-Z][a-zA-Z0-9_-]*$ (maximum 64 characters)",
  example: {
    target: { kind: "instance", instanceId: "claudeAgent" },
    model: "claude-fable-5",
    options: [{ id: "effort", value: "high" }],
    titlePrefix: "reviewer",
  },
} as const;

const schemaCommand = Command.make("schema", { json: jsonFlag }).pipe(
  Command.withDescription("Print the agent profile file shape and authoring rules."),
  Command.withHandler((flags) =>
    emit({
      json: flags.json,
      value: PROFILE_SCHEMA_HELP,
      text: [
        "Agent profile JSON",
        "Name: ^[a-zA-Z][a-zA-Z0-9_-]*$, maximum 64 characters.",
        'target (required): {"kind":"driver","driver":"codex"} or {"kind":"instance","instanceId":"claudeAgent"}.',
        "model (optional): free-form slug; omitted means inherit the project's default model.",
        'options (optional): [{"id":"reasoningEffort","value":"high"}] for Codex/Cursor/Grok; use id "effort" for Claude; omit for OpenCode and pi (no option ids).',
        "runtime: session | terminal. runtimeMode: approval-required | auto-accept-edits | auto | full-access.",
        "interactionMode: default | plan. titlePrefix is optional.",
        `Example:\n${toJsonLine(PROFILE_SCHEMA_HELP.example)}`,
      ].join("\n"),
    }),
  ),
);

export const profileCommand = Command.make("profile").pipe(
  Command.withDescription("Create and manage machine-local agent profiles."),
  Command.withSubcommands([
    listCommand,
    showCommand,
    makeWriteCommand("create"),
    makeWriteCommand("update"),
    deleteCommand,
    schemaCommand,
  ]),
);
