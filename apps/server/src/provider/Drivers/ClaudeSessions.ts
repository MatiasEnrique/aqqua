/**
 * ClaudeSessions — best-effort discovery and lazy reading of Claude Code TUI sessions.
 *
 * Claude stores one JSONL transcript below
 * `<config dir>/projects/<slugified cwd>/<session id>.jsonl`. Discovery only
 * accepts records explicitly marked `entrypoint: "cli"`; sessions from other
 * SDK clients and sidechain/sub-agent records are excluded. aqqua marks its
 * primary Claude sessions as CLI-resumable at the adapter boundary.
 *
 * @module provider/Drivers/ClaudeSessions
 */
import type {
  ClaudeSettings,
  ProviderExternalSession,
  ProviderExternalSessionMessage,
  ProviderInstanceId,
  ProviderReadSessionResult,
} from "@aqqua/contracts";
import { ProviderListSessionsError } from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveClaudeConfigDirPath } from "./ClaudeSkills.ts";

const ClaudeContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
});

const ClaudeSessionRecord = Schema.Struct({
  type: Schema.String,
  uuid: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  gitBranch: Schema.optionalKey(Schema.String),
  entrypoint: Schema.optionalKey(Schema.String),
  isSidechain: Schema.optionalKey(Schema.Boolean),
  message: Schema.optionalKey(
    Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(ClaudeContentBlock)]),
    }),
  ),
  lastPrompt: Schema.optionalKey(Schema.String),
  leafUuid: Schema.optionalKey(Schema.String),
});
type ClaudeSessionRecord = typeof ClaudeSessionRecord.Type;

const decodeClaudeSessionRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeSessionRecord),
);
const ClaudeSessionId = Schema.String.pipe(Schema.check(Schema.isUUID()));
const isClaudeSessionId = Schema.is(ClaudeSessionId);
const ClaudeResumeCursor = Schema.Struct({ resume: ClaudeSessionId });
const isClaudeResumeCursor = Schema.is(ClaudeResumeCursor);

export interface ClaudeSessionResumeMetadata {
  readonly resumeSessionAt?: string;
  readonly turnCount: number;
}

export interface LoadedClaudeSession {
  readonly result: ProviderReadSessionResult;
  readonly resume: ClaudeSessionResumeMetadata;
}

function claudeProjectDirectoryName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function matchesClaudeResumeCursor(sessionId: string, cursor: unknown): boolean {
  return isClaudeResumeCursor(cursor) && cursor.resume === sessionId;
}

function recordText(record: ClaudeSessionRecord): string | undefined {
  const content = record.message?.content;
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }
  if (!content) return undefined;
  const text = content
    .filter((block) => block.type === "text" && block.text !== undefined)
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function titleFromText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function parseRecords(contents: string): ReadonlyArray<ClaudeSessionRecord> {
  return contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    return Option.match(decodeClaudeSessionRecord(trimmed), {
      onNone: () => [],
      onSome: (record) => [record],
    });
  });
}

const DISCOVERY_HEAD_BYTES = 64 * 1024;
const DISCOVERY_TAIL_BYTES = 64 * 1024;
/** Matches `CODEX_EXTERNAL_SESSION_LIMIT` so both pickers page the same way. */
const CLAUDE_EXTERNAL_SESSION_LIMIT = 100;

const readClaudeSessionHeadAndTail = Effect.fn("readClaudeSessionHeadAndTail")(function* (
  filePath: string,
  size: number,
): Effect.fn.Return<string, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fileSystem.open(filePath, { flag: "r" });
      const headSize = Math.min(size, DISCOVERY_HEAD_BYTES);
      const head = yield* file.readAlloc(headSize);
      if (size <= DISCOVERY_HEAD_BYTES) {
        return Option.match(head, {
          onNone: () => "",
          onSome: (bytes) => new TextDecoder().decode(bytes),
        });
      }

      const tailSize = Math.min(size - headSize, DISCOVERY_TAIL_BYTES);
      yield* file.seek(size - tailSize, "start");
      const tail = yield* file.readAlloc(tailSize);
      const decode = (bytes: Option.Option<Uint8Array>) =>
        Option.match(bytes, {
          onNone: () => "",
          onSome: (value) => new TextDecoder().decode(value),
        });
      return `${decode(head)}\n${decode(tail)}`;
    }).pipe(Effect.orElseSucceed(() => "")),
  );
});

function visibleMessages(
  records: ReadonlyArray<ClaudeSessionRecord>,
  boundaryUuid?: string,
): {
  readonly messages: ReadonlyArray<ProviderExternalSessionMessage>;
  readonly boundaryUuid: string | undefined;
  readonly boundaryFound: boolean;
  readonly turnCount: number;
  readonly resumeSessionAt: string | undefined;
} {
  const messages: Array<ProviderExternalSessionMessage> = [];
  let lastUuid: string | undefined;
  let lastAssistantUuid: string | undefined;
  let turnCount = 0;
  let boundaryFound = boundaryUuid === undefined;

  for (const record of records) {
    // Older aqqua versions and other SDK clients can append `sdk-*` records to
    // a CLI transcript. Only CLI-authored turns belong to the conversation
    // being adopted.
    if (
      record.entrypoint !== "cli" ||
      record.isSidechain === true ||
      (record.type !== "user" && record.type !== "assistant")
    ) {
      continue;
    }
    const messageId = record.uuid?.trim();
    const text = recordText(record);
    if (!messageId || !text) continue;

    const role = record.type === "user" ? "user" : "assistant";
    messages.push({
      messageId,
      role,
      text,
      ...(record.timestamp?.trim() ? { createdAt: record.timestamp.trim() } : {}),
    });
    lastUuid = messageId;
    if (role === "user") turnCount += 1;
    else lastAssistantUuid = messageId;

    if (boundaryUuid !== undefined && messageId === boundaryUuid) {
      boundaryFound = true;
      break;
    }
  }

  return {
    messages,
    boundaryUuid: lastUuid,
    boundaryFound,
    turnCount,
    resumeSessionAt: lastAssistantUuid,
  };
}

function externalSessionFromRecords(input: {
  readonly sessionId: string;
  readonly cwd: string;
  readonly updatedAt: string;
  readonly records: ReadonlyArray<ClaudeSessionRecord>;
}): ProviderExternalSession | undefined {
  const cliRecords = input.records.filter(
    (record) =>
      record.entrypoint === "cli" &&
      record.isSidechain !== true &&
      (record.type === "user" || record.type === "assistant"),
  );
  if (cliRecords.length === 0) return undefined;

  const firstUser = cliRecords.find((record) => record.type === "user" && recordText(record));
  const lastPrompt = input.records
    .toReversed()
    .find((record) => record.type === "last-prompt" && record.lastPrompt?.trim())?.lastPrompt;
  const title = firstUser ? recordText(firstUser) : lastPrompt;
  if (!title) return undefined;

  const metadata = cliRecords.find((record) => record.cwd === input.cwd) ?? cliRecords[0];
  if (!metadata || metadata.cwd !== input.cwd) return undefined;

  return {
    sessionId: input.sessionId,
    title: titleFromText(title),
    cwd: input.cwd,
    updatedAt: input.updatedAt,
    // Claude's bounded discovery metadata has no authoritative count. The
    // lazy read fills the exact count before the adoption marker is written.
    messageCount: 0,
    ...(metadata.gitBranch?.trim() ? { gitBranch: metadata.gitBranch.trim() } : {}),
  };
}

/** Discover exact-cwd CLI sessions. Unreadable roots/files and malformed JSONL degrade to skips. */
export const discoverClaudeSessions = Effect.fn("discoverClaudeSessions")(function* (input: {
  readonly config: Pick<ClaudeSettings, "homePath">;
  readonly cwds: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}): Effect.fn.Return<
  ReadonlyArray<ProviderExternalSession>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sessions: Array<ProviderExternalSession> = [];

  for (const cwd of new Set(input.cwds.map((entry) => path.resolve(entry)))) {
    const configDir = yield* resolveClaudeConfigDirPath(
      input.config,
      input.environment ?? process.env,
      cwd,
    );
    const projectDirectory = path.join(configDir, "projects", claudeProjectDirectoryName(cwd));
    const entries = yield* fileSystem
      .readDirectory(projectDirectory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const sessionId = entry.slice(0, -".jsonl".length);
      if (!isClaudeSessionId(sessionId)) continue;
      const filePath = path.join(projectDirectory, entry);
      const info = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
      if (info === undefined) continue;
      const contents = yield* readClaudeSessionHeadAndTail(filePath, Number(info.size));
      if (!contents) continue;

      const records = parseRecords(contents);
      const fallbackTimestamp = records.findLast((record) => record.timestamp)?.timestamp;
      const updatedAt = Option.getOrElse(info.mtime, () =>
        DateTime.toDate(DateTime.makeUnsafe(fallbackTimestamp ?? 0)),
      );
      const session = externalSessionFromRecords({
        sessionId,
        cwd,
        updatedAt: DateTime.formatIso(DateTime.makeUnsafe(updatedAt)),
        records,
      });
      if (session) sessions.push(session);
    }
  }

  // Cap like the Codex path does. A long-lived project accumulates hundreds of
  // transcripts, and the picker only ever shows the most recent ones.
  return sessions
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, CLAUDE_EXTERNAL_SESSION_LIMIT);
});

function sessionAccessError(
  instanceId: ProviderInstanceId,
  reason: string,
  cause?: unknown,
): ProviderListSessionsError {
  return new ProviderListSessionsError({
    instanceId,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Locate and lazily parse one Claude transcript. */
export const readClaudeSession = Effect.fn("readClaudeSession")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly config: Pick<ClaudeSettings, "homePath">;
  readonly sessionId: string;
  readonly boundaryUuid?: string;
  readonly cwdHint?: string;
  readonly environment?: NodeJS.ProcessEnv;
}): Effect.fn.Return<
  LoadedClaudeSession,
  ProviderListSessionsError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!isClaudeSessionId(input.sessionId)) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session id '${input.sessionId}' is not a UUID`,
    );
  }
  const configDir = yield* resolveClaudeConfigDirPath(
    input.config,
    input.environment ?? process.env,
    input.cwdHint,
  );
  const projectsDirectory = path.join(configDir, "projects");
  const projectEntries = input.cwdHint
    ? [claudeProjectDirectoryName(path.resolve(input.cwdHint))]
    : yield* fileSystem
        .readDirectory(projectsDirectory)
        .pipe(
          Effect.mapError((cause) =>
            sessionAccessError(input.instanceId, "Claude session store is unavailable", cause),
          ),
        );
  let selected:
    | { readonly filePath: string; readonly records: ReadonlyArray<ClaudeSessionRecord> }
    | undefined;

  for (const projectEntry of projectEntries) {
    const filePath = path.join(projectsDirectory, projectEntry, `${input.sessionId}.jsonl`);
    const contents = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) continue;
    const records = parseRecords(contents);
    if (
      records.some(
        (record) =>
          record.entrypoint === "cli" &&
          record.isSidechain !== true &&
          (record.type === "user" || record.type === "assistant"),
      )
    ) {
      selected = { filePath, records };
      break;
    }
  }

  if (!selected) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session '${input.sessionId}' was not found`,
    );
  }

  const firstRecord = selected.records.find(
    (record) => record.entrypoint === "cli" && record.isSidechain !== true && record.cwd,
  );
  const cwd = firstRecord?.cwd?.trim();
  if (!cwd) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session '${input.sessionId}' has no recorded cwd`,
    );
  }

  const visible = visibleMessages(selected.records, input.boundaryUuid);
  if (!visible.boundaryFound) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session '${input.sessionId}' no longer contains boundary '${input.boundaryUuid}'`,
    );
  }
  if (!visible.boundaryUuid || visible.messages.length === 0) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session '${input.sessionId}' has no readable messages`,
    );
  }

  const info = yield* fileSystem
    .stat(selected.filePath)
    .pipe(
      Effect.mapError((cause) =>
        sessionAccessError(
          input.instanceId,
          `Failed to stat Claude session '${input.sessionId}'`,
          cause,
        ),
      ),
    );
  const updatedAt = DateTime.formatIso(
    DateTime.makeUnsafe(
      Option.getOrElse(info.mtime, () => DateTime.toDate(DateTime.makeUnsafe(0))),
    ),
  );
  const firstUser = selected.records.find(
    (record) =>
      record.type === "user" &&
      record.entrypoint === "cli" &&
      record.isSidechain !== true &&
      recordText(record),
  );
  const title = firstUser ? recordText(firstUser) : undefined;
  if (!title) {
    return yield* sessionAccessError(
      input.instanceId,
      `Claude CLI session '${input.sessionId}' has no readable title`,
    );
  }

  return {
    result: {
      session: {
        sessionId: input.sessionId,
        title: titleFromText(title),
        cwd,
        updatedAt,
        messageCount: visible.messages.length,
        ...(firstRecord?.gitBranch?.trim() ? { gitBranch: firstRecord.gitBranch.trim() } : {}),
      },
      messages: visible.messages,
      boundaryUuid: visible.boundaryUuid,
    },
    resume: {
      turnCount: visible.turnCount,
      ...(visible.resumeSessionAt ? { resumeSessionAt: visible.resumeSessionAt } : {}),
    },
  };
});
