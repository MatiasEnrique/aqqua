import type {
  AccountRateLimitsSnapshot,
  AccountUsageSnapshot,
  ProviderRuntimeEvent,
} from "@aqqua/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";

type AccountRateLimitsUpdatedEvent = Extract<
  ProviderRuntimeEvent,
  { type: "account.rate-limits.updated" }
>;

export class AccountRateLimits extends Context.Service<
  AccountRateLimits,
  {
    readonly latest: Effect.Effect<AccountUsageSnapshot>;
    readonly changes: Stream.Stream<AccountUsageSnapshot>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: AccountUsageSnapshot;
        readonly changes: Stream.Stream<AccountUsageSnapshot>;
      },
      never,
      Scope.Scope
    >;
    readonly ingest: (event: AccountRateLimitsUpdatedEvent) => Effect.Effect<void>;
    readonly report: (snapshot: AccountRateLimitsSnapshot) => Effect.Effect<void>;
    readonly seedCold: (snapshot: AccountRateLimitsSnapshot) => Effect.Effect<boolean>;
  }
>()("aqqua/usage/AccountRateLimits") {
  static readonly layer = Layer.effect(
    AccountRateLimits,
    Effect.gen(function* () {
      const state = yield* Ref.make<ReadonlyMap<string, AccountRateLimitsSnapshot>>(new Map());
      const updates = yield* PubSub.sliding<AccountUsageSnapshot>(8);
      const mutex = yield* Semaphore.make(1);
      const latest = Ref.get(state).pipe(
        Effect.map((snapshots) => ({ rateLimits: Array.from(snapshots.values()) })),
      );

      // Snapshots merge per window kind: providers report incrementally
      // (Claude sends one window per event, the OAuth fetcher sends full sets),
      // so an update replaces same-kind windows and keeps the rest. Tradeoff:
      // a window a provider stops reporting mid-run lingers until restart.
      const publishSnapshot = Effect.fn("AccountRateLimits.publishSnapshot")(function* (
        key: string,
        incoming: AccountRateLimitsSnapshot,
      ) {
        const current = yield* Ref.get(state);
        const previous = current.get(key);
        const incomingKinds = new Set(incoming.windows.map((window) => window.kind));
        const merged: AccountRateLimitsSnapshot = previous
          ? {
              ...incoming,
              planLabel: incoming.planLabel ?? previous.planLabel,
              credits: incoming.credits ?? previous.credits,
              // Status must track the newest report: Codex clears a reached
              // limit by sending null, which a fallback would mask forever.
              status: incoming.status,
              windows: [
                ...previous.windows.filter((window) => !incomingKinds.has(window.kind)),
                ...incoming.windows,
              ],
            }
          : incoming;
        if (previous && snapshotsSemanticallyEqual(previous, merged)) {
          return;
        }

        const next = new Map(current);
        next.set(key, merged);
        yield* Ref.set(state, next);
        yield* PubSub.publish(updates, {
          rateLimits: Array.from(next.values()),
        });
      });

      const ingest = Effect.fn("AccountRateLimits.ingest")(function* (
        event: AccountRateLimitsUpdatedEvent,
      ) {
        // Runtime events still permit a missing instance id during migration.
        // Driver kind is stable enough to provide one latest bucket for legacy emitters.
        const key = event.providerInstanceId ?? event.provider;
        yield* mutex.withPermits(1)(publishSnapshot(key, event.payload.rateLimits));
      });

      const report = Effect.fn("AccountRateLimits.report")(function* (
        snapshot: AccountRateLimitsSnapshot,
      ) {
        yield* mutex.withPermits(1)(publishSnapshot(snapshot.providerInstanceId, snapshot));
      });

      const seedCold = Effect.fn("AccountRateLimits.seedCold")(function* (
        snapshot: AccountRateLimitsSnapshot,
      ) {
        return yield* mutex.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* Ref.get(state);
            if (current.has(snapshot.providerInstanceId)) {
              return false;
            }

            const next = new Map(current);
            next.set(snapshot.providerInstanceId, snapshot);
            yield* Ref.set(state, next);
            yield* PubSub.publish(updates, {
              rateLimits: Array.from(next.values()),
            });
            return true;
          }),
        );
      });

      const subscribe = subscribeBeforeSnapshot(updates, latest, mutex);
      const changes = Stream.unwrap(Effect.map(subscribe, (subscription) => subscription.changes));

      return AccountRateLimits.of({
        latest,
        changes,
        subscribe,
        ingest,
        report,
        seedCold,
      });
    }),
  );
}

function snapshotsSemanticallyEqual(
  left: AccountRateLimitsSnapshot,
  right: AccountRateLimitsSnapshot,
): boolean {
  return (
    left.providerInstanceId === right.providerInstanceId &&
    left.provider === right.provider &&
    left.planLabel === right.planLabel &&
    left.status === right.status &&
    creditsEqual(left.credits, right.credits) &&
    left.windows.length === right.windows.length &&
    left.windows.every((window, index) => {
      const other = right.windows[index];
      return (
        other !== undefined &&
        window.kind === other.kind &&
        window.usedPercent === other.usedPercent &&
        window.resetsAt === other.resetsAt &&
        window.windowMinutes === other.windowMinutes
      );
    })
  );
}

function creditsEqual(
  left: AccountRateLimitsSnapshot["credits"],
  right: AccountRateLimitsSnapshot["credits"],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.balance === right.balance &&
    left.hasCredits === right.hasCredits &&
    left.unlimited === right.unlimited
  );
}
