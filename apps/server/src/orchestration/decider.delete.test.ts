import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const seedReadModel = Effect.gen(function* () {
  const now = "2026-01-01T00:00:00.000Z";
  const initial = createEmptyReadModel(now);
  const withProject = yield* projectEvent(initial, {
    sequence: 1,
    eventId: asEventId("evt-project-create"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-delete"),
    type: "project.created",
    occurredAt: now,
    commandId: asCommandId("cmd-project-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-delete"),
      title: "Project Delete",
      workspaceRoot: "/tmp/project-delete",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  const withFirstThread = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: asEventId("evt-thread-create-1"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-1"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-1"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-1"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-1"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 1",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return yield* projectEvent(withFirstThread, {
    sequence: 3,
    eventId: asEventId("evt-thread-create-2"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-2"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-2"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-2"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-2"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 2",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

const threadCreatedEvent = (input: {
  readonly sequence: number;
  readonly threadId: string;
  readonly title: string;
  readonly parentThreadId?: string;
}): OrchestrationEvent => {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    sequence: input.sequence,
    eventId: asEventId(`evt-thread-create-${input.threadId}`),
    aggregateKind: "thread",
    aggregateId: asThreadId(input.threadId),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId(`cmd-thread-create-${input.threadId}`),
    causationEventId: null,
    correlationId: asCommandId(`cmd-thread-create-${input.threadId}`),
    metadata: {},
    payload: {
      threadId: asThreadId(input.threadId),
      projectId: asProjectId("project-delete"),
      ...(input.parentThreadId !== undefined
        ? { parentThreadId: asThreadId(input.parentThreadId) }
        : {}),
      title: input.title,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  };
};

// project-delete with orchestrator "thread-parent" owning "thread-child",
// which in turn owns "thread-grandchild".
const seedHierarchyReadModel = Effect.gen(function* () {
  let readModel = yield* seedReadModel;
  for (const event of [
    threadCreatedEvent({ sequence: 4, threadId: "thread-parent", title: "Thread Parent" }),
    threadCreatedEvent({
      sequence: 5,
      threadId: "thread-child",
      title: "Thread Child",
      parentThreadId: "thread-parent",
    }),
    threadCreatedEvent({
      sequence: 6,
      threadId: "thread-grandchild",
      title: "Thread Grandchild",
      parentThreadId: "thread-child",
    }),
  ]) {
    readModel = yield* projectEvent(readModel, event);
  }
  return readModel;
});

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function normalizeDeleteEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    switch (entry.type) {
      case "thread.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            threadId: entry.payload.threadId,
          },
        };
      case "project.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            projectId: entry.payload.projectId,
          },
        };
      default:
        return entry;
    }
  });
}

it.layer(NodeServices.layer)("decider deletion flows", (it) => {
  it.effect("rejects deleting a non-empty project without force", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-no-force"),
            projectId: asProjectId("project-delete"),
          },
          readModel,
        }),
      );
      expect(error.message).toContain("cannot be deleted without force=true");
    }),
  );

  it.effect("reuses thread.delete semantics when force-deleting a non-empty project", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const projectDeleteCommand: Extract<OrchestrationCommand, { type: "project.delete" }> = {
        type: "project.delete",
        commandId: asCommandId("cmd-project-delete-force"),
        projectId: asProjectId("project-delete"),
        force: true,
      };

      const forcedResult = yield* decideOrchestrationCommand({
        command: projectDeleteCommand,
        readModel,
      });
      const forcedEvents = Array.isArray(forcedResult) ? forcedResult : [forcedResult];

      expect(forcedEvents.map((event) => event.type)).toEqual([
        "thread.deleted",
        "thread.deleted",
        "project.deleted",
      ]);

      let sequentialReadModel = readModel;
      let nextSequence = readModel.snapshotSequence;
      const sequentialEvents: PlannedEvent[] = [];
      for (const nextCommand of [
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-1"),
        },
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-2"),
        },
        {
          type: "project.delete",
          commandId: projectDeleteCommand.commandId,
          projectId: asProjectId("project-delete"),
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>) {
        const decided = yield* decideOrchestrationCommand({
          command: nextCommand,
          readModel: sequentialReadModel,
        });
        const nextEvents = Array.isArray(decided) ? decided : [decided];
        sequentialEvents.push(...nextEvents);
        for (const nextEvent of nextEvents) {
          nextSequence += 1;
          sequentialReadModel = yield* projectEvent(sequentialReadModel, {
            ...nextEvent,
            sequence: nextSequence,
          });
        }
      }

      expect(normalizeDeleteEvent(forcedResult)).toEqual(normalizeDeleteEvent(sequentialEvents));
    }),
  );

  it.effect("deleting a thread cascades to its sub-agent threads, deepest first", () =>
    Effect.gen(function* () {
      const readModel = yield* seedHierarchyReadModel;
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.delete",
          commandId: asCommandId("cmd-thread-delete-parent"),
          threadId: asThreadId("thread-parent"),
        },
        readModel,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => ({ type: event.type, aggregateId: event.aggregateId }))).toEqual(
        [
          { type: "thread.deleted", aggregateId: asThreadId("thread-grandchild") },
          { type: "thread.deleted", aggregateId: asThreadId("thread-child") },
          { type: "thread.deleted", aggregateId: asThreadId("thread-parent") },
        ],
      );
    }),
  );

  it.effect("deleting a thread skips sub-agent threads that are already deleted", () =>
    Effect.gen(function* () {
      const readModel = yield* seedHierarchyReadModel;
      const withDeletedChild = yield* projectEvent(readModel, {
        sequence: readModel.snapshotSequence + 1,
        eventId: asEventId("evt-thread-child-deleted"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-child"),
        type: "thread.deleted",
        occurredAt: "2026-01-01T01:00:00.000Z",
        commandId: asCommandId("cmd-thread-delete-child"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-delete-child"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-child"),
          deletedAt: "2026-01-01T01:00:00.000Z",
        },
      });
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.delete",
          commandId: asCommandId("cmd-thread-delete-parent"),
          threadId: asThreadId("thread-parent"),
        },
        readModel: withDeletedChild,
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => ({ type: event.type, aggregateId: event.aggregateId }))).toEqual(
        [{ type: "thread.deleted", aggregateId: asThreadId("thread-parent") }],
      );
    }),
  );

  it.effect(
    "force-deleting a project emits exactly one thread.deleted per thread in the hierarchy",
    () =>
      Effect.gen(function* () {
        const readModel = yield* seedHierarchyReadModel;
        const result = yield* decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-hierarchy"),
            projectId: asProjectId("project-delete"),
            force: true,
          },
          readModel,
        });
        const events = Array.isArray(result) ? result : [result];
        const deletedThreadIds = events
          .filter((event) => event.type === "thread.deleted")
          .map((event) => event.aggregateId)
          .sort();
        expect(deletedThreadIds).toEqual(
          [
            "thread-delete-1",
            "thread-delete-2",
            "thread-parent",
            "thread-child",
            "thread-grandchild",
          ].sort(),
        );
        expect(events.at(-1)?.type).toBe("project.deleted");
      }),
  );
});
