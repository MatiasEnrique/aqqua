import type { AgentSpawnRequest } from "@aqqua/contracts";

export const AGENT_SPAWN_SELECTOR_CONFLICT_MESSAGE =
  "'profile' cannot be combined with 'modelSelection' or 'reasoning'. Choose one selector style.";

export const AGENT_SPAWN_WORKTREE_CONFLICT_MESSAGE =
  "'worktree' cannot be combined with 'worktreeFromThreadId'. Choose a fresh or existing worktree.";

export const hasAgentSpawnSelectorConflict = (
  request: Pick<AgentSpawnRequest, "profile" | "modelSelection" | "reasoning">,
): boolean =>
  request.profile !== undefined &&
  (request.modelSelection !== undefined || request.reasoning !== undefined);

export const hasAgentSpawnWorktreeConflict = (
  request: Pick<AgentSpawnRequest, "worktree" | "worktreeFromThreadId">,
): boolean => request.worktree === true && request.worktreeFromThreadId !== undefined;
