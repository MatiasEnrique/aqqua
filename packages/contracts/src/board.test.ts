import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BoardCreateCommand,
  BoardCreatedPayload,
  BoardReadArtifactInput,
  BoardReadArtifactResult,
  BoardStep,
  BoardWriteArtifactInput,
  CardCreateCommand,
  CardPosition,
  CardReleaseCompleteCommand,
  CardStatus,
  CardStepReportCommand,
  CONTINUABLE_CARD_STATUSES,
  isContinuableCardStatus,
  OrchestrationBoard,
  OrchestrationCard,
  BOARD_WS_METHODS,
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

const decodeBoardStep = Schema.decodeUnknownEffect(BoardStep);
const decodeOrchestrationBoard = Schema.decodeUnknownEffect(OrchestrationBoard);
const decodeOrchestrationCard = Schema.decodeUnknownEffect(OrchestrationCard);
const decodeBoardCreateCommand = Schema.decodeUnknownEffect(BoardCreateCommand);
const decodeCardCreateCommand = Schema.decodeUnknownEffect(CardCreateCommand);
const decodeCardStepReportCommand = Schema.decodeUnknownEffect(CardStepReportCommand);
const decodeCardReleaseCompleteCommand = Schema.decodeUnknownEffect(CardReleaseCompleteCommand);
const decodeBoardCreatedPayload = Schema.decodeUnknownEffect(BoardCreatedPayload);
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
  snapshot: null,
  branch: null,
  worktreePath: null,
  stepThreads: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  releasedAt: null,
  completedAt: null,
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
    assert.strictEqual(viaUnion.type, "card.release");
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
      branch: "board/card-1",
      worktreePath: "/tmp/wt",
    });
    const viaUnion = yield* decodeOrchestrationCommand({
      type: "card.status.set",
      commandId: "cmd-status-1",
      cardId: "card-1",
      status: "paused",
    });

    assert.strictEqual(report.outcome, "success");
    assert.strictEqual(complete.branch, "board/card-1");
    assert.strictEqual(viaUnion.type, "card.status.set");
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
      "card.archived",
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
