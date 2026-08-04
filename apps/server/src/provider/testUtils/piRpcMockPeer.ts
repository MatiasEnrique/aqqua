import * as NodeStringDecoder from "node:string_decoder";

import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

const PiRpcMockCommandSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    type: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
const decodeMockCommand = Schema.decodeUnknownExit(PiRpcMockCommandSchema, {
  onExcessProperty: "preserve",
});
export type PiRpcMockCommand = typeof PiRpcMockCommandSchema.Type;

export interface PiRpcMockPeer {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly takeCommand: Effect.Effect<PiRpcMockCommand>;
  readonly writeStdout: (chunks: ReadonlyArray<string | Uint8Array>) => Effect.Effect<void>;
  readonly writeRecord: (
    record: Readonly<Record<string, unknown>>,
    lineEnding?: "\n" | "\r\n",
  ) => Effect.Effect<void>;
  readonly respond: (command: PiRpcMockCommand, data?: unknown) => Effect.Effect<void>;
  readonly fail: (command: PiRpcMockCommand, error: string) => Effect.Effect<void>;
  readonly writeStderr: (text: string) => Effect.Effect<void>;
  readonly closeStdout: Effect.Effect<void>;
  readonly exit: (code: number) => Effect.Effect<void>;
  readonly killCount: Effect.Effect<number>;
}

const decodeJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

export const makePiRpcMockPeer = Effect.fn("makePiRpcMockPeer")(function* () {
  const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const stderr = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const commands = yield* Queue.unbounded<PiRpcMockCommand>();
  const exitCode = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
  const kills = yield* Ref.make(0);
  const encoder = new TextEncoder();
  const stdinDecoder = new NodeStringDecoder.StringDecoder("utf8");
  let stdinRemainder = "";

  const acceptStdinText = Effect.fn("PiRpcMockPeer.acceptStdinText")(function* (text: string) {
    stdinRemainder += text;
    while (true) {
      const newline = stdinRemainder.indexOf("\n");
      if (newline < 0) {
        return;
      }
      let line = stdinRemainder.slice(0, newline);
      stdinRemainder = stdinRemainder.slice(newline + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.length === 0) {
        continue;
      }
      const parsed = decodeJson(line);
      const command = decodeMockCommand(parsed);
      if (Exit.isFailure(command)) {
        return yield* Effect.die(new Error("Pi RPC mock received an invalid command"));
      }
      yield* Queue.offer(commands, command.value);
    }
  });

  const finish = Effect.fn("PiRpcMockPeer.finish")(function* (code: number) {
    yield* Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(code));
    yield* Queue.end(stdout);
    yield* Queue.end(stderr);
  });

  const handle = ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(41_041),
    exitCode: Deferred.await(exitCode),
    isRunning: Deferred.isDone(exitCode).pipe(Effect.map((done) => !done)),
    kill: () =>
      Effect.gen(function* () {
        yield* Ref.update(kills, (count) => count + 1);
        yield* finish(143);
      }),
    unref: Effect.succeed(Effect.void),
    stdin: Sink.forEach((chunk: Uint8Array) => acceptStdinText(stdinDecoder.write(chunk))),
    stdout: Stream.fromQueue(stdout),
    stderr: Stream.fromQueue(stderr),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.succeed(handle)),
  );

  const writeStdout = (chunks: ReadonlyArray<string | Uint8Array>) =>
    Effect.forEach(
      chunks,
      (chunk) => Queue.offer(stdout, typeof chunk === "string" ? encoder.encode(chunk) : chunk),
      { discard: true },
    );

  const writeRecord = (
    record: Readonly<Record<string, unknown>>,
    lineEnding: "\n" | "\r\n" = "\n",
  ) => writeStdout([`${encodeJson(record)}${lineEnding}`]);

  return {
    layer,
    takeCommand: Queue.take(commands),
    writeStdout,
    writeRecord,
    respond: (command, data) =>
      writeRecord({
        type: "response",
        id: command.id,
        command: command.type,
        success: true,
        ...(data === undefined ? {} : { data }),
      }),
    fail: (command, error) =>
      writeRecord({
        type: "response",
        id: command.id,
        command: command.type,
        success: false,
        error,
      }),
    writeStderr: (text) => Queue.offer(stderr, encoder.encode(text)).pipe(Effect.asVoid),
    closeStdout: Queue.end(stdout).pipe(Effect.asVoid),
    exit: finish,
    killCount: Ref.get(kills),
  } satisfies PiRpcMockPeer;
});
