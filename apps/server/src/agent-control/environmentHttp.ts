import {
  AgentProfileName,
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import type { AgentControlError } from "./Errors.ts";
import { AgentControl } from "./Services/AgentControl.ts";

const decodeAgentProfileName = Schema.decodeUnknownEffect(AgentProfileName);

const decodeProfileName = Effect.fn("environment.agents.decodeProfileName")(function* (
  value: string,
) {
  return yield* decodeAgentProfileName(value).pipe(
    Effect.mapError(
      () =>
        new EnvironmentHttpBadRequestError({
          message:
            `'${value}' is not a valid agent profile name: it must start with a letter and ` +
            "use only letters, digits, '-' or '_'.",
        }),
    ),
  );
});

export const mapStandaloneSpawnError = Effect.fn("environment.agents.mapSpawnError")(function* (
  error: AgentControlError,
) {
  if (error._tag === "AgentDispatchError" || error._tag === "AgentLaunchFailedError") {
    return yield* failEnvironmentInternal("internal_error", error);
  }
  return yield* new EnvironmentHttpConflictError({ message: error.message });
});

export const handleStandaloneSpawn = Effect.fn("environment.agents.handleStandaloneSpawn")(
  function* (payload: {
    readonly cwd: string;
    readonly profile: string;
    readonly task: string;
    readonly title?: string | undefined;
  }) {
    yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
    const agents = yield* AgentControl;
    const profile = yield* decodeProfileName(payload.profile);
    return yield* agents
      .spawnStandalone({
        cwd: payload.cwd,
        profile,
        task: payload.task,
        ...(payload.title === undefined ? {} : { title: payload.title }),
      })
      .pipe(Effect.catch(mapStandaloneSpawnError));
  },
);

export const agentEnvironmentHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "agents",
  Effect.fnUntraced(function* (handlers) {
    yield* AgentControl;
    return handlers.handle(
      "standaloneSpawn",
      Effect.fn("environment.agents.standaloneSpawn")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        return yield* handleStandaloneSpawn(args.payload);
      }),
    );
  }),
);
