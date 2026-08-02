import {
  EventId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import { makeRuntimeEventCoalescer } from "./RuntimeEventCoalescer.ts";

const provider = ProviderDriverKind.make("codex");
const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const now = "2026-07-30T12:00:00.000Z";

function itemUpdated(index: number, itemId = "item-1"): ProviderRuntimeEvent {
  return {
    type: "item.updated",
    eventId: EventId.make(`item-updated-${index}`),
    provider,
    threadId,
    turnId,
    itemId: RuntimeItemId.make(itemId),
    createdAt: now,
    payload: {
      itemType: "command_execution",
      status: "inProgress",
      detail: `update ${index}`,
    },
  };
}

function itemCompleted(itemId = "item-1"): ProviderRuntimeEvent {
  return {
    type: "item.completed",
    eventId: EventId.make("item-completed"),
    provider,
    threadId,
    turnId,
    itemId: RuntimeItemId.make(itemId),
    createdAt: now,
    payload: {
      itemType: "command_execution",
      status: "completed",
      detail: "done",
    },
  };
}

function taskProgress(index: number, taskId = "task-1"): ProviderRuntimeEvent {
  return {
    type: "task.progress",
    eventId: EventId.make(`task-progress-${index}`),
    provider,
    threadId,
    turnId,
    createdAt: now,
    payload: {
      taskId: RuntimeTaskId.make(taskId),
      description: `progress ${index}`,
    },
  };
}

function runtimeError(): ProviderRuntimeEvent {
  return {
    type: "runtime.error",
    eventId: EventId.make("runtime-error"),
    provider,
    threadId,
    turnId,
    createdAt: now,
    payload: {
      message: "boom",
    },
  };
}

describe("RuntimeEventCoalescer", () => {
  it.effect("emits the leading update immediately and only the latest trailing update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) => Effect.sync(() => emitted.push(event)).pipe(Effect.asVoid),
          drainDownstream: Effect.void,
        });

        yield* coalescer.offer(itemUpdated(1));
        yield* coalescer.offer(itemUpdated(2));
        yield* coalescer.offer(itemUpdated(3));

        expect(emitted.map((event) => event.eventId)).toEqual(["item-updated-1"]);

        yield* TestClock.adjust("250 millis");
        yield* Effect.yieldNow;

        expect(emitted.map((event) => event.eventId)).toEqual(["item-updated-1", "item-updated-3"]);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestClock.layer()))),
  );

  it.effect("flushes a pending update before its terminal event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) => Effect.sync(() => emitted.push(event)).pipe(Effect.asVoid),
          drainDownstream: Effect.void,
        });

        yield* coalescer.offer(itemUpdated(1));
        yield* coalescer.offer(itemUpdated(2));
        yield* coalescer.offer(itemCompleted());

        expect(emitted.map((event) => event.eventId)).toEqual([
          "item-updated-1",
          "item-updated-2",
          "item-completed",
        ]);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestClock.layer()))),
  );

  it.live("serializes terminal events and drain behind an in-flight trailing update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const trailingStarted = yield* Deferred.make<void>();
        const releaseTrailing = yield* Deferred.make<void>();
        let downstreamDrained = false;
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) =>
            Effect.gen(function* () {
              if (event.eventId === "item-updated-2") {
                yield* Deferred.succeed(trailingStarted, undefined);
                yield* Deferred.await(releaseTrailing);
              }
              emitted.push(event);
            }),
          drainDownstream: Effect.sync(() => {
            downstreamDrained = true;
          }),
          window: Duration.hours(1),
        });

        yield* coalescer.offer(itemUpdated(1));
        yield* coalescer.offer(itemUpdated(2));
        const coordinateTerminal = Effect.gen(function* () {
          yield* Deferred.await(trailingStarted);
          yield* Effect.all(
            [
              coalescer.offer(itemCompleted()),
              Effect.gen(function* () {
                yield* Effect.yieldNow;
                expect(downstreamDrained).toBe(false);
                expect(emitted.map((event) => event.eventId)).toEqual(["item-updated-1"]);
                yield* Deferred.succeed(releaseTrailing, undefined);
              }),
            ],
            { concurrency: "unbounded", discard: true },
          );
        });

        yield* Effect.all([coalescer.drain, coordinateTerminal], {
          concurrency: "unbounded",
          discard: true,
        });

        expect(emitted.map((event) => event.eventId)).toEqual([
          "item-updated-1",
          "item-updated-2",
          "item-completed",
        ]);
        expect(downstreamDrained).toBe(true);
      }),
    ),
  );

  it.effect("keeps independent transient keys and critical events independent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) => Effect.sync(() => emitted.push(event)).pipe(Effect.asVoid),
          drainDownstream: Effect.void,
        });

        yield* coalescer.offer(itemUpdated(1));
        yield* coalescer.offer(itemUpdated(2));
        yield* coalescer.offer(taskProgress(1));
        yield* coalescer.offer(taskProgress(2));
        yield* coalescer.offer(runtimeError());

        expect(emitted.map((event) => event.eventId)).toEqual([
          "item-updated-1",
          "task-progress-1",
          "runtime-error",
        ]);

        yield* coalescer.drain;

        expect(emitted.map((event) => event.eventId)).toEqual([
          "item-updated-1",
          "task-progress-1",
          "runtime-error",
          "item-updated-2",
          "task-progress-2",
        ]);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestClock.layer()))),
  );

  it.effect("bypasses item-update coalescing when the provider omitted itemId", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) => Effect.sync(() => emitted.push(event)).pipe(Effect.asVoid),
          drainDownstream: Effect.void,
        });
        const { itemId: _firstItemId, ...first } = itemUpdated(1);
        const { itemId: _secondItemId, ...second } = itemUpdated(2);

        yield* coalescer.offer(first);
        yield* coalescer.offer(second);

        expect(emitted.map((event) => event.eventId)).toEqual(["item-updated-1", "item-updated-2"]);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestClock.layer()))),
  );

  it.effect("bounds a deterministic ten-session workload per logical key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emitted: ProviderRuntimeEvent[] = [];
        const coalescer = yield* makeRuntimeEventCoalescer({
          emit: (event) => Effect.sync(() => emitted.push(event)).pipe(Effect.asVoid),
          drainDownstream: Effect.void,
        });
        const sessionCount = 10;

        for (let step = 0; step < 100; step += 1) {
          for (let session = 0; session < sessionCount; session += 1) {
            yield* coalescer.offer({
              ...itemUpdated(step, `item-${session}`),
              eventId: EventId.make(`item-updated-${session}-${step}`),
              threadId: ThreadId.make(`thread-${session}`),
              turnId: TurnId.make(`turn-${session}`),
            });
          }
          yield* TestClock.adjust("10 millis");
          yield* Effect.yieldNow;
        }

        for (let session = 0; session < sessionCount; session += 1) {
          yield* coalescer.offer({
            ...itemCompleted(`item-${session}`),
            eventId: EventId.make(`item-completed-${session}`),
            threadId: ThreadId.make(`thread-${session}`),
            turnId: TurnId.make(`turn-${session}`),
          });
        }
        yield* coalescer.drain;

        const acceptedPerThread = Array.from(
          { length: sessionCount },
          (_unused, session) =>
            emitted.filter((event) => event.threadId === `thread-${session}`).length,
        );
        const acceptedForFirstThread = acceptedPerThread[0] ?? 0;
        expect(new Set(acceptedPerThread).size).toBe(1);
        expect(acceptedForFirstThread).toBeLessThanOrEqual(6);
        expect(emitted.length).toBe(acceptedForFirstThread * sessionCount);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestClock.layer()))),
  );
});
