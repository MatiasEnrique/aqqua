import type { AgentSpawnRequest } from "@aqqua/contracts";

export const AGENT_SPAWN_SELECTOR_CONFLICT_MESSAGE =
  "'profile' cannot be combined with 'modelSelection' or 'reasoning'. Choose one selector style.";

export const hasAgentSpawnSelectorConflict = (
  request: Pick<AgentSpawnRequest, "profile" | "modelSelection" | "reasoning">,
): boolean =>
  request.profile !== undefined &&
  (request.modelSelection !== undefined || request.reasoning !== undefined);
