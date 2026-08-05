import {
  AgentProfileName,
  type AgentStandaloneSpawnRequest,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentAgentModelsRequest,
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

const mapStandaloneModelsError = Effect.fn("environment.agents.mapModelsError")(function* (
  error: AgentControlError,
) {
  if (error._tag === "AgentDispatchError") {
    return yield* failEnvironmentInternal("internal_error", error);
  }
  return yield* new EnvironmentHttpConflictError({ message: error.message });
});

export const handleStandaloneSpawn = Effect.fn("environment.agents.handleStandaloneSpawn")(
  function* (payload: AgentStandaloneSpawnRequest) {
    yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
    const agents = yield* AgentControl;
    if (
      payload.profile !== undefined &&
      (payload.modelSelection !== undefined || payload.reasoning !== undefined)
    ) {
      return yield* new EnvironmentHttpBadRequestError({
        message:
          "'profile' cannot be combined with 'modelSelection' or 'reasoning'. Choose one selector style.",
      });
    }
    const shared = {
      cwd: payload.cwd,
      task: payload.task,
      ...(payload.title === undefined ? {} : { title: payload.title }),
    };
    if (payload.profile !== undefined) {
      const profile = yield* decodeProfileName(payload.profile);
      return yield* agents
        .spawnStandaloneProfile({ ...shared, profile })
        .pipe(Effect.catch(mapStandaloneSpawnError));
    }
    return yield* agents
      .spawnStandalone({
        ...shared,
        selection: {
          model: payload.modelSelection ?? null,
          ...(payload.reasoning === undefined ? {} : { reasoning: payload.reasoning }),
        },
      })
      .pipe(Effect.catch(mapStandaloneSpawnError));
  },
);

const runStandaloneModels = Effect.fn("environment.agents.runStandaloneModels")(function* (input: {
  readonly payload: EnvironmentAgentModelsRequest;
  readonly agents: AgentControl["Service"];
}) {
  const { agents, payload } = input;
  yield* requireEnvironmentScope(AuthOrchestrationReadScope);
  const models = yield* agents
    .modelsStandalone({ cwd: payload.cwd })
    .pipe(Effect.catch(mapStandaloneModelsError));
  return { models };
});

export const handleStandaloneModels = Effect.fn("environment.agents.handleStandaloneModels")(
  function* (payload: EnvironmentAgentModelsRequest) {
    return yield* runStandaloneModels({
      payload,
      agents: yield* AgentControl,
    });
  },
);

export const agentEnvironmentHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "agents",
  Effect.fnUntraced(function* (handlers) {
    const agents = yield* AgentControl;
    return handlers
      .handle(
        "standaloneSpawn",
        Effect.fn("environment.agents.standaloneSpawn")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          return yield* handleStandaloneSpawn(args.payload);
        }),
      )
      .handle(
        "standaloneModels",
        Effect.fn("environment.agents.standaloneModels")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          return yield* runStandaloneModels({
            payload: args.payload,
            agents,
          });
        }),
      );
  }),
);
