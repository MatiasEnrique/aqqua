import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AgentProfileName,
  BoardId,
  BoardStepId,
  CardId,
  CommandId,
  type ClientOrchestrationCommand,
  OrchestrationReadModel,
  type OrchestrationBoard,
  type OrchestrationCard,
  ProjectId,
  ProviderInstanceId,
} from "@aqqua/contracts";
import * as NetService from "@aqqua/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";

import {
  executeFlowCommand,
  FlowAmbiguousNameError,
  FlowLiveServerRequiredError,
  flowCommand,
  readAvailableFlowProfileNames,
  resolveFlow,
  type FlowCommandAccess,
  type FlowCommandAction,
} from "./flow.ts";

const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationReadModel);
const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeFlowListJson = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        stepCount: Schema.Number,
        profiles: Schema.Array(Schema.String),
        agents: Schema.Array(Schema.String),
      }),
    ),
  ),
);
const timestamp = "2026-08-04T12:00:00.000Z";

const project = {
  id: "project-1",
  title: "Aqqua",
  workspaceRoot: "/workspace/aqqua",
  defaultModelSelection: null,
  scripts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};

const flow = (overrides: Partial<OrchestrationBoard> = {}): OrchestrationBoard => ({
  id: BoardId.make("flow-1"),
  projectId: ProjectId.make("project-1"),
  name: "Ship",
  steps: [
    {
      id: BoardStepId.make("step-1"),
      name: "Plan",
      profileName: AgentProfileName.make("planner"),
      continuation: "auto",
      promptTemplate: "Plan ${request}",
    },
    {
      id: BoardStepId.make("step-2"),
      name: "Implement",
      profileName: AgentProfileName.make("implementer"),
      continuation: "manual",
      promptTemplate: "Use ${artifact}",
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  ...overrides,
});

const card = (overrides: Partial<OrchestrationCard> = {}): OrchestrationCard => ({
  id: CardId.make("card-1"),
  boardId: BoardId.make("flow-1"),
  projectId: ProjectId.make("project-1"),
  title: "Ship the CLI",
  parameters: { request: "Add card commands" },
  position: { kind: "todo" },
  status: null,
  operation: null,
  lastError: null,
  snapshot: null,
  branch: null,
  worktreePath: null,
  stepThreads: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  releasedAt: null,
  completedAt: null,
  settledAt: null,
  archivedAt: null,
  ...overrides,
});

const snapshot = (
  flows: ReadonlyArray<OrchestrationBoard>,
  cards: ReadonlyArray<OrchestrationCard> = [],
) =>
  decodeSnapshot({
    snapshotSequence: 1,
    projects: [project],
    threads: [],
    boards: flows,
    cards,
    updatedAt: timestamp,
  });

const makeAccess = (
  flows: ReadonlyArray<OrchestrationBoard>,
  cards: ReadonlyArray<OrchestrationCard> = [],
  mode: "live" | "offline" = "live",
) => {
  const commands: ClientOrchestrationCommand[] = [];
  const access: FlowCommandAccess = {
    snapshot: snapshot(flows, cards),
    mode,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
      }),
  };
  return { access, commands };
};

const run = (
  action: FlowCommandAction,
  access: FlowCommandAccess,
  mintUuid: Effect.Effect<string> = Effect.succeed("uuid"),
) =>
  executeFlowCommand({
    action,
    access,
    cwd: "/workspace/aqqua/apps/server",
    mintUuid,
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)));

it.effect("lists active flows with step counts and distinct sorted profiles", () =>
  Effect.gen(function* () {
    const { access } = makeAccess([
      flow({
        steps: [
          ...flow().steps,
          {
            id: BoardStepId.make("step-3"),
            name: "Review",
            profileName: AgentProfileName.make("planner"),
            continuation: "auto",
            promptTemplate: "Review",
          },
        ],
      }),
      flow({ id: BoardId.make("deleted"), name: "Old", deletedAt: timestamp }),
      flow({ id: BoardId.make("other-project"), projectId: ProjectId.make("project-2") }),
    ]);

    const output = yield* run({ type: "list", json: true }, access);
    const decoded = yield* decodeFlowListJson(output);

    assert.deepStrictEqual(decoded, [
      {
        id: "flow-1",
        name: "Ship",
        stepCount: 3,
        profiles: ["implementer", "planner"],
        agents: ["profile=implementer (legacy)", "profile=planner (legacy)"],
      },
    ]);
  }),
);

it.effect("shows the full definition and resolves an exact id before duplicate names", () =>
  Effect.gen(function* () {
    const { access } = makeAccess([
      flow({ id: BoardId.make("flow-1"), name: "Duplicate" }),
      flow({ id: BoardId.make("flow-2"), name: "Duplicate" }),
    ]);

    const output = yield* run({ type: "show", identifier: "flow-2", json: true }, access);
    const decoded = yield* decodeUnknownJson(output);
    assert.deepStrictEqual(decoded, {
      id: "flow-2",
      name: "Duplicate",
      steps: [
        {
          id: "step-1",
          name: "Plan",
          profileName: "planner",
          continuation: "auto",
          promptTemplate: "Plan ${request}",
        },
        {
          id: "step-2",
          name: "Implement",
          profileName: "implementer",
          continuation: "manual",
          promptTemplate: "Use ${artifact}",
        },
      ],
    });
  }),
);

it.effect("renders canonical steps by exact instance/model and legacy steps as profiles", () =>
  Effect.gen(function* () {
    const mixed = flow({
      steps: [
        {
          id: BoardStepId.make("step-canonical"),
          name: "Plan",
          agent: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
            reasoning: "high",
          },
          continuation: "auto",
          promptTemplate: "Plan ${request}",
        },
        {
          id: BoardStepId.make("step-legacy"),
          name: "Implement",
          profileName: AgentProfileName.make("implementer"),
          continuation: "manual",
          promptTemplate: "Use ${artifact}",
        },
      ],
    });
    const { access } = makeAccess([mixed]);

    // `show --json` round-trips: each step carries back the selector it was
    // authored with, so the output is a valid `update --file` body.
    const shown = yield* decodeUnknownJson(
      yield* run({ type: "show", identifier: "flow-1", json: true }, access),
    );
    assert.deepStrictEqual(shown, {
      id: "flow-1",
      name: "Ship",
      steps: [
        {
          id: "step-canonical",
          name: "Plan",
          agent: { instanceId: "codex", model: "gpt-5.6-sol", reasoning: "high" },
          continuation: "auto",
          promptTemplate: "Plan ${request}",
        },
        {
          id: "step-legacy",
          name: "Implement",
          profileName: "implementer",
          continuation: "manual",
          promptTemplate: "Use ${artifact}",
        },
      ],
    });

    const text = yield* run({ type: "show", identifier: "flow-1", json: false }, access);
    assert.include(text, "instance=codex model=gpt-5.6-sol reasoning=high");
    assert.include(text, "profile=implementer (legacy)");

    const listed = yield* decodeFlowListJson(yield* run({ type: "list", json: true }, access));
    assert.deepStrictEqual(listed[0]?.agents, [
      "instance=codex model=gpt-5.6-sol reasoning=high",
      "profile=implementer (legacy)",
    ]);
  }),
);

it.effect("creates a canonical flow without consulting local agent profiles", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([]);
    const ids = ["flow-created", "command-created"];
    const output = yield* run(
      {
        type: "create",
        contents:
          '{"name":"Ship","steps":[{"id":"step-kept","name":"Plan","agent":{"instanceId":"pi_work","model":"anthropic/claude-sonnet-5","reasoning":"high"},"promptTemplate":"Plan ${request}"}]}',
        availableProfileNames: [],
        allowUnknownProfiles: false,
        json: false,
      },
      access,
      Effect.sync(() => ids.shift() ?? "unexpected"),
    );

    // No profile exists locally and none is needed: the instance/model pair is
    // validated against the environment that runs the card.
    assert.strictEqual(
      output,
      "Created flow flow-created. Cards on this flow will ask for: request.",
    );
    assert.deepStrictEqual(commands, [
      {
        type: "board.create",
        commandId: CommandId.make("command-created"),
        boardId: BoardId.make("flow-created"),
        projectId: ProjectId.make("project-1"),
        name: "Ship",
        steps: [
          {
            id: BoardStepId.make("step-kept"),
            name: "Plan",
            agent: {
              instanceId: ProviderInstanceId.make("pi_work"),
              model: "anthropic/claude-sonnet-5",
              reasoning: "high",
            },
            promptTemplate: "Plan ${request}",
            continuation: "auto",
          },
        ],
      },
    ]);
  }),
);

it.effect("reports every id when a flow name is ambiguous", () =>
  Effect.gen(function* () {
    const flows = [
      flow({ id: BoardId.make("flow-1"), name: "Duplicate" }),
      flow({ id: BoardId.make("flow-2"), name: "Duplicate" }),
    ];
    const failure = yield* Effect.flip(resolveFlow(flows, "Duplicate"));
    assert.instanceOf(failure, FlowAmbiguousNameError);
    assert.include(failure.message, "flow-1");
    assert.include(failure.message, "flow-2");
  }),
);

it.effect("creates a validated flow through the injected transport and reports parameters", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([]);
    const ids = ["flow-created", "command-created"];
    const output = yield* run(
      {
        type: "create",
        contents:
          '{"name":"Ship","steps":[{"id":"step-kept","name":"Plan","profileName":"planner","promptTemplate":"Plan ${request}"}]}',
        availableProfileNames: ["planner"],
        allowUnknownProfiles: false,
        json: false,
      },
      access,
      Effect.sync(() => ids.shift() ?? "unexpected"),
    );

    assert.strictEqual(
      output,
      "Created flow flow-created. Cards on this flow will ask for: request.",
    );
    assert.deepStrictEqual(commands, [
      {
        type: "board.create",
        commandId: CommandId.make("command-created"),
        boardId: BoardId.make("flow-created"),
        projectId: ProjectId.make("project-1"),
        name: "Ship",
        steps: [
          {
            id: BoardStepId.make("step-kept"),
            name: "Plan",
            profileName: AgentProfileName.make("planner"),
            promptTemplate: "Plan ${request}",
            continuation: "auto",
          },
        ],
      },
    ]);
  }),
);

it.effect("updates a name-matched flow wholesale and preserves supplied step ids", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()]);
    const output = yield* run(
      {
        type: "update",
        identifier: "Ship",
        contents:
          '{"name":"Deliver","steps":[{"id":"replacement","name":"Review","profileName":"future","promptTemplate":"Review"}]}',
        availableProfileNames: [],
        allowUnknownProfiles: true,
        json: false,
      },
      access,
      Effect.succeed("command-update"),
    );

    assert.include(output, "Updated flow flow-1.");
    assert.include(output, "Warning: unknown legacy agent profiles: future.");
    assert.deepStrictEqual(commands, [
      {
        type: "board.update",
        commandId: CommandId.make("command-update"),
        boardId: BoardId.make("flow-1"),
        name: "Deliver",
        steps: [
          {
            id: BoardStepId.make("replacement"),
            name: "Review",
            profileName: AgentProfileName.make("future"),
            promptTemplate: "Review",
            continuation: "auto",
          },
        ],
      },
    ]);
  }),
);

it.effect("soft-deletes by dispatching the flow delete command", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()]);
    const output = yield* run(
      { type: "delete", identifier: "Ship", json: true },
      access,
      Effect.succeed("command-delete"),
    );

    assert.strictEqual(output, '{"id":"flow-1","deleted":true}');
    assert.deepStrictEqual(commands, [
      {
        type: "board.delete",
        commandId: CommandId.make("command-delete"),
        boardId: BoardId.make("flow-1"),
      },
    ]);
  }),
);

it.effect("creates a card for a named flow and reports its id", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()]);
    const ids = ["card-created", "command-created"];
    const output = yield* run(
      {
        type: "card-create",
        flowIdentifier: "Ship",
        title: "Ship card commands",
        parameters: { request: "Add CLI support" },
        json: true,
      },
      access,
      Effect.sync(() => ids.shift() ?? "unexpected"),
    );

    assert.strictEqual(output, '{"id":"card-created","flowId":"flow-1","position":"todo"}');
    assert.deepStrictEqual(commands, [
      {
        type: "card.create",
        commandId: CommandId.make("command-created"),
        cardId: CardId.make("card-created"),
        boardId: BoardId.make("flow-1"),
        title: "Ship card commands",
        parameters: { request: "Add CLI support" },
      },
    ]);
  }),
);

it.effect("lists project cards with their flow and current state", () =>
  Effect.gen(function* () {
    const { access } = makeAccess([flow()], [card()]);
    const output = yield* run({ type: "card-list", json: true }, access);
    const decoded = yield* decodeUnknownJson(output);
    assert.deepStrictEqual(decoded, [
      {
        id: "card-1",
        flowId: "flow-1",
        flowName: "Ship",
        title: "Ship the CLI",
        position: { kind: "todo" },
        status: null,
      },
    ]);
  }),
);

it.effect("starts an existing todo card through the live server", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()], [card()]);
    const output = yield* run(
      { type: "card-start", cardId: "card-1", json: false },
      access,
      Effect.succeed("command-start"),
    );

    assert.strictEqual(output, "Start requested for card card-1 (Ship the CLI).");
    assert.deepStrictEqual(commands, [
      {
        type: "card.release",
        commandId: CommandId.make("command-start"),
        cardId: CardId.make("card-1"),
      },
    ]);
  }),
);

it.effect("refuses to start a card from an offline CLI runtime", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()], [card()], "offline");
    const failure = yield* Effect.flip(
      run(
        { type: "card-start", cardId: "card-1", json: false },
        access,
        Effect.succeed("command-start"),
      ),
    );

    assert.instanceOf(failure, FlowLiveServerRequiredError);
    assert.deepStrictEqual(commands, []);
  }),
);

it.effect("requests a live card reset so a CLI-started run has a way back to To Do", () =>
  Effect.gen(function* () {
    const { access, commands } = makeAccess([flow()], [card({ status: "failed" })]);
    const output = yield* run(
      { type: "card-reset", cardId: "card-1", json: true },
      access,
      Effect.succeed("command-reset"),
    );

    assert.strictEqual(output, '{"id":"card-1","resetRequested":true}');
    assert.deepStrictEqual(commands, [
      {
        type: "card.reset",
        commandId: CommandId.make("command-reset"),
        cardId: CardId.make("card-1"),
      },
    ]);
  }),
);

it.effect("reads configured profiles leniently and always includes implementer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const settingsPath = path.join(directory, "settings.json");
      yield* fileSystem.writeFileString(
        settingsPath,
        `{
          // Agent-authored settings may contain comments.
          "agentProfiles": {
            "planner": { "target": { "kind": "driver", "driver": "codex" } },
          },
        }`,
      );

      const names = yield* readAvailableFlowProfileNames(settingsPath);
      assert.deepStrictEqual(names, ["implementer", "planner"]);
    }),
  ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, Path.layer))),
);

it.effect("prints the canonical schema example as JSON through the CLI command", () =>
  Effect.gen(function* () {
    yield* Command.runWith(flowCommand, { version: "0.0.0" })(["schema", "--json"]);
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    const decoded = yield* decodeUnknownJson(output);
    assert.deepStrictEqual(decoded, {
      name: "Ship a feature",
      steps: [
        {
          name: "Plan",
          agent: {
            instanceId: "codex",
            model: "gpt-5.6-sol",
            reasoning: "high",
          },
          promptTemplate: "Plan ${card_title}: ${request}",
        },
        {
          name: "Implement",
          agent: {
            instanceId: "codex",
            model: "gpt-5.6-sol",
          },
          promptTemplate: "Implement the plan:\n${artifact}",
          continuation: "manual",
        },
      ],
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        FetchHttpClient.layer,
        NetService.layer,
        TestConsole.layer,
      ),
    ),
  ),
);

it.effect("exposes the nested card definition schema through the CLI", () =>
  Effect.gen(function* () {
    yield* Command.runWith(flowCommand, { version: "0.0.0" })(["card", "schema", "--json"]);
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    const decoded = yield* decodeUnknownJson(output);
    assert.deepStrictEqual(decoded, {
      title: "Ship card commands",
      parameters: { request: "Add CLI support for creating and starting cards" },
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        FetchHttpClient.layer,
        NetService.layer,
        TestConsole.layer,
      ),
    ),
  ),
);
