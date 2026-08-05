import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Effect } from "effect";

import type { UsageTurnRecord } from "./UsageRollup.ts";

const TokenCountersSchema = Schema.Struct({
  input_tokens: Schema.Natural,
  cached_input_tokens: Schema.Natural,
  cache_write_input_tokens: Schema.optionalKey(Schema.Natural),
  output_tokens: Schema.Natural,
  reasoning_output_tokens: Schema.Natural,
});

const SessionMetaLineSchema = Schema.Struct({
  type: Schema.Literal("session_meta"),
  payload: Schema.Struct({
    session_id: Schema.String,
    cwd: Schema.String,
    originator: Schema.optionalKey(Schema.String),
    source: Schema.optionalKey(Schema.Json),
  }),
});

const TurnContextLineSchema = Schema.Struct({
  type: Schema.Literal("turn_context"),
  timestamp: Schema.optionalKey(Schema.String),
  payload: Schema.Struct({
    model: Schema.optionalKey(Schema.String),
  }),
});

const TokenCountLineSchema = Schema.Struct({
  type: Schema.Literal("event_msg"),
  timestamp: Schema.DateTimeUtcFromString,
  payload: Schema.Struct({
    type: Schema.Literal("token_count"),
    info: Schema.Struct({
      total_token_usage: TokenCountersSchema,
    }),
    rate_limits: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const CodexLineSchema = Schema.fromJsonString(
  Schema.Union([SessionMetaLineSchema, TurnContextLineSchema, TokenCountLineSchema]),
);

const decodeCodexLine = Schema.decodeUnknownOption(CodexLineSchema);

export interface CodexTokenCounters {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface CodexLogParseState {
  readonly sessionId: string | null;
  readonly projectPath: string | null;
  readonly originator: string | null;
  readonly sessionSource: Schema.Json | null;
  readonly model: string | null;
  readonly previousTotal: CodexTokenCounters | null;
}

export interface CodexTurnRecord extends UsageTurnRecord {
  readonly provider: "codex";
  readonly originator: string | null;
  readonly sessionSource: Schema.Json | null;
}

export interface CodexInlineRateLimits {
  readonly timestamp: string;
  readonly rateLimits: Readonly<Record<string, unknown>>;
}

export interface CodexLogParseResult {
  readonly turns: ReadonlyArray<CodexTurnRecord>;
  readonly state: CodexLogParseState;
  readonly rateLimits: CodexInlineRateLimits | null;
}

export type CodexLogLine = Schema.Schema.Type<typeof CodexLineSchema>;

const EMPTY_STATE: CodexLogParseState = {
  sessionId: null,
  projectPath: null,
  originator: null,
  sessionSource: null,
  model: null,
  previousTotal: null,
};

function toCounters(input: Schema.Schema.Type<typeof TokenCountersSchema>): CodexTokenCounters {
  return {
    inputTokens: input.input_tokens,
    cachedInputTokens: input.cached_input_tokens,
    cacheWriteTokens: input.cache_write_input_tokens ?? 0,
    outputTokens: input.output_tokens,
    reasoningTokens: input.reasoning_output_tokens,
  };
}

function difference(
  current: CodexTokenCounters,
  previous: CodexTokenCounters | null,
): CodexTokenCounters {
  if (
    previous === null ||
    current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.cacheWriteTokens < previous.cacheWriteTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningTokens < previous.reasoningTokens
  ) {
    return current;
  }

  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    cacheWriteTokens: current.cacheWriteTokens - previous.cacheWriteTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningTokens: current.reasoningTokens - previous.reasoningTokens,
  };
}

function hasUsage(counters: CodexTokenCounters): boolean {
  return (
    counters.inputTokens > 0 ||
    counters.cachedInputTokens > 0 ||
    counters.cacheWriteTokens > 0 ||
    counters.outputTokens > 0 ||
    counters.reasoningTokens > 0
  );
}

function separateInputTokenCategories(counters: CodexTokenCounters): CodexTokenCounters {
  return {
    ...counters,
    inputTokens: Math.max(
      0,
      counters.inputTokens - counters.cachedInputTokens - counters.cacheWriteTokens,
    ),
  };
}

export function parseCodexLogLine(line: string): CodexLogLine | null {
  return Option.getOrNull(decodeCodexLine(line));
}

export function parseCodexLog(
  content: string,
  carriedState: CodexLogParseState = EMPTY_STATE,
): CodexLogParseResult {
  let state = { ...carriedState };
  let rateLimits: CodexInlineRateLimits | null = null;
  const turns: CodexTurnRecord[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = parseCodexLogLine(rawLine);
    if (line === null) continue;

    if (line.type === "session_meta") {
      const isNewSession = state.sessionId !== null && state.sessionId !== line.payload.session_id;
      state.sessionId = line.payload.session_id;
      state.projectPath = line.payload.cwd;
      state.originator = line.payload.originator ?? null;
      state.sessionSource = line.payload.source ?? null;
      if (isNewSession) {
        state.model = null;
        state.previousTotal = null;
      }
      continue;
    }

    if (line.type === "turn_context") {
      state.model = line.payload.model ?? state.model;
      continue;
    }

    const timestamp = DateTime.formatIso(line.timestamp);

    if (line.payload.rate_limits !== undefined) {
      rateLimits = {
        timestamp,
        rateLimits: line.payload.rate_limits,
      };
    }

    const current = toCounters(line.payload.info.total_token_usage);

    const delta = separateInputTokenCategories(difference(current, state.previousTotal));
    state.previousTotal = current;
    if (!hasUsage(delta) || state.sessionId === null) continue;

    turns.push({
      provider: "codex",
      sessionId: state.sessionId,
      timestamp,
      model: state.model,
      projectPath: state.projectPath,
      gitBranch: null,
      ...delta,
      isSubagent: false,
      originator: state.originator,
      sessionSource: state.sessionSource,
    });
  }

  return { turns, state, rateLimits };
}

function isCodexLogCandidate(relativePath: string): boolean {
  return /^\d{4}[/\\]\d{2}[/\\]\d{2}[/\\]rollout-.+\.jsonl$/.test(relativePath);
}

export const listCodexLogFiles = Effect.fn("CodexLogSource.listCodexLogFiles")(function* (
  sessionsDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem.readDirectory(sessionsDirectory, { recursive: true });

  return entries
    .filter(isCodexLogCandidate)
    .map((entry) => path.join(sessionsDirectory, entry))
    .sort();
});
