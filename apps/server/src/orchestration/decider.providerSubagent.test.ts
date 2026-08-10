import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@aqqua/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");
const OWNER_ID = ThreadId.make("owner-thread");

const addProject = (readModel: OrchestrationReadModel, projectId: ProjectId, sequence: number) =>
  projectEvent(readModel, {
    sequence,
    eventId: EventId.make(`evt-${projectId}`),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make(`cmd-${projectId}`),
    causationEventId: null,
    correlationId: CommandId.make(`cmd-${projectId}`),
    metadata: {},
    payload: {
      projectId,
      title: String(projectId),
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

const addOwner = (readModel: OrchestrationReadModel, projectId: ProjectId, sequence: number) =>
  projectEvent(readModel, {
    sequence,
    eventId: EventId.make("evt-owner"),
    aggregateKind: "thread",
    aggregateId: OWNER_ID,
    type: "thread.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-owner"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-owner"),
    metadata: {},
    payload: {
      threadId: OWNER_ID,
      projectId,
      parentThreadId: null,
      title: "Owner",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

const deleteOwner = (readModel: OrchestrationReadModel, sequence: number) =>
  projectEvent(readModel, {
    sequence,
    eventId: EventId.make("evt-owner-deleted"),
    aggregateKind: "thread",
    aggregateId: OWNER_ID,
    type: "thread.deleted",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-owner-deleted"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-owner-deleted"),
    metadata: {},
    payload: {
      threadId: OWNER_ID,
      deletedAt: NOW,
    },
  });

const createNativeChild = (readModel: OrchestrationReadModel, projectId: ProjectId) =>
  decideOrchestrationCommand({
    readModel,
    command: {
      type: "thread.create",
      commandId: CommandId.make(`cmd-child-${projectId}`),
      threadId: ThreadId.make(`child-${projectId}`),
      projectId,
      parentThreadId: OWNER_ID,
      providerSubagent: {
        ownerThreadId: OWNER_ID,
        provider: ProviderDriverKind.make("codex"),
        childId: "native-child",
      },
      title: "Native child",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    },
  });

it.layer(NodeServices.layer)("provider-native thread.create invariants", (it) => {
  it.effect("rejects a binding whose owner does not exist", () =>
    Effect.gen(function* () {
      const readModel = yield* addProject(createEmptyReadModel(NOW), PROJECT_A, 1);

      const error = yield* Effect.flip(createNativeChild(readModel, PROJECT_A));

      expect(error.message).toContain(`Thread '${OWNER_ID}' does not exist`);
    }),
  );

  it.effect("rejects a binding whose owner belongs to another project", () =>
    Effect.gen(function* () {
      const withProjectA = yield* addProject(createEmptyReadModel(NOW), PROJECT_A, 1);
      const withProjectB = yield* addProject(withProjectA, PROJECT_B, 2);
      const readModel = yield* addOwner(withProjectB, PROJECT_A, 3);

      const error = yield* Effect.flip(createNativeChild(readModel, PROJECT_B));

      expect(error.message).toContain("belongs to a different project");
    }),
  );

  it.effect("rejects a binding whose owner has been deleted", () =>
    Effect.gen(function* () {
      const withProject = yield* addProject(createEmptyReadModel(NOW), PROJECT_A, 1);
      const withOwner = yield* addOwner(withProject, PROJECT_A, 2);
      const readModel = yield* deleteOwner(withOwner, 3);

      const error = yield* Effect.flip(createNativeChild(readModel, PROJECT_A));

      expect(error.message).toContain(
        `Provider-native owner thread '${OWNER_ID}' has been deleted`,
      );
    }),
  );
});
