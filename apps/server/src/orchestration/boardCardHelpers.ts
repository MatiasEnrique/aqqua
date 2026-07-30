import type { OrchestrationCard, ThreadId } from "@t3tools/contracts";

/**
 * Find the card whose CURRENT step thread is `threadId` (latest stepThreads
 * entry for the card's current stepIndex). Sub-agents and stale retries never match.
 */
export function findCardForCurrentStepThread(
  cards: ReadonlyArray<OrchestrationCard>,
  threadId: ThreadId,
): OrchestrationCard | null {
  for (const card of cards) {
    if (card.archivedAt !== null) continue;
    const position = card.position;
    if (position.kind !== "step") continue;
    const current = [...card.stepThreads]
      .toReversed()
      .find((entry) => entry.stepIndex === position.stepIndex);
    if (current !== undefined && current.threadId === threadId) {
      return card;
    }
  }
  return null;
}

function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

/**
 * Scans the read model's activities (projector-capped) for open approval /
 * user-input requests. Shared by the decider (settle/snooze gates) and the
 * board reactor (needs-input ↔ running transitions).
 */
export function hasOpenBlockingRequest(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}): boolean {
  const openRequestIds = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      openRequestIds.delete(requestId);
    }
  }
  return openRequestIds.size > 0;
}
