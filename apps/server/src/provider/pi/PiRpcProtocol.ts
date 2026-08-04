import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

const LooseRecord = Schema.Record(Schema.String, Schema.Unknown);

export const PiThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type PiThinkingLevel = typeof PiThinkingLevel.Type;

export const PiImageContent = Schema.Struct({
  type: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
});
export type PiImageContent = typeof PiImageContent.Type;

const command = <Type extends string, Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) =>
  Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.Literal(type),
    ...fields,
  });

export const PiPromptCommand = command("prompt", {
  message: Schema.String,
  images: Schema.optional(Schema.Array(PiImageContent)),
  streamingBehavior: Schema.optional(Schema.Literals(["steer", "followUp"])),
});
export const PiSteerCommand = command("steer", {
  message: Schema.String,
  images: Schema.optional(Schema.Array(PiImageContent)),
});
export const PiFollowUpCommand = command("follow_up", {
  message: Schema.String,
  images: Schema.optional(Schema.Array(PiImageContent)),
});
export const PiAbortCommand = command("abort", {});
export const PiGetStateCommand = command("get_state", {});
export const PiSetModelCommand = command("set_model", {
  provider: Schema.String,
  modelId: Schema.String,
});
export const PiGetAvailableModelsCommand = command("get_available_models", {});
export const PiSetThinkingLevelCommand = command("set_thinking_level", {
  level: PiThinkingLevel,
});
export const PiCompactCommand = command("compact", {
  customInstructions: Schema.optional(Schema.String),
});
export const PiGetSessionStatsCommand = command("get_session_stats", {});
export const PiForkCommand = command("fork", { entryId: Schema.String });
export const PiGetEntriesCommand = command("get_entries", {
  since: Schema.optional(Schema.String),
});
export const PiGetTreeCommand = command("get_tree", {});
export const PiGetMessagesCommand = command("get_messages", {});
export const PiGetCommandsCommand = command("get_commands", {});

// Only the commands aqqua sends. pi's RPC surface is larger (bash,
// export_html, clone, session naming, queue modes, ...); add schemas here as
// integrations need them.
const PiRpcCommandSchemas = [
  PiPromptCommand,
  PiSteerCommand,
  PiFollowUpCommand,
  PiAbortCommand,
  PiGetStateCommand,
  PiSetModelCommand,
  PiGetAvailableModelsCommand,
  PiSetThinkingLevelCommand,
  PiCompactCommand,
  PiGetSessionStatsCommand,
  PiForkCommand,
  PiGetEntriesCommand,
  PiGetTreeCommand,
  PiGetMessagesCommand,
  PiGetCommandsCommand,
] as const;

export const PiRpcCommand = Schema.Union(PiRpcCommandSchemas);
export type PiRpcCommand = typeof PiRpcCommand.Type;

type WithoutId<Command> = Command extends unknown ? Omit<Command, "id"> : never;
export type PiRpcCommandInput = WithoutId<(typeof PiRpcCommandSchemas)[number]["Type"]>;

export const PiSessionStatsTokens = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  total: Schema.Number,
});

export const PiSessionStatsContextUsage = Schema.Struct({
  tokens: Schema.Number,
  contextWindow: Schema.Number,
  percent: Schema.Number,
});

export const PiSessionStatsData = Schema.Struct({
  sessionFile: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  userMessages: Schema.Number,
  assistantMessages: Schema.Number,
  toolCalls: Schema.Number,
  toolResults: Schema.Number,
  totalMessages: Schema.Number,
  tokens: PiSessionStatsTokens,
  cost: Schema.Number,
  contextUsage: PiSessionStatsContextUsage,
});
export type PiSessionStatsData = typeof PiSessionStatsData.Type;

export const PiSessionEntry = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  message: Schema.optional(Schema.Unknown),
});

export const PiGetEntriesData = Schema.Struct({
  entries: Schema.Array(PiSessionEntry),
  leafId: Schema.optional(Schema.String),
});
export type PiGetEntriesData = typeof PiGetEntriesData.Type;

export const PiRpcSuccessResponse = Schema.Struct({
  type: Schema.Literal("response"),
  id: Schema.String,
  command: Schema.String,
  success: Schema.Literal(true),
  data: Schema.optional(Schema.Unknown),
});
export type PiRpcSuccessResponse = typeof PiRpcSuccessResponse.Type;

export const PiRpcFailureResponse = Schema.Struct({
  type: Schema.Literal("response"),
  id: Schema.String,
  command: Schema.String,
  success: Schema.Literal(false),
  error: Schema.String,
});
export type PiRpcFailureResponse = typeof PiRpcFailureResponse.Type;

export const PiRpcResponse = Schema.Union([PiRpcSuccessResponse, PiRpcFailureResponse]);
export type PiRpcResponse = typeof PiRpcResponse.Type;

export const PiAssistantMessageEvent = Schema.Struct({
  type: Schema.String,
  contentIndex: Schema.optional(Schema.Number),
  delta: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  partial: Schema.optional(Schema.Unknown),
});
export type PiAssistantMessageEvent = typeof PiAssistantMessageEvent.Type;

const event = <Type extends string, Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    ...fields,
  });

export const PiAgentStartEvent = event("agent_start", {});
export const PiAgentEndEvent = event("agent_end", {
  messages: Schema.optional(Schema.Array(Schema.Unknown)),
  willRetry: Schema.Boolean,
});
export const PiAgentSettledEvent = event("agent_settled", {});
export const PiTurnStartEvent = event("turn_start", {});
export const PiTurnEndEvent = event("turn_end", {});
export const PiMessageStartEvent = event("message_start", {
  message: Schema.Unknown,
});
export const PiMessageUpdateEvent = event("message_update", {
  message: Schema.Unknown,
  assistantMessageEvent: PiAssistantMessageEvent,
});
export const PiMessageEndEvent = event("message_end", {
  message: Schema.Unknown,
  entryId: Schema.String,
});
export const PiToolExecutionStartEvent = event("tool_execution_start", {
  toolCallId: Schema.String,
  toolName: Schema.String,
  args: Schema.Unknown,
});
export const PiToolExecutionUpdateEvent = event("tool_execution_update", {
  toolCallId: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
});
export const PiToolExecutionEndEvent = event("tool_execution_end", {
  toolCallId: Schema.optional(Schema.String),
  result: Schema.Unknown,
  isError: Schema.Boolean,
});
export const PiQueueUpdateEvent = event("queue_update", {});
export const PiCompactionStartEvent = event("compaction_start", {});
export const PiCompactionEndEvent = event("compaction_end", {});
export const PiAutoRetryStartEvent = event("auto_retry_start", {});
export const PiAutoRetryEndEvent = event("auto_retry_end", {});
export const PiExtensionErrorEvent = event("extension_error", {
  error: Schema.optional(Schema.Unknown),
});

export const PiKnownEvent = Schema.Union([
  PiAgentStartEvent,
  PiAgentEndEvent,
  PiAgentSettledEvent,
  PiTurnStartEvent,
  PiTurnEndEvent,
  PiMessageStartEvent,
  PiMessageUpdateEvent,
  PiMessageEndEvent,
  PiToolExecutionStartEvent,
  PiToolExecutionUpdateEvent,
  PiToolExecutionEndEvent,
  PiQueueUpdateEvent,
  PiCompactionStartEvent,
  PiCompactionEndEvent,
  PiAutoRetryStartEvent,
  PiAutoRetryEndEvent,
  PiExtensionErrorEvent,
]);
export type PiKnownEvent = typeof PiKnownEvent.Type;

export const PiUnknownEventRecord = LooseRecord;
export type PiUnknownEventRecord = typeof PiUnknownEventRecord.Type;

export const PiUnknownEvent = Schema.TaggedStruct("PiUnknownEvent", {
  eventType: Schema.String,
  raw: PiUnknownEventRecord,
});
export type PiUnknownEvent = typeof PiUnknownEvent.Type;

export const PiUnknownEventFromRecord = PiUnknownEventRecord.pipe(
  Schema.decodeTo(PiUnknownEvent, {
    decode: SchemaGetter.transform((raw) =>
      PiUnknownEvent.make({
        eventType: typeof raw["type"] === "string" ? raw["type"] : "<missing>",
        raw,
      }),
    ),
    encode: SchemaGetter.transform((event) => event.raw),
  }),
);

export const PiProtocolDiagnostic = Schema.TaggedStruct("PiProtocolDiagnostic", {
  issue: Schema.Literal("malformed-jsonl"),
  line: Schema.String,
  detail: Schema.String,
});
export type PiProtocolDiagnostic = typeof PiProtocolDiagnostic.Type;

export const PiRpcEvent = Schema.Union([
  PiKnownEvent,
  PiProtocolDiagnostic,
  PiUnknownEventFromRecord,
]);
export type PiRpcEvent = typeof PiRpcEvent.Type;
