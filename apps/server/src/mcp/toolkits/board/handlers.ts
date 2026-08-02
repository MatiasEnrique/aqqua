import { CommandId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { findCardForCurrentStepThread } from "../../../orchestration/boardCardHelpers.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { BoardToolkit, type BoardCompleteOutcome } from "./tools.ts";

export { findCardForCurrentStepThread };

export function boardCompleteReplyText(input: {
  readonly outcome: BoardCompleteOutcome;
  readonly stepIndex: number;
  readonly stepName: string;
  readonly advances: boolean;
  readonly completes: boolean;
}): string {
  const stepLabel = `step ${input.stepIndex + 1} · ${input.stepName}`;
  if (input.outcome === "blocked") {
    return `Recorded blocked for ${stepLabel} — card marked needs-input.`;
  }
  if (input.completes) {
    return `Recorded success for ${stepLabel} — card reaches Done.`;
  }
  if (input.advances) {
    return `Recorded success for ${stepLabel} — card advances.`;
  }
  return `Recorded success for ${stepLabel} — card paused for review.`;
}

export const boardComplete = Effect.fn("BoardToolkit.board_complete")(function* (input: {
  readonly outcome: BoardCompleteOutcome;
}) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const snapshots = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  // Tool handlers must not surface orchestration/persistence errors as Effect
  // failures — map them to a refused result so the MCP call still returns.
  const result = yield* Effect.gen(function* () {
    const shell = yield* snapshots.getShellSnapshot();
    const card = findCardForCurrentStepThread(shell.cards, invocation.threadId);
    if (card === null) {
      return {
        accepted: false,
        message:
          "This thread is not the current step thread of any flow card. " +
          "Only the active step thread may call board_complete — sub-agents and ordinary chats cannot move a card.",
      };
    }

    if (card.position.kind !== "step" || card.snapshot === null) {
      return {
        accepted: false,
        message: "Card is not positioned at a step with a snapshot.",
      };
    }

    const stepIndex = card.position.stepIndex;
    const step = card.snapshot.steps[stepIndex];
    if (step === undefined) {
      return {
        accepted: false,
        message: `Card step index ${stepIndex} is out of range.`,
      };
    }

    const commandId = CommandId.make(
      `mcp:board-complete:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
    );

    yield* engine.dispatch({
      type: "card.step.report",
      commandId,
      cardId: card.id,
      stepIndex,
      threadId: invocation.threadId,
      outcome: input.outcome,
    });

    const isLastStep = stepIndex === card.snapshot.steps.length - 1;
    const advances = input.outcome === "success" && step.continuation === "auto" && !isLastStep;
    const completes = input.outcome === "success" && step.continuation === "auto" && isLastStep;

    return {
      accepted: true,
      message: boardCompleteReplyText({
        outcome: input.outcome,
        stepIndex,
        stepName: step.name,
        advances,
        completes,
      }),
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        accepted: false,
        message:
          "message" in error && typeof error.message === "string"
            ? error.message
            : "Failed to record flow step report.",
      }),
    ),
  );

  return result;
});

const handlers = {
  board_complete: (input: { readonly outcome: BoardCompleteOutcome }) => boardComplete(input),
} satisfies Parameters<typeof BoardToolkit.toLayer>[0];

export const BoardToolkitHandlersLive = BoardToolkit.toLayer(handlers);
