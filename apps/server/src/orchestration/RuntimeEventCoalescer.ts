import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

const DEFAULT_WINDOW = Duration.millis(250);

type TransientEvent = Extract<
  ProviderRuntimeEvent,
  {
    readonly type: "item.updated" | "task.progress" | "thread.token-usage.updated";
  }
>;

interface SequencedEvent {
  readonly event: TransientEvent;
  readonly sequence: number;
}

interface PendingEntry {
  readonly key: string;
  readonly threadId: string;
  readonly turnId: string | undefined;
  latest: SequencedEvent | undefined;
  timer: Fiber.Fiber<void, never> | undefined;
}

export interface RuntimeEventCoalescer {
  readonly offer: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

interface RuntimeEventCoalescerOptions {
  readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly drainDownstream: Effect.Effect<void>;
  readonly window?: Duration.Duration;
}

function itemKey(event: {
  readonly threadId: string;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
}): string | undefined {
  return event.itemId === undefined
    ? undefined
    : `item\u0000${event.threadId}\u0000${event.turnId ?? ""}\u0000${event.itemId}`;
}

function taskKey(event: {
  readonly threadId: string;
  readonly turnId?: string | undefined;
  readonly payload: { readonly taskId: string };
}): string {
  return `task\u0000${event.threadId}\u0000${event.turnId ?? ""}\u0000${event.payload.taskId}`;
}

function transientInput(
  event: ProviderRuntimeEvent,
): { readonly event: TransientEvent; readonly key: string } | undefined {
  switch (event.type) {
    case "item.updated": {
      const key = itemKey(event);
      return key === undefined ? undefined : { event, key };
    }
    case "task.progress":
      return { event, key: taskKey(event) };
    case "thread.token-usage.updated":
      return {
        event,
        key: `context\u0000${event.threadId}\u0000${event.turnId ?? ""}`,
      };
    default:
      return undefined;
  }
}

function flushPredicate(
  event: ProviderRuntimeEvent,
): ((entry: PendingEntry) => boolean) | undefined {
  switch (event.type) {
    case "item.completed": {
      const key = itemKey(event);
      return key === undefined ? undefined : (entry) => entry.key === key;
    }
    case "task.completed": {
      const key = taskKey(event);
      return (entry) => entry.key === key;
    }
    case "turn.completed":
    case "turn.aborted":
      return (entry) => entry.threadId === event.threadId && entry.turnId === event.turnId;
    case "session.exited":
      return (entry) => entry.threadId === event.threadId;
    case "session.state.changed":
      return event.payload.state === "stopped" || event.payload.state === "error"
        ? (entry) => entry.threadId === event.threadId
        : undefined;
    default:
      return undefined;
  }
}

export const makeRuntimeEventCoalescer = (
  options: RuntimeEventCoalescerOptions,
): Effect.Effect<RuntimeEventCoalescer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const window = options.window ?? DEFAULT_WINDOW;
    const scope = yield* Scope.Scope;
    const mutex = yield* Semaphore.make(1);
    const emitMutex = yield* Semaphore.make(1);
    const entries = new Map<string, PendingEntry>();
    let nextSequence = 0;

    const takePending = (predicate: (entry: PendingEntry) => boolean) =>
      mutex.withPermits(1)(
        Effect.sync(() => {
          const pending: SequencedEvent[] = [];
          const timers: Fiber.Fiber<void, never>[] = [];
          for (const [key, entry] of entries) {
            if (!predicate(entry)) continue;
            entries.delete(key);
            if (entry.latest !== undefined) pending.push(entry.latest);
            if (entry.timer !== undefined) timers.push(entry.timer);
          }
          pending.sort((left, right) => left.sequence - right.sequence);
          return { pending, timers };
        }),
      );

    const emitPending = (predicate: (entry: PendingEntry) => boolean) =>
      Effect.gen(function* () {
        const { pending, timers } = yield* takePending(predicate);
        yield* Effect.forEach(pending, ({ event }) => options.emit(event), {
          discard: true,
        });
        return timers;
      });

    function scheduleTimer(key: string, entry: PendingEntry): Effect.Effect<void> {
      return Effect.gen(function* () {
        const fiber = yield* Effect.sleep(window).pipe(
          Effect.andThen(flushTimer(key, entry)),
          Effect.forkIn(scope),
        );
        const retained = yield* mutex.withPermits(1)(
          Effect.sync(() => {
            if (entries.get(key) !== entry) return false;
            entry.timer = fiber;
            return true;
          }),
        );
        if (!retained) {
          yield* Fiber.interrupt(fiber);
        }
      });
    }

    function flushTimer(key: string, entry: PendingEntry): Effect.Effect<void> {
      return emitMutex.withPermits(1)(
        Effect.gen(function* () {
          const pending = yield* mutex.withPermits(1)(
            Effect.sync(() => {
              if (entries.get(key) !== entry) return undefined;
              entry.timer = undefined;
              if (entry.latest === undefined) {
                entries.delete(key);
                return undefined;
              }
              const latest = entry.latest;
              entry.latest = undefined;
              return latest;
            }),
          );
          if (pending === undefined) return;
          yield* options.emit(pending.event);
          yield* scheduleTimer(key, entry);
        }),
      );
    }

    const offerTransient = (event: TransientEvent, key: string) =>
      Effect.gen(function* () {
        const sequence = nextSequence++;
        const action = yield* mutex.withPermits(1)(
          Effect.sync(() => {
            const existing = entries.get(key);
            if (existing !== undefined) {
              existing.latest = { event, sequence };
              return undefined;
            }
            const entry: PendingEntry = {
              key,
              threadId: event.threadId,
              turnId: event.turnId,
              latest: undefined,
              timer: undefined,
            };
            entries.set(key, entry);
            return entry;
          }),
        );
        if (action === undefined) return;
        yield* options.emit(event);
        yield* scheduleTimer(key, action);
      });

    const offer: RuntimeEventCoalescer["offer"] = (event) =>
      Effect.gen(function* () {
        const timers = yield* emitMutex.withPermits(1)(
          Effect.gen(function* () {
            const transient = transientInput(event);
            if (transient !== undefined) {
              yield* offerTransient(transient.event, transient.key);
              return [];
            }
            const predicate = flushPredicate(event);
            const timers = predicate === undefined ? [] : yield* emitPending(predicate);
            yield* options.emit(event);
            return timers;
          }),
        );
        yield* Effect.forEach(timers, Fiber.interrupt, { discard: true });
      });

    const drain = Effect.gen(function* () {
      const timers = yield* emitMutex.withPermits(1)(
        Effect.gen(function* () {
          const timers = yield* emitPending(() => true);
          yield* options.drainDownstream;
          return timers;
        }),
      );
      yield* Effect.forEach(timers, Fiber.interrupt, { discard: true });
    });
    yield* Effect.addFinalizer(() => drain.pipe(Effect.ignore));

    return { offer, drain } satisfies RuntimeEventCoalescer;
  });
