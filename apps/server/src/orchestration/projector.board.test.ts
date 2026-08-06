import { expect, it } from "@effect/vitest";
import {
  BoardId,
  type BoardStep,
  BoardStepId,
  CardId,
  CommandId,
  EventId,
  type OrchestrationEvent,
  ProjectId,
  ThreadId,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const STEPS: ReadonlyArray<BoardStep> = [
  {
    id: BoardStepId.make("step-1"),
    name: "Implement",
    promptTemplate: "Implement ${ticket_id}",
    profileName: "default" as BoardStep["profileName"],
    continuation: "auto",
  },
  {
    id: BoardStepId.make("step-2"),
    name: "Review",
    promptTemplate: "Review ${artifact}",
    profileName: "default" as BoardStep["profileName"],
    continuation: "manual",
  },
];

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "board"
        ? BoardId.make(input.aggregateId)
        : input.aggregateKind === "card"
          ? CardId.make(input.aggregateId)
          : input.aggregateKind === "project"
            ? ProjectId.make(input.aggregateId)
            : ThreadId.make(input.aggregateId),
    occurredAt: NOW,
    commandId: CommandId.make(`cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

it.effect("projects board create/update/delete", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "board.created",
        aggregateKind: "board",
        aggregateId: "board-1",
        payload: {
          boardId: "board-1",
          projectId: "project-1",
          name: "Delivery",
          steps: STEPS,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.boards).toHaveLength(1);
    expect(model.boards[0]?.name).toBe("Delivery");
    expect(model.boards[0]?.deletedAt).toBeNull();

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "board.updated",
        aggregateKind: "board",
        aggregateId: "board-1",
        payload: {
          boardId: "board-1",
          name: "Delivery v2",
          steps: [STEPS[0]],
          updatedAt: NOW,
        },
      }),
    );
    expect(model.boards[0]?.name).toBe("Delivery v2");
    expect(model.boards[0]?.steps).toHaveLength(1);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 3,
        type: "board.deleted",
        aggregateKind: "board",
        aggregateId: "board-1",
        payload: {
          boardId: "board-1",
          deletedAt: NOW,
        },
      }),
    );
    expect(model.boards[0]?.deletedAt).toBe(NOW);
  }),
);

it.effect("projects the card lifecycle without moving position on release-request", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          boardId: "board-1",
          projectId: "project-1",
          title: "Fix flaky test",
          parameters: { ticket_id: "T-1" },
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });
    expect(model.cards[0]?.status).toBeNull();
    expect(model.cards[0]?.snapshot).toBeNull();

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.release-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          snapshot: { name: "Delivery", steps: STEPS },
          requestedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });
    expect(model.cards[0]?.snapshot?.name).toBe("Delivery");
    expect(model.cards[0]?.operation).toMatchObject({
      kind: "starting",
      operationId: "op-start",
    });
    expect(model.cards[0]?.status).toBeNull();

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 3,
        type: "card.released",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          branch: "card/card-1",
          worktreePath: "/tmp/wt/card-1",
          releasedAt: NOW,
          updatedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    expect(model.cards[0]?.branch).toBe("card/card-1");
    expect(model.cards[0]?.releasedAt).toBe(NOW);
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });
    // Starting remains until step-enter so reactors can resume after restart.
    expect(model.cards[0]?.operation?.kind).toBe("starting");

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 4,
        type: "card.step-entered",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          stepIndex: 0,
          threadId: "thread-1",
          enteredAt: NOW,
          updatedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "step", stepIndex: 0 });
    expect(model.cards[0]?.status).toBe("running");
    expect(model.cards[0]?.operation).toBeNull();
    expect(model.cards[0]?.stepThreads).toEqual([
      { stepIndex: 0, threadId: "thread-1", spawnedAt: NOW },
    ]);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 5,
        type: "card.status-set",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          status: "paused",
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.status).toBe("paused");
    expect(model.cards[0]?.position).toEqual({ kind: "step", stepIndex: 0 });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 6,
        type: "card.completed",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          completedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "done" });
    expect(model.cards[0]?.status).toBeNull();
    expect(model.cards[0]?.completedAt).toBe(NOW);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 7,
        type: "card.settled",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          settledAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.settledAt).toBe(NOW);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 8,
        type: "card.unsettled",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.settledAt).toBeNull();

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 9,
        type: "card.archived",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          archivedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]?.archivedAt).toBe(NOW);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 10,
        type: "card.delete-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          requestedAt: NOW,
          operationId: "op-delete",
        },
      }),
    );
    // Durable delete claims an operation; agent status is unchanged.
    expect(model.cards[0]?.status).toBeNull();
    expect(model.cards[0]?.operation).toMatchObject({
      kind: "deleting",
      operationId: "op-delete",
    });
    expect(model.cards[0]?.position).toEqual({ kind: "done" });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 11,
        type: "card.deleted",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          deletedAt: NOW,
          operationId: "op-delete",
        },
      }),
    );
    expect(model.cards).toHaveLength(0);
  }),
);

it.effect("projects legacy delete-requested status for historical events", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          boardId: "board-1",
          projectId: "project-1",
          title: "Legacy",
          parameters: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.delete-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: { cardId: "card-1", requestedAt: NOW },
      }),
    );
    expect(model.cards[0]?.status).toBe("deleting");
    expect(model.cards[0]?.operation).toBeNull();
  }),
);

it.effect("keeps archive cleanup visible until the final archived receipt", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: {
          cardId: "card-archive",
          boardId: "board-1",
          projectId: "project-1",
          title: "Archive me",
          parameters: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.delete-requested",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: {
          cardId: "card-archive",
          requestedAt: NOW,
          operationId: "cmd-archive",
          purpose: "archive",
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      archivedAt: null,
      operation: { kind: "deleting", operationId: "cmd-archive", purpose: "archive" },
    });

    for (const [sequence, stage] of [
      [3, "cleanup-started"],
      [4, "conversations-archived"],
      [5, "worktree-removed"],
    ] as const) {
      model = yield* projectEvent(
        model,
        makeEvent({
          sequence,
          type: "card.cleanup-progressed",
          aggregateKind: "card",
          aggregateId: "card-archive",
          payload: {
            cardId: "card-archive",
            operationId: "cmd-archive",
            kind: "deleting",
            stage,
            progressedAt: NOW,
          },
        }),
      );
    }
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 6,
        type: "card.operation-failed",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: {
          cardId: "card-archive",
          operationId: "cmd-archive",
          kind: "deleting",
          reason: "Archive failed while removing artifacts",
          failedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      archivedAt: null,
      lastError: "Archive failed while removing artifacts",
      operation: { cleanupStage: "worktree-removed" },
    });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 7,
        type: "card.delete-requested",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: {
          cardId: "card-archive",
          requestedAt: NOW,
          operationId: "cmd-archive",
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      lastError: null,
      operation: { cleanupStage: "worktree-removed", purpose: "archive" },
    });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 8,
        type: "card.cleanup-progressed",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: {
          cardId: "card-archive",
          operationId: "cmd-archive",
          kind: "deleting",
          stage: "artifacts-removed",
          progressedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 9,
        type: "card.archived",
        aggregateKind: "card",
        aggregateId: "card-archive",
        payload: { cardId: "card-archive", archivedAt: NOW, updatedAt: NOW },
      }),
    );
    expect(model.cards[0]).toMatchObject({ archivedAt: NOW, operation: null, lastError: null });
  }),
);

it.effect("projects a full-card reset back to To-Do while retaining its worktree", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          boardId: "board-1",
          projectId: "project-1",
          title: "Reset me",
          parameters: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.release-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          snapshot: { name: "Delivery", steps: STEPS },
          requestedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 3,
        type: "card.released",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          branch: "board/reset-card-1",
          worktreePath: "/tmp/wt/card-1",
          releasedAt: NOW,
          updatedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 4,
        type: "card.step-entered",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          stepIndex: 0,
          threadId: "thread-1",
          enteredAt: NOW,
          updatedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 5,
        type: "card.reset-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          operationId: "op-reset",
          activeThreadId: "thread-1",
          threadIds: ["thread-1"],
          requestedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      position: { kind: "step", stepIndex: 0 },
      status: "running",
      operation: {
        kind: "resetting",
        operationId: "op-reset",
        activeThreadId: "thread-1",
        threadIds: ["thread-1"],
      },
      branch: "board/reset-card-1",
      worktreePath: "/tmp/wt/card-1",
    });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 6,
        type: "card.reset",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          operationId: "op-reset",
          activeThreadId: "thread-1",
          threadIds: ["thread-1"],
          resetAt: NOW,
        },
      }),
    );

    expect(model.cards[0]).toMatchObject({
      position: { kind: "todo" },
      status: null,
      operation: null,
      snapshot: null,
      branch: "board/reset-card-1",
      worktreePath: "/tmp/wt/card-1",
      stepThreads: [],
      releasedAt: null,
      completedAt: null,
      settledAt: null,
    });
  }),
);

it.effect("projects operation failure without moving position for delete/reset", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          boardId: "board-1",
          projectId: "project-1",
          title: "Failing ops",
          parameters: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.release-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          snapshot: { name: "Delivery", steps: STEPS },
          requestedAt: NOW,
          operationId: "op-start",
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 3,
        type: "card.operation-failed",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          operationId: "op-start",
          kind: "starting",
          reason: "worktree failed",
          failedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      position: { kind: "todo" },
      status: "failed",
      operation: null,
      lastError: "worktree failed",
      snapshot: { name: "Delivery" },
    });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 4,
        type: "card.status-set",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          status: "paused",
          updatedAt: NOW,
        },
      }),
    );
    // Jump the card to a step with a delete claim for failure preservation.
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 5,
        type: "card.step-entered",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          stepIndex: 0,
          threadId: "thread-1",
          enteredAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 6,
        type: "card.status-set",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          status: "paused",
          updatedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 7,
        type: "card.delete-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          requestedAt: NOW,
          operationId: "op-delete",
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 8,
        type: "card.cleanup-progressed",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          operationId: "op-delete",
          kind: "deleting",
          stage: "cleanup-started",
          progressedAt: NOW,
        },
      }),
    );
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 9,
        type: "card.operation-failed",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          operationId: "op-delete",
          kind: "deleting",
          reason: "cleanup failed",
          failedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]).toMatchObject({
      position: { kind: "step", stepIndex: 0 },
      status: "paused",
      operation: {
        kind: "deleting",
        operationId: "op-delete",
        cleanupStage: "cleanup-started",
      },
      lastError: "cleanup failed",
    });
  }),
);

it.effect("projects advance and retry request operations for resume", () =>
  Effect.gen(function* () {
    let model = createEmptyReadModel(NOW);
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 1,
        type: "card.created",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          boardId: "board-1",
          projectId: "project-1",
          title: "Fix flaky test",
          parameters: {},
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );

    // Legacy request without operationId leaves the card idle.
    const before = model.cards[0];
    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 2,
        type: "card.step-advance-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          toStepIndex: 1,
          requestedAt: NOW,
        },
      }),
    );
    expect(model.cards[0]).toEqual(before);

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 3,
        type: "card.step-advance-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          toStepIndex: 1,
          requestedAt: NOW,
          operationId: "op-advance",
        },
      }),
    );
    expect(model.cards[0]?.operation).toMatchObject({
      kind: "advancing",
      operationId: "op-advance",
      toStepIndex: 1,
    });
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });

    model = yield* projectEvent(
      model,
      makeEvent({
        sequence: 4,
        type: "card.retry-requested",
        aggregateKind: "card",
        aggregateId: "card-1",
        payload: {
          cardId: "card-1",
          stepIndex: 0,
          requestedAt: NOW,
          operationId: "op-retry",
        },
      }),
    );
    expect(model.cards[0]?.operation).toMatchObject({
      kind: "retrying",
      operationId: "op-retry",
      stepIndex: 0,
    });
  }),
);
