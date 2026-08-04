import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BoardId,
  BoardStepId,
  CardId,
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * Mirror of `AgentProfileName` from settings.ts (same brand string + checks).
 *
 * Cannot import the schema value from settings.ts: settings → orchestration → board
 * would form a TDZ cycle at module init. Values remain assignable across both.
 */
const BOARD_AGENT_PROFILE_NAME_MAX_CHARS = 64;
const BOARD_AGENT_PROFILE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const BoardAgentProfileName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BOARD_AGENT_PROFILE_NAME_MAX_CHARS),
  Schema.isPattern(BOARD_AGENT_PROFILE_NAME_PATTERN),
).pipe(Schema.brand("AgentProfileName"));

export const BOARD_WS_METHODS = {
  readArtifact: "board.readArtifact",
  writeArtifact: "board.writeArtifact",
} as const;

export const BoardStepContinuation = Schema.Literals(["auto", "manual"]);
export type BoardStepContinuation = typeof BoardStepContinuation.Type;
export const DEFAULT_BOARD_STEP_CONTINUATION: BoardStepContinuation = "auto";

export const BoardStep = Schema.Struct({
  id: BoardStepId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  promptTemplate: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  profileName: BoardAgentProfileName,
  continuation: BoardStepContinuation.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_BOARD_STEP_CONTINUATION)),
  ),
});
export type BoardStep = typeof BoardStep.Type;

export const OrchestrationBoard = Schema.Struct({
  id: BoardId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationBoard = typeof OrchestrationBoard.Type;

export const BoardSnapshot = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

/**
 * Agent-facing status for the current pipeline position. Orthogonal to durable
 * `operation` (starting/advancing/…) and to position (todo/step/done).
 *
 * `deleting` is retained only so historical projected rows and events still
 * decode; new delete requests claim a `deleting` operation instead of writing
 * this status.
 */
export const CardStatus = Schema.Literals([
  "running",
  "paused",
  "needs-input",
  "failed",
  "cancelled",
  "deleting",
]);
export type CardStatus = typeof CardStatus.Type;

/**
 * Statuses that allow user override actions: Continue (advance past a stuck
 * step) and Retry (discard the step thread and re-run from the snapshot).
 * While `running`, Retry/Continue are unavailable; Reset claims a durable
 * reset operation instead of mutating position at request time.
 */
export const CONTINUABLE_CARD_STATUSES = [
  "paused",
  "needs-input",
  "failed",
  "cancelled",
] as const satisfies ReadonlyArray<CardStatus>;
export type ContinuableCardStatus = (typeof CONTINUABLE_CARD_STATUSES)[number];

export function isContinuableCardStatus(
  status: CardStatus | null | undefined,
): status is ContinuableCardStatus {
  return (
    status !== null &&
    status !== undefined &&
    (CONTINUABLE_CARD_STATUSES as ReadonlyArray<string>).includes(status)
  );
}

/** Stable id for a card lifecycle operation; typically the claiming command id. */
export const CardOperationId = TrimmedNonEmptyString.pipe(Schema.brand("CardOperationId"));
export type CardOperationId = typeof CardOperationId.Type;

const CardOperationBase = {
  operationId: CardOperationId,
  requestedAt: IsoDateTime,
} as const;

export const CardCleanupStage = Schema.Literals([
  "pending",
  "cleanup-started",
  "threads-archived",
  "conversations-deleted",
  "worktree-removed",
  "artifacts-removed",
]);
export type CardCleanupStage = typeof CardCleanupStage.Type;

/**
 * Shared by step-entry claims (`starting` / `advancing` / `retrying`). The
 * decider allocates a stable `threadId` before any reactor side effect so
 * restart cannot spawn a second agent. Null on historical projected rows;
 * reactors derive the same deterministic fallback from `operationId`.
 */
const CardStepEntryOperationBase = {
  ...CardOperationBase,
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
} as const;

/**
 * In-flight card transition claimed by a request event. Position/status stay
 * put until a completion (or failure) event; reactors resume from this field
 * after restart. Null means the card is idle for lifecycle work.
 */
export const CardOperation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("starting"),
    ...CardStepEntryOperationBase,
  }),
  Schema.Struct({
    kind: Schema.Literal("advancing"),
    ...CardStepEntryOperationBase,
    toStepIndex: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("retrying"),
    ...CardStepEntryOperationBase,
    stepIndex: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("resetting"),
    ...CardOperationBase,
    activeThreadId: Schema.NullOr(ThreadId),
    threadIds: Schema.Array(ThreadId),
    cleanupStage: Schema.optionalKey(CardCleanupStage),
  }),
  Schema.Struct({
    kind: Schema.Literal("deleting"),
    ...CardOperationBase,
    /** Missing on historical projected rows, which are deletion operations. */
    purpose: Schema.optionalKey(Schema.Literals(["delete", "archive"])),
    cleanupStage: Schema.optionalKey(CardCleanupStage),
  }),
]);
export type CardOperation = typeof CardOperation.Type;

export const CardOperationKind = Schema.Literals([
  "starting",
  "advancing",
  "retrying",
  "resetting",
  "deleting",
]);
export type CardOperationKind = typeof CardOperationKind.Type;

export const CardPosition = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("todo"),
  }),
  Schema.Struct({
    kind: Schema.Literal("step"),
    stepIndex: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("done"),
  }),
]);
export type CardPosition = typeof CardPosition.Type;

const CARD_PARAMETER_NAME_MAX_CHARS = 64;
const CARD_PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
const CARD_PARAMETER_VALUE_MAX_CHARS = 4_000;

export const CardParameterName = Schema.String.check(
  Schema.isMaxLength(CARD_PARAMETER_NAME_MAX_CHARS),
  Schema.isPattern(CARD_PARAMETER_NAME_PATTERN),
);
export type CardParameterName = typeof CardParameterName.Type;

export const CardParameters = Schema.Record(
  CardParameterName,
  Schema.String.check(Schema.isMaxLength(CARD_PARAMETER_VALUE_MAX_CHARS)),
);
export type CardParameters = typeof CardParameters.Type;

export const CardStepThread = Schema.Struct({
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
  spawnedAt: IsoDateTime,
});
export type CardStepThread = typeof CardStepThread.Type;

export const OrchestrationCard = Schema.Struct({
  id: CardId,
  boardId: BoardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  parameters: CardParameters,
  position: CardPosition,
  status: Schema.NullOr(CardStatus),
  /**
   * Durable in-flight lifecycle claim. Orthogonal to `status` and `position`.
   * Missing on historical rows; defaults to null on decode.
   */
  operation: Schema.NullOr(CardOperation).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Last failed operation reason; cleared when a new operation is claimed. */
  lastError: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  snapshot: Schema.NullOr(BoardSnapshot),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  stepThreads: Schema.Array(CardStepThread),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  releasedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationCard = typeof OrchestrationCard.Type;

// ── Artifact RPCs ──────────────────────────────────────────────

export const BoardReadArtifactInput = Schema.Struct({
  cardId: CardId,
  stepName: TrimmedNonEmptyString,
});
export type BoardReadArtifactInput = typeof BoardReadArtifactInput.Type;

export const BoardReadArtifactResult = Schema.Struct({
  exists: Schema.Boolean,
  content: Schema.NullOr(Schema.String),
  path: TrimmedNonEmptyString,
});
export type BoardReadArtifactResult = typeof BoardReadArtifactResult.Type;

export const BoardWriteArtifactInput = Schema.Struct({
  cardId: CardId,
  stepName: TrimmedNonEmptyString,
  content: Schema.String.check(Schema.isMaxLength(1_000_000)),
});
export type BoardWriteArtifactInput = typeof BoardWriteArtifactInput.Type;

export const BoardWriteArtifactResult = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type BoardWriteArtifactResult = typeof BoardWriteArtifactResult.Type;

export class BoardArtifactError extends Schema.TaggedErrorClass<BoardArtifactError>()(
  "BoardArtifactError",
  {
    message: TrimmedNonEmptyString,
    cardId: Schema.optional(CardId),
    stepName: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// ── Event payloads ─────────────────────────────────────────────

export const BoardCreatedPayload = Schema.Struct({
  boardId: BoardId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardCreatedPayload = typeof BoardCreatedPayload.Type;

export const BoardUpdatedPayload = Schema.Struct({
  boardId: BoardId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
  updatedAt: IsoDateTime,
});
export type BoardUpdatedPayload = typeof BoardUpdatedPayload.Type;

export const BoardDeletedPayload = Schema.Struct({
  boardId: BoardId,
  deletedAt: IsoDateTime,
});
export type BoardDeletedPayload = typeof BoardDeletedPayload.Type;

export const CardCreatedPayload = Schema.Struct({
  cardId: CardId,
  boardId: BoardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  parameters: CardParameters,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardCreatedPayload = typeof CardCreatedPayload.Type;

export const CardTitleUpdatedPayload = Schema.Struct({
  cardId: CardId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  updatedAt: IsoDateTime,
});
export type CardTitleUpdatedPayload = typeof CardTitleUpdatedPayload.Type;

export const CardReleaseRequestedPayload = Schema.Struct({
  cardId: CardId,
  snapshot: BoardSnapshot,
  requestedAt: IsoDateTime,
  /** Present on new events; omitted on historical rows for decode compatibility. */
  operationId: Schema.optional(CardOperationId),
  /** Stable step-thread id claimed with the operation; omitted on historical rows. */
  threadId: Schema.optional(ThreadId),
});
export type CardReleaseRequestedPayload = typeof CardReleaseRequestedPayload.Type;

export const CardReleasedPayload = Schema.Struct({
  cardId: CardId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  releasedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
});
export type CardReleasedPayload = typeof CardReleasedPayload.Type;

export const CardStepEnteredPayload = Schema.Struct({
  cardId: CardId,
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
  enteredAt: IsoDateTime,
  updatedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
});
export type CardStepEnteredPayload = typeof CardStepEnteredPayload.Type;

export const CardStepAdvanceRequestedPayload = Schema.Struct({
  cardId: CardId,
  toStepIndex: NonNegativeInt,
  requestedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
  /** Stable step-thread id for the target step; omitted on historical rows. */
  threadId: Schema.optional(ThreadId),
});
export type CardStepAdvanceRequestedPayload = typeof CardStepAdvanceRequestedPayload.Type;

export const CardStatusSetPayload = Schema.Struct({
  cardId: CardId,
  status: Schema.NullOr(CardStatus),
  updatedAt: IsoDateTime,
});
export type CardStatusSetPayload = typeof CardStatusSetPayload.Type;

export const CardCompletedPayload = Schema.Struct({
  cardId: CardId,
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardCompletedPayload = typeof CardCompletedPayload.Type;

export const CardRetryRequestedPayload = Schema.Struct({
  cardId: CardId,
  stepIndex: NonNegativeInt,
  requestedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
  /** Stable step-thread id for the fresh retry thread; omitted on historical rows. */
  threadId: Schema.optional(ThreadId),
});
export type CardRetryRequestedPayload = typeof CardRetryRequestedPayload.Type;

/** Legacy cancel signal; new flows emit `card.reset-requested` instead. */
export const CardCancelRequestedPayload = Schema.Struct({
  cardId: CardId,
  threadId: Schema.NullOr(ThreadId),
  requestedAt: IsoDateTime,
});
export type CardCancelRequestedPayload = typeof CardCancelRequestedPayload.Type;

/**
 * Reset claimed. Projection sets `operation: resetting` only — position and
 * status stay put until `card.reset` completion. A pre-cleanup failure releases
 * the claim; once cleanup starts, failure retains the claim for a retry.
 */
export const CardResetRequestedPayload = Schema.Struct({
  cardId: CardId,
  operationId: CardOperationId,
  activeThreadId: Schema.NullOr(ThreadId),
  threadIds: Schema.Array(ThreadId),
  requestedAt: IsoDateTime,
});
export type CardResetRequestedPayload = typeof CardResetRequestedPayload.Type;

/**
 * Reset completed. The card returns to To-Do and forgets its released board
 * snapshot and step threads; the reactor already interrupted/archived the
 * captured threads before this lands (or finishes after detachment).
 */
export const CardResetPayload = Schema.Struct({
  cardId: CardId,
  operationId: Schema.optional(CardOperationId),
  activeThreadId: Schema.NullOr(ThreadId),
  threadIds: Schema.Array(ThreadId),
  resetAt: IsoDateTime,
});
export type CardResetPayload = typeof CardResetPayload.Type;

/**
 * A claimed card operation failed. Persists `lastError`; `starting` also sets
 * agent status to `failed`. Reset/delete failures release a pre-cleanup claim,
 * but retain a cleanup-in-progress claim so the remaining stages can retry.
 */
export const CardOperationFailedPayload = Schema.Struct({
  cardId: CardId,
  operationId: CardOperationId,
  kind: CardOperationKind,
  reason: Schema.String,
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardOperationFailedPayload = typeof CardOperationFailedPayload.Type;

/** Durable receipt for one monotonic reset/delete cleanup stage. */
export const CardCleanupProgressedPayload = Schema.Struct({
  cardId: CardId,
  operationId: CardOperationId,
  kind: Schema.Literals(["resetting", "deleting"]),
  stage: CardCleanupStage,
  progressedAt: IsoDateTime,
});
export type CardCleanupProgressedPayload = typeof CardCleanupProgressedPayload.Type;

export const CardArchivedPayload = Schema.Struct({
  cardId: CardId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardArchivedPayload = typeof CardArchivedPayload.Type;

export const CardDeleteRequestedPayload = Schema.Struct({
  cardId: CardId,
  requestedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
  /** Missing on historical events, which are deletion requests. */
  purpose: Schema.optional(Schema.Literals(["delete", "archive"])),
});
export type CardDeleteRequestedPayload = typeof CardDeleteRequestedPayload.Type;

export const CardDeletedPayload = Schema.Struct({
  cardId: CardId,
  deletedAt: IsoDateTime,
  operationId: Schema.optional(CardOperationId),
});
export type CardDeletedPayload = typeof CardDeletedPayload.Type;

export const CardSettledPayload = Schema.Struct({
  cardId: CardId,
  settledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardSettledPayload = typeof CardSettledPayload.Type;

export const CardUnsettledPayload = Schema.Struct({
  cardId: CardId,
  updatedAt: IsoDateTime,
});
export type CardUnsettledPayload = typeof CardUnsettledPayload.Type;

// ── Commands ───────────────────────────────────────────────────

export const BoardCreateCommand = Schema.Struct({
  type: Schema.Literal("board.create"),
  commandId: CommandId,
  boardId: BoardId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
});
export type BoardCreateCommand = typeof BoardCreateCommand.Type;

export const BoardUpdateCommand = Schema.Struct({
  type: Schema.Literal("board.update"),
  commandId: CommandId,
  boardId: BoardId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  steps: Schema.Array(BoardStep).check(Schema.isMaxLength(20)),
});
export type BoardUpdateCommand = typeof BoardUpdateCommand.Type;

export const BoardDeleteCommand = Schema.Struct({
  type: Schema.Literal("board.delete"),
  commandId: CommandId,
  boardId: BoardId,
});
export type BoardDeleteCommand = typeof BoardDeleteCommand.Type;

export const CardCreateCommand = Schema.Struct({
  type: Schema.Literal("card.create"),
  commandId: CommandId,
  cardId: CardId,
  boardId: BoardId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  parameters: CardParameters,
});
export type CardCreateCommand = typeof CardCreateCommand.Type;

export const CardReleaseCommand = Schema.Struct({
  type: Schema.Literal("card.release"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardReleaseCommand = typeof CardReleaseCommand.Type;

export const CardContinueCommand = Schema.Struct({
  type: Schema.Literal("card.continue"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardContinueCommand = typeof CardContinueCommand.Type;

export const CardRetryCommand = Schema.Struct({
  type: Schema.Literal("card.retry"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardRetryCommand = typeof CardRetryCommand.Type;

/** Legacy cancel-only command. Full destructive cleanup uses `card.reset`. */
export const CardCancelCommand = Schema.Struct({
  type: Schema.Literal("card.cancel"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardCancelCommand = typeof CardCancelCommand.Type;

/** Public full-card reset: claims a durable operation; completion is separate. */
export const CardResetCommand = Schema.Struct({
  type: Schema.Literal("card.reset"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardResetCommand = typeof CardResetCommand.Type;

export const CardArchiveCommand = Schema.Struct({
  type: Schema.Literal("card.archive"),
  commandId: CommandId,
  cardId: CardId,
  /** Internal completion receipt; omitted by user-issued archive commands. */
  operationId: Schema.optional(CardOperationId),
});
export type CardArchiveCommand = typeof CardArchiveCommand.Type;

export const CardDeleteCommand = Schema.Struct({
  type: Schema.Literal("card.delete"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardDeleteCommand = typeof CardDeleteCommand.Type;

export const CardDeleteCompleteCommand = Schema.Struct({
  type: Schema.Literal("card.delete.complete"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
});
export type CardDeleteCompleteCommand = typeof CardDeleteCompleteCommand.Type;

export const CardDeleteFailCommand = Schema.Struct({
  type: Schema.Literal("card.delete.fail"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  reason: Schema.String,
});
export type CardDeleteFailCommand = typeof CardDeleteFailCommand.Type;

export const CardSettleCommand = Schema.Struct({
  type: Schema.Literal("card.settle"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardSettleCommand = typeof CardSettleCommand.Type;

export const CardUnsettleCommand = Schema.Struct({
  type: Schema.Literal("card.unsettle"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardUnsettleCommand = typeof CardUnsettleCommand.Type;

export const CardReleaseCompleteCommand = Schema.Struct({
  type: Schema.Literal("card.release.complete"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
});
export type CardReleaseCompleteCommand = typeof CardReleaseCompleteCommand.Type;

export const CardReleaseFailCommand = Schema.Struct({
  type: Schema.Literal("card.release.fail"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  reason: Schema.String,
});
export type CardReleaseFailCommand = typeof CardReleaseFailCommand.Type;

export const CardStepEnterCommand = Schema.Struct({
  type: Schema.Literal("card.step.enter"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
});
export type CardStepEnterCommand = typeof CardStepEnterCommand.Type;

export const CardResetCompleteCommand = Schema.Struct({
  type: Schema.Literal("card.reset.complete"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
});
export type CardResetCompleteCommand = typeof CardResetCompleteCommand.Type;

export const CardResetFailCommand = Schema.Struct({
  type: Schema.Literal("card.reset.fail"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  reason: Schema.String,
});
export type CardResetFailCommand = typeof CardResetFailCommand.Type;

/**
 * Generic internal fail for any durable card operation kind. Validates that
 * `operationId` and `kind` still match the card's claim, then emits
 * `card.operation-failed` so reactors can clear the claim and persist
 * `lastError` for starting, advancing, retrying, resetting, and deleting.
 */
export const CardOperationFailCommand = Schema.Struct({
  type: Schema.Literal("card.operation.fail"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  kind: CardOperationKind,
  reason: Schema.String,
});
export type CardOperationFailCommand = typeof CardOperationFailCommand.Type;

export const CardCleanupProgressCommand = Schema.Struct({
  type: Schema.Literal("card.cleanup.progress"),
  commandId: CommandId,
  cardId: CardId,
  operationId: CardOperationId,
  kind: Schema.Literals(["resetting", "deleting"]),
  stage: CardCleanupStage,
});
export type CardCleanupProgressCommand = typeof CardCleanupProgressCommand.Type;

export const CardStepReportCommand = Schema.Struct({
  type: Schema.Literal("card.step.report"),
  commandId: CommandId,
  cardId: CardId,
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
  outcome: Schema.Literals(["success", "blocked"]),
});
export type CardStepReportCommand = typeof CardStepReportCommand.Type;

export const CardStatusSetCommand = Schema.Struct({
  type: Schema.Literal("card.status.set"),
  commandId: CommandId,
  cardId: CardId,
  status: Schema.NullOr(CardStatus),
});
export type CardStatusSetCommand = typeof CardStatusSetCommand.Type;

export const CardTitleSetCommand = Schema.Struct({
  type: Schema.Literal("card.title.set"),
  commandId: CommandId,
  cardId: CardId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
});
export type CardTitleSetCommand = typeof CardTitleSetCommand.Type;
