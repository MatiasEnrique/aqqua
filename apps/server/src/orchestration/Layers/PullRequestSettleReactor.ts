import {
  CommandId,
  ThreadId,
  type OrchestrationEvent,
  type VcsStatusRemoteResult,
} from "@aqqua/contracts";
import { makeDrainableWorker } from "@aqqua/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PullRequestSettleReactor,
  type PullRequestSettleReactorShape,
} from "../Services/PullRequestSettleReactor.ts";

interface RemoteChange {
  readonly cwd: string;
  readonly remote: VcsStatusRemoteResult | null;
}

interface PendingSettlement {
  readonly changeRequestNumber: number;
  readonly attempts: number;
}

const MAX_SETTLEMENT_ATTEMPTS = 3;

type ThreadSessionSetEvent = Extract<OrchestrationEvent, { readonly type: "thread.session-set" }>;

const isSettlementRetrySignal = (event: OrchestrationEvent): event is ThreadSessionSetEvent =>
  event.type === "thread.session-set" &&
  event.payload.session.status !== "starting" &&
  event.payload.session.status !== "running";

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionThreads = yield* ProjectionThreadRepository;
  const serverSettings = yield* ServerSettingsService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const pendingSettlements = yield* Ref.make(new Map<ThreadId, PendingSettlement>());

  const normalizeCwd = (cwd: string) => fs.realPath(cwd).pipe(Effect.orElseSucceed(() => cwd));

  const settleThread = Effect.fn("PullRequestSettleReactor.settleThread")(function* (
    threadId: ThreadId,
    changeRequestNumber: number,
  ) {
    const uuid = yield* crypto.randomUUIDv4;
    yield* orchestrationEngine.dispatch({
      type: "thread.settle",
      commandId: CommandId.make(`server:pull-request-settle:${uuid}`),
      threadId,
      trigger: {
        kind: "merged-change-request",
        number: changeRequestNumber,
      },
    });
  });

  const clearPendingSettlement = (threadId: ThreadId) =>
    Ref.update(pendingSettlements, (current) => {
      if (!current.has(threadId)) return current;
      const next = new Map(current);
      next.delete(threadId);
      return next;
    });

  const settleThreadSafely = (threadId: ThreadId, changeRequestNumber: number) =>
    settleThread(threadId, changeRequestNumber).pipe(
      Effect.tap(() => clearPendingSettlement(threadId)),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.gen(function* () {
          const retry = yield* Ref.modify(pendingSettlements, (current) => {
            const previous = current.get(threadId);
            const attempts =
              previous?.changeRequestNumber === changeRequestNumber ? previous.attempts + 1 : 1;
            const next = new Map(current);
            if (attempts < MAX_SETTLEMENT_ATTEMPTS) {
              next.set(threadId, { changeRequestNumber, attempts });
            } else {
              next.delete(threadId);
            }
            return [{ attempts, willRetry: attempts < MAX_SETTLEMENT_ATTEMPTS }, next] as const;
          });
          yield* Effect.logWarning("pull request settle reactor could not settle thread", {
            threadId,
            changeRequestNumber,
            attempt: retry.attempts,
            willRetry: retry.willRetry,
            cause: Cause.pretty(cause),
          });
        });
      }),
    );

  const processRemoteChange = Effect.fn("PullRequestSettleReactor.processRemoteChange")(function* ({
    cwd,
    remote,
  }: RemoteChange) {
    const pullRequest = remote?.pr;
    if (pullRequest?.state !== "merged") {
      return;
    }

    const settings = yield* serverSettings.getSettings;
    if (!settings.autoSettleOnMergedChangeRequest) {
      return;
    }

    const threads = yield* projectionThreads.listAll;
    for (const thread of threads) {
      if (
        thread.worktreePath === null ||
        thread.deletedAt !== null ||
        thread.archivedAt !== null ||
        thread.settledOverride === "settled" ||
        thread.settledOverride === "active" ||
        (thread.settledChangeRequestNumber ?? null) === pullRequest.number
      ) {
        continue;
      }
      const worktreePath = yield* normalizeCwd(thread.worktreePath);
      if (worktreePath !== cwd) {
        continue;
      }
      yield* settleThreadSafely(thread.threadId, pullRequest.number);
    }
  });

  const processRemoteChangeSafely = (change: RemoteChange) =>
    processRemoteChange(change).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("pull request settle reactor failed to process remote status", {
          cwd: change.cwd,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const processDomainEvent = Effect.fn("PullRequestSettleReactor.processDomainEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (!isSettlementRetrySignal(event)) return;

    const pending = (yield* Ref.get(pendingSettlements)).get(event.payload.threadId);
    if (!pending) return;

    const thread = yield* projectionThreads.getById({ threadId: event.payload.threadId });
    const settings = yield* serverSettings.getSettings;
    if (
      Option.isNone(thread) ||
      !settings.autoSettleOnMergedChangeRequest ||
      thread.value.deletedAt !== null ||
      thread.value.archivedAt !== null ||
      thread.value.settledOverride === "settled" ||
      thread.value.settledOverride === "active" ||
      (thread.value.settledChangeRequestNumber ?? null) === pending.changeRequestNumber
    ) {
      yield* clearPendingSettlement(event.payload.threadId);
      return;
    }

    yield* settleThreadSafely(event.payload.threadId, pending.changeRequestNumber);
  });

  const processDomainEventSafely = (event: OrchestrationEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("pull request settle reactor failed to process retry signal", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processRemoteChangeSafely);
  const retryWorker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: PullRequestSettleReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(vcsStatusBroadcaster.streamRemoteChanges, worker.enqueue),
    );
    yield* Effect.forkScoped(
      orchestrationEngine.streamDomainEvents.pipe(
        Stream.filter(isSettlementRetrySignal),
        Stream.runForEach(retryWorker.enqueue),
      ),
    );
  });

  return {
    start,
    drain: Effect.all([worker.drain, retryWorker.drain], { discard: true }),
  } satisfies PullRequestSettleReactorShape;
});

export const PullRequestSettleReactorLive = Layer.effect(PullRequestSettleReactor, make);
