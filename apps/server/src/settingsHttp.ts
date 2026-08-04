import {
  AgentProfileName,
  AuthAccessWriteScope,
  DEFAULT_AGENT_PROFILE_NAME,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpNotFoundError,
  type AgentProfile,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "./auth/http.ts";
import { ServerSettingsService } from "./serverSettings.ts";

const decodeAgentProfileName = Schema.decodeUnknownEffect(AgentProfileName);

export const decodeSettingsAgentProfileName = Effect.fn("decodeSettingsAgentProfileName")(
  function* (value: string) {
    return yield* decodeAgentProfileName(value).pipe(
      Effect.mapError(
        () =>
          new EnvironmentHttpBadRequestError({
            message:
              `'${value}' is not a valid agent profile name: it must start with a letter and ` +
              "use only letters, digits, '-' or '_' (maximum 64 characters).",
          }),
      ),
    );
  },
);

const getAgentProfiles = Effect.fn("environment.settings.getAgentProfiles")(function* () {
  yield* requireEnvironmentScope(AuthAccessWriteScope);
  const settings = yield* ServerSettingsService;
  const current = yield* settings.getSettings.pipe(
    Effect.catch((error) => failEnvironmentInternal("internal_error", error)),
  );
  return {
    profiles: current.agentProfiles,
    implicitDefaultName: DEFAULT_AGENT_PROFILE_NAME,
  };
});

const getAtomicSettingsModifier = Effect.fn("getAtomicSettingsModifier")(function* () {
  const settings = yield* ServerSettingsService;
  if (settings.modifySettings === undefined) {
    return yield* failEnvironmentInternal(
      "internal_error",
      new Error("Server settings atomic modifier is unavailable."),
    );
  }
  return settings.modifySettings;
});

const upsertAgentProfile = Effect.fn("environment.settings.upsertAgentProfile")(function* (
  nameValue: string,
  profile: AgentProfile,
) {
  yield* requireEnvironmentScope(AuthAccessWriteScope);
  const name = yield* decodeSettingsAgentProfileName(nameValue);
  const modifySettings = yield* getAtomicSettingsModifier();
  const updated = yield* modifySettings((current) =>
    Effect.succeed({
      patch: {
        agentProfiles: {
          ...current.agentProfiles,
          [name]: profile,
        },
      },
      value: undefined,
    }),
  ).pipe(Effect.catch((error) => failEnvironmentInternal("internal_error", error)));
  return { name, profile: updated.settings.agentProfiles[name] ?? profile };
});

const deleteAgentProfile = Effect.fn("environment.settings.deleteAgentProfile")(function* (
  nameValue: string,
) {
  yield* requireEnvironmentScope(AuthAccessWriteScope);
  const name = yield* decodeSettingsAgentProfileName(nameValue);
  const modifySettings = yield* getAtomicSettingsModifier();
  const updated = yield* modifySettings((current) => {
    const existing = current.agentProfiles[name];
    if (existing === undefined) {
      return new EnvironmentHttpNotFoundError({
        message: `Agent profile '${name}' is not stored.`,
      });
    }
    const { [name]: _removed, ...agentProfiles } = current.agentProfiles;
    return Effect.succeed({
      patch: { agentProfiles },
      value: existing,
    });
  }).pipe(
    Effect.catchTag("ServerSettingsError", (error) =>
      failEnvironmentInternal("internal_error", error),
    ),
  );
  return { name, profile: updated.value };
});

export const settingsEnvironmentHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "settings",
  Effect.fnUntraced(function* (handlers) {
    yield* ServerSettingsService;
    return handlers
      .handle(
        "agentProfiles",
        Effect.fn("environment.settings.agentProfiles")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          return yield* getAgentProfiles();
        }),
      )
      .handle(
        "upsertAgentProfile",
        Effect.fn("environment.settings.upsertAgentProfileEndpoint")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          return yield* upsertAgentProfile(args.params.name, args.payload);
        }),
      )
      .handle(
        "deleteAgentProfile",
        Effect.fn("environment.settings.deleteAgentProfileEndpoint")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          return yield* deleteAgentProfile(args.params.name);
        }),
      );
  }),
);
