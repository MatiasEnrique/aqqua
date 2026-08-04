import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Effect } from "effect";

import type { UsageTurnRecord } from "./UsageRollup.ts";

const ClaudeUsageSchema = Schema.Struct({
  input_tokens: Schema.Natural,
  cache_creation_input_tokens: Schema.optionalKey(Schema.Natural),
  cache_read_input_tokens: Schema.optionalKey(Schema.Natural),
  output_tokens: Schema.Natural,
});

const ClaudeAssistantLineSchema = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("assistant"),
    requestId: Schema.String,
    timestamp: Schema.DateTimeUtcFromString,
    cwd: Schema.String,
    sessionId: Schema.String,
    gitBranch: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
    isSidechain: Schema.optionalKey(Schema.Boolean),
    message: Schema.Struct({
      model: Schema.String,
      usage: ClaudeUsageSchema,
    }),
  }),
);

const decodeClaudeAssistantLine = Schema.decodeUnknownOption(ClaudeAssistantLineSchema);

export interface ClaudeTurnRecord extends UsageTurnRecord {
  readonly provider: "claude";
  readonly requestId: string;
}

export interface ClaudeLogParseState {
  readonly seenRequestIds: ReadonlySet<string>;
}

export interface ClaudeLogParseResult {
  readonly turns: ReadonlyArray<ClaudeTurnRecord>;
  readonly state: ClaudeLogParseState;
}

export function parseClaudeLogLine(line: string): ClaudeTurnRecord | null {
  const decoded = Option.getOrNull(decodeClaudeAssistantLine(line));
  if (decoded === null || decoded.requestId.length === 0 || decoded.sessionId.length === 0) {
    return null;
  }
  // Claude Code writes locally generated assistant messages (errors, notices)
  // with a "<synthetic>" model and zero tokens; they are not API usage.
  if (decoded.message.model === "<synthetic>") {
    return null;
  }

  return {
    provider: "claude",
    requestId: decoded.requestId,
    sessionId: decoded.sessionId,
    timestamp: DateTime.formatIso(decoded.timestamp),
    model: decoded.message.model,
    projectPath: decoded.cwd,
    gitBranch: decoded.gitBranch ?? null,
    inputTokens: decoded.message.usage.input_tokens,
    cachedInputTokens: decoded.message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: decoded.message.usage.cache_creation_input_tokens ?? 0,
    outputTokens: decoded.message.usage.output_tokens,
    reasoningTokens: 0,
    isSubagent: decoded.isSidechain === true,
  };
}

export function parseClaudeLog(
  content: string,
  carriedState?: ClaudeLogParseState,
): ClaudeLogParseResult {
  const seenRequestIds = new Set(carriedState?.seenRequestIds ?? []);
  const turns: ClaudeTurnRecord[] = [];

  for (const line of content.split(/\r?\n/)) {
    const turn = parseClaudeLogLine(line);
    if (turn === null || seenRequestIds.has(turn.requestId)) continue;

    seenRequestIds.add(turn.requestId);
    turns.push(turn);
  }

  return {
    turns,
    state: { seenRequestIds },
  };
}

function isClaudeLogCandidate(relativePath: string): boolean {
  return /^[^/\\]+[/\\][^/\\]+\.jsonl$/.test(relativePath);
}

export const listClaudeLogFiles = Effect.fn("ClaudeLogSource.listClaudeLogFiles")(function* (
  projectsDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem.readDirectory(projectsDirectory, { recursive: true });

  return entries
    .filter(isClaudeLogCandidate)
    .map((entry) => path.join(projectsDirectory, entry))
    .sort();
});
