import {
  AuthAdministrativeScopes,
  BoardId,
  CommandId,
  DEFAULT_AGENT_PROFILE_NAME,
  EnvironmentHttpCommonError,
  type OrchestrationBoard,
  type OrchestrationReadModel,
  ServerSettings,
  type ClientOrchestrationCommand,
  type ProjectId,
} from "@aqqua/contracts";
import { fromLenientJson } from "@aqqua/shared/schemaJson";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { HttpClient, HttpClientError } from "effect/unstable/http";

import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { runWithEnvironmentAccess } from "./environmentAccess.ts";
import { decodeFlowDefinition, validateFlowDefinition } from "./flowDefinition.ts";

type FlowCliDispatchCommand = Extract<
  ClientOrchestrationCommand,
  { type: "board.create" | "board.update" | "board.delete" }
>;

export type FlowCommandAccess = {
  readonly snapshot: OrchestrationReadModel;
  readonly dispatch: (
    command: FlowCliDispatchCommand,
  ) => Effect.Effect<void, Error, FileSystem.FileSystem | HttpClient.HttpClient | Path.Path>;
};

export type FlowCommandAction =
  | { readonly type: "list"; readonly json: boolean }
  | { readonly type: "show"; readonly identifier: string; readonly json: boolean }
  | {
      readonly type: "create";
      readonly contents: string;
      readonly availableProfileNames: ReadonlyArray<string>;
      readonly allowUnknownProfiles: boolean;
      readonly json: boolean;
    }
  | {
      readonly type: "update";
      readonly identifier: string;
      readonly contents: string;
      readonly availableProfileNames: ReadonlyArray<string>;
      readonly allowUnknownProfiles: boolean;
      readonly json: boolean;
    }
  | { readonly type: "delete"; readonly identifier: string; readonly json: boolean };

export class FlowLiveServerDeclaredResponseError extends Schema.TaggedErrorClass<FlowLiveServerDeclaredResponseError>()(
  "FlowLiveServerDeclaredResponseError",
  {
    code: Schema.String,
    traceId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Server request failed (${this.code}, trace ${this.traceId}).`;
  }
}

export class FlowLiveServerUndeclaredStatusError extends Schema.TaggedErrorClass<FlowLiveServerUndeclaredStatusError>()(
  "FlowLiveServerUndeclaredStatusError",
  {
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Server request failed with undeclared status ${this.status}.`;
  }
}

export class FlowLiveServerRequestError extends Schema.TaggedErrorClass<FlowLiveServerRequestError>()(
  "FlowLiveServerRequestError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to call the running server.";
  }
}

export class FlowProjectNotFoundError extends Schema.TaggedErrorClass<FlowProjectNotFoundError>()(
  "FlowProjectNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  override get message(): string {
    return `No active project contains the current directory '${this.cwd}'.`;
  }
}

export class FlowNotFoundError extends Schema.TaggedErrorClass<FlowNotFoundError>()(
  "FlowNotFoundError",
  {
    identifier: Schema.String,
    candidates: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  },
) {
  override get message(): string {
    const candidates =
      this.candidates.length === 0
        ? "No flows are available in this project."
        : `Available flows: ${this.candidates.map((flow) => `'${flow.name}' (${flow.id})`).join(", ")}.`;
    return `No flow matched '${this.identifier}'. ${candidates}`;
  }
}

export class FlowAmbiguousNameError extends Schema.TaggedErrorClass<FlowAmbiguousNameError>()(
  "FlowAmbiguousNameError",
  {
    name: Schema.String,
    candidates: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  },
) {
  override get message(): string {
    return `Flow name '${this.name}' is ambiguous. Matches: ${this.candidates.map((flow) => `${flow.name} (${flow.id})`).join(", ")}.`;
  }
}

export class FlowDefinitionFileError extends Schema.TaggedErrorClass<FlowDefinitionFileError>()(
  "FlowDefinitionFileError",
  {
    path: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Could not read flow definition from '${this.path}': ${this.detail}`;
  }
}

export class FlowIdentifierGenerationError extends Schema.TaggedErrorClass<FlowIdentifierGenerationError>()(
  "FlowIdentifierGenerationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to generate a flow identifier.";
  }
}

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

export function flowCommandErrorFromLiveServerRequest(cause: unknown) {
  if (isEnvironmentHttpCommonError(cause)) {
    return new FlowLiveServerDeclaredResponseError({
      code: cause.code,
      traceId: cause.traceId,
      cause,
    });
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    return new FlowLiveServerUndeclaredStatusError({
      status: cause.response.status,
      cause,
    });
  }
  return new FlowLiveServerRequestError({ cause });
}

const toJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const emit = (input: { readonly json: boolean; readonly value: unknown; readonly text: string }) =>
  input.json ? toJsonLine(input.value) : input.text;

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable text."),
);

const allowUnknownProfilesFlag = Flag.boolean("allow-unknown-profiles").pipe(
  Flag.withDescription("Warn instead of failing when a referenced agent profile does not exist."),
  Flag.withDefault(false),
);

const definitionFileFlag = Flag.string("file").pipe(
  Flag.withDescription("Path to a flow definition JSON file."),
);

const flowIdentifierArgument = Argument.string("id-or-name").pipe(
  Argument.withDescription("Flow id or exact flow name."),
);

export const canonicalFlowDefinition = {
  name: "Ship a feature",
  steps: [
    {
      name: "Plan",
      profileName: "Planning",
      promptTemplate: "Plan ${card_title}: ${request}",
    },
    {
      name: "Implement",
      profileName: "implementer",
      promptTemplate: "Implement the plan:\n${artifact}",
      continuation: "manual",
    },
  ],
};

const flowSchemaText = `Flow definition JSON:
{
  "name": string,
  "steps": [{
    "id"?: string,
    "name": string,
    "profileName": string,
    "promptTemplate": string,
    "continuation"?: "auto" | "manual"
  }]
}

Placeholders:
  \${card_title}          card title
  \${artifact}            artifact from the immediately preceding step
  \${artifact:Step name}  artifact from an earlier step with that exact name
  \${parameter_name}      required card parameter

Validation rules:
  - Flow names are non-empty and at most 120 characters.
  - A flow has 1 to 20 steps.
  - Step names are non-empty, at most 64 characters, unique ignoring case, and safe artifact names.
  - Prompt templates are non-empty and at most 20000 characters.
  - Profile names start with a letter and contain only letters, numbers, underscores, or dashes.
  - Card parameter names start with a letter or underscore and contain only letters, numbers, underscores, or dashes.
  - Referenced profiles must exist unless --allow-unknown-profiles is passed.
  - \${artifact} is not allowed in the first step.
  - \${artifact:Step name} must name an earlier step exactly.
  - continuation defaults to "auto"; supplied step ids are preserved and missing ids are generated.

Canonical example:
${toJsonLine(canonicalFlowDefinition)}`;

const activeFlowsForProject = (
  snapshot: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationBoard> =>
  snapshot.boards.filter((flow) => flow.projectId === projectId && flow.deletedAt === null);

const isPathWithin = (path: Path.Path, root: string, candidate: string) => {
  const relative = path.relative(path.resolve(root), candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

export const resolveFlowProject = Effect.fn("resolveFlowProject")(function* (
  snapshot: OrchestrationReadModel,
  cwd: string,
) {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const requestedCwd = path.resolve(cwd);
  const candidateCwd = yield* fileSystem
    .realPath(requestedCwd)
    .pipe(Effect.orElseSucceed(() => requestedCwd));
  const activeProjects = snapshot.projects.filter((project) => project.deletedAt === null);
  const projectById = new Map(activeProjects.map((project) => [project.id, project]));
  const candidates = [
    ...activeProjects.flatMap((project) =>
      isPathWithin(path, project.workspaceRoot, candidateCwd)
        ? [{ projectId: project.id, root: path.resolve(project.workspaceRoot), priority: 0 }]
        : [],
    ),
    ...snapshot.threads.flatMap((thread) =>
      thread.deletedAt === null &&
      thread.worktreePath !== null &&
      isPathWithin(path, thread.worktreePath, candidateCwd)
        ? [
            {
              projectId: thread.projectId,
              root: path.resolve(thread.worktreePath),
              priority: 1,
            },
          ]
        : [],
    ),
  ].toSorted(
    (left, right) => right.root.length - left.root.length || right.priority - left.priority,
  );
  const project = candidates[0] ? projectById.get(candidates[0].projectId) : undefined;
  if (!project) {
    return yield* new FlowProjectNotFoundError({ cwd: candidateCwd });
  }
  return project;
});

export const resolveFlow = Effect.fn("resolveFlow")(function* (
  flows: ReadonlyArray<OrchestrationBoard>,
  identifier: string,
) {
  const exactId = flows.find((flow) => flow.id === identifier);
  if (exactId) {
    return exactId;
  }
  const nameMatches = flows.filter((flow) => flow.name === identifier);
  if (nameMatches.length === 1) {
    return nameMatches[0]!;
  }
  const candidates = (nameMatches.length > 0 ? nameMatches : flows)
    .map((flow) => ({ id: flow.id, name: flow.name }))
    .toSorted(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  if (nameMatches.length > 1) {
    return yield* new FlowAmbiguousNameError({ name: identifier, candidates });
  }
  return yield* new FlowNotFoundError({ identifier, candidates });
});

const flowDefinitionValue = (flow: OrchestrationBoard) => ({
  id: flow.id,
  name: flow.name,
  steps: flow.steps.map((step) => ({
    id: step.id,
    name: step.name,
    profileName: step.profileName,
    continuation: step.continuation,
    promptTemplate: step.promptTemplate,
  })),
});

const formatFlowDefinition = (flow: OrchestrationBoard) => {
  const steps = flow.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.name} (${step.id}) profile=${step.profileName} continuation=${step.continuation}\n   promptTemplate=${toJsonLine(step.promptTemplate)}`,
    )
    .join("\n");
  return `Flow ${flow.name} (${flow.id})\n${steps}`;
};

const formatDefinitionSuccess = (input: {
  readonly verb: "Created" | "Updated";
  readonly flowId: string;
  readonly parameterNames: ReadonlyArray<string>;
  readonly unknownProfileNames: ReadonlyArray<string>;
}) => {
  const parameters =
    input.parameterNames.length === 0
      ? "Cards on this flow will not ask for parameters."
      : `Cards on this flow will ask for: ${input.parameterNames.join(", ")}.`;
  const warning =
    input.unknownProfileNames.length === 0
      ? ""
      : ` Warning: unknown agent profiles: ${input.unknownProfileNames.join(", ")}.`;
  return `${input.verb} flow ${input.flowId}. ${parameters}${warning}`;
};

export const executeFlowCommand = Effect.fn("executeFlowCommand")(function* (input: {
  readonly action: FlowCommandAction;
  readonly access: FlowCommandAccess;
  readonly cwd: string;
  readonly mintUuid?: Effect.Effect<string, Error, Crypto.Crypto>;
}) {
  const project = yield* resolveFlowProject(input.access.snapshot, input.cwd);
  const flows = activeFlowsForProject(input.access.snapshot, project.id);
  const mintUuid =
    input.mintUuid ??
    Crypto.Crypto.pipe(
      Effect.flatMap((crypto) => crypto.randomUUIDv4),
      Effect.mapError((cause) => new FlowIdentifierGenerationError({ cause })),
    );

  switch (input.action.type) {
    case "list": {
      const value = flows
        .map((flow) => ({
          id: flow.id,
          name: flow.name,
          stepCount: flow.steps.length,
          profiles: [...new Set(flow.steps.map((step) => step.profileName))].toSorted(),
        }))
        .toSorted(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        );
      const text =
        value.length === 0
          ? "No flows found for this project."
          : value
              .map(
                (flow) =>
                  `${flow.name} (${flow.id}) — ${flow.stepCount} step${flow.stepCount === 1 ? "" : "s"}; profiles: ${flow.profiles.join(", ") || "none"}`,
              )
              .join("\n");
      return emit({ json: input.action.json, value, text });
    }
    case "show": {
      const flow = yield* resolveFlow(flows, input.action.identifier);
      return emit({
        json: input.action.json,
        value: flowDefinitionValue(flow),
        text: formatFlowDefinition(flow),
      });
    }
    case "create": {
      const definition = yield* decodeFlowDefinition(input.action.contents, mintUuid);
      const validated = yield* validateFlowDefinition({
        definition,
        availableProfileNames: input.action.availableProfileNames,
        allowUnknownProfiles: input.action.allowUnknownProfiles,
      });
      const flowId = BoardId.make(yield* mintUuid);
      yield* input.access.dispatch({
        type: "board.create",
        commandId: CommandId.make(yield* mintUuid),
        boardId: flowId,
        projectId: project.id,
        name: validated.definition.name,
        steps: [...validated.definition.steps],
      });
      const value = {
        id: flowId,
        parameters: validated.parameterNames,
        warnings: validated.unknownProfileNames.map(
          (profileName) => `Unknown agent profile: ${profileName}`,
        ),
      };
      return emit({
        json: input.action.json,
        value,
        text: formatDefinitionSuccess({
          verb: "Created",
          flowId,
          parameterNames: validated.parameterNames,
          unknownProfileNames: validated.unknownProfileNames,
        }),
      });
    }
    case "update": {
      const flow = yield* resolveFlow(flows, input.action.identifier);
      const definition = yield* decodeFlowDefinition(input.action.contents, mintUuid);
      const validated = yield* validateFlowDefinition({
        definition,
        availableProfileNames: input.action.availableProfileNames,
        allowUnknownProfiles: input.action.allowUnknownProfiles,
      });
      yield* input.access.dispatch({
        type: "board.update",
        commandId: CommandId.make(yield* mintUuid),
        boardId: flow.id,
        name: validated.definition.name,
        steps: [...validated.definition.steps],
      });
      const value = {
        id: flow.id,
        parameters: validated.parameterNames,
        warnings: validated.unknownProfileNames.map(
          (profileName) => `Unknown agent profile: ${profileName}`,
        ),
      };
      return emit({
        json: input.action.json,
        value,
        text: formatDefinitionSuccess({
          verb: "Updated",
          flowId: flow.id,
          parameterNames: validated.parameterNames,
          unknownProfileNames: validated.unknownProfileNames,
        }),
      });
    }
    case "delete": {
      const flow = yield* resolveFlow(flows, input.action.identifier);
      yield* input.access.dispatch({
        type: "board.delete",
        commandId: CommandId.make(yield* mintUuid),
        boardId: flow.id,
      });
      return emit({
        json: input.action.json,
        value: { id: flow.id, deleted: true },
        text: `Deleted flow ${flow.id} (${flow.name}).`,
      });
    }
  }
});

export const readFlowDefinitionFile = Effect.fn("readFlowDefinitionFile")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* fileSystem.readFileString(file).pipe(
    Effect.mapError(
      (cause) =>
        new FlowDefinitionFileError({
          path: file,
          detail: String(cause),
        }),
    ),
  );
  if (contents.trim().length === 0) {
    return yield* new FlowDefinitionFileError({ path: file, detail: "the file is empty." });
  }
  return contents;
});

const decodeServerSettingsJson = Schema.decodeExit(fromLenientJson(ServerSettings));

export const readAvailableFlowProfileNames = Effect.fn("readAvailableFlowProfileNames")(function* (
  settingsPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const exists = yield* fileSystem.exists(settingsPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return [DEFAULT_AGENT_PROFILE_NAME];
  }
  const contents = yield* fileSystem
    .readFileString(settingsPath)
    .pipe(Effect.orElseSucceed(() => ""));
  const decoded = decodeServerSettingsJson(contents);
  if (Exit.isFailure(decoded)) {
    return [DEFAULT_AGENT_PROFILE_NAME];
  }
  return [
    ...new Set([...Object.keys(decoded.value.agentProfiles), DEFAULT_AGENT_PROFILE_NAME]),
  ].toSorted();
});

const runFlowWithEnvironmentAccess = Effect.fn("runFlowWithEnvironmentAccess")(function* (
  flags: CliAuthLocationFlags,
  action: FlowCommandAction,
) {
  return yield* runWithEnvironmentAccess(
    flags,
    {
      scopes: AuthAdministrativeScopes,
      label: "aqqua flow cli",
      mapLiveServerError: flowCommandErrorFromLiveServerRequest,
      connectionFailureLogMessage: "Failed to connect to the persisted flow CLI server.",
    },
    ({ snapshot, dispatch }) =>
      executeFlowCommand({
        action,
        access: { snapshot, dispatch },
        cwd: process.cwd(),
      }),
  );
});

const prepareDefinitionAction = Effect.fn("prepareDefinitionAction")(function* (
  flags: CliAuthLocationFlags & {
    readonly file: string;
    readonly allowUnknownProfiles: boolean;
    readonly json: boolean;
  },
  input: { readonly type: "create" } | { readonly type: "update"; readonly identifier: string },
) {
  const contents = yield* readFlowDefinitionFile(flags.file);
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const availableProfileNames = yield* readAvailableFlowProfileNames(config.settingsPath);
  return {
    ...input,
    contents,
    availableProfileNames,
    allowUnknownProfiles: flags.allowUnknownProfiles,
    json: flags.json,
  } satisfies FlowCommandAction;
});

const flowListCommand = Command.make("list", {
  ...projectLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("List flows for the project containing the current directory."),
  Command.withHandler((flags) =>
    runFlowWithEnvironmentAccess(flags, { type: "list", json: flags.json }),
  ),
);

const flowShowCommand = Command.make("show", {
  ...projectLocationFlags,
  identifier: flowIdentifierArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show a flow definition."),
  Command.withHandler((flags) =>
    runFlowWithEnvironmentAccess(flags, {
      type: "show",
      identifier: flags.identifier,
      json: flags.json,
    }),
  ),
);

const flowCreateCommand = Command.make("create", {
  ...projectLocationFlags,
  file: definitionFileFlag,
  allowUnknownProfiles: allowUnknownProfilesFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Create a flow from a JSON definition file."),
  Command.withHandler(
    Effect.fn("flowCreateCommand")(function* (flags) {
      const action = yield* prepareDefinitionAction(flags, { type: "create" });
      return yield* runFlowWithEnvironmentAccess(flags, action);
    }),
  ),
);

const flowUpdateCommand = Command.make("update", {
  ...projectLocationFlags,
  identifier: flowIdentifierArgument,
  file: definitionFileFlag,
  allowUnknownProfiles: allowUnknownProfilesFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Replace a flow from a JSON definition file."),
  Command.withHandler(
    Effect.fn("flowUpdateCommand")(function* (flags) {
      const action = yield* prepareDefinitionAction(flags, {
        type: "update",
        identifier: flags.identifier,
      });
      return yield* runFlowWithEnvironmentAccess(flags, action);
    }),
  ),
);

const flowDeleteCommand = Command.make("delete", {
  ...projectLocationFlags,
  identifier: flowIdentifierArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Delete a flow."),
  Command.withHandler((flags) =>
    runFlowWithEnvironmentAccess(flags, {
      type: "delete",
      identifier: flags.identifier,
      json: flags.json,
    }),
  ),
);

const flowSchemaCommand = Command.make("schema", {
  json: jsonFlag,
}).pipe(
  Command.withDescription("Print the flow definition format and validation rules."),
  Command.withHandler((flags) =>
    Console.log(
      emit({
        json: flags.json,
        value: canonicalFlowDefinition,
        text: flowSchemaText,
      }),
    ),
  ),
);

export const flowCommand = Command.make("flow").pipe(
  Command.withDescription("Create and manage project flows."),
  Command.withSubcommands([
    flowListCommand,
    flowShowCommand,
    flowCreateCommand,
    flowUpdateCommand,
    flowDeleteCommand,
    flowSchemaCommand,
  ]),
);
