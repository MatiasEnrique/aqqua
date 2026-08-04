import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type VcsStatusRemoteResult,
} from "@aqqua/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../../persistence/Services/ProjectionThreads.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { PullRequestSettleReactor } from "../Services/PullRequestSettleReactor.ts";
import { PullRequestSettleReactorLive } from "./PullRequestSettleReactor.ts";

const OPEN_REMOTE: VcsStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: {
    number: 42,
    title: "Settle merged threads",
    url: "https://github.com/aqqua/aqqua/pull/42",
    baseRef: "main",
    headRef: "feature/settle-merged",
    state: "open",
  },
};

const MERGED_REMOTE: VcsStatusRemoteResult = {
  ...OPEN_REMOTE,
  pr: {
    ...OPEN_REMOTE.pr!,
    state: "merged",
  },
};

const makeThread = (): ProjectionThread => ({
  threadId: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  parentThreadId: null,
  title: "Thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/settle-merged",
  worktreePath: "/repo",
  latestTurnId: null,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  settledChangeRequestNumber: null,
  snoozedUntil: null,
  snoozedAt: null,
  latestUserMessageAt: null,
  pendingApprovalCount: 0,
  pendingUserInputCount: 0,
  hasActionableProposedPlan: 0,
  deletedAt: null,
});

interface HarnessOptions {
  readonly settingEnabled?: boolean;
  readonly rejectFirstDispatch?: boolean;
}

const withHarness = <A, E>(
  options: HarnessOptions,
  use: (harness: {
    readonly getThread: Effect.Effect<ProjectionThread>;
    readonly unsettleThread: Effect.Effect<void>;
    readonly dispatched: ReadonlyArray<OrchestrationCommand>;
    readonly logs: ReadonlyArray<ReadonlyArray<unknown>>;
    readonly publishAndDrain: (remote: VcsStatusRemoteResult | null) => Effect.Effect<void>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const remoteChanges = yield* PubSub.unbounded<{
        readonly cwd: string;
        readonly remote: VcsStatusRemoteResult | null;
      }>();
      let thread = makeThread();
      const dispatched: Array<OrchestrationCommand> = [];
      const logs: Array<ReadonlyArray<unknown>> = [];
      let rejectNextDispatch = options.rejectFirstDispatch ?? false;

      const logger = Logger.make<unknown, void>(({ message }) => {
        logs.push(message as ReadonlyArray<unknown>);
      });

      const projectionThreads = ProjectionThreadRepository.of({
        upsert: () => Effect.void,
        getById: ({ threadId }) =>
          Effect.succeed(thread.threadId === threadId ? Option.some(thread) : Option.none()),
        listByProjectId: () => Effect.succeed([thread]),
        listAll: Effect.sync(() => [thread]),
        deleteById: () => Effect.void,
      });

      const layer = PullRequestSettleReactorLive.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(
          ServerSettingsService.layerTest({
            autoSettleOnMergedChangeRequest: options.settingEnabled ?? true,
          }),
        ),
        Layer.provideMerge(Layer.succeed(ProjectionThreadRepository, projectionThreads)),
        Layer.provideMerge(
          Layer.succeed(
            VcsStatusBroadcaster,
            VcsStatusBroadcaster.of({
              getStatus: () => Effect.die("unused"),
              refreshLocalStatus: () => Effect.die("unused"),
              refreshStatus: () => Effect.die("unused"),
              streamStatus: () => Stream.empty,
              streamRemoteChanges: Stream.fromPubSub(remoteChanges),
            }),
          ),
        ),
        Layer.provideMerge(
          Layer.succeed(
            OrchestrationEngineService,
            OrchestrationEngineService.of({
              readEvents: () => Stream.empty,
              dispatch: (command) =>
                Effect.suspend(() => {
                  dispatched.push(command);
                  if (rejectNextDispatch) {
                    rejectNextDispatch = false;
                    return Effect.fail("thread has a queued turn start" as never);
                  }
                  if (command.type === "thread.settle" && command.trigger !== undefined) {
                    thread = {
                      ...thread,
                      settledOverride: "settled",
                      settledChangeRequestNumber: command.trigger.number,
                    };
                  }
                  return Effect.succeed({ sequence: dispatched.length });
                }),
              streamDomainEvents: Stream.empty,
              latestSequence: Effect.succeed(0),
            }),
          ),
        ),
        Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false })),
      );

      return yield* Effect.gen(function* () {
        const reactor = yield* PullRequestSettleReactor;
        yield* reactor.start();
        yield* Effect.yieldNow;

        return yield* use({
          getThread: Effect.sync(() => thread),
          unsettleThread: Effect.sync(() => {
            thread = {
              ...thread,
              settledOverride: "active",
              settledAt: null,
            };
          }),
          dispatched,
          logs,
          publishAndDrain: (remote) =>
            Effect.gen(function* () {
              yield* PubSub.publish(remoteChanges, { cwd: "/repo", remote });
              yield* Effect.forEach(Array.from({ length: 10 }), () => Effect.yieldNow, {
                discard: true,
              });
              yield* reactor.drain;
            }),
        });
      }).pipe(Effect.provide(layer));
    }),
  );

it.effect("settles once when an open pull request becomes merged", () =>
  withHarness({}, (harness) =>
    Effect.gen(function* () {
      yield* harness.publishAndDrain(OPEN_REMOTE);
      expect(harness.dispatched).toHaveLength(0);

      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(1);
      expect(harness.dispatched[0]).toMatchObject({
        type: "thread.settle",
        threadId: ThreadId.make("thread-1"),
        trigger: { kind: "merged-change-request", number: 42 },
      });

      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(1);
    }),
  ),
);

it.effect("retains the merge memo when a thread is manually un-settled", () =>
  withHarness({}, (harness) =>
    Effect.gen(function* () {
      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(1);

      yield* harness.unsettleThread;
      yield* harness.publishAndDrain(MERGED_REMOTE);

      expect((yield* harness.getThread).settledChangeRequestNumber).toBe(42);
      expect(harness.dispatched).toHaveLength(1);
    }),
  ),
);

it.effect("logs a queued-turn rejection and keeps processing later merged events", () =>
  withHarness({ rejectFirstDispatch: true }, (harness) =>
    Effect.gen(function* () {
      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(1);
      expect(
        harness.logs.some(
          (message) => message[0] === "pull request settle reactor could not settle thread",
        ),
      ).toBe(true);

      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(2);
      expect((yield* harness.getThread).settledChangeRequestNumber).toBe(42);
    }),
  ),
);

it.effect("does not settle when automatic merge settlement is disabled", () =>
  withHarness({ settingEnabled: false }, (harness) =>
    Effect.gen(function* () {
      yield* harness.publishAndDrain(MERGED_REMOTE);
      expect(harness.dispatched).toHaveLength(0);
      expect((yield* harness.getThread).settledChangeRequestNumber).toBeNull();
    }),
  ),
);
