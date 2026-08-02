import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  Crypto.Crypto,
];

export const BoardCompleteOutcome = Schema.Literals(["success", "blocked"]);
export type BoardCompleteOutcome = typeof BoardCompleteOutcome.Type;

export const BoardCompleteInput = Schema.Struct({
  outcome: BoardCompleteOutcome,
});
export type BoardCompleteInput = typeof BoardCompleteInput.Type;

export const BoardCompleteResult = Schema.Struct({
  accepted: Schema.Boolean,
  message: Schema.String,
});
export type BoardCompleteResult = typeof BoardCompleteResult.Type;

export const BoardCompleteTool = Tool.make("board_complete", {
  description:
    "Signal that this flow step thread has finished. Call with outcome `success` when the step's work is done (and its artifact is written), or `blocked` when you cannot proceed and need human input. Only the card's current step thread may call this; sub-agents and ordinary chats are refused.",
  parameters: BoardCompleteInput,
  success: BoardCompleteResult,
  dependencies,
})
  .annotate(Tool.Title, "Complete flow step")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const BoardToolkit = Toolkit.make(BoardCompleteTool);
