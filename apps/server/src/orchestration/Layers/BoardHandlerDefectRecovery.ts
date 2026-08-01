import { CommandId, type OrchestrationCard } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { eventCardId, eventOperationId, eventThreadId } from "./BoardReactorEvent.ts";
import {
  cardOperationOwnsThreadForHandlerFailure,
  type ThreadLineageMember,
} from "./BoardReactorState.ts";
import type { BoardReactorEvent } from "./BoardStepEntrySaga.ts";

export const makeBoardHandlerDefectRecovery = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:board:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command);

  const listCards = Effect.fn("BoardHandlerDefectRecovery.listCards")(function* () {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    return shell.cards;
  });

  const loadAllThreadShells = Effect.fn("BoardHandlerDefectRecovery.loadAllThreadShells")(
    function* () {
      const [live, archived] = yield* Effect.all([
        projectionSnapshotQuery.getShellSnapshot(),
        projectionSnapshotQuery.getArchivedShellSnapshot(),
      ]);
      return [...live.threads, ...archived.threads].map(
        (thread) =>
          ({
            id: thread.id,
            parentThreadId: thread.parentThreadId ?? null,
            session: thread.session,
            archivedAt: thread.archivedAt,
          }) satisfies ThreadLineageMember,
      );
    },
  );

  const failCardOperation = Effect.fn("BoardHandlerDefectRecovery.failCardOperation")(function* (
    card: OrchestrationCard,
    reason: string,
  ) {
    const operation = card.operation;
    if (operation === null) return;
    yield* dispatch({
      type: "card.operation.fail",
      commandId: yield* serverCommandId("operation-fail"),
      cardId: card.id,
      operationId: operation.operationId,
      kind: operation.kind,
      reason,
    });
  });

  const failMatchingClaimsAfterHandlerDefect = Effect.fn(
    "BoardReactor.failMatchingClaimsAfterHandlerDefect",
  )(function* (event: BoardReactorEvent, cause: Cause.Cause<unknown>) {
    const reason = `Board reactor failed while handling '${event.type}': ${Cause.pretty(cause)}`;
    const cardsToFail: OrchestrationCard[] = [];

    const directCardId = eventCardId(event);
    if (directCardId !== null) {
      const cardOption = yield* projectionSnapshotQuery
        .getCardById(directCardId)
        .pipe(Effect.catchCause(() => Effect.succeed(Option.none())));
      if (Option.isSome(cardOption) && cardOption.value.operation !== null) {
        const expectedOperationId = eventOperationId(event);
        // Never clear a newer claim that replaced the event's operation.
        if (
          expectedOperationId === undefined ||
          cardOption.value.operation.operationId === expectedOperationId
        ) {
          cardsToFail.push(cardOption.value);
        }
      }
    } else {
      const threadId = eventThreadId(event);
      if (threadId !== null) {
        const cards = yield* listCards().pipe(Effect.catchCause(() => Effect.succeed([])));
        const allThreads = yield* loadAllThreadShells().pipe(
          Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<ThreadLineageMember>)),
        );
        for (const card of cards) {
          if (
            cardOperationOwnsThreadForHandlerFailure({
              card,
              threadId,
              allThreads,
            })
          ) {
            cardsToFail.push(card);
          }
        }
      }
    }

    for (const card of cardsToFail) {
      const operationId = card.operation?.operationId;
      yield* failCardOperation(card, reason).pipe(
        Effect.catchCause((failCause) =>
          Effect.logWarning(
            "board reactor could not persist operation failure after handler error",
            {
              eventType: event.type,
              cardId: card.id,
              operationId,
              handlerCause: Cause.pretty(cause),
              failCause: Cause.pretty(failCause),
            },
          ),
        ),
      );
    }
  });

  return failMatchingClaimsAfterHandlerDefect;
});
