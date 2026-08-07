import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BOARD_WS_METHODS,
  BoardCreateCommand,
  BoardCreatedPayload,
  BoardReadArtifactInput,
  BoardReadArtifactResult,
  BoardStep,
  BoardWriteArtifactInput,
  CardCreateCommand,
  CardDeleteRequestedPayload,
  CardOperation,
  CardPosition,
  CardReleaseCompleteCommand,
  CardStatus,
  CardStepReportCommand,
  CONTINUABLE_CARD_STATUSES,
  isContinuableCardStatus,
  OrchestrationBoard,
  OrchestrationCard,
} from "./board.ts";
import {
  ClientOrchestrationCommand,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeBoardStep = Schema.decodeUnknownEffect(BoardStep);
const decodeOrchestrationBoard = Schema.decodeUnknownEffect(OrchestrationBoard);
const decodeOrchestrationCard = Schema.decodeUnknownEffect(OrchestrationCard);
const decodeBoardCreateCommand = Schema.decodeUnknownEffect(BoardCreateCommand);
const decodeCardCreateCommand = Schema.decodeUnknownEffect(CardCreateCommand);
const decodeCardStepReportCommand = Schema.decodeUnknownEffect(CardStepReportCommand);
const decodeCardReleaseCompleteCommand = Schema.decodeUnknownEffect(CardReleaseCompleteCommand);
const decodeBoardCreatedPayload = Schema.decodeUnknownEffect(BoardCreatedPayload);
const decodeCardOperation = Schema.decodeUnknownEffect(CardOperation);
const decodeCardDeleteRequestedPayload = Schema.decodeUnknownEffect(CardDeleteRequestedPayload);
const decodeCardPosition = Schema.decodeUnknownEffect(CardPosition);
const decodeCardStatus = Schema.decodeUnknownEffect(CardStatus);
const decodeBoardReadArtifactInput = Schema.decodeUnknownEffect(BoardReadArtifactInput);
const decodeBoardReadArtifactResult = Schema.decodeUnknownEffect(BoardReadArtifactResult);
const decodeBoardWriteArtifactInput = Schema.decodeUnknownEffect(BoardWriteArtifactInput);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeClientOrchestrationCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeOrchestrationEventType = Schema.decodeUnknownEffect(OrchestrationEventType);
const decodeOrchestrationReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeOrchestrationShellSnapshot = Schema.decodeUnknownEffect(OrchestrationShellSnapshot);
const decodeOrchestrationShellStreamEvent = Schema.decodeUnknownEffect(
  OrchestrationShellStreamEvent,
);

const sampleStep = {
  id: "step-1",
  name: "Implement",
  promptTemplate: "Ship ${ticket_id} using ${artifact}",
  profileName: "implementer",
  continuation: "auto" as const,
};

const sampleBoard = {
  id: "board-1",
  projectId: "project-1",
  name: "Delivery",
  steps: [sampleStep],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const sampleCard = {
  id: "card-1",
  boardId: "board-1",
  projectId: "project-1",
  title: "SHIP-1",
  parameters: { ticket_id: "SHIP-1" },
  position: { kind: "todo" as const },
  status: null,
  operation: null,
  lastError: null,
  snapshot: null,
  branch: null,
  worktreePath: null,
  stepThreads: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  releasedAt: null,
  completedAt: null,
  settledAt: null,
  archivedAt: null,
};

const eventBase = {
  sequence: 1,
  eventId: "evt-1",
  aggregateKind: "board" as const,
  aggregateId: "board-1",
  occurredAt: "2026-01-01T00:00:00.000Z",
  commandId: "cmd-1",
  causationEventId: null,
  correlationId: "cmd-1",
  metadata: {},
};

it("CONTINUABLE_CARD_STATUSES covers continue/retry gates and excludes running", () => {
  assert.deepStrictEqual(
    [...CONTINUABLE_CARD_STATUSES],
    ["paused", "needs-input", "failed", "cancelled"],
  );
  assert.strictEqual(isContinuableCardStatus("paused"), true);
  assert.strictEqual(isContinuableCardStatus("running"), false);
  assert.strictEqual(isContinuableCardStatus(null), false);
});

it.effect("defaults BoardStep.continuation to auto when omitted", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBoardStep({
      id: "step-1",
      name: "Implement",
      promptTemplate: "Do the work",
      profileName: "implementer",
    });
    assert.strictEqual(parsed.continuation, "auto");
  }),
);

it.effect("decodes a canonical BoardStep that names an instance, model, and reasoning", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBoardStep({
      id: "step-1",
      name: "Implement",
      promptTemplate: "Do the work",
      agent: { instanceId: "grok", model: "grok-build", reasoning: "high" },
    });

    assert.deepStrictEqual(parsed.agent, {
      instanceId: ProviderInstanceId.make("grok"),
      model: "grok-build",
      reasoning: "high",
    });
    assert.strictEqual(parsed.profileName, undefined);
    assert.strictEqual(parsed.continuation, "auto");
  }),
);

it.effect("keeps a canonical BoardStep model slug exact, dots and slashes included", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBoardStep({
      id: "step-1",
      name: "Review",
      promptTemplate: "Review the work",
      agent: { instanceId: "pi_work", model: "openrouter/anthropic/claude-sonnet-4.6" },
    });

    assert.strictEqual(parsed.agent?.model, "openrouter/anthropic/claude-sonnet-4.6");
    assert.strictEqual(parsed.agent?.reasoning, undefined);
  }),
);

it.effect("holds a step's instance id to the same slug rules as every routing key", () =>
  Effect.gen(function* () {
    // A model slug may contain a slash; the instance id that routes it may not.
    for (const instanceId of ["pi work", "pi/work", ""]) {
      const result = yield* Effect.exit(
        decodeBoardStep({
          id: "step-1",
          name: "Review",
          promptTemplate: "Review the work",
          agent: { instanceId, model: "grok-build" },
        }),
      );
      assert.strictEqual(result._tag, "Failure", `expected '${instanceId}' to be rejected`);
    }
  }),
);

it.effect("still decodes a historical profileName step so persisted flows keep running", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBoardStep({
      id: "step-1",
      name: "Implement",
      promptTemplate: "Do the work",
      profileName: "implementer",
    });

    assert.strictEqual(parsed.profileName, "implementer");
    assert.strictEqual(parsed.agent, undefined);
  }),
);

it.effect("rejects a BoardStep that names both selectors or neither", () =>
  Effect.gen(function* () {
    const both = yield* Effect.exit(
      decodeBoardStep({
        id: "step-1",
        name: "Implement",
        promptTemplate: "Do the work",
        profileName: "implementer",
        agent: { instanceId: "grok", model: "grok-build" },
      }),
    );
    assert.strictEqual(both._tag, "Failure");

    const neither = yield* Effect.exit(
      decodeBoardStep({
        id: "step-1",
        name: "Implement",
        promptTemplate: "Do the work",
      }),
    );
    assert.strictEqual(neither._tag, "Failure");
  }),
);

it.effect("rejects BoardStep with empty name after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeBoardStep({
        id: "step-1",
        name: "  ",
        promptTemplate: "Do the work",
        profileName: "implementer",
        continuation: "manual",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("roundtrips OrchestrationBoard and OrchestrationCard", () =>
  Effect.gen(function* () {
    const board = yield* decodeOrchestrationBoard(sampleBoard);
    const card = yield* decodeOrchestrationCard({
      ...sampleCard,
      position: { kind: "step", stepIndex: 0 },
      status: "running",
      snapshot: { name: "Delivery", steps: [sampleStep] },
      branch: "board/card-1",
      worktreePath: "/tmp/wt",
      stepThreads: [
        {
          stepIndex: 0,
          threadId: "thread-1",
          spawnedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      releasedAt: "2026-01-01T00:01:00.000Z",
    });

    assert.strictEqual(board.id, "board-1");
    assert.strictEqual(board.steps[0]?.profileName, "implementer");
    assert.strictEqual(card.position.kind, "step");
    assert.strictEqual(card.status, "running");
    assert.strictEqual(card.stepThreads.length, 1);

    const {
      settledAt: _settledAt,
      operation: _operation,
      lastError: _lastError,
      ...legacyCard
    } = sampleCard;
    const decodedLegacyCard = yield* decodeOrchestrationCard(legacyCard);
    assert.strictEqual(decodedLegacyCard.settledAt, null);
    assert.strictEqual(decodedLegacyCard.operation, null);
    assert.strictEqual(decodedLegacyCard.lastError, null);

    const withOperation = yield* decodeOrchestrationCard({
      ...sampleCard,
      operation: {
        kind: "starting",
        operationId: "op-1",
        requestedAt: "2026-01-01T00:00:00.000Z",
      },
      lastError: "previous failure",
    });
    assert.strictEqual(withOperation.operation?.kind, "starting");
    assert.strictEqual(withOperation.lastError, "previous failure");

    // Historical agent status still decodes for re-projection compatibility.
    const deletingStatus = yield* decodeCardStatus("deleting");
    assert.strictEqual(deletingStatus, "deleting");

    const resetting = yield* decodeCardOperation({
      kind: "resetting",
      operationId: "op-reset",
      requestedAt: "2026-01-01T00:00:00.000Z",
      activeThreadId: "thread-1",
      threadIds: ["thread-1", "thread-2"],
    });
    assert.strictEqual(resetting.kind, "resetting");

    const archiveRequest = yield* decodeCardDeleteRequestedPayload({
      cardId: "card-1",
      requestedAt: "2026-01-01T00:00:00.000Z",
      operationId: "op-archive",
      purpose: "archive",
      deleteWorktree: false,
    });
    assert.strictEqual(archiveRequest.purpose, "archive");
    assert.strictEqual(archiveRequest.deleteWorktree, false);

    const historicalDelete = yield* decodeCardOperation({
      kind: "deleting",
      operationId: "archive:historical-delete-command",
      requestedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(historicalDelete.kind, "deleting");
    if (historicalDelete.kind === "deleting") {
      assert.strictEqual(historicalDelete.purpose, undefined);
    }

    const interruptedLegacyDelete = yield* decodeCardOperation({
      kind: "deleting",
      operationId: "archive:legacy-cleanup",
      requestedAt: "2026-01-01T00:00:00.000Z",
      cleanupStage: "conversations-deleted",
    });
    assert.strictEqual(interruptedLegacyDelete.kind, "deleting");
    if (interruptedLegacyDelete.kind === "deleting") {
      assert.strictEqual(interruptedLegacyDelete.cleanupStage, "conversations-archived");
    }

    const legacyCleanupEvent = yield* decodeOrchestrationEvent({
      sequence: 10,
      eventId: "event-legacy-cleanup",
      aggregateKind: "card",
      aggregateId: "card-1",
      type: "card.cleanup-progressed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "command-legacy-cleanup",
      causationEventId: null,
      correlationId: "command-legacy-cleanup",
      metadata: {},
      payload: {
        cardId: "card-1",
        operationId: "archive:legacy-cleanup",
        kind: "deleting",
        stage: "conversations-deleted",
        progressedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(legacyCleanupEvent.type, "card.cleanup-progressed");
    if (legacyCleanupEvent.type === "card.cleanup-progressed") {
      assert.strictEqual(legacyCleanupEvent.payload.stage, "conversations-archived");
    }

    // Legacy step-entry ops without threadId default to null.
    const legacyStarting = yield* decodeCardOperation({
      kind: "starting",
      operationId: "op-start-legacy",
      requestedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(legacyStarting.kind, "starting");
    if (legacyStarting.kind === "starting") {
      assert.strictEqual(legacyStarting.threadId, null);
    }

    const startingWithThread = yield* decodeCardOperation({
      kind: "starting",
      operationId: "op-start",
      requestedAt: "2026-01-01T00:00:00.000Z",
      threadId: "board-op-thread:op-start",
    });
    assert.strictEqual(startingWithThread.kind, "starting");
    if (startingWithThread.kind === "starting") {
      assert.strictEqual(startingWithThread.threadId, "board-op-thread:op-start");
    }
  }),
);

it.effect("decodes CardPosition variants and CardStatus literals", () =>
  Effect.gen(function* () {
    const todo = yield* decodeCardPosition({ kind: "todo" });
    const step = yield* decodeCardPosition({ kind: "step", stepIndex: 2 });
    const done = yield* decodeCardPosition({ kind: "done" });
    const status = yield* decodeCardStatus("needs-input");

    assert.strictEqual(todo.kind, "todo");
    assert.strictEqual(step.kind, "step");
    if (step.kind === "step") assert.strictEqual(step.stepIndex, 2);
    assert.strictEqual(done.kind, "done");
    assert.strictEqual(status, "needs-input");
  }),
);

it.effect("strips card parameter keys that fail the name pattern (Record key selection)", () =>
  Effect.gen(function* () {
    // effect-smol Record key checks select matching properties; non-matching keys
    // are dropped rather than failing the decode (same pattern as terminal env keys).
    const card = yield* decodeOrchestrationCard({
      ...sampleCard,
      parameters: { ticket_id: "SHIP-1", "1bad": "x" },
    });
    assert.deepStrictEqual(card.parameters, { ticket_id: "SHIP-1" });
  }),
);

it.effect("rejects card parameter values over the max length", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeOrchestrationCard({
        ...sampleCard,
        parameters: { ticket_id: "x".repeat(4_001) },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes client board and card commands", () =>
  Effect.gen(function* () {
    const createBoard = yield* decodeBoardCreateCommand({
      type: "board.create",
      commandId: "cmd-board-1",
      boardId: "board-1",
      projectId: "project-1",
      name: "Delivery",
      steps: [sampleStep],
    });
    const createCard = yield* decodeCardCreateCommand({
      type: "card.create",
      commandId: "cmd-card-1",
      cardId: "card-1",
      boardId: "board-1",
      title: "SHIP-1",
      parameters: { ticket_id: "SHIP-1" },
    });

    assert.strictEqual(createBoard.type, "board.create");
    assert.strictEqual(createCard.type, "card.create");

    const viaUnion = yield* decodeClientOrchestrationCommand({
      type: "card.release",
      commandId: "cmd-release-1",
      cardId: "card-1",
    });
    const settle = yield* decodeClientOrchestrationCommand({
      type: "card.settle",
      commandId: "cmd-settle-1",
      cardId: "card-1",
    });
    const unsettle = yield* decodeClientOrchestrationCommand({
      type: "card.unsettle",
      commandId: "cmd-unsettle-1",
      cardId: "card-1",
    });
    const deleteCard = yield* decodeClientOrchestrationCommand({
      type: "card.delete",
      commandId: "cmd-delete-1",
      cardId: "card-1",
    });
    const reset = yield* decodeClientOrchestrationCommand({
      type: "card.reset",
      commandId: "cmd-reset-1",
      cardId: "card-1",
    });
    const cancelLegacy = yield* decodeClientOrchestrationCommand({
      type: "card.cancel",
      commandId: "cmd-cancel-1",
      cardId: "card-1",
    });
    assert.strictEqual(viaUnion.type, "card.release");
    assert.strictEqual(settle.type, "card.settle");
    assert.strictEqual(unsettle.type, "card.unsettle");
    assert.strictEqual(deleteCard.type, "card.delete");
    assert.strictEqual(reset.type, "card.reset");
    assert.strictEqual(cancelLegacy.type, "card.cancel");
  }),
);

it.effect("decodes internal card commands via OrchestrationCommand", () =>
  Effect.gen(function* () {
    const report = yield* decodeCardStepReportCommand({
      type: "card.step.report",
      commandId: "cmd-report-1",
      cardId: "card-1",
      stepIndex: 0,
      threadId: "thread-1",
      outcome: "success",
    });
    const complete = yield* decodeCardReleaseCompleteCommand({
      type: "card.release.complete",
      commandId: "cmd-rel-complete",
      cardId: "card-1",
      operationId: "op-release-1",
      branch: "board/card-1",
      worktreePath: "/tmp/wt",
    });
    const viaUnion = yield* decodeOrchestrationCommand({
      type: "card.status.set",
      commandId: "cmd-status-1",
      cardId: "card-1",
      status: "paused",
    });
    const deleteComplete = yield* decodeOrchestrationCommand({
      type: "card.delete.complete",
      commandId: "cmd-delete-complete-1",
      cardId: "card-1",
      operationId: "op-delete-1",
    });
    const deleteFail = yield* decodeOrchestrationCommand({
      type: "card.delete.fail",
      commandId: "cmd-delete-fail-1",
      cardId: "card-1",
      operationId: "op-delete-1",
      reason: "cleanup failed",
    });
    const resetComplete = yield* decodeOrchestrationCommand({
      type: "card.reset.complete",
      commandId: "cmd-reset-complete-1",
      cardId: "card-1",
      operationId: "op-reset-1",
    });
    const operationFail = yield* decodeOrchestrationCommand({
      type: "card.operation.fail",
      commandId: "cmd-operation-fail-1",
      cardId: "card-1",
      operationId: "op-retry-1",
      kind: "retrying",
      reason: "archive failed",
    });

    assert.strictEqual(report.outcome, "success");
    assert.strictEqual(complete.branch, "board/card-1");
    assert.strictEqual(complete.operationId, "op-release-1");
    assert.strictEqual(viaUnion.type, "card.status.set");
    assert.strictEqual(deleteComplete.type, "card.delete.complete");
    assert.strictEqual(deleteFail.type, "card.delete.fail");
    assert.strictEqual(resetComplete.type, "card.reset.complete");
    assert.strictEqual(operationFail.type, "card.operation.fail");
    if (operationFail.type === "card.operation.fail") {
      assert.strictEqual(operationFail.kind, "retrying");
      assert.strictEqual(operationFail.reason, "archive failed");
    }
  }),
);

it.effect("decodes board and card event payloads and union membership", () =>
  Effect.gen(function* () {
    const payload = yield* decodeBoardCreatedPayload({
      boardId: "board-1",
      projectId: "project-1",
      name: "Delivery",
      steps: [sampleStep],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(payload.boardId, "board-1");

    const eventTypes = [
      "board.created",
      "board.updated",
      "board.deleted",
      "card.created",
      "card.title-updated",
      "card.release-requested",
      "card.released",
      "card.step-entered",
      "card.step-advance-requested",
      "card.status-set",
      "card.completed",
      "card.retry-requested",
      "card.cancel-requested",
      "card.reset-requested",
      "card.reset",
      "card.operation-failed",
      "card.settled",
      "card.unsettled",
      "card.archived",
      "card.unarchived",
      "card.delete-requested",
      "card.deleted",
    ] as const;

    for (const type of eventTypes) {
      const parsedType = yield* decodeOrchestrationEventType(type);
      assert.strictEqual(parsedType, type);
    }

    const boardEvent = yield* decodeOrchestrationEvent({
      ...eventBase,
      type: "board.created",
      payload: {
        boardId: "board-1",
        projectId: "project-1",
        name: "Delivery",
        steps: [sampleStep],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(boardEvent.type, "board.created");
    assert.strictEqual(boardEvent.aggregateKind, "board");

    const cardEvent = yield* decodeOrchestrationEvent({
      ...eventBase,
      aggregateKind: "card",
      aggregateId: "card-1",
      type: "card.status-set",
      payload: {
        cardId: "card-1",
        status: "failed",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    });
    assert.strictEqual(cardEvent.type, "card.status-set");
  }),
);

it.effect(
  "defaults missing boards/cards arrays on historical read models and shell snapshots",
  () =>
    Effect.gen(function* () {
      const readModel = yield* decodeOrchestrationReadModel({
        snapshotSequence: 0,
        projects: [],
        threads: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const shell = yield* decodeOrchestrationShellSnapshot({
        snapshotSequence: 0,
        projects: [],
        threads: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      assert.deepStrictEqual(readModel.boards, []);
      assert.deepStrictEqual(readModel.cards, []);
      assert.deepStrictEqual(shell.boards, []);
      assert.deepStrictEqual(shell.cards, []);
    }),
);

it.effect("decodes shell stream board/card upsert and remove events", () =>
  Effect.gen(function* () {
    const upserted = yield* decodeOrchestrationShellStreamEvent({
      kind: "board-upserted",
      sequence: 3,
      board: sampleBoard,
    });
    const removed = yield* decodeOrchestrationShellStreamEvent({
      kind: "card-removed",
      sequence: 4,
      cardId: "card-1",
    });
    const cardUpserted = yield* decodeOrchestrationShellStreamEvent({
      kind: "card-upserted",
      sequence: 5,
      card: sampleCard,
    });
    const boardRemoved = yield* decodeOrchestrationShellStreamEvent({
      kind: "board-removed",
      sequence: 6,
      boardId: "board-1",
    });

    assert.strictEqual(upserted.kind, "board-upserted");
    assert.strictEqual(removed.kind, "card-removed");
    assert.strictEqual(cardUpserted.kind, "card-upserted");
    assert.strictEqual(boardRemoved.kind, "board-removed");
  }),
);

it.effect("decodes artifact RPC input/output and rejects oversized write content", () =>
  Effect.gen(function* () {
    assert.strictEqual(BOARD_WS_METHODS.readArtifact, "board.readArtifact");
    assert.strictEqual(BOARD_WS_METHODS.writeArtifact, "board.writeArtifact");

    const input = yield* decodeBoardReadArtifactInput({
      cardId: "card-1",
      stepName: "Implement",
    });
    const result = yield* decodeBoardReadArtifactResult({
      exists: true,
      content: "# brief",
      path: "/state/board-artifacts/wt/Implement.md",
    });
    const write = yield* decodeBoardWriteArtifactInput({
      cardId: "card-1",
      stepName: "Implement",
      content: "updated",
    });

    assert.strictEqual(input.stepName, "Implement");
    assert.strictEqual(result.exists, true);
    assert.strictEqual(write.content, "updated");

    const tooLarge = yield* Effect.exit(
      decodeBoardWriteArtifactInput({
        cardId: "card-1",
        stepName: "Implement",
        content: "x".repeat(1_000_001),
      }),
    );
    assert.strictEqual(tooLarge._tag, "Failure");
  }),
);

it.effect("client cannot dispatch internal card commands", () =>
  Effect.gen(function* () {
    const forged = yield* decodeClientOrchestrationCommand({
      type: "card.step.report",
      commandId: "cmd-forged",
      cardId: "card-1",
      stepIndex: 0,
      threadId: "thread-1",
      outcome: "success",
    }).pipe(Effect.flip);
    assert.ok(forged);
  }),
);
