import { EventId, type OrchestrationCard, type OrchestrationEvent } from "@aqqua/contracts";

import type { BoardReactorEvent } from "./BoardReactorEvent.ts";
import { currentStepRootThreadId } from "./BoardReactorState.ts";

/**
 * Rebuilds the hot events for durable in-flight operations after restart.
 * Handlers re-check operation id and kind before performing side effects.
 */
export function makeBoardReconciliationEvents(
  cards: ReadonlyArray<OrchestrationCard>,
): ReadonlyArray<BoardReactorEvent> {
  const events: BoardReactorEvent[] = [];
  for (const card of cards) {
    // Historical archive receipts may predate operation clearing. An already
    // archived card is final and must never resume stale cleanup metadata.
    if (card.archivedAt !== null) {
      continue;
    }
    const operation = card.operation;
    if (operation === null) {
      // Legacy status:deleting without a durable claim.
      if (card.status === "deleting") {
        events.push({
          type: "card.delete-requested",
          eventId: EventId.make(`board-reconcile-delete-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: card.updatedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            requestedAt: card.updatedAt,
          },
        } as BoardReactorEvent);
      }
      continue;
    }

    switch (operation.kind) {
      case "starting":
        events.push({
          type: "card.release-requested",
          eventId: EventId.make(`board-reconcile-start-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: operation.requestedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            snapshot: card.snapshot ?? { name: "board", steps: [] },
            requestedAt: operation.requestedAt,
            operationId: operation.operationId,
          },
        } as BoardReactorEvent);
        break;
      case "advancing":
        events.push({
          type: "card.step-advance-requested",
          eventId: EventId.make(`board-reconcile-advance-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: operation.requestedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            toStepIndex: operation.toStepIndex,
            requestedAt: operation.requestedAt,
            operationId: operation.operationId,
          },
        } as BoardReactorEvent);
        break;
      case "retrying":
        events.push({
          type: "card.retry-requested",
          eventId: EventId.make(`board-reconcile-retry-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: operation.requestedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            stepIndex: operation.stepIndex,
            requestedAt: operation.requestedAt,
            operationId: operation.operationId,
          },
        } as BoardReactorEvent);
        break;
      case "resetting":
        events.push({
          type: "card.reset-requested",
          eventId: EventId.make(`board-reconcile-reset-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: operation.requestedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            operationId: operation.operationId,
            activeThreadId: operation.activeThreadId,
            threadIds: operation.threadIds,
            requestedAt: operation.requestedAt,
          },
        } as BoardReactorEvent);
        break;
      case "deleting":
        events.push({
          type: "card.delete-requested",
          eventId: EventId.make(`board-reconcile-delete-op-${card.id}`),
          aggregateKind: "card",
          aggregateId: card.id,
          sequence: 0,
          occurredAt: operation.requestedAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            cardId: card.id,
            requestedAt: operation.requestedAt,
            operationId: operation.operationId,
            purpose: operation.purpose ?? "delete",
            deleteWorktree: operation.deleteWorktree ?? true,
          },
        } as BoardReactorEvent);
        break;
    }
  }
  return events;
}

export function makeBoardMissingCurrentRootRecoveryEvents(
  cards: ReadonlyArray<OrchestrationCard>,
  knownThreadIds: ReadonlySet<string>,
): ReadonlyArray<Extract<OrchestrationEvent, { type: "thread.deleted" }>> {
  const events: Array<Extract<OrchestrationEvent, { type: "thread.deleted" }>> = [];
  for (const card of cards) {
    if (card.archivedAt !== null) {
      continue;
    }
    if (card.operation !== null) {
      continue;
    }
    if (card.status === "deleting") {
      continue;
    }
    if (card.status === "failed") {
      continue;
    }
    const root = currentStepRootThreadId(card);
    if (root === null) {
      continue;
    }
    if (knownThreadIds.has(String(root))) {
      continue;
    }
    events.push({
      type: "thread.deleted",
      eventId: EventId.make(`board-reconcile-missing-root-${card.id}`),
      aggregateKind: "thread",
      aggregateId: root,
      sequence: 0,
      occurredAt: card.updatedAt,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: root,
        deletedAt: card.updatedAt,
      },
    });
  }
  return events;
}
