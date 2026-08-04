import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { makePiRpcMockPeer } from "../testUtils/piRpcMockPeer.ts";
import { PiRpcProcessExitError, PiRpcRequestError, spawnPiRpcClient } from "./PiRpcClient.ts";
import { PiRpcEvent, type PiUnknownEvent } from "./PiRpcProtocol.ts";

const spawnOptions = {
  executable: "pi-test-double",
  args: ["--mode", "rpc"],
  cwd: "/workspace",
} as const;

const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const decodePiRpcEvent = Schema.decodeUnknownEffect(PiRpcEvent);

function isUnknownEvent(event: PiRpcEvent): event is PiUnknownEvent {
  return "_tag" in event && event._tag === "PiUnknownEvent";
}

describe("PiRpcClient", () => {
  it.effect("frames strict-LF JSONL across protocol edge cases", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const eventsFiber = yield* client.events.pipe(
        Stream.take(6),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* peer.writeStdout([
        `${encodeJson({ type: "future_event", text: "before\u2028middle\u2029after", seq: 1 })}\n`,
      ]);
      yield* peer.writeRecord({ type: "agent_start", seq: 2 }, "\r\n");

      const splitRecord = `${encodeJson({ type: "future_event", seq: 3 })}\n`;
      yield* peer.writeStdout([splitRecord.slice(0, 12), splitRecord.slice(12)]);

      const unicodeRecord = new TextEncoder().encode(
        `${encodeJson({ type: "future_event", text: "café ☕", seq: 4 })}\n`,
      );
      const coffeeStart = unicodeRecord.indexOf(0xe2);
      assert.isAtLeast(coffeeStart, 0);
      yield* peer.writeStdout([
        unicodeRecord.slice(0, coffeeStart + 1),
        unicodeRecord.slice(coffeeStart + 1),
      ]);

      yield* peer.writeStdout([
        `${encodeJson({ type: "future_event", seq: 5 })}\n${encodeJson({
          type: "future_event",
          seq: 6,
        })}\n`,
      ]);

      const events = Array.from(yield* Fiber.join(eventsFiber));
      assert.equal(events.length, 6);
      const firstEvent = events[0];
      assert.ok(firstEvent && isUnknownEvent(firstEvent));
      if (firstEvent && isUnknownEvent(firstEvent)) {
        assert.equal(firstEvent.raw["text"], "before\u2028middle\u2029after");
      }
      const secondEvent = events[1];
      assert.ok(secondEvent && "type" in secondEvent);
      if (secondEvent && "type" in secondEvent) {
        assert.equal(secondEvent.type, "agent_start");
        assert.equal((secondEvent as unknown as Record<string, unknown>)["seq"], 2);
      }
      const fourthEvent = events[3];
      if (fourthEvent && isUnknownEvent(fourthEvent)) {
        assert.equal(fourthEvent.raw["text"], "café ☕");
      } else {
        assert.fail("Expected the multibyte test record to use the unknown-event passthrough");
      }
      assert.deepEqual(
        events.slice(2).map((event) => (isUnknownEvent(event) ? event.raw["seq"] : undefined)),
        [3, 4, 5, 6],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("correlates concurrent requests whose responses arrive out of order", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));

      const stateFiber = yield* client.request({ type: "get_state" }).pipe(Effect.forkChild);
      const statsFiber = yield* client
        .request({ type: "get_session_stats" })
        .pipe(Effect.forkChild);
      const first = yield* peer.takeCommand;
      const second = yield* peer.takeCommand;

      yield* peer.respond(second, { marker: "second" });
      yield* peer.respond(first, { marker: "first" });

      const state = yield* Fiber.join(stateFiber);
      const stats = yield* Fiber.join(statsFiber);
      assert.equal(state.id, first.id);
      assert.deepEqual(state.data, { marker: "first" });
      assert.equal(stats.id, second.id);
      assert.deepEqual(stats.data, { marker: "second" });
    }).pipe(Effect.scoped),
  );

  it.effect("passes unknown events through with their complete raw record", () =>
    Effect.gen(function* () {
      const schemaDecoded = yield* decodePiRpcEvent({
        type: "tool_start",
        schemaFallback: true,
      });
      assert.equal(isUnknownEvent(schemaDecoded), true);
      if (isUnknownEvent(schemaDecoded)) {
        assert.equal(schemaDecoded.raw["schemaFallback"], true);
      }

      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const eventFiber = yield* client.events.pipe(Stream.runHead, Effect.forkChild);
      yield* Effect.yieldNow;

      yield* peer.writeRecord({
        type: "tool_start",
        renamed: true,
        nested: { retained: true },
      });

      const event = yield* Fiber.join(eventFiber);
      assert.equal(event._tag, "Some");
      if (event._tag === "Some") {
        assert.equal(isUnknownEvent(event.value), true);
        if (isUnknownEvent(event.value)) {
          assert.deepEqual(event.value.raw, {
            type: "tool_start",
            renamed: true,
            nested: { retained: true },
          });
        }
      }
    }).pipe(Effect.scoped),
  );

  it.effect("publishes a diagnostic for malformed JSON and keeps reading", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const eventsFiber = yield* client.events.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* peer.writeStdout(["{not json}\n"]);
      yield* peer.writeRecord({ type: "agent_settled" });

      const events = Array.from(yield* Fiber.join(eventsFiber));
      assert.ok(events[0] && "_tag" in events[0]);
      if (events[0] && "_tag" in events[0]) {
        assert.equal(events[0]._tag, "PiProtocolDiagnostic");
      }
      assert.ok(events[1] && "type" in events[1]);
      if (events[1] && "type" in events[1]) {
        assert.equal(events[1].type, "agent_settled");
      }
    }).pipe(Effect.scoped),
  );

  it.effect("turns unsuccessful responses into PiRpcRequestError", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const requestFiber = yield* client.request({ type: "abort" }).pipe(Effect.forkChild);
      const command = yield* peer.takeCommand;
      yield* peer.fail(command, "nothing to abort");

      const error = yield* Fiber.join(requestFiber).pipe(Effect.flip);
      assert.instanceOf(error, PiRpcRequestError);
      assert.equal(error.id, command.id);
      assert.equal(error.command, "abort");
      assert.equal(error.error, "nothing to abort");
    }).pipe(Effect.scoped),
  );

  it.effect("fails pending requests and ends events when the process dies", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const eventsFiber = yield* client.events.pipe(Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      const requestFiber = yield* client.request({ type: "get_tree" }).pipe(Effect.forkChild);
      yield* peer.takeCommand;
      yield* peer.writeStderr("provider exploded");
      yield* peer.exit(7);

      const error = yield* Fiber.join(requestFiber).pipe(Effect.flip);
      assert.instanceOf(error, PiRpcProcessExitError);
      assert.equal(error.stderrTail, "provider exploded");
      assert.equal(error.exitCode, 7);
      yield* Fiber.join(eventsFiber);
    }).pipe(Effect.scoped),
  );

  it.effect("kills a process whose stdout closes and reports its exit status", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(Effect.provide(peer.layer));
      const requestFiber = yield* client.request({ type: "get_commands" }).pipe(Effect.forkChild);
      yield* peer.takeCommand;

      yield* peer.closeStdout;

      const error = yield* Fiber.join(requestFiber).pipe(Effect.flip);
      assert.instanceOf(error, PiRpcProcessExitError);
      assert.equal(error.reason, "stdout-closed");
      assert.equal(error.exitCode, 143);
      assert.equal(yield* peer.killCount, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("scope close closes stdin, kills the process, and terminates clients", () =>
    Effect.gen(function* () {
      const peer = yield* makePiRpcMockPeer();
      const clientScope = yield* Scope.make("sequential");
      const client = yield* spawnPiRpcClient(spawnOptions).pipe(
        Effect.provide(peer.layer),
        Scope.provide(clientScope),
      );
      const eventsFiber = yield* client.events.pipe(Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      const requestFiber = yield* client.request({ type: "get_messages" }).pipe(Effect.forkChild);
      yield* peer.takeCommand;

      yield* Scope.close(clientScope, Exit.void);

      const error = yield* Fiber.join(requestFiber).pipe(Effect.flip);
      assert.instanceOf(error, PiRpcProcessExitError);
      assert.equal(error.reason, "scope-closed");
      yield* Fiber.join(eventsFiber);
      assert.equal(yield* peer.killCount, 1);
    }).pipe(Effect.scoped),
  );
});
