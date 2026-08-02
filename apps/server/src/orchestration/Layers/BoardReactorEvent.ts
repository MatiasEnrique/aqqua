import type { CardId, CardOperationId, OrchestrationEvent, ThreadId } from "@aqqua/contracts";
import * as Context from "effect/Context";

import type { BoardReactorEvent } from "./BoardStepEntrySaga.ts";

/**
 * Test-only: when provided, processEvent dies for matching event types so
 * processEventSafely can exercise claim failure without real side-effect defects.
 */
export class BoardReactorHandlerDefectInjection extends Context.Service<
  BoardReactorHandlerDefectInjection,
  {
    readonly shouldFail: (event: { readonly type: string }) => boolean;
  }
>()("aqqua/orchestration/Layers/BoardReactorEvent/BoardReactorHandlerDefectInjection") {}

export function eventCardId(event: BoardReactorEvent): CardId | null {
  switch (event.type) {
    case "card.release-requested":
    case "card.step-advance-requested":
    case "card.retry-requested":
    case "card.cancel-requested":
    case "card.reset-requested":
    case "card.created":
    case "card.archived":
    case "card.delete-requested":
      return event.payload.cardId;
    default:
      return null;
  }
}

export function eventThreadId(event: BoardReactorEvent): ThreadId | null {
  switch (event.type) {
    case "thread.session-set":
    case "thread.activity-appended":
    case "thread.turn-interrupt-requested":
    case "thread.turn-start-requested":
      return event.payload.threadId;
    default:
      return null;
  }
}

export function eventOperationId(event: BoardReactorEvent): CardOperationId | undefined {
  switch (event.type) {
    case "card.release-requested":
    case "card.step-advance-requested":
    case "card.retry-requested":
    case "card.delete-requested":
      return event.payload.operationId;
    case "card.reset-requested":
      return event.payload.operationId;
    default:
      return undefined;
  }
}

export const isBoardReactorEvent = (event: OrchestrationEvent): event is BoardReactorEvent =>
  event.type === "card.release-requested" ||
  event.type === "card.step-advance-requested" ||
  event.type === "card.retry-requested" ||
  event.type === "card.cancel-requested" ||
  event.type === "card.reset-requested" ||
  event.type === "card.created" ||
  event.type === "card.archived" ||
  event.type === "card.delete-requested" ||
  event.type === "thread.session-set" ||
  event.type === "thread.activity-appended" ||
  event.type === "thread.turn-interrupt-requested" ||
  event.type === "thread.turn-start-requested";
