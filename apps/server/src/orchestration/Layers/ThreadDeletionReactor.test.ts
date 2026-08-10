import { CommandId, EventId, ThreadId, type OrchestrationEvent } from "@aqqua/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import {
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "./ThreadDeletionReactor.ts";

const makeDeletedEvent = (
  threadId: ThreadId,
  options?: {
    readonly providerSubagent?: {
      readonly ownerThreadId: ThreadId;
      readonly provider: string;
      readonly childId: string;
    };
  },
): Extract<OrchestrationEvent, { type: "thread.deleted" }> => ({
  eventId: EventId.make(`event-deleted-${threadId}`),
  sequence: 1,
  type: "thread.deleted",
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: "2026-01-01T00:00:00.000Z",
  commandId: CommandId.make(`cmd-deleted-${threadId}`),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    threadId,
    deletedAt: "2026-01-01T00:00:00.000Z",
    ...(options?.providerSubagent
      ? {
          providerSubagent: {
            ownerThreadId: options.providerSubagent.ownerThreadId,
            provider: options.providerSubagent.provider as never,
            childId: options.providerSubagent.childId,
          },
        }
      : {}),
  },
});

const makeArchivedEvent = (
  threadId: ThreadId,
): Extract<OrchestrationEvent, { type: "thread.archived" }> => ({
  eventId: EventId.make("event-archived"),
  sequence: 1,
  type: "thread.archived",
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: "2026-01-01T00:00:00.000Z",
  commandId: CommandId.make("cmd-archived"),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    threadId,
    archivedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});

type HarnessOptions = {
  readonly failStopSession?: boolean;
};

const withThreadDeletionHarness = <A, E>(
  options: HarnessOptions,
  use: (harness: {
    readonly publish: (event: OrchestrationEvent) => Effect.Effect<boolean>;
    readonly awaitTerminalClosed: Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
    readonly stopSessionCalls: ReadonlyArray<{ readonly threadId: ThreadId }>;
    readonly closeCalls: ReadonlyArray<{
      readonly threadId: ThreadId;
      readonly deleteHistory?: boolean;
    }>;
  }) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const terminalClosed = yield* Deferred.make<void>();
      const stopSessionCalls: Array<{ readonly threadId: ThreadId }> = [];
      const closeCalls: Array<{
        readonly threadId: ThreadId;
        readonly deleteHistory?: boolean;
      }> = [];

      const layer = ThreadDeletionReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch: () => Effect.die("dispatch should not be called by ThreadDeletionReactor"),
            streamDomainEvents: Stream.fromPubSub(domainEvents),
            latestSequence: Effect.succeed(0),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderService, {
            startSession: () => Effect.die("unused"),
            sendTurn: () => Effect.die("unused"),
            interruptTurn: () => Effect.die("unused"),
            respondToRequest: () => Effect.die("unused"),
            respondToUserInput: () => Effect.die("unused"),
            stopSession: ((input: { readonly threadId: ThreadId }) => {
              stopSessionCalls.push(input);
              if (options.failStopSession) {
                return Effect.fail("simulated stop failure" as const);
              }
              return Effect.void;
            }) as never,
            listSessions: () => Effect.succeed([]),
            getCapabilities: () => Effect.die("unused"),
            getInstanceInfo: () => Effect.die("unused"),
            rollbackConversation: () => Effect.die("unused"),
            streamEvents: Stream.empty,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(TerminalManager.TerminalManager, {
            open: () => Effect.die("unused"),
            attachStream: () => Effect.die("unused"),
            write: () => Effect.void,
            resize: () => Effect.void,
            clear: () => Effect.void,
            restart: () => Effect.die("unused"),
            close: ((input: { readonly threadId: ThreadId; readonly deleteHistory?: boolean }) =>
              Effect.gen(function* () {
                closeCalls.push(input);
                yield* Deferred.succeed(terminalClosed, undefined);
              })) as never,
            subscribe: () => Effect.succeed(() => undefined),
            subscribeMetadata: () => Effect.succeed(() => undefined),
          } as TerminalManager.TerminalManager["Service"]),
        ),
      );

      return yield* Effect.gen(function* () {
        const reactor = yield* ThreadDeletionReactor;
        yield* reactor.start();
        // Let the scoped stream fiber subscribe before publishing domain events.
        yield* Effect.yieldNow;

        return yield* use({
          publish: (event) => PubSub.publish(domainEvents, event),
          awaitTerminalClosed: Deferred.await(terminalClosed),
          drain: reactor.drain,
          stopSessionCalls,
          closeCalls,
        });
      }).pipe(Effect.provide(layer));
    }),
  );

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it.effect("swallows ordinary cleanup failures", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        logCleanupCauseUnlessInterrupted({
          effect: Effect.fail("cleanup failed"),
          message: "thread deletion cleanup skipped provider session stop",
          threadId,
        }),
      );

      assert.isTrue(Exit.isSuccess(exit));
    }),
  );

  it.effect("preserves interrupt causes", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        logCleanupCauseUnlessInterrupted({
          effect: Effect.interrupt,
          message: "thread deletion cleanup skipped provider session stop",
          threadId,
        }),
      );

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
      }
    }),
  );
});

describe("ThreadDeletionReactorLive", () => {
  it.effect(
    "stops the provider session and closes terminals with history after thread.deleted",
    () =>
      withThreadDeletionHarness({}, (harness) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make("thread-deleted-cleanup");

          yield* harness.publish(makeDeletedEvent(threadId));
          yield* harness.awaitTerminalClosed;
          yield* harness.drain;

          expect(harness.stopSessionCalls).toEqual([{ threadId }]);
          expect(harness.closeCalls).toEqual([{ threadId, deleteHistory: true }]);
        }),
      ),
  );

  it.effect("continues terminal cleanup when provider session stop fails", () =>
    withThreadDeletionHarness({ failStopSession: true }, (harness) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("thread-deleted-stop-failure");

        yield* harness.publish(makeDeletedEvent(threadId));
        yield* harness.awaitTerminalClosed;
        yield* harness.drain;

        expect(harness.stopSessionCalls).toEqual([{ threadId }]);
        expect(harness.closeCalls).toEqual([{ threadId, deleteHistory: true }]);
      }),
    ),
  );

  it.effect("ignores non-deleted domain events", () =>
    withThreadDeletionHarness({}, (harness) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("thread-archived-ignored");

        yield* harness.publish(makeArchivedEvent(threadId));
        // archived events are not enqueued; yield so the stream consumer can
        // observe the event without waiting on drain or wall-clock sleep
        // (TestClock would freeze Effect.sleep).
        yield* Effect.forEach(Array.from({ length: 10 }), () => Effect.yieldNow, {
          discard: true,
        });

        expect(harness.stopSessionCalls).toEqual([]);
        expect(harness.closeCalls).toEqual([]);
      }),
    ),
  );

  it.effect("does not stop the owner provider session when deleting a native child", () =>
    withThreadDeletionHarness({}, (harness) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("thread-native-child-deleted");
        const ownerThreadId = ThreadId.make("thread-owner");

        yield* harness.publish(
          makeDeletedEvent(threadId, {
            providerSubagent: {
              ownerThreadId,
              provider: "codex",
              childId: "native-1",
            },
          }),
        );
        yield* harness.awaitTerminalClosed;
        yield* harness.drain;

        expect(harness.stopSessionCalls).toEqual([]);
        expect(harness.closeCalls).toEqual([{ threadId, deleteHistory: true }]);
      }),
    ),
  );
});
