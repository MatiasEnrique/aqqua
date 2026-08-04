import {
  EventId,
  type PiSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderItemId,
  ProviderInstanceId,
  RuntimeItemId,
  type ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from "@aqqua/contracts";
import { getModelSelectionStringOptionValue } from "@aqqua/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { resolveAttachmentPath, toSafeThreadAttachmentSegment } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  ProviderUnsupportedError,
} from "../Errors.ts";
import {
  type PiRpcClient,
  type PiRpcClientError,
  PiRpcSpawnError,
  spawnPiRpcClient,
} from "../pi/PiRpcClient.ts";
import {
  type PiGetEntriesData,
  type PiRpcEvent,
  PiSessionStatsData,
  PiThinkingLevel,
} from "../pi/PiRpcProtocol.ts";
import { piEnvironment, piExecutable, splitPiModelSlug } from "../pi/piSpawnSettings.ts";
import type { PiAdapterShape } from "../Services/PiAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const PI_RESUME_VERSION = 1 as const;
const READ_ONLY_TOOLS = "read,grep,find,ls";
const THINKING_LEVELS = new Set<PiThinkingLevel>(PiThinkingLevel.literals);

const decodeSessionStats = Schema.decodeUnknownEffect(PiSessionStatsData, {
  onExcessProperty: "preserve",
});
const decodeEntries = Schema.decodeUnknownEffect(
  Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        id: Schema.String,
        parentId: Schema.optional(Schema.NullOr(Schema.String)),
        timestamp: Schema.optional(Schema.String),
        message: Schema.optional(Schema.Unknown),
      }),
    ),
    leafId: Schema.optional(Schema.String),
  }),
  { onExcessProperty: "preserve" },
);

interface PiResumeCursor {
  readonly version: typeof PI_RESUME_VERSION;
  readonly sessionFile: string;
  readonly leafId?: string;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly client: PiRpcClient;
  readonly lock: Semaphore.Semaphore;
  eventFiber: Fiber.Fiber<void, never> | undefined;
  activeTurnId: TurnId | undefined;
  streaming: boolean;
  stopped: boolean;
  sessionFile: string | undefined;
  leafId: string | undefined;
  entries: Array<PiGetEntriesData["entries"][number]>;
  textByContentIndex: Map<number, string>;
  thinkingByContentIndex: Map<number, string>;
  reasoningItemByContentIndex: Map<number, RuntimeItemId>;
  toolNameByCallId: Map<string, string>;
  compactionItemId: RuntimeItemId | undefined;
  turnFailureMessage: string | undefined;
  turnInterrupted: boolean;
}

export interface PiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly instanceId?: ProviderInstanceId;
}

function record(value: unknown): Readonly<Record<PropertyKey, unknown>> | undefined {
  return Predicate.isObject(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function parsePiResumeCursor(value: unknown): PiResumeCursor | undefined {
  const cursor = record(value);
  if (cursor?.["version"] !== PI_RESUME_VERSION) return undefined;
  const sessionFile = nonEmptyString(cursor["sessionFile"]);
  if (sessionFile === undefined) return undefined;
  const leafId = nonEmptyString(cursor["leafId"]);
  return {
    version: PI_RESUME_VERSION,
    sessionFile,
    ...(leafId === undefined ? {} : { leafId }),
  };
}

function toolItemType(toolName: string): "command_execution" | "file_change" | "dynamic_tool_call" {
  if (toolName === "bash") return "command_execution";
  if (toolName === "write" || toolName === "edit") return "file_change";
  return "dynamic_tool_call";
}

function nativeEventRecord(event: PiRpcEvent): Readonly<Record<PropertyKey, unknown>> | undefined {
  if ("_tag" in event) {
    return event._tag === "PiUnknownEvent" ? event.raw : undefined;
  }
  return event;
}

function assistantContent(message: unknown): ReadonlyArray<Readonly<Record<PropertyKey, unknown>>> {
  const content = record(message)?.["content"];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const partRecord = record(part);
    return partRecord === undefined ? [] : [partRecord];
  });
}

function usageFromMessage(message: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = record(record(message)?.["usage"]);
  if (usage === undefined) return undefined;
  const input = finiteNonNegative(usage["input"]);
  const output = finiteNonNegative(usage["output"]);
  const cacheRead = finiteNonNegative(usage["cacheRead"]);
  const total = finiteNonNegative(usage["total"]);
  const usedTokens =
    total ??
    (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (finiteNonNegative(usage["cacheWrite"]) ?? 0);
  return {
    usedTokens,
    totalProcessedTokens: usedTokens,
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(cacheRead === undefined ? {} : { cachedInputTokens: cacheRead }),
    ...(output === undefined ? {} : { outputTokens: output }),
  };
}

function usageFromStats(stats: PiSessionStatsData): ThreadTokenUsageSnapshot {
  return {
    usedTokens: Math.max(0, Math.floor(stats.contextUsage.tokens)),
    totalProcessedTokens: Math.max(0, Math.floor(stats.tokens.total)),
    maxTokens: Math.max(1, Math.floor(stats.contextUsage.contextWindow)),
    inputTokens: Math.max(0, Math.floor(stats.tokens.input)),
    cachedInputTokens: Math.max(0, Math.floor(stats.tokens.cacheRead)),
    outputTokens: Math.max(0, Math.floor(stats.tokens.output)),
  };
}

function snapshotFromEntries(
  threadId: ThreadId,
  entries: ReadonlyArray<PiGetEntriesData["entries"][number]>,
) {
  return {
    threadId,
    turns: entries.flatMap((entry) => {
      const message = record(entry.message);
      if (entry.type !== "message" || message?.["role"] !== "assistant") return [];
      return [{ id: TurnId.make(entry.id), items: [entry] }];
    }),
  };
}

function resumeCursor(ctx: PiSessionContext): PiResumeCursor | undefined {
  if (ctx.sessionFile === undefined) return undefined;
  return {
    version: PI_RESUME_VERSION,
    sessionFile: ctx.sessionFile,
    ...(ctx.leafId === undefined ? {} : { leafId: ctx.leafId }),
  };
}

function adapterError(threadId: ThreadId, method: string, cause: PiRpcClientError) {
  if (cause._tag === "PiRpcProcessExitError") {
    return new ProviderAdapterProcessError({
      provider: PROVIDER,
      threadId,
      detail: cause.message,
      cause,
    });
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: cause.message,
    cause,
  });
}

/** Build one pi RPC adapter bound to a configured provider instance. */
export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  piSettings: PiSettings,
  options?: PiAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);
  const crypto = yield* Crypto.Crypto;
  const adapterScope = yield* Scope.Scope;
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
  const sessions = new Map<ThreadId, PiSessionContext>();
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUUIDv4 = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to generate pi runtime identifier.",
          cause,
        }),
    ),
  );
  const makeEventStamp = () =>
    Effect.all({
      eventId: Effect.map(randomUUIDv4, EventId.make),
      createdAt: nowIso,
    });
  const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

  const logNative = Effect.fn("PiAdapter.logNative")(
    function* (threadId: ThreadId, event: PiRpcEvent) {
      if (nativeEventLogger === undefined) return;
      const observedAt = yield* nowIso;
      yield* nativeEventLogger.write(
        {
          observedAt,
          event: {
            id: yield* randomUUIDv4,
            kind: "notification",
            provider: PROVIDER,
            createdAt: observedAt,
            method: "pi.rpc.event",
            threadId,
            payload: nativeEventRecord(event) ?? event,
          },
        },
        threadId,
      );
    },
    (effect, threadId) =>
      Effect.catchCause(effect, (cause) =>
        Effect.logWarning("Failed to write native pi notification log.", {
          cause,
          threadId,
        }),
      ),
  );

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> => {
    const ctx = sessions.get(threadId);
    return ctx === undefined || ctx.stopped
      ? Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
      : Effect.succeed(ctx);
  };

  const updateSession = Effect.fn("PiAdapter.updateSession")(function* (
    ctx: PiSessionContext,
    status: ProviderSession["status"],
    activeTurnId?: TurnId,
  ) {
    const { activeTurnId: _activeTurnId, ...base } = ctx.session;
    ctx.session = {
      ...base,
      status,
      updatedAt: yield* nowIso,
      ...(activeTurnId === undefined ? {} : { activeTurnId }),
      ...(resumeCursor(ctx) === undefined ? {} : { resumeCursor: resumeCursor(ctx) }),
    };
  });

  const completeActiveTurn = Effect.fn("PiAdapter.completeActiveTurn")(function* (
    ctx: PiSessionContext,
    state: "completed" | "failed" | "interrupted" | "cancelled",
    detail?: string,
  ) {
    const turnId = ctx.activeTurnId;
    if (turnId === undefined) return;
    ctx.activeTurnId = undefined;
    ctx.streaming = false;
    yield* updateSession(ctx, state === "failed" ? "error" : "ready");
    yield* offerRuntimeEvent({
      type: "turn.completed",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      turnId,
      payload: {
        state,
        ...(detail === undefined ? {} : { errorMessage: detail }),
      },
    });
  });

  const emitError = Effect.fn("PiAdapter.emitError")(function* (
    ctx: PiSessionContext,
    message: string,
    detail?: unknown,
  ) {
    yield* offerRuntimeEvent({
      type: "runtime.error",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      ...(ctx.activeTurnId === undefined ? {} : { turnId: ctx.activeTurnId }),
      payload: {
        message,
        class: "provider_error",
        ...(detail === undefined ? {} : { detail }),
      },
    });
  });

  const handleUnexpectedProcessExit = Effect.fn("PiAdapter.handleUnexpectedProcessExit")(function* (
    ctx: PiSessionContext,
    message: string,
    detail?: unknown,
  ) {
    if (ctx.stopped) return;
    ctx.stopped = true;
    sessions.delete(ctx.threadId);
    yield* emitError(ctx, message, detail);
    yield* completeActiveTurn(ctx, "failed", message);
    yield* updateSession(ctx, "error");
    yield* offerRuntimeEvent({
      type: "session.exited",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      payload: {
        exitKind: "error",
        reason: message,
        recoverable: true,
      },
    });
    yield* Scope.close(ctx.scope, Exit.void).pipe(Effect.ignore, Effect.forkIn(adapterScope));
  });

  const emitUsage = Effect.fn("PiAdapter.emitUsage")(function* (
    ctx: PiSessionContext,
    usage: ThreadTokenUsageSnapshot,
  ) {
    yield* offerRuntimeEvent({
      type: "thread.token-usage.updated",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      ...(ctx.activeTurnId === undefined ? {} : { turnId: ctx.activeTurnId }),
      payload: { usage },
    });
  });

  const emitContentDelta = Effect.fn("PiAdapter.emitContentDelta")(function* (
    ctx: PiSessionContext,
    streamKind: "assistant_text" | "reasoning_text",
    contentIndex: number,
    delta: string,
  ) {
    const turnId = ctx.activeTurnId;
    if (turnId === undefined || delta.length === 0) return;
    const reasoningItemId =
      streamKind === "reasoning_text"
        ? ctx.reasoningItemByContentIndex.get(contentIndex)
        : undefined;
    yield* offerRuntimeEvent({
      type: "content.delta",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      turnId,
      ...(reasoningItemId === undefined ? {} : { itemId: reasoningItemId }),
      payload: { streamKind, delta, contentIndex },
    });
  });

  // message_end carries the authoritative content. Deltas were already
  // published as they streamed and content.delta is append-only, so
  // reconciliation can only add a missing suffix; a divergent final is
  // corrected by the completed assistant_message item, which carries the
  // authoritative content.
  const reconcileFinalContent = Effect.fn("PiAdapter.reconcileFinalContent")(function* (
    ctx: PiSessionContext,
    streamKind: "assistant_text" | "reasoning_text",
    contentIndex: number,
    authoritative: string,
  ) {
    const contentByIndex =
      streamKind === "assistant_text" ? ctx.textByContentIndex : ctx.thinkingByContentIndex;
    const assembled = contentByIndex.get(contentIndex) ?? "";
    contentByIndex.set(contentIndex, authoritative);
    if (authoritative.startsWith(assembled)) {
      yield* emitContentDelta(ctx, streamKind, contentIndex, authoritative.slice(assembled.length));
    }
  });

  const startReasoningItem = Effect.fn("PiAdapter.startReasoningItem")(function* (
    ctx: PiSessionContext,
    contentIndex: number,
  ) {
    if (ctx.activeTurnId === undefined || ctx.reasoningItemByContentIndex.has(contentIndex)) {
      return;
    }
    const itemId = RuntimeItemId.make(`pi-reasoning-${yield* randomUUIDv4}`);
    ctx.reasoningItemByContentIndex.set(contentIndex, itemId);
    yield* offerRuntimeEvent({
      type: "item.started",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      turnId: ctx.activeTurnId,
      itemId,
      payload: {
        itemType: "reasoning",
        status: "inProgress",
        title: "Reasoning",
      },
    });
  });

  const completeReasoningItem = Effect.fn("PiAdapter.completeReasoningItem")(function* (
    ctx: PiSessionContext,
    contentIndex: number,
  ) {
    const itemId = ctx.reasoningItemByContentIndex.get(contentIndex);
    if (ctx.activeTurnId === undefined || itemId === undefined) return;
    ctx.reasoningItemByContentIndex.delete(contentIndex);
    yield* offerRuntimeEvent({
      type: "item.completed",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      turnId: ctx.activeTurnId,
      itemId,
      payload: {
        itemType: "reasoning",
        status: "completed",
        title: "Reasoning",
      },
    });
  });

  const handleAssistantMessageEvent = Effect.fn("PiAdapter.handleAssistantMessageEvent")(function* (
    ctx: PiSessionContext,
    nativeEvent: Readonly<Record<PropertyKey, unknown>>,
  ) {
    const type = nativeEvent["type"];
    const contentIndex = finiteNonNegative(nativeEvent["contentIndex"]) ?? 0;
    const isThinking =
      type === "thinking_start" || type === "thinking_delta" || type === "thinking_end";
    const isText = type === "text_start" || type === "text_delta" || type === "text_end";
    if (!isThinking && !isText) return;
    const contentByIndex = isThinking ? ctx.thinkingByContentIndex : ctx.textByContentIndex;
    if (type === "text_start" || type === "thinking_start") {
      contentByIndex.set(contentIndex, "");
      if (isThinking) {
        yield* startReasoningItem(ctx, contentIndex);
      }
      return;
    }
    const delta = typeof nativeEvent["delta"] === "string" ? nativeEvent["delta"] : "";
    if (type === "text_delta" || type === "thinking_delta") {
      contentByIndex.set(contentIndex, `${contentByIndex.get(contentIndex) ?? ""}${delta}`);
      yield* emitContentDelta(
        ctx,
        isThinking ? "reasoning_text" : "assistant_text",
        contentIndex,
        delta,
      );
      return;
    }
    // text_end/thinking_end need no handling: message_end carries the
    // authoritative content and reconcileFinalContent settles it there.
  });

  const handleToolEvent = Effect.fn("PiAdapter.handleToolEvent")(function* (
    ctx: PiSessionContext,
    nativeEvent: Readonly<Record<PropertyKey, unknown>>,
  ) {
    const type = nativeEvent["type"];
    // pi's inner agent package has renamed tool_execution_* to tool_*; the RPC
    // surface still emits the long names, so accept both spellings.
    const lifecycle =
      type === "tool_execution_start" || type === "tool_start"
        ? "item.started"
        : type === "tool_execution_update" || type === "tool_update"
          ? "item.updated"
          : type === "tool_execution_end" || type === "tool_end"
            ? "item.completed"
            : undefined;
    if (lifecycle === undefined || ctx.activeTurnId === undefined) return false;
    const toolCallId = nonEmptyString(nativeEvent["toolCallId"]);
    if (toolCallId === undefined) return true;
    const suppliedToolName = nonEmptyString(nativeEvent["toolName"]);
    if (suppliedToolName !== undefined) {
      ctx.toolNameByCallId.set(toolCallId, suppliedToolName);
    }
    const toolName = suppliedToolName ?? ctx.toolNameByCallId.get(toolCallId) ?? "unknown";
    const result = nativeEvent["result"] ?? nativeEvent["partialResult"];
    const isError = nativeEvent["isError"] === true;
    yield* offerRuntimeEvent({
      type: lifecycle,
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      turnId: ctx.activeTurnId,
      itemId: RuntimeItemId.make(toolCallId),
      providerRefs: { providerItemId: ProviderItemId.make(toolCallId) },
      payload: {
        itemType: toolItemType(toolName),
        status: lifecycle === "item.completed" ? (isError ? "failed" : "completed") : "inProgress",
        title: toolName,
        ...(lifecycle === "item.started"
          ? { data: nativeEvent["args"] }
          : result === undefined
            ? {}
            : { data: result }),
      },
    });
    if (lifecycle === "item.completed") {
      ctx.toolNameByCallId.delete(toolCallId);
    }
    return true;
  });

  const handlePiEvent = Effect.fn("PiAdapter.handlePiEvent")(function* (
    ctx: PiSessionContext,
    event: PiRpcEvent,
  ) {
    yield* logNative(ctx.threadId, event);
    const nativeEvent = nativeEventRecord(event);
    if (nativeEvent === undefined) return;
    if (yield* handleToolEvent(ctx, nativeEvent)) return;
    const type = nativeEvent["type"];

    if (type === "agent_start") {
      if (ctx.activeTurnId === undefined) {
        ctx.activeTurnId = TurnId.make(yield* randomUUIDv4);
      }
      if (!ctx.streaming) {
        ctx.streaming = true;
        ctx.textByContentIndex.clear();
        ctx.thinkingByContentIndex.clear();
        ctx.reasoningItemByContentIndex.clear();
        ctx.toolNameByCallId.clear();
        ctx.turnFailureMessage = undefined;
        yield* updateSession(ctx, "running", ctx.activeTurnId);
        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId: ctx.activeTurnId,
          payload: ctx.session.model === undefined ? {} : { model: ctx.session.model },
        });
      }
      return;
    }

    if (type === "agent_settled") {
      const failureMessage = ctx.turnFailureMessage;
      const interrupted = ctx.turnInterrupted;
      ctx.turnFailureMessage = undefined;
      ctx.turnInterrupted = false;
      yield* completeActiveTurn(
        ctx,
        interrupted ? "interrupted" : failureMessage === undefined ? "completed" : "failed",
        failureMessage,
      );
      return;
    }

    if (type === "message_update") {
      const assistantEvent = record(nativeEvent["assistantMessageEvent"]);
      if (assistantEvent !== undefined) {
        yield* handleAssistantMessageEvent(ctx, assistantEvent);
      }
      return;
    }

    if (type === "message_end") {
      const message = nativeEvent["message"];
      const messageRecord = record(message);
      if (messageRecord?.["role"] !== "assistant") return;
      const contentParts = assistantContent(message);
      for (const [contentIndex, part] of contentParts.entries()) {
        if (part["type"] === "text" && typeof part["text"] === "string") {
          yield* reconcileFinalContent(ctx, "assistant_text", contentIndex, part["text"]);
        } else if (part["type"] === "thinking" && typeof part["thinking"] === "string") {
          yield* reconcileFinalContent(ctx, "reasoning_text", contentIndex, part["thinking"]);
          yield* completeReasoningItem(ctx, contentIndex);
        }
      }
      const entryId = nonEmptyString(nativeEvent["entryId"]);
      if (entryId !== undefined) ctx.leafId = entryId;
      if (ctx.activeTurnId !== undefined) {
        const itemId = RuntimeItemId.make(entryId ?? `pi-assistant-${yield* randomUUIDv4}`);
        const finalText = contentParts
          .flatMap((part) =>
            part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
          )
          .join("");
        yield* offerRuntimeEvent({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: ctx.threadId,
          turnId: ctx.activeTurnId,
          itemId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            ...(finalText.trim().length === 0 ? {} : { detail: finalText }),
            data: message,
          },
        });
      }
      const usage = usageFromMessage(message);
      if (usage !== undefined) yield* emitUsage(ctx, usage);
      if (messageRecord["stopReason"] === "error") {
        const errorMessage =
          nonEmptyString(messageRecord["errorMessage"]) ?? "pi assistant message failed.";
        ctx.turnFailureMessage = errorMessage;
        yield* emitError(ctx, errorMessage, message);
      }
      return;
    }

    if (type === "compaction_start") {
      const itemId = RuntimeItemId.make(`pi-compaction-${yield* randomUUIDv4}`);
      ctx.compactionItemId = itemId;
      yield* offerRuntimeEvent({
        type: "item.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        ...(ctx.activeTurnId === undefined ? {} : { turnId: ctx.activeTurnId }),
        itemId,
        payload: {
          itemType: "context_compaction",
          status: "inProgress",
          title: "Context compaction",
          data: nativeEvent,
        },
      });
      return;
    }

    if (type === "compaction_end") {
      const itemId =
        ctx.compactionItemId ?? RuntimeItemId.make(`pi-compaction-${yield* randomUUIDv4}`);
      ctx.compactionItemId = undefined;
      yield* offerRuntimeEvent({
        type: "item.completed",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        ...(ctx.activeTurnId === undefined ? {} : { turnId: ctx.activeTurnId }),
        itemId,
        payload: {
          itemType: "context_compaction",
          status: nativeEvent["errorMessage"] === undefined ? "completed" : "failed",
          title: "Context compaction",
          data: nativeEvent,
        },
      });
      return;
    }

    if (type === "auto_retry_start" || type === "auto_retry_end") {
      if (type === "auto_retry_start") {
        ctx.turnFailureMessage = undefined;
      }
      const message =
        nonEmptyString(nativeEvent["errorMessage"]) ??
        nonEmptyString(nativeEvent["finalError"]) ??
        (type === "auto_retry_start" ? "pi is retrying the turn." : "pi retry finished.");
      yield* offerRuntimeEvent({
        type: "runtime.warning",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: ctx.threadId,
        ...(ctx.activeTurnId === undefined ? {} : { turnId: ctx.activeTurnId }),
        payload: { message, detail: nativeEvent },
      });
      return;
    }

    if (type === "extension_error") {
      const detail = nativeEvent["error"];
      yield* emitError(
        ctx,
        nonEmptyString(record(detail)?.["message"]) ??
          nonEmptyString(detail) ??
          "pi extension failed.",
        detail,
      );
    }
  });

  const stopSessionInternal = Effect.fn("PiAdapter.stopSessionInternal")(function* (
    ctx: PiSessionContext,
  ) {
    if (ctx.stopped) return;
    ctx.stopped = true;
    if (ctx.eventFiber !== undefined) {
      yield* Fiber.interrupt(ctx.eventFiber);
    }
    yield* Scope.close(ctx.scope, Exit.void).pipe(Effect.ignore);
    sessions.delete(ctx.threadId);
    yield* offerRuntimeEvent({
      type: "session.exited",
      ...(yield* makeEventStamp()),
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: ctx.threadId,
      payload: { exitKind: "graceful" },
    });
  });

  const applyModelSelection = Effect.fn("PiAdapter.applyModelSelection")(function* (
    ctx: PiSessionContext,
    modelSelection: Parameters<PiAdapterShape["sendTurn"]>[0]["modelSelection"],
  ) {
    if (modelSelection?.instanceId !== boundInstanceId) return;
    const parsedModel = splitPiModelSlug(modelSelection.model);
    if (parsedModel === null) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "modelSelection",
        issue: "Pi model selection must use the 'provider/model' format.",
      });
    }
    yield* ctx.client
      .request({ type: "set_model", ...parsedModel })
      .pipe(Effect.mapError((cause) => adapterError(ctx.threadId, "set_model", cause)));
    const rawThinkingLevel = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
    if (rawThinkingLevel !== undefined) {
      if (!THINKING_LEVELS.has(rawThinkingLevel as PiThinkingLevel)) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "modelSelection",
          issue: `Unsupported pi thinking level '${rawThinkingLevel}'.`,
        });
      }
      yield* ctx.client
        .request({
          type: "set_thinking_level",
          level: rawThinkingLevel as PiThinkingLevel,
        })
        .pipe(Effect.mapError((cause) => adapterError(ctx.threadId, "set_thinking_level", cause)));
    }
    ctx.session = {
      ...ctx.session,
      model: modelSelection.model,
      updatedAt: yield* nowIso,
    };
  });

  const startSession: PiAdapterShape["startSession"] = Effect.fn("PiAdapter.startSession")(
    function* (input) {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }
      const rawCwd = input.cwd?.trim();
      if (!rawCwd) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "cwd is required and must be non-empty.",
        });
      }
      const existing = sessions.get(input.threadId);
      if (existing !== undefined && !existing.stopped) {
        yield* existing.lock.withPermit(stopSessionInternal(existing));
      }

      const cwd = path.resolve(rawCwd);
      const threadSegment = toSafeThreadAttachmentSegment(input.threadId);
      if (threadSegment === null) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "threadId cannot be converted into a safe pi session directory.",
        });
      }
      const sessionDir = path.join(serverConfig.stateDir, "provider-sessions", "pi", threadSegment);
      yield* fileSystem.makeDirectory(sessionDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: `Failed to create pi session directory: ${cause.message}`,
              cause,
            }),
        ),
      );

      const parsedResume = parsePiResumeCursor(input.resumeCursor);
      const args = [
        "--mode",
        "rpc",
        "--session-dir",
        sessionDir,
        ...(parsedResume === undefined ? [] : ["--session", parsedResume.sessionFile]),
        ...(input.runtimeMode === "approval-required" || input.runtimeMode === "auto-accept-edits"
          ? ["--tools", READ_ONLY_TOOLS]
          : []),
        ...(piSettings.trustProjectFiles ? ["--approve"] : []),
      ];
      const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
      const needsEnvironment =
        options?.environment !== undefined ||
        mcpSession !== undefined ||
        piSettings.homePath.trim().length > 0;
      const environment = needsEnvironment
        ? piEnvironment(piSettings, {
            ...(options?.environment ?? process.env),
            ...(mcpSession === undefined
              ? {}
              : McpProviderSession.agentSessionEnvironment(mcpSession)),
          })
        : undefined;
      const sessionScope = yield* Scope.make("sequential");
      let transferred = false;
      let provisionalContext: PiSessionContext | undefined;
      yield* Effect.addFinalizer(() =>
        transferred
          ? Effect.void
          : Effect.gen(function* () {
              if (provisionalContext !== undefined) {
                provisionalContext.stopped = true;
                sessions.delete(provisionalContext.threadId);
              }
              yield* Scope.close(sessionScope, Exit.void);
            }),
      );
      const client = yield* spawnPiRpcClient({
        executable: piExecutable(piSettings),
        args,
        cwd,
        ...(environment === undefined ? {} : { env: environment }),
      }).pipe(
        Effect.provideService(Scope.Scope, sessionScope),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
        Effect.mapError(
          (cause: PiRpcSpawnError) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: cause.message,
              cause,
            }),
        ),
      );

      const timestamp = yield* nowIso;
      const lock = yield* Semaphore.make(1);
      const selectedModel =
        input.modelSelection?.instanceId === boundInstanceId
          ? input.modelSelection.model
          : undefined;
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        ...(selectedModel === undefined ? {} : { model: selectedModel }),
        threadId: input.threadId,
        ...(parsedResume === undefined ? {} : { resumeCursor: parsedResume }),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const ctx: PiSessionContext = {
        threadId: input.threadId,
        session,
        scope: sessionScope,
        client,
        lock,
        eventFiber: undefined,
        activeTurnId: undefined,
        streaming: false,
        stopped: false,
        sessionFile: parsedResume?.sessionFile,
        leafId: parsedResume?.leafId,
        entries: [],
        textByContentIndex: new Map(),
        thinkingByContentIndex: new Map(),
        reasoningItemByContentIndex: new Map(),
        toolNameByCallId: new Map(),
        compactionItemId: undefined,
        turnFailureMessage: undefined,
        turnInterrupted: false,
      };
      provisionalContext = ctx;
      sessions.set(input.threadId, ctx);

      ctx.eventFiber = yield* client.events.pipe(
        Stream.runForEach((event) => handlePiEvent(ctx, event)),
        Effect.andThen(
          Effect.gen(function* () {
            if (ctx.stopped) return;
            yield* handleUnexpectedProcessExit(ctx, "pi RPC process exited unexpectedly.");
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logError("Failed to process pi RPC events.", {
            cause,
            threadId: input.threadId,
          }),
        ),
        Effect.forkIn(sessionScope),
      );

      yield* applyModelSelection(ctx, input.modelSelection);
      let statsUsage: ThreadTokenUsageSnapshot | undefined;
      const statsResponse = yield* client
        .request({ type: "get_session_stats" })
        .pipe(Effect.mapError((cause) => adapterError(input.threadId, "get_session_stats", cause)));
      if (statsResponse.data !== undefined) {
        const stats = yield* decodeSessionStats(statsResponse.data).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "get_session_stats",
                detail: "pi returned invalid session stats.",
                cause,
              }),
          ),
        );
        ctx.sessionFile = stats.sessionFile ?? ctx.sessionFile;
        statsUsage = usageFromStats(stats);
      }
      yield* updateSession(ctx, "ready");
      transferred = true;

      yield* offerRuntimeEvent({
        type: "session.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        payload: parsedResume === undefined ? {} : { resume: parsedResume },
      });
      yield* offerRuntimeEvent({
        type: "session.state.changed",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        payload: { state: "ready", reason: "pi RPC session ready" },
      });
      yield* offerRuntimeEvent({
        type: "thread.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId: input.threadId,
        payload: ctx.sessionFile === undefined ? {} : { providerThreadId: ctx.sessionFile },
      });
      if (statsUsage !== undefined) {
        yield* emitUsage(ctx, statsUsage);
      }

      return ctx.session;
    },
    Effect.scoped,
  );

  const sendTurn: PiAdapterShape["sendTurn"] = Effect.fn("PiAdapter.sendTurn")(function* (input) {
    const ctx = yield* requireSession(input.threadId);
    const text = input.input?.trim();
    const images = yield* Effect.forEach(input.attachments ?? [], (attachment) =>
      Effect.gen(function* () {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (attachmentPath === null) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "prompt",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "prompt",
                detail: cause.message,
                cause,
              }),
          ),
        );
        return {
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        };
      }),
    );
    if (!text && images.length === 0) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "Turn requires non-empty text or attachments.",
      });
    }
    // set_model/set_thinking_level and the prompt must land on pi as one unit:
    // a concurrent sendTurn carrying a different model could otherwise slip its
    // own set_model between this turn's set_model and prompt.
    const prepared = yield* ctx.lock.withPermit(
      Effect.gen(function* () {
        if (ctx.stopped || sessions.get(input.threadId) !== ctx) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }
        yield* applyModelSelection(ctx, input.modelSelection);
        const streamingBehavior = ctx.streaming
          ? ("steer" as const)
          : ctx.activeTurnId !== undefined
            ? ("followUp" as const)
            : undefined;
        const turnId = ctx.activeTurnId ?? TurnId.make(yield* randomUUIDv4);
        ctx.activeTurnId = turnId;
        yield* updateSession(
          ctx,
          streamingBehavior === undefined ? "connecting" : "running",
          turnId,
        );
        const promptOutcome = yield* ctx.client
          .request({
            type: "prompt",
            message: text ?? "",
            ...(images.length === 0 ? {} : { images }),
            ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
          })
          .pipe(Effect.result);
        return { promptOutcome, turnId, wasStreaming: streamingBehavior !== undefined };
      }),
    );
    if (Result.isFailure(prepared.promptOutcome)) {
      const cause = adapterError(input.threadId, "prompt", prepared.promptOutcome.failure);
      if (cause._tag === "ProviderAdapterProcessError") {
        yield* handleUnexpectedProcessExit(ctx, cause.message, cause);
      } else if (!ctx.stopped) {
        yield* emitError(ctx, cause.message, cause);
        if (!prepared.wasStreaming) {
          yield* completeActiveTurn(ctx, "failed", cause.message);
        }
      }
      return yield* cause;
    }
    return {
      threadId: input.threadId,
      turnId: prepared.turnId,
      ...(resumeCursor(ctx) === undefined ? {} : { resumeCursor: resumeCursor(ctx) }),
    };
  });

  const interruptTurn: PiAdapterShape["interruptTurn"] = Effect.fn("PiAdapter.interruptTurn")(
    function* (threadId, turnId) {
      const ctx = yield* requireSession(threadId);
      const shouldAbort = yield* ctx.lock.withPermit(
        Effect.sync(() => {
          if (ctx.stopped || sessions.get(threadId) !== ctx) return;
          if (
            turnId !== undefined &&
            ctx.activeTurnId !== undefined &&
            turnId !== ctx.activeTurnId
          ) {
            return;
          }
          if (ctx.activeTurnId !== undefined) {
            ctx.turnInterrupted = true;
          }
          return true;
        }),
      );
      if (shouldAbort !== true) return;
      yield* ctx.client
        .request({ type: "abort" })
        .pipe(Effect.mapError((cause) => adapterError(threadId, "abort", cause)));
    },
  );

  const readEntries = Effect.fn("PiAdapter.readEntries")(function* (
    ctx: PiSessionContext,
    since: string | undefined,
  ) {
    const response = yield* ctx.client
      .request({
        type: "get_entries",
        ...(since === undefined ? {} : { since }),
      })
      .pipe(Effect.mapError((cause) => adapterError(ctx.threadId, "get_entries", cause)));
    const decoded = yield* decodeEntries(response.data).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "get_entries",
            detail: "pi returned invalid session entries.",
            cause,
          }),
      ),
    );
    const entriesById = new Map(ctx.entries.map((entry) => [entry.id, entry]));
    for (const entry of decoded.entries) {
      const { parentId, ...entryWithoutParent } = entry;
      entriesById.set(
        entry.id,
        parentId === null || parentId === undefined
          ? entryWithoutParent
          : { ...entryWithoutParent, parentId },
      );
    }
    ctx.entries = [...entriesById.values()];
    ctx.leafId = decoded.leafId ?? ctx.leafId;
    yield* updateSession(ctx, ctx.session.status, ctx.activeTurnId);
    return snapshotFromEntries(ctx.threadId, ctx.entries);
  });

  const readThread: PiAdapterShape["readThread"] = Effect.fn("PiAdapter.readThread")(
    function* (threadId) {
      const ctx = yield* requireSession(threadId);
      const since = ctx.leafId;
      const needsFullSnapshot = since !== undefined && ctx.entries.length === 0;
      const incremental = yield* readEntries(ctx, since);
      return needsFullSnapshot ? yield* readEntries(ctx, undefined) : incremental;
    },
  );

  const rollbackThread: PiAdapterShape["rollbackThread"] = Effect.fn("PiAdapter.rollbackThread")(
    function* (threadId, numTurns) {
      const ctx = yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        });
      }
      yield* readEntries(ctx, undefined);
      const userEntries = ctx.entries.filter((entry) => {
        const message = record(entry.message);
        return entry.type === "message" && message?.["role"] === "user";
      });
      const target = userEntries[userEntries.length - numTurns];
      if (target === undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: `Cannot roll back ${numTurns} turn(s); the pi thread has only ${userEntries.length}.`,
        });
      }
      yield* ctx.client
        .request({ type: "fork", entryId: target.id })
        .pipe(Effect.mapError((cause) => adapterError(threadId, "fork", cause)));
      const targetIndex = ctx.entries.findIndex((entry) => entry.id === target.id);
      ctx.entries = targetIndex < 0 ? ctx.entries : ctx.entries.slice(0, targetIndex);
      ctx.leafId = target.parentId;
      yield* updateSession(ctx, ctx.session.status, ctx.activeTurnId);
      return snapshotFromEntries(threadId, ctx.entries);
    },
  );

  // ProviderUnsupportedError belongs to ProviderServiceError rather than the
  // narrower adapter union, but v1 must preserve this runtime error identity.
  const unsupportedError = new ProviderUnsupportedError({
    provider: PROVIDER,
  }) as unknown as ProviderAdapterError;
  const unsupported = () => Effect.fail(unsupportedError);
  const respondToRequest: PiAdapterShape["respondToRequest"] = () => unsupported();
  const respondToUserInput: PiAdapterShape["respondToUserInput"] = () => unsupported();
  const stopSession: PiAdapterShape["stopSession"] = Effect.fn("PiAdapter.stopSession")(
    function* (threadId) {
      const ctx = yield* requireSession(threadId);
      yield* ctx.lock.withPermit(stopSessionInternal(ctx));
    },
  );
  const listSessions: PiAdapterShape["listSessions"] = () =>
    Effect.sync(() => [...sessions.values()].map((ctx) => ({ ...ctx.session })));
  const hasSession: PiAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => {
      const ctx = sessions.get(threadId);
      return ctx !== undefined && !ctx.stopped;
    });
  const stopAll: PiAdapterShape["stopAll"] = () =>
    Effect.forEach([...sessions.values()], (ctx) => ctx.lock.withPermit(stopSessionInternal(ctx)), {
      concurrency: "unbounded",
      discard: true,
    });

  yield* Effect.addFinalizer(() =>
    Effect.ignore(stopAll()).pipe(
      Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  } satisfies PiAdapterShape;
});
