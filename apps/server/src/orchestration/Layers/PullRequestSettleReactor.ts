import { CommandId, ThreadId, type VcsStatusRemoteResult } from "@aqqua/contracts";
import { makeDrainableWorker } from "@aqqua/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
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

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionThreads = yield* ProjectionThreadRepository;
  const serverSettings = yield* ServerSettingsService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;

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

  const settleThreadSafely = (threadId: ThreadId, changeRequestNumber: number) =>
    settleThread(threadId, changeRequestNumber).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("pull request settle reactor could not settle thread", {
          threadId,
          changeRequestNumber,
          cause: Cause.pretty(cause),
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

  const worker = yield* makeDrainableWorker(processRemoteChangeSafely);

  const start: PullRequestSettleReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(vcsStatusBroadcaster.streamRemoteChanges, worker.enqueue),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies PullRequestSettleReactorShape;
});

export const PullRequestSettleReactorLive = Layer.effect(PullRequestSettleReactor, make);
