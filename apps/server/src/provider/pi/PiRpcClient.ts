import * as NodeStringDecoder from "node:string_decoder";

import { resolveSpawnCommand } from "@aqqua/shared/shell";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  PiProtocolDiagnostic,
  type PiRpcCommandInput,
  PiRpcEvent,
  PiRpcResponse,
  type PiRpcSuccessResponse,
} from "./PiRpcProtocol.ts";

const STDERR_TAIL_CHARACTERS = 16_384;

export class PiRpcSpawnError extends Schema.TaggedErrorClass<PiRpcSpawnError>()("PiRpcSpawnError", {
  executable: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Failed to spawn pi RPC process '${this.executable}': ${this.detail}`;
  }
}

export class PiRpcEncodingError extends Schema.TaggedErrorClass<PiRpcEncodingError>()(
  "PiRpcEncodingError",
  {
    command: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to encode pi RPC command '${this.command}': ${this.detail}`;
  }
}

export class PiRpcRequestError extends Schema.TaggedErrorClass<PiRpcRequestError>()(
  "PiRpcRequestError",
  {
    id: Schema.String,
    command: Schema.String,
    error: Schema.String,
  },
) {
  override get message(): string {
    return `Pi RPC command '${this.command}' failed: ${this.error}`;
  }
}

export class PiRpcProcessExitError extends Schema.TaggedErrorClass<PiRpcProcessExitError>()(
  "PiRpcProcessExitError",
  {
    reason: Schema.Literals(["process-exit", "stdout-closed", "transport-error", "scope-closed"]),
    exitCode: Schema.NullOr(Schema.Number),
    stderrTail: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Pi RPC process ended (${this.reason}, exit ${this.exitCode ?? "unknown"}): ${this.detail}`;
  }
}

export type PiRpcClientError = PiRpcEncodingError | PiRpcRequestError | PiRpcProcessExitError;

export interface PiRpcClientOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PiRpcClient {
  readonly request: (
    command: PiRpcCommandInput,
  ) => Effect.Effect<PiRpcSuccessResponse, PiRpcClientError>;
  readonly events: Stream.Stream<PiRpcEvent>;
}

interface PendingRequest {
  readonly command: string;
  readonly deferred: Deferred.Deferred<PiRpcSuccessResponse, PiRpcClientError>;
}

interface ClientState {
  readonly closed: PiRpcProcessExitError | null;
  readonly pending: ReadonlyMap<string, PendingRequest>;
}

const decodeResponse = Schema.decodeUnknownExit(PiRpcResponse, {
  onExcessProperty: "preserve",
});
const decodeEvent = Schema.decodeUnknownExit(PiRpcEvent, {
  onExcessProperty: "preserve",
});
const decodeJsonRecord = Schema.decodeUnknownExit(Schema.Record(Schema.String, Schema.Unknown));
const decodeJson = Schema.decodeUnknownExit(Schema.UnknownFromJsonString);
const encodeJson = Schema.encodeUnknownExit(Schema.UnknownFromJsonString);

function errorDetail(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message.trim()
    : String(cause);
}

export const spawnPiRpcClient = Effect.fn("spawnPiRpcClient")(function* (
  options: PiRpcClientOptions,
): Effect.fn.Return<
  PiRpcClient,
  PiRpcSpawnError,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> {
  const scope = yield* Scope.Scope;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const spawnCommand = yield* resolveSpawnCommand(
    options.executable,
    options.args,
    options.env === undefined ? {} : { env: options.env },
  );
  const child = yield* spawner
    .spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        shell: spawnCommand.shell,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.env !== undefined
          ? { env: options.env, extendEnv: false }
          : { extendEnv: true }),
      }),
    )
    .pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.mapError(
        (cause) =>
          new PiRpcSpawnError({
            executable: options.executable,
            detail: errorDetail(cause),
            cause,
          }),
      ),
    );

  const outgoing = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const eventBus = yield* PubSub.unbounded<PiRpcEvent>();
  const state = yield* Ref.make<ClientState>({
    closed: null,
    pending: new Map(),
  });
  const stderrTail = yield* Ref.make("");
  const processExited = yield* Deferred.make<number>();
  const terminalReason = yield* Ref.make<"process-exit" | "stdout-closed">("process-exit");
  const encoder = new TextEncoder();
  let nextRequestId = 1;

  const failClient = Effect.fn("PiRpcClient.failClient")(function* (error: PiRpcProcessExitError) {
    const pending = yield* Ref.modify(state, (current) => {
      if (current.closed !== null) {
        return [[], current] as const;
      }
      return [
        [...current.pending.values()],
        { closed: error, pending: new Map<string, PendingRequest>() },
      ] as const;
    });
    yield* Effect.forEach(pending, ({ deferred }) => Deferred.fail(deferred, error), {
      discard: true,
    });
    yield* Queue.end(outgoing);
    yield* PubSub.shutdown(eventBus);
  });

  const currentStderrTail = Ref.get(stderrTail);

  const publishDiagnostic = Effect.fn("PiRpcClient.publishDiagnostic")(function* (
    line: string,
    detail: string,
  ) {
    yield* PubSub.publish(
      eventBus,
      PiProtocolDiagnostic.make({
        issue: "malformed-jsonl",
        line,
        detail,
      }),
    );
  });

  const takePending = (id: string) =>
    Ref.modify(state, (current) => {
      const found = current.pending.get(id);
      if (found === undefined) {
        return [undefined, current] as const;
      }
      const next = new Map(current.pending);
      next.delete(id);
      return [found, { ...current, pending: next }] as const;
    });

  const routeRecord = Effect.fn("PiRpcClient.routeRecord")(function* (
    value: unknown,
    line: string,
  ) {
    const decodedRecord = decodeJsonRecord(value);
    if (Exit.isFailure(decodedRecord)) {
      yield* publishDiagnostic(line, "JSONL record must be an object");
      return;
    }
    const record = decodedRecord.value;

    if (record["type"] === "response") {
      const decoded = decodeResponse(record);
      if (Exit.isFailure(decoded)) {
        yield* publishDiagnostic(line, "Invalid pi RPC response record");
        const rawId = record["id"];
        if (typeof rawId === "string") {
          const pending = yield* takePending(rawId);
          if (pending !== undefined) {
            yield* Deferred.fail(
              pending.deferred,
              new PiRpcRequestError({
                id: rawId,
                command: pending.command,
                error: "Pi returned a response that could not be decoded.",
              }),
            );
          }
        }
        return;
      }
      const response = decoded.value;
      const pending = yield* takePending(response.id);
      if (pending === undefined) {
        return;
      }
      if (response.success) {
        yield* Deferred.succeed(pending.deferred, response);
      } else {
        yield* Deferred.fail(
          pending.deferred,
          new PiRpcRequestError({
            id: response.id,
            command: response.command,
            error: response.error,
          }),
        );
      }
      return;
    }

    const event = decodeEvent(record);
    if (Exit.isSuccess(event)) {
      yield* PubSub.publish(eventBus, event.value);
      return;
    }
    yield* publishDiagnostic(line, "Invalid pi RPC event record");
  });

  const stdoutDecoder = new NodeStringDecoder.StringDecoder("utf8");
  let stdoutRemainder = "";
  const consumeStdoutText = Effect.fn("PiRpcClient.consumeStdoutText")(function* (text: string) {
    stdoutRemainder += text;
    while (true) {
      const newline = stdoutRemainder.indexOf("\n");
      if (newline < 0) {
        return;
      }
      let line = stdoutRemainder.slice(0, newline);
      stdoutRemainder = stdoutRemainder.slice(newline + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (line.length === 0) {
        continue;
      }
      const parsed = decodeJson(line);
      if (Exit.isFailure(parsed)) {
        yield* publishDiagnostic(line, String(parsed.cause));
        continue;
      }
      yield* routeRecord(parsed.value, line);
    }
  });

  const failTransport = Effect.fn("PiRpcClient.failTransport")(function* (
    reason: PiRpcProcessExitError["reason"],
    detail: string,
    cause?: unknown,
  ) {
    yield* failClient(
      new PiRpcProcessExitError({
        reason,
        exitCode: null,
        stderrTail: yield* currentStderrTail,
        detail,
        ...(cause === undefined ? {} : { cause }),
      }),
    );
  });

  const writerFiber = yield* Stream.fromQueue(outgoing).pipe(
    Stream.run(child.stdin),
    Effect.matchEffect({
      onFailure: (cause) =>
        failTransport("transport-error", "Failed writing to pi RPC stdin", cause),
      onSuccess: () => Effect.void,
    }),
    Effect.forkIn(scope),
  );

  const stderrFiber = yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Ref.update(stderrTail, (tail) => `${tail}${chunk}`.slice(-STDERR_TAIL_CHARACTERS)),
    ),
    Effect.ignore,
    Effect.forkIn(scope),
  );

  const handleStdoutClose = Effect.fn("PiRpcClient.handleStdoutClose")(function* () {
    yield* consumeStdoutText(stdoutDecoder.end());
    if (stdoutRemainder.length > 0) {
      yield* publishDiagnostic(
        stdoutRemainder,
        "Pi RPC stdout closed with an unterminated JSONL record",
      );
    }
    if (!(yield* Deferred.isDone(processExited))) {
      yield* Ref.set(terminalReason, "stdout-closed");
      yield* child.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" }).pipe(Effect.ignore);
    }
    yield* Deferred.await(processExited);
  });

  const stdoutFiber = yield* child.stdout.pipe(
    Stream.runForEach((chunk) => consumeStdoutText(stdoutDecoder.write(chunk))),
    Effect.matchEffect({
      onFailure: (cause) => failTransport("transport-error", "Failed reading pi RPC stdout", cause),
      onSuccess: handleStdoutClose,
    }),
    Effect.forkIn(scope),
  );

  const handleProcessExit = Effect.fn("PiRpcClient.handleProcessExit")(function* (
    exitCode: ChildProcessSpawner.ExitCode,
  ) {
    yield* Deferred.succeed(processExited, Number(exitCode));
    yield* Fiber.await(stdoutFiber).pipe(Effect.ignore);
    yield* Fiber.await(stderrFiber).pipe(Effect.ignore);
    const reason = yield* Ref.get(terminalReason);
    yield* failClient(
      new PiRpcProcessExitError({
        reason,
        exitCode: Number(exitCode),
        stderrTail: yield* currentStderrTail,
        detail: reason === "stdout-closed" ? "Pi RPC stdout closed" : "Pi RPC process exited",
      }),
    );
  });

  yield* child.exitCode.pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        failTransport("transport-error", "Failed reading pi RPC process exit status", cause),
      onSuccess: handleProcessExit,
    }),
    Effect.forkIn(scope),
  );

  yield* Scope.addFinalizer(
    scope,
    Effect.gen(function* () {
      yield* failClient(
        new PiRpcProcessExitError({
          reason: "scope-closed",
          exitCode: null,
          stderrTail: yield* currentStderrTail,
          detail: "Pi RPC client scope closed",
        }),
      );
      yield* Queue.end(outgoing);
      yield* Fiber.await(writerFiber).pipe(Effect.ignore);
      yield* child.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" }).pipe(Effect.ignore);
    }),
  );

  const request: PiRpcClient["request"] = Effect.fn("PiRpcClient.request")(function* (command) {
    const id = `pi-rpc-${String(nextRequestId++)}`;
    const encodedJson = encodeJson({ ...command, id });
    if (Exit.isFailure(encodedJson)) {
      return yield* new PiRpcEncodingError({
        command: command.type,
        detail: String(encodedJson.cause),
        cause: encodedJson.cause,
      });
    }
    const encoded = encoder.encode(`${encodedJson.value}\n`);

    const deferred = yield* Deferred.make<PiRpcSuccessResponse, PiRpcClientError>();
    const closed = yield* Ref.modify(state, (current) => {
      if (current.closed !== null) {
        return [current.closed, current] as const;
      }
      const pending = new Map(current.pending);
      pending.set(id, { command: command.type, deferred });
      return [null, { ...current, pending }] as const;
    });
    if (closed !== null) {
      return yield* closed;
    }

    const offered = yield* Queue.offer(outgoing, encoded);
    if (!offered) {
      const error = new PiRpcProcessExitError({
        reason: "transport-error",
        exitCode: null,
        stderrTail: yield* currentStderrTail,
        detail: "Pi RPC stdin is closed",
      });
      yield* failClient(error);
      return yield* error;
    }
    return yield* Deferred.await(deferred).pipe(
      Effect.onInterrupt(() => Effect.ignore(takePending(id))),
    );
  });

  return {
    request,
    events: Stream.fromPubSub(eventBus),
  };
});
