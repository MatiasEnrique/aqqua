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

export const CardStatus = Schema.Literals([
  "running",
  "paused",
  "needs-input",
  "failed",
  "cancelled",
]);
export type CardStatus = typeof CardStatus.Type;

/**
 * Statuses that allow user override actions: Continue (advance past a stuck
 * step) and Retry (discard the step thread and re-run from the snapshot).
 * While `running`, the flow is Cancel first.
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
  snapshot: Schema.NullOr(BoardSnapshot),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  stepThreads: Schema.Array(CardStepThread),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  releasedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
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
});
export type CardReleaseRequestedPayload = typeof CardReleaseRequestedPayload.Type;

export const CardReleasedPayload = Schema.Struct({
  cardId: CardId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  releasedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardReleasedPayload = typeof CardReleasedPayload.Type;

export const CardStepEnteredPayload = Schema.Struct({
  cardId: CardId,
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
  enteredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardStepEnteredPayload = typeof CardStepEnteredPayload.Type;

export const CardStepAdvanceRequestedPayload = Schema.Struct({
  cardId: CardId,
  toStepIndex: NonNegativeInt,
  requestedAt: IsoDateTime,
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
});
export type CardRetryRequestedPayload = typeof CardRetryRequestedPayload.Type;

export const CardCancelRequestedPayload = Schema.Struct({
  cardId: CardId,
  threadId: Schema.NullOr(ThreadId),
  requestedAt: IsoDateTime,
});
export type CardCancelRequestedPayload = typeof CardCancelRequestedPayload.Type;

export const CardArchivedPayload = Schema.Struct({
  cardId: CardId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CardArchivedPayload = typeof CardArchivedPayload.Type;

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

export const CardCancelCommand = Schema.Struct({
  type: Schema.Literal("card.cancel"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardCancelCommand = typeof CardCancelCommand.Type;

export const CardArchiveCommand = Schema.Struct({
  type: Schema.Literal("card.archive"),
  commandId: CommandId,
  cardId: CardId,
});
export type CardArchiveCommand = typeof CardArchiveCommand.Type;

export const CardReleaseCompleteCommand = Schema.Struct({
  type: Schema.Literal("card.release.complete"),
  commandId: CommandId,
  cardId: CardId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
});
export type CardReleaseCompleteCommand = typeof CardReleaseCompleteCommand.Type;

export const CardReleaseFailCommand = Schema.Struct({
  type: Schema.Literal("card.release.fail"),
  commandId: CommandId,
  cardId: CardId,
  reason: Schema.String,
});
export type CardReleaseFailCommand = typeof CardReleaseFailCommand.Type;

export const CardStepEnterCommand = Schema.Struct({
  type: Schema.Literal("card.step.enter"),
  commandId: CommandId,
  cardId: CardId,
  stepIndex: NonNegativeInt,
  threadId: ThreadId,
});
export type CardStepEnterCommand = typeof CardStepEnterCommand.Type;

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
