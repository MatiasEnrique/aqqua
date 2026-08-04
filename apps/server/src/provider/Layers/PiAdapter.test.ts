// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  PiSettings,
  type ProviderRuntimeEvent,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@aqqua/contracts";

import { ServerConfig } from "../../config.ts";
import type { PiAdapterShape } from "../Services/PiAdapter.ts";
import { makePiRpcMockPeer, type PiRpcMockPeer } from "../testUtils/piRpcMockPeer.ts";
import { makePiAdapter, type PiAdapterLiveOptions } from "./PiAdapter.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const instanceId = ProviderInstanceId.make("pi");
const stats = {
  sessionFile: "/sessions/current.jsonl",
  sessionId: "session-1",
  userMessages: 0,
  assistantMessages: 0,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 0,
  tokens: {
    input: 11,
    output: 7,
    cacheRead: 3,
    cacheWrite: 2,
    total: 23,
  },
  cost: 0,
  contextUsage: {
    tokens: 23,
    contextWindow: 200_000,
    percent: 0.0115,
  },
} as const;

const adapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "aqqua-pi-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (
  peer: PiRpcMockPeer,
  settings: Partial<PiSettings> = {},
  options?: PiAdapterLiveOptions,
  spawnerLayer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> = peer.layer,
) =>
  makePiAdapter(decodePiSettings(settings), options).pipe(
    Effect.provide(Layer.merge(adapterTestLayer, spawnerLayer)),
    Effect.orDie,
  );

function capturingSpawnerLayer(
  peer: PiRpcMockPeer,
  capture: (command: ChildProcess.Command) => void,
) {
  return Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const delegate = yield* ChildProcessSpawner.ChildProcessSpawner;
      return ChildProcessSpawner.make((command) =>
        Effect.sync(() => capture(command)).pipe(Effect.andThen(delegate.spawn(command))),
      );
    }),
  ).pipe(Layer.provide(peer.layer));
}

const startSession = Effect.fn("startPiTestSession")(function* (input: {
  readonly adapter: PiAdapterShape;
  readonly peer: PiRpcMockPeer;
  readonly threadId: ThreadId;
  readonly runtimeMode?: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
  readonly resumeCursor?: unknown;
  readonly modelSelection?: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
    readonly options?: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>;
  };
}) {
  const sessionFiber = yield* input.adapter
    .startSession({
      threadId: input.threadId,
      provider: ProviderDriverKind.make("pi"),
      cwd: process.cwd(),
      runtimeMode: input.runtimeMode ?? "full-access",
      ...(input.resumeCursor === undefined ? {} : { resumeCursor: input.resumeCursor }),
      ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
    })
    .pipe(Effect.forkChild);

  while (true) {
    const command = yield* input.peer.takeCommand;
    if (command.type === "get_session_stats") {
      yield* input.peer.respond(command, stats);
      break;
    }
    yield* input.peer.respond(command, {});
  }
  return yield* Fiber.join(sessionFiber);
});

const collectEvents = Effect.fn("collectPiTestEvents")(function* (
  stream: Stream.Stream<ProviderRuntimeEvent>,
) {
  const events: Array<ProviderRuntimeEvent> = [];
  const completed = yield* Deferred.make<void>();
  const waiters: Array<{
    predicate: (events: ReadonlyArray<ProviderRuntimeEvent>) => boolean;
    deferred: Deferred.Deferred<void>;
  }> = [];
  const fiber = yield* stream.pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        events.push(event);
        if (event.type === "turn.completed") {
          yield* Deferred.succeed(completed, undefined).pipe(Effect.ignore);
        }
        const satisfied = waiters.filter((waiter) => waiter.predicate(events));
        for (const waiter of satisfied) {
          waiters.splice(waiters.indexOf(waiter), 1);
          yield* Deferred.succeed(waiter.deferred, undefined).pipe(Effect.ignore);
        }
      }),
    ),
    Effect.forkChild,
  );
  // Deterministic drain: resolves as soon as the collector has seen events
  // satisfying the predicate, instead of counting scheduler yields.
  const waitUntil = (predicate: (events: ReadonlyArray<ProviderRuntimeEvent>) => boolean) =>
    Effect.gen(function* () {
      if (predicate(events)) return;
      const deferred = yield* Deferred.make<void>();
      waiters.push({ predicate, deferred });
      yield* Deferred.await(deferred);
    });
  yield* Effect.yieldNow;
  return { events, completed, fiber, waitUntil } as const;
});

describe("PiAdapter", () => {
  it.effect("streams indexed assistant text and settles only on agent_settled", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer, {}, undefined, peer.layer);
      const threadId = ThreadId.make("pi-streaming-text");
      const collected = yield* collectEvents(adapter.streamEvents);
      const session = yield* startSession({ adapter, peer, threadId });

      assert.deepEqual(session.resumeCursor, {
        version: 1,
        sessionFile: "/sessions/current.jsonl",
      });

      const sendFiber = yield* adapter
        .sendTurn({ threadId, input: "stream", attachments: [] })
        .pipe(Effect.forkChild);
      const prompt = yield* peer.takeCommand;
      assert.equal(prompt.type, "prompt");
      yield* peer.respond(prompt, {});
      const result = yield* Fiber.join(sendFiber);

      yield* peer.writeRecord({ type: "agent_start" });
      yield* peer.writeRecord({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_start", contentIndex: 0 },
      });
      yield* peer.writeRecord({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel" },
      });
      yield* peer.writeRecord({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_start", contentIndex: 1 },
      });
      yield* peer.writeRecord({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: " world" },
      });
      yield* collected.waitUntil(
        (events) => events.filter((event) => event.type === "content.delta").length >= 2,
      );
      assert.deepEqual(
        collected.events
          .filter(
            (event): event is Extract<ProviderRuntimeEvent, { type: "content.delta" }> =>
              event.type === "content.delta",
          )
          .map((event) => [event.payload.contentIndex, event.payload.delta]),
        [
          [0, "Hel"],
          [1, " world"],
        ],
        "deltas must be published while the message is still streaming",
      );
      yield* peer.writeRecord({
        type: "message_end",
        entryId: "assistant-entry-1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " universe" },
          ],
          stopReason: "stop",
        },
      });
      yield* peer.writeRecord({ type: "agent_end", willRetry: false });
      // The adapter emits nothing for agent_end itself, so a probe tool event
      // written after it provides the receipt that agent_end was processed.
      yield* peer.writeRecord({
        type: "tool_execution_start",
        toolCallId: "agent-end-probe",
        toolName: "read",
        args: {},
      });
      yield* collected.waitUntil((events) =>
        events.some(
          (event) => event.type === "item.started" && String(event.itemId) === "agent-end-probe",
        ),
      );
      assert.lengthOf(
        collected.events.filter((event) => event.type === "turn.completed"),
        0,
      );

      yield* peer.writeRecord({ type: "agent_settled" });
      yield* Deferred.await(collected.completed);

      assert.equal(
        String(result.turnId),
        String(collected.events.find((event) => event.type === "turn.started")?.turnId),
      );
      assert.deepEqual(
        collected.events
          .filter(
            (event): event is Extract<ProviderRuntimeEvent, { type: "content.delta" }> =>
              event.type === "content.delta",
          )
          .map((event) => [event.payload.contentIndex, event.payload.delta]),
        [
          [0, "Hel"],
          [1, " world"],
          [0, "lo"],
        ],
      );
      assert.lengthOf(
        collected.events.filter((event) => event.type === "turn.completed"),
        1,
      );
      const finalAssistant = collected.events.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "item.completed" }> =>
          event.type === "item.completed" && event.payload.itemType === "assistant_message",
      );
      assert.deepInclude(finalAssistant?.payload.data, {
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: " universe" },
        ],
      });

      yield* Fiber.interrupt(collected.fiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect(
    "keeps a retry in one turn and translates reasoning, tools, usage, compaction, and errors",
    () =>
      Effect.gen(function* () {
        const peer = yield* makePiRpcMockPeer();
        const adapter = yield* makeTestAdapter(peer, {}, undefined, peer.layer);
        const threadId = ThreadId.make("pi-event-translation");
        const collected = yield* collectEvents(adapter.streamEvents);
        yield* startSession({ adapter, peer, threadId });

        const sendFiber = yield* adapter
          .sendTurn({ threadId, input: "exercise events", attachments: [] })
          .pipe(Effect.forkChild);
        const prompt = yield* peer.takeCommand;
        yield* peer.respond(prompt, {});
        yield* Fiber.join(sendFiber);

        yield* peer.writeRecord({ type: "agent_start" });
        yield* peer.writeRecord({
          type: "message_update",
          message: {},
          assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        yield* peer.writeRecord({
          type: "message_update",
          message: {},
          assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Reason" },
        });
        yield* peer.writeRecord({
          type: "tool_execution_start",
          toolCallId: "bash-1",
          toolName: "bash",
          args: { command: "pwd" },
        });
        yield* peer.writeRecord({
          type: "tool_execution_update",
          toolCallId: "bash-1",
          result: { content: "running" },
        });
        yield* peer.writeRecord({
          type: "tool_execution_end",
          toolCallId: "bash-1",
          result: { content: "/workspace" },
          isError: false,
        });
        yield* peer.writeRecord({
          type: "tool_start",
          runId: "run-1",
          stepId: "step-1",
          toolCallId: "edit-1",
          toolName: "edit",
          args: { path: "a.ts" },
        });
        yield* peer.writeRecord({
          type: "tool_end",
          runId: "run-1",
          stepId: "step-1",
          toolCallId: "edit-1",
          toolName: "edit",
          result: {},
          isError: true,
        });
        yield* peer.writeRecord({
          type: "tool_start",
          runId: "run-1",
          stepId: "step-2",
          toolCallId: "extension-1",
          toolName: "custom_lookup",
          args: {},
        });
        yield* peer.writeRecord({
          type: "tool_end",
          runId: "run-1",
          stepId: "step-2",
          toolCallId: "extension-1",
          toolName: "custom_lookup",
          result: {},
          isError: false,
        });
        yield* peer.writeRecord({ type: "compaction_start", reason: "threshold" });
        yield* peer.writeRecord({
          type: "compaction_end",
          reason: "threshold",
          result: {},
          aborted: false,
          willRetry: false,
        });
        yield* peer.writeRecord({ type: "extension_error", error: { message: "bad extension" } });
        yield* peer.writeRecord({
          type: "message_end",
          entryId: "assistant-entry-usage",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "Reason" }],
            stopReason: "stop",
            usage: { input: 13, output: 5, cacheRead: 2, cacheWrite: 1, total: 21 },
          },
        });
        yield* peer.writeRecord({ type: "agent_end", willRetry: true });
        yield* peer.writeRecord({
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 10,
          errorMessage: "retry me",
        });
        yield* peer.writeRecord({ type: "agent_start" });
        yield* peer.writeRecord({ type: "agent_end", willRetry: false });
        yield* peer.writeRecord({ type: "agent_settled" });
        yield* Deferred.await(collected.completed);

        const deltas = collected.events.filter(
          (event): event is Extract<ProviderRuntimeEvent, { type: "content.delta" }> =>
            event.type === "content.delta",
        );
        assert.deepInclude(
          deltas.map((event) => event.payload),
          { streamKind: "reasoning_text", delta: "Reason", contentIndex: 0 },
        );
        assert.isTrue(
          collected.events.some(
            (event) => event.type === "item.started" && event.payload.itemType === "reasoning",
          ),
        );
        assert.isTrue(
          collected.events.some(
            (event) => event.type === "item.completed" && event.payload.itemType === "reasoning",
          ),
        );

        const lifecycle = collected.events.filter(
          (
            event,
          ): event is Extract<
            ProviderRuntimeEvent,
            { type: "item.started" | "item.updated" | "item.completed" }
          > =>
            event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed",
        );
        assert.isTrue(
          lifecycle.some(
            (event) =>
              event.type === "item.started" && event.payload.itemType === "command_execution",
          ),
        );
        assert.isTrue(
          lifecycle.some(
            (event) =>
              event.type === "item.updated" && event.payload.itemType === "command_execution",
          ),
        );
        assert.isTrue(
          lifecycle.some(
            (event) =>
              event.type === "item.completed" &&
              event.payload.itemType === "file_change" &&
              event.payload.status === "failed",
          ),
        );
        assert.isTrue(
          lifecycle.some(
            (event) =>
              event.type === "item.completed" &&
              event.payload.itemType === "dynamic_tool_call" &&
              event.payload.status === "completed",
          ),
        );
        assert.deepEqual(
          lifecycle
            .filter((event) => event.payload.itemType === "context_compaction")
            .map((event) => event.type),
          ["item.started", "item.completed"],
        );

        const usage = collected.events.find(
          (event): event is Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }> =>
            event.type === "thread.token-usage.updated" &&
            event.payload.usage.totalProcessedTokens === 21,
        );
        assert.deepInclude(usage?.payload.usage, {
          usedTokens: 21,
          inputTokens: 13,
          cachedInputTokens: 2,
          outputTokens: 5,
        });
        assert.isTrue(
          collected.events.some(
            (event) => event.type === "runtime.warning" && event.payload.message === "retry me",
          ),
        );
        assert.isTrue(
          collected.events.some(
            (event) => event.type === "runtime.error" && event.payload.message === "bad extension",
          ),
        );
        assert.lengthOf(
          collected.events.filter((event) => event.type === "turn.completed"),
          1,
        );

        yield* Fiber.interrupt(collected.fiber);
        yield* adapter.stopSession(threadId);
      }),
  );

  it.effect("applies models, steers a streaming turn, aborts, and closes the scoped client", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer, {}, undefined, peer.layer);
      const threadId = ThreadId.make("pi-commands");
      const collected = yield* collectEvents(adapter.streamEvents);
      yield* startSession({ adapter, peer, threadId });

      // sendTurn holds the session lock through the prompt acknowledgement so
      // set_model and prompt land on pi atomically; a second sendTurn queues
      // behind the first, so each prompt is acknowledged before the next.
      const firstFiber = yield* adapter
        .sendTurn({ threadId, input: "first", attachments: [] })
        .pipe(Effect.forkChild);
      const firstPrompt = yield* peer.takeCommand;
      assert.equal(firstPrompt.type, "prompt");
      assert.isUndefined(firstPrompt["streamingBehavior"]);
      yield* peer.respond(firstPrompt, {});
      const first = yield* Fiber.join(firstFiber);

      const followUpFiber = yield* adapter
        .sendTurn({ threadId, input: "after first", attachments: [] })
        .pipe(Effect.forkChild);
      const followUp = yield* peer.takeCommand;
      assert.deepInclude(followUp, {
        type: "prompt",
        message: "after first",
        streamingBehavior: "followUp",
      });
      yield* peer.respond(followUp, {});
      const followedUp = yield* Fiber.join(followUpFiber);
      assert.equal(String(followedUp.turnId), String(first.turnId));
      yield* peer.writeRecord({ type: "agent_start" });
      yield* collected.waitUntil((events) => events.some((event) => event.type === "turn.started"));

      const steerFiber = yield* adapter
        .sendTurn({
          threadId,
          input: "steer",
          attachments: [],
          modelSelection: {
            instanceId,
            model: "openrouter/vendor/model",
            options: [{ id: "reasoningEffort", value: "high" }],
          },
        })
        .pipe(Effect.forkChild);
      const setModel = yield* peer.takeCommand;
      assert.deepInclude(setModel, {
        type: "set_model",
        provider: "openrouter",
        modelId: "vendor/model",
      });
      yield* peer.respond(setModel, {});
      const setThinking = yield* peer.takeCommand;
      assert.deepInclude(setThinking, { type: "set_thinking_level", level: "high" });
      yield* peer.respond(setThinking, {});
      const steer = yield* peer.takeCommand;
      assert.deepInclude(steer, {
        type: "prompt",
        message: "steer",
        streamingBehavior: "steer",
      });
      yield* peer.respond(steer, {});
      const steered = yield* Fiber.join(steerFiber);
      assert.equal(String(steered.turnId), String(first.turnId));

      const abortFiber = yield* adapter
        .interruptTurn(threadId, first.turnId)
        .pipe(Effect.forkChild);
      const abort = yield* peer.takeCommand;
      assert.equal(abort.type, "abort");
      yield* peer.writeRecord({ type: "agent_settled" });
      yield* Deferred.await(collected.completed);
      yield* peer.respond(abort, {});
      yield* Fiber.join(abortFiber);
      const interrupted = collected.events.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed",
      );
      assert.equal(interrupted?.payload.state, "interrupted");

      yield* Fiber.interrupt(collected.fiber);
      yield* adapter.stopSession(threadId);
      assert.equal(yield* peer.killCount, 1);
    }),
  );

  it.effect("maps incremental reads and forks at the requested user turn", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer, {}, undefined, peer.layer);
      const threadId = ThreadId.make("pi-thread-operations");
      yield* startSession({
        adapter,
        peer,
        threadId,
        resumeCursor: {
          version: 1,
          sessionFile: "/sessions/resume.jsonl",
          leafId: "resume-leaf",
        },
      });

      const readFiber = yield* adapter.readThread(threadId).pipe(Effect.forkChild);
      const read = yield* peer.takeCommand;
      assert.deepInclude(read, { type: "get_entries", since: "resume-leaf" });
      yield* peer.respond(read, {
        entries: [
          {
            type: "message",
            id: "user-1",
            parentId: null,
            message: { role: "user", content: "one" },
          },
          {
            type: "message",
            id: "assistant-1",
            parentId: "user-1",
            message: { role: "assistant", content: [] },
          },
          {
            type: "message",
            id: "user-2",
            parentId: "assistant-1",
            message: { role: "user", content: "two" },
          },
          {
            type: "message",
            id: "assistant-2",
            parentId: "user-2",
            message: { role: "assistant", content: [] },
          },
        ],
        leafId: "assistant-2",
      });
      const fullRead = yield* peer.takeCommand;
      assert.equal(fullRead.type, "get_entries");
      assert.isUndefined(fullRead["since"]);
      yield* peer.respond(fullRead, {
        entries: [
          {
            type: "message",
            id: "user-1",
            parentId: null,
            message: { role: "user", content: "one" },
          },
          {
            type: "message",
            id: "assistant-1",
            parentId: "user-1",
            message: { role: "assistant", content: [] },
          },
          {
            type: "message",
            id: "user-2",
            parentId: "assistant-1",
            message: { role: "user", content: "two" },
          },
          {
            type: "message",
            id: "assistant-2",
            parentId: "user-2",
            message: { role: "assistant", content: [] },
          },
        ],
        leafId: "assistant-2",
      });
      const snapshot = yield* Fiber.join(readFiber);
      assert.deepEqual(
        snapshot.turns.map((turn) => String(turn.id)),
        ["assistant-1", "assistant-2"],
      );

      const rollbackFiber = yield* adapter.rollbackThread(threadId, 1).pipe(Effect.forkChild);
      const refresh = yield* peer.takeCommand;
      assert.equal(refresh.type, "get_entries");
      assert.isUndefined(refresh["since"]);
      yield* peer.respond(refresh, { entries: [], leafId: "assistant-2" });
      const fork = yield* peer.takeCommand;
      assert.deepInclude(fork, { type: "fork", entryId: "user-2" });
      yield* peer.respond(fork, {});
      const rolledBack = yield* Fiber.join(rollbackFiber);
      assert.deepEqual(
        rolledBack.turns.map((turn) => String(turn.id)),
        ["assistant-1"],
      );

      const unsupported = yield* Effect.flip(
        adapter.respondToRequest(threadId, "request-1" as never, "accept"),
      );
      assert.equal(unsupported._tag, "ProviderUnsupportedError");
      const unsupportedUserInput = yield* Effect.flip(
        adapter.respondToUserInput(threadId, "request-2" as never, {}),
      );
      assert.equal(unsupportedUserInput._tag, "ProviderUnsupportedError");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("lets stop close a session while abort RPC is wedged", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer);
      const threadId = ThreadId.make("pi-stop-wedged-abort");
      yield* startSession({ adapter, peer, threadId });

      const sendFiber = yield* adapter
        .sendTurn({ threadId, input: "start", attachments: [] })
        .pipe(Effect.forkChild);
      const prompt = yield* peer.takeCommand;
      yield* peer.respond(prompt, {});
      const turn = yield* Fiber.join(sendFiber);
      yield* peer.writeRecord({ type: "agent_start" });

      const abortFiber = yield* adapter.interruptTurn(threadId, turn.turnId).pipe(Effect.forkChild);
      const abort = yield* peer.takeCommand;
      assert.equal(abort.type, "abort");

      yield* adapter.stopSession(threadId);
      assert.equal(yield* peer.killCount, 1);
      assert.isTrue(Exit.isFailure(yield* Fiber.await(abortFiber)));
    }),
  );

  it.effect("builds resume, read-only, trust, and home spawn configuration", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      let spawned: ChildProcess.Command | undefined;
      const capturingLayer = capturingSpawnerLayer(peer, (command) => {
        spawned = command;
      });
      const adapter = yield* makeTestAdapter(
        peer,
        {
          binaryPath: "pi-test-double",
          trustProjectFiles: true,
          homePath: "/tmp/pi-home",
        },
        { environment: { PATH: process.env.PATH } },
        capturingLayer,
      );
      const threadId = ThreadId.make("pi-spawn-options");

      yield* startSession({
        adapter,
        peer,
        threadId,
        runtimeMode: "approval-required",
        resumeCursor: {
          version: 1,
          sessionFile: "/sessions/resume.jsonl",
          leafId: "leaf-1",
        },
      });

      assert.isDefined(spawned);
      if (spawned !== undefined && ChildProcess.isStandardCommand(spawned)) {
        assert.equal(spawned.command, "pi-test-double");
        assert.deepEqual(spawned.args.slice(0, 3), ["--mode", "rpc", "--session-dir"]);
        assert.deepEqual(spawned.args.slice(-5), [
          "--session",
          "/sessions/resume.jsonl",
          "--tools",
          "read,grep,find,ls",
          "--approve",
        ]);
        assert.equal(spawned.options.env?.["PI_CODING_AGENT_DIR"], "/tmp/pi-home");
      } else {
        assert.fail("Expected a standard pi child-process command.");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("degrades exactly the two approval runtime modes to read-only tools", () =>
    Effect.gen(function* () {
      const cases = [
        { runtimeMode: "approval-required", readOnly: true },
        { runtimeMode: "auto-accept-edits", readOnly: true },
        { runtimeMode: "auto", readOnly: false },
        { runtimeMode: "full-access", readOnly: false },
      ] as const;

      yield* Effect.forEach(
        cases,
        ({ runtimeMode, readOnly }) =>
          Effect.gen(function* () {
            const peer = yield* makePiRpcMockPeer();
            let spawned: ChildProcess.Command | undefined;
            const adapter = yield* makeTestAdapter(
              peer,
              {},
              undefined,
              capturingSpawnerLayer(peer, (command) => {
                spawned = command;
              }),
            );
            const threadId = ThreadId.make(`pi-runtime-mode-${runtimeMode}`);
            yield* startSession({ adapter, peer, threadId, runtimeMode });

            assert.isDefined(spawned);
            if (spawned !== undefined && ChildProcess.isStandardCommand(spawned)) {
              const toolsIndex = spawned.args.indexOf("--tools");
              if (readOnly) {
                assert.isAtLeast(toolsIndex, 0);
                assert.equal(spawned.args[toolsIndex + 1], "read,grep,find,ls");
              } else {
                assert.equal(toolsIndex, -1);
              }
            } else {
              assert.fail("Expected a standard pi child-process command.");
            }
            yield* adapter.stopSession(threadId);
          }),
        { discard: true },
      );
    }),
  );

  it.effect("marks a terminal assistant error as a failed turn", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer);
      const threadId = ThreadId.make("pi-assistant-error");
      const collected = yield* collectEvents(adapter.streamEvents);
      yield* startSession({ adapter, peer, threadId });

      const sendFiber = yield* adapter
        .sendTurn({ threadId, input: "fail", attachments: [] })
        .pipe(Effect.forkChild);
      const prompt = yield* peer.takeCommand;
      yield* peer.respond(prompt, {});
      yield* Fiber.join(sendFiber);
      yield* peer.writeRecord({ type: "agent_start" });
      yield* peer.writeRecord({
        type: "message_end",
        entryId: "assistant-error",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "model request failed",
        },
      });
      yield* peer.writeRecord({ type: "agent_end", willRetry: false });
      yield* peer.writeRecord({ type: "agent_settled" });
      yield* Deferred.await(collected.completed);

      assert.isTrue(
        collected.events.some(
          (event) =>
            event.type === "runtime.error" && event.payload.message === "model request failed",
        ),
      );
      const completed = collected.events.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed",
      );
      assert.deepInclude(completed?.payload, {
        state: "failed",
        errorMessage: "model request failed",
      });

      yield* Fiber.interrupt(collected.fiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("surfaces process death as an error and failed turn", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const adapter = yield* makeTestAdapter(peer, {}, undefined, peer.layer);
      const threadId = ThreadId.make("pi-process-death");
      const collected = yield* collectEvents(adapter.streamEvents);
      yield* startSession({ adapter, peer, threadId });

      const sendFiber = yield* adapter
        .sendTurn({ threadId, input: "die", attachments: [] })
        .pipe(Effect.forkChild);
      const prompt = yield* peer.takeCommand;
      assert.equal(prompt.type, "prompt");
      yield* peer.writeStderr("pi crashed");
      yield* peer.exit(17);

      const exit = yield* Fiber.await(sendFiber);
      assert.isTrue(Exit.isFailure(exit));
      yield* Deferred.await(collected.completed);
      assert.isTrue(collected.events.some((event) => event.type === "runtime.error"));
      const completed = collected.events.find(
        (event): event is Extract<ProviderRuntimeEvent, { type: "turn.completed" }> =>
          event.type === "turn.completed",
      );
      assert.equal(completed?.payload.state, "failed");
      assert.isFalse(yield* adapter.hasSession(threadId));
      yield* collected.waitUntil((events) =>
        events.some((event) => event.type === "session.exited"),
      );
      assert.isTrue(
        collected.events.some(
          (event) => event.type === "session.exited" && event.payload.exitKind === "error",
        ),
      );

      yield* Fiber.interrupt(collected.fiber);
    }),
  );
});
