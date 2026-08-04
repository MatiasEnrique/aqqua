import {
  ProviderDriverKind,
  ProviderInstanceId,
  type AccountRateLimitsSnapshot,
} from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  RuntimeReceiptBus,
  type UsageScanCompletedReceipt,
} from "../orchestration/Services/RuntimeReceiptBus.ts";
import {
  UsageLedgerRepository,
  type UsageRollup,
  type UsageScanFile,
} from "../persistence/Services/UsageLedger.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { AccountRateLimits } from "./AccountRateLimits.ts";
import { parseClaudeLog, type ClaudeLogParseState, listClaudeLogFiles } from "./ClaudeLogSource.ts";
import {
  listCodexLogFiles,
  parseCodexLog,
  type CodexInlineRateLimits,
  type CodexLogParseState,
} from "./CodexLogSource.ts";
import { usageProjectAttributionKey, type UsageAttributionRoot } from "./UsageAttribution.ts";
import { rollupUsageTurns, type UsageTurnRecord } from "./UsageRollup.ts";

const SCAN_INTERVAL = "15 minutes";
const STARTUP_DELAY = "2 seconds";

export interface UsageScannerRoots {
  readonly claudeProjectsDirectory: string;
  readonly codexSessionsDirectory: string;
}

export interface UsageScannerLayerOptions {
  readonly roots?: UsageScannerRoots;
  readonly runInBackground?: boolean;
}

export interface UsageScanState {
  readonly enabled: boolean;
  readonly scanning: boolean;
  readonly lastScanAt: string | null;
}

export type { UsageScanCompletedReceipt } from "../orchestration/Services/RuntimeReceiptBus.ts";

export class UsageScannerError extends Schema.TaggedErrorClass<UsageScannerError>()(
  "UsageScannerError",
  {
    message: Schema.String,
  },
) {}

interface FileSnapshot {
  readonly path: string;
  readonly provider: "claude" | "codex";
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: number | null;
  readonly birthtimeMs: number | null;
  readonly previous: UsageScanFile | null;
}

type ParserState =
  | { readonly provider: "claude"; readonly state: ClaudeLogParseState }
  | { readonly provider: "codex"; readonly state: CodexLogParseState };

interface ScanFileResult {
  readonly turns: ReadonlyArray<UsageTurnRecord>;
  readonly parserState: ParserState;
  readonly rateLimits: CodexInlineRateLimits | null;
  readonly nextOffset: number;
}

interface ScanAccumulator {
  readonly scannedFiles: number;
  readonly parsedTurns: number;
  readonly newestCodexRateLimits: CodexInlineRateLimits | null;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function defaultRoots(path: Path.Path): UsageScannerRoots {
  const homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return {
    claudeProjectsDirectory: path.join(homeDirectory, ".claude", "projects"),
    codexSessionsDirectory: path.join(homeDirectory, ".codex", "sessions"),
  };
}

function mtimeMs(info: FileSystem.File.Info): number {
  return Option.match(info.mtime, {
    onNone: () => 0,
    onSome: (mtime) => Math.max(0, Math.trunc(mtime.getTime())),
  });
}

function inode(info: FileSystem.File.Info): number | null {
  return Option.getOrNull(info.ino);
}

function birthtimeMs(info: FileSystem.File.Info): number | null {
  return Option.match(info.birthtime, {
    onNone: () => null,
    onSome: (birthtime) => Math.max(0, Math.trunc(birthtime.getTime())),
  });
}

function scannedAtMs(scanFile: UsageScanFile): number | null {
  return Option.match(DateTime.make(scanFile.scannedAt), {
    onNone: () => null,
    onSome: DateTime.toEpochMillis,
  });
}

function completedBytes(bytes: Uint8Array): Uint8Array {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] === 10) {
      return bytes.subarray(0, index + 1);
    }
  }
  return new Uint8Array();
}

const readTail = Effect.fn("UsageScanner.readTail")(function* (
  path: string,
  offset: number,
  size: number,
) {
  if (size <= offset) {
    return new Uint8Array();
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const chunks = yield* fileSystem
    .stream(path, {
      offset,
      bytesToRead: size - offset,
    })
    .pipe(Stream.runCollect);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return completedBytes(bytes);
});

function attributeTurns(
  turns: ReadonlyArray<UsageTurnRecord>,
  roots: ReadonlyArray<UsageAttributionRoot>,
): ReadonlyArray<UsageTurnRecord> {
  return turns.map((turn) => ({
    ...turn,
    projectPath: usageProjectAttributionKey(turn.projectPath, roots),
  }));
}

function toLedgerRows(
  rows: ReturnType<typeof rollupUsageTurns>["rows"],
): ReadonlyArray<UsageRollup> {
  return rows.map((row) => ({
    day: row.day,
    provider: row.provider,
    model: row.model,
    projectPath: row.project_path,
    gitBranch: row.git_branch,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    turns: row.turns,
    sessions: row.sessions,
    costUsd: row.cost_usd,
    source: row.source,
  }));
}

function rollupIdentity(row: ReturnType<typeof rollupUsageTurns>["rows"][number]): string {
  return JSON.stringify([
    row.day,
    row.provider,
    row.model,
    row.project_path,
    row.git_branch,
    row.source,
  ]);
}

function numberField(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function coldCodexSnapshot(inline: CodexInlineRateLimits): AccountRateLimitsSnapshot {
  const windows = (["primary", "secondary"] as const).flatMap((key) => {
    const window = recordField(inline.rateLimits, key);
    if (window === null) return [];
    const windowMinutes = numberField(window, "window_minutes");
    const usedPercent = numberField(window, "used_percent");
    if (usedPercent === null) return [];
    return [
      {
        kind: windowMinutes === 300 ? ("five-hour" as const) : ("weekly" as const),
        usedPercent,
        resetsAt: numberField(window, "resets_at"),
        windowMinutes,
      },
    ];
  });
  const credits = recordField(inline.rateLimits, "credits");
  const planType = inline.rateLimits.plan_type;

  return {
    providerInstanceId: ProviderInstanceId.make("codex"),
    provider: ProviderDriverKind.make("codex"),
    planLabel: typeof planType === "string" ? planType : null,
    credits:
      credits === null
        ? null
        : {
            balance:
              typeof credits.balance === "string"
                ? credits.balance
                : typeof credits.balance === "number"
                  ? String(credits.balance)
                  : null,
            hasCredits: credits.has_credits === true,
            unlimited: credits.unlimited === true,
          },
    windows,
    status: null,
    capturedAt: inline.timestamp,
  };
}

function newerRateLimits(
  current: CodexInlineRateLimits | null,
  candidate: CodexInlineRateLimits | null,
): CodexInlineRateLimits | null {
  if (candidate === null) return current;
  if (current === null || candidate.timestamp > current.timestamp) return candidate;
  return current;
}

export class UsageScanner extends Context.Service<
  UsageScanner,
  {
    readonly scan: Effect.Effect<UsageScanCompletedReceipt, UsageScannerError>;
    readonly state: Effect.Effect<UsageScanState>;
    readonly clear: Effect.Effect<void, UsageScannerError>;
  }
>()("aqqua/usage/UsageScanner") {
  static readonly layer = (options: UsageScannerLayerOptions = {}) =>
    Layer.effect(
      UsageScanner,
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sql = yield* SqlClient.SqlClient;
        const ledger = yield* UsageLedgerRepository;
        const settings = yield* ServerSettingsService;
        const accountRateLimits = yield* AccountRateLimits;
        const receiptBus = yield* RuntimeReceiptBus;
        const workerScope = yield* Effect.scope;
        const roots = options.roots ?? defaultRoots(path);
        const parserStates = yield* Ref.make(new Map<string, ParserState>());
        const inodeByPath = yield* Ref.make(new Map<string, number | null>());
        const rollupKeysByPath = yield* Ref.make(new Map<string, ReadonlySet<string>>());
        const stateRef = yield* Ref.make<UsageScanState>({
          enabled: false,
          scanning: false,
          lastScanAt: null,
        });
        const activeScan = yield* Ref.make<Deferred.Deferred<
          UsageScanCompletedReceipt,
          UsageScannerError
        > | null>(null);
        const mutex = yield* Semaphore.make(1);
        const ledgerMutex = yield* Semaphore.make(1);

        const discoverFiles = Effect.fn("UsageScanner.discoverFiles")(function* () {
          const [claudeExists, codexExists] = yield* Effect.all([
            fileSystem.exists(roots.claudeProjectsDirectory),
            fileSystem.exists(roots.codexSessionsDirectory),
          ]);
          const [claude, codex] = yield* Effect.all([
            claudeExists
              ? listClaudeLogFiles(roots.claudeProjectsDirectory).pipe(
                  Effect.provideService(FileSystem.FileSystem, fileSystem),
                  Effect.provideService(Path.Path, path),
                )
              : Effect.succeed<ReadonlyArray<string>>([]),
            codexExists
              ? listCodexLogFiles(roots.codexSessionsDirectory).pipe(
                  Effect.provideService(FileSystem.FileSystem, fileSystem),
                  Effect.provideService(Path.Path, path),
                )
              : Effect.succeed<ReadonlyArray<string>>([]),
          ]);
          return [
            ...claude.map((filePath) => ({ path: filePath, provider: "claude" as const })),
            ...codex.map((filePath) => ({ path: filePath, provider: "codex" as const })),
          ];
        });

        const snapshotFiles = Effect.fn("UsageScanner.snapshotFiles")(function* (
          files: ReadonlyArray<{ readonly path: string; readonly provider: "claude" | "codex" }>,
        ) {
          return yield* Effect.forEach(
            files,
            Effect.fn("UsageScanner.snapshotFile")(function* (file) {
              const [info, previous] = yield* Effect.all([
                fileSystem.stat(file.path),
                ledger.getScanFile(file.path),
              ]);
              return {
                ...file,
                size: Number(info.size),
                mtimeMs: mtimeMs(info),
                inode: inode(info),
                birthtimeMs: birthtimeMs(info),
                previous: Option.getOrNull(previous),
              } satisfies FileSnapshot;
            }),
            { concurrency: 8 },
          );
        });

        const readAttributionRoots = Effect.fn("UsageScanner.readAttributionRoots")(function* () {
          const projects = yield* sql<{
            readonly projectId: string;
            readonly projectTitle: string;
            readonly path: string;
          }>`
            SELECT
              project_id AS "projectId",
              title AS "projectTitle",
              workspace_root AS path
            FROM projection_projects
            WHERE deleted_at IS NULL
          `;
          const worktrees = yield* sql<{
            readonly projectId: string;
            readonly projectTitle: string;
            readonly path: string;
          }>`
            SELECT DISTINCT
              project.project_id AS "projectId",
              project.title AS "projectTitle",
              roots.path
            FROM (
              SELECT project_id, worktree_path AS path
              FROM projection_threads
              WHERE deleted_at IS NULL AND worktree_path IS NOT NULL
              UNION
              SELECT project_id, worktree_path AS path
              FROM projection_cards
              WHERE worktree_path IS NOT NULL
            ) roots
            JOIN projection_projects project ON project.project_id = roots.project_id
            WHERE project.deleted_at IS NULL
          `;
          return [...projects, ...worktrees] satisfies ReadonlyArray<UsageAttributionRoot>;
        });

        const scanFile = Effect.fn("UsageScanner.scanFile")(function* (
          file: FileSnapshot,
          offset: number,
        ) {
          const bytes = yield* readTail(file.path, offset, file.size).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
          );
          const content = new TextDecoder().decode(bytes);
          const carried = (yield* Ref.get(parserStates)).get(file.path);
          if (file.provider === "claude") {
            const parsed = parseClaudeLog(
              content,
              carried?.provider === "claude" ? carried.state : undefined,
            );
            return {
              turns: parsed.turns,
              parserState: { provider: "claude" as const, state: parsed.state },
              rateLimits: null,
              nextOffset: offset + bytes.length,
            };
          }
          const parsed = parseCodexLog(
            content,
            carried?.provider === "codex" ? carried.state : undefined,
          );
          return {
            turns: parsed.turns,
            parserState: { provider: "codex" as const, state: parsed.state },
            rateLimits: parsed.rateLimits,
            nextOffset: offset + bytes.length,
          };
        });

        const recoverCodexState = Effect.fn("UsageScanner.recoverCodexState")(function* (
          file: FileSnapshot,
          offset: number,
        ) {
          const headerEnd = Math.min(offset, 64 * 1024);
          const contextStart = Math.max(headerEnd, offset - 1024 * 1024);
          const [header, context] = yield* Effect.all([
            readTail(file.path, 0, headerEnd),
            readTail(file.path, contextStart, offset),
          ]).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));
          return parseCodexLog(
            `${new TextDecoder().decode(header)}\n${new TextDecoder().decode(context)}`,
          );
        });

        const runScan = Effect.fn("UsageScanner.runScan")(function* () {
          const currentSettings = yield* settings.getSettings;
          if (!currentSettings.usage.scanEnabled) {
            yield* Ref.update(stateRef, (state) => ({
              ...state,
              enabled: false,
              scanning: false,
            }));
            const receipt = {
              type: "usage.scan.completed",
              scannedFiles: 0,
              parsedTurns: 0,
              completedAt: yield* nowIso,
            } satisfies UsageScanCompletedReceipt;
            yield* receiptBus.publish(receipt);
            return receipt;
          }

          yield* Ref.update(stateRef, (state) => ({
            ...state,
            enabled: true,
            scanning: true,
          }));
          const files = yield* discoverFiles();
          let snapshots = yield* snapshotFiles(files);
          const knownInodes = yield* Ref.get(inodeByPath);
          let knownParserStates = yield* Ref.get(parserStates);
          let recoveredRateLimits: CodexInlineRateLimits | null = null;
          for (const file of snapshots) {
            if (
              file.provider !== "codex" ||
              file.previous === null ||
              file.previous.byteOffset === 0 ||
              knownParserStates.has(file.path)
            ) {
              continue;
            }
            const recovered = yield* recoverCodexState(file, file.previous.byteOffset);
            const parserState = {
              provider: "codex" as const,
              state: recovered.state,
            };
            yield* Ref.update(parserStates, (current) =>
              new Map(current).set(file.path, parserState),
            );
            recoveredRateLimits = newerRateLimits(recoveredRateLimits, recovered.rateLimits);
          }
          knownParserStates = yield* Ref.get(parserStates);
          const needsRebuild = snapshots.some((file) => {
            if (file.previous === null) return false;
            if (file.size < file.previous.byteOffset) return true;
            if (knownInodes.has(file.path) && knownInodes.get(file.path) !== file.inode)
              return true;
            const previousScanMs = scannedAtMs(file.previous);
            if (
              file.birthtimeMs !== null &&
              previousScanMs !== null &&
              previousScanMs >= file.previous.mtimeMs &&
              file.birthtimeMs > previousScanMs
            ) {
              return true;
            }
            return file.provider === "codex" && !knownParserStates.has(file.path);
          });
          if (needsRebuild) {
            yield* ledger.clear();
            yield* Ref.set(parserStates, new Map());
            yield* Ref.set(inodeByPath, new Map());
            yield* Ref.set(rollupKeysByPath, new Map());
            snapshots = snapshots.map((file) => ({ ...file, previous: null }));
          }

          const attributionRoots = yield* readAttributionRoots();
          let accumulator: ScanAccumulator = {
            scannedFiles: 0,
            parsedTurns: 0,
            newestCodexRateLimits: recoveredRateLimits,
          };
          for (const file of snapshots) {
            const offset = file.previous?.byteOffset ?? 0;
            if (file.size === offset && file.previous?.mtimeMs === file.mtimeMs) {
              yield* Ref.update(inodeByPath, (current) =>
                new Map(current).set(file.path, file.inode),
              );
              continue;
            }
            const result = yield* scanFile(file, offset);
            const attributedTurns = attributeTurns(result.turns, attributionRoots);
            const rollups = rollupUsageTurns(attributedTurns);
            const knownRollupKeys = (yield* Ref.get(rollupKeysByPath)).get(file.path) ?? new Set();
            const nextRollupKeys = new Set(knownRollupKeys);
            const ledgerRows = toLedgerRows(
              rollups.rows.map((row) => {
                const key = rollupIdentity(row);
                const sessions = knownRollupKeys.has(key) ? 0 : row.sessions;
                nextRollupKeys.add(key);
                return { ...row, sessions };
              }),
            );
            const scannedAt = yield* nowIso;
            yield* ledger.commitScanFile(ledgerRows, {
              path: file.path,
              mtimeMs: file.mtimeMs,
              size: file.size,
              byteOffset: result.nextOffset,
              scannedAt,
            });
            yield* Ref.update(parserStates, (current) =>
              new Map(current).set(file.path, result.parserState),
            );
            yield* Ref.update(inodeByPath, (current) =>
              new Map(current).set(file.path, file.inode),
            );
            yield* Ref.update(rollupKeysByPath, (current) =>
              new Map(current).set(file.path, nextRollupKeys),
            );
            accumulator = {
              scannedFiles: accumulator.scannedFiles + 1,
              parsedTurns: accumulator.parsedTurns + result.turns.length,
              newestCodexRateLimits: newerRateLimits(
                accumulator.newestCodexRateLimits,
                result.rateLimits,
              ),
            };
          }

          if (accumulator.newestCodexRateLimits !== null) {
            yield* accountRateLimits.seedCold(coldCodexSnapshot(accumulator.newestCodexRateLimits));
          }
          const completedAt = yield* nowIso;
          yield* Ref.set(stateRef, {
            enabled: true,
            scanning: false,
            lastScanAt: completedAt,
          });
          const receipt = {
            type: "usage.scan.completed",
            scannedFiles: accumulator.scannedFiles,
            parsedTurns: accumulator.parsedTurns,
            completedAt,
          } satisfies UsageScanCompletedReceipt;
          // RuntimeReceiptBus is intentionally closed over orchestration receipts.
          // The bus is runtime-structural, so usage publishes its private receipt
          // without expanding the public orchestration receipt schema.
          yield* receiptBus.publish(receipt);
          return receipt;
        });

        const runScanSafely = ledgerMutex
          .withPermits(1)(runScan())
          .pipe(
            Effect.catchCause((cause) =>
              Ref.update(stateRef, (state) => ({ ...state, scanning: false })).pipe(
                Effect.andThen(
                  Effect.fail(
                    new UsageScannerError({
                      message: Cause.pretty(cause),
                    }),
                  ),
                ),
              ),
            ),
          );

        const scan = Effect.fn("UsageScanner.scan")(function* () {
          const deferred = yield* mutex.withPermits(1)(
            Effect.gen(function* () {
              const current = yield* Ref.get(activeScan);
              if (current !== null) return current;
              const next = yield* Deferred.make<UsageScanCompletedReceipt, UsageScannerError>();
              yield* Ref.set(activeScan, next);
              yield* Deferred.complete(next, runScanSafely).pipe(
                Effect.asVoid,
                Effect.ensuring(
                  mutex.withPermits(1)(
                    Ref.update(activeScan, (candidate) => (candidate === next ? null : candidate)),
                  ),
                ),
                Effect.forkIn(workerScope),
              );
              return next;
            }),
          );
          return yield* Deferred.await(deferred);
        });

        const clear = ledgerMutex
          .withPermits(1)(
            ledger.clear().pipe(
              Effect.andThen(Ref.set(parserStates, new Map())),
              Effect.andThen(Ref.set(inodeByPath, new Map())),
              Effect.andThen(Ref.set(rollupKeysByPath, new Map())),
              Effect.andThen(
                Ref.update(stateRef, (state) => ({
                  ...state,
                  scanning: false,
                  lastScanAt: null,
                })),
              ),
            ),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new UsageScannerError({ message: Cause.pretty(cause) })),
            ),
          );

        if (options.runInBackground !== false) {
          yield* Effect.sleep(STARTUP_DELAY).pipe(
            Effect.andThen(scan()),
            Effect.catchCause((cause) =>
              Effect.logWarning("Initial usage scan failed", { detail: Cause.pretty(cause) }),
            ),
            Effect.andThen(
              Effect.sleep(SCAN_INTERVAL).pipe(
                Effect.andThen(scan()),
                Effect.catchCause((cause) =>
                  Effect.logWarning("Scheduled usage scan failed", {
                    detail: Cause.pretty(cause),
                  }),
                ),
                Effect.repeat(Schedule.spaced(SCAN_INTERVAL)),
              ),
            ),
            Effect.forkScoped,
          );
        }

        return UsageScanner.of({
          scan: scan(),
          state: settings.getSettings.pipe(
            Effect.flatMap((currentSettings) =>
              Ref.get(stateRef).pipe(
                Effect.map((state) => ({
                  ...state,
                  enabled: currentSettings.usage.scanEnabled,
                })),
              ),
            ),
            Effect.catchCause(() => Ref.get(stateRef)),
          ),
          clear,
        });
      }),
    );
}
