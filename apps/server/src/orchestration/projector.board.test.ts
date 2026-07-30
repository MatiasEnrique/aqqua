import {
  BoardId,
  BoardStepId,
  CardId,
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type BoardStep,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
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
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });
    expect(model.cards[0]?.snapshot?.name).toBe("Delivery");

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
        },
      }),
    );
    expect(model.cards[0]?.branch).toBe("card/card-1");
    expect(model.cards[0]?.releasedAt).toBe(NOW);
    expect(model.cards[0]?.position).toEqual({ kind: "todo" });

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
        },
      }),
    );
    expect(model.cards[0]?.position).toEqual({ kind: "step", stepIndex: 0 });
    expect(model.cards[0]?.status).toBe("running");
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
  }),
);

it.effect("ignores reactor signal events for card projection fields", () =>
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
    expect(model.snapshotSequence).toBe(2);
  }),
);
