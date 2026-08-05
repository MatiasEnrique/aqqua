/**
 * Sub-agent turn status derivation.
 *
 * aqqua has no `thread.turn-completed` event. A turn ends when its thread's session
 * leaves the `running` status, and the projector is what turns that into a turn
 * state (`apps/server/src/orchestration/projector.ts`). Delegation has to read
 * the same signal, so these two functions mirror the projector's rules
 * deliberately — if the projector's mapping changes, these must change with it.
 *
 * Both are pure so the definition of "done" is testable without a provider.
 *
 * @module agent-control/Status
 */
import type { OrchestrationLatestTurn, OrchestrationSessionStatus } from "@aqqua/contracts";

import type { AgentRunStatus } from "./Services/AgentControl.ts";

/**
 * Terminal status implied by a session status, or `null` while the session is
 * still starting or running and the turn must stay unsettled.
 *
 * Mirrors `settledTurnStateForSessionStatus` in the projector.
 */
export function agentRunStatusFromSessionStatus(
  status: OrchestrationSessionStatus,
): Exclude<AgentRunStatus, "running"> | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "failed";
    case "interrupted":
    case "stopped":
      // A provider process that exits surfaces as `stopped`, so a crash and a
      // user interrupt land in the same bucket. The session's `lastError` is what
      // distinguishes them for reporting.
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

/**
 * Status implied by a thread's latest-turn state, used for the projection recheck
 * that closes the subscribe-after-completion race and for listing sub-agents.
 */
export function agentRunStatusFromLatestTurn(
  latestTurn: Pick<OrchestrationLatestTurn, "state"> | null,
): AgentRunStatus {
  if (latestTurn === null) {
    // No turn has been recorded yet. The sub-agent was created and its turn
    // requested, so from a caller's point of view it is working.
    return "running";
  }
  switch (latestTurn.state) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "failed";
    case "interrupted":
      return "interrupted";
  }
}

export function isSettledAgentRunStatus(
  status: AgentRunStatus,
): status is Exclude<AgentRunStatus, "running"> {
  return status !== "running";
}

/**
 * Status of a sub-agent's most recent turn, from its projected thread.
 *
 * Two signals are needed, not one. `projection_threads.latest_turn_id` is set
 * from the session's `activeTurnId`, so it is **cleared** the moment a session
 * leaves `running` — the settled turn row is only re-linked later, when the
 * checkpoint reactor dispatches `thread.turn.diff.complete`. In that window the
 * thread has no latest turn at all, and reading only `latestTurn` would report a
 * finished sub-agent as still working: a caller would wait for a turn that had
 * already ended.
 *
 * A pending turn start or a `running`/`starting` session wins first, even over a
 * stale settled turn pointer. The session precedence agrees with the web's
 * `classifyThreadPresentation`, which also checks for a running session before
 * classifying the latest turn. Otherwise a settled `latestTurn` wins (preserving
 * the re-link window above), followed by the session-derived status and finally
 * `running` when neither signal settles.
 */
export function agentRunStatusFromThread(thread: {
  readonly hasPendingTurnStart: boolean;
  readonly latestTurn: Pick<OrchestrationLatestTurn, "state"> | null;
  readonly session: { readonly status: OrchestrationSessionStatus } | null;
}): AgentRunStatus {
  if (
    thread.hasPendingTurnStart ||
    thread.session?.status === "running" ||
    thread.session?.status === "starting"
  ) {
    return "running";
  }
  const fromTurn = agentRunStatusFromLatestTurn(thread.latestTurn);
  if (isSettledAgentRunStatus(fromTurn)) {
    return fromTurn;
  }
  if (thread.session === null) {
    return "running";
  }
  return agentRunStatusFromSessionStatus(thread.session.status) ?? "running";
}
