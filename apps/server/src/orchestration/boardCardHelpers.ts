import {
  type CardOperation,
  type CardOperationId,
  type CardStatus,
  type OrchestrationCard,
  type OrchestrationSession,
  MessageId,
  ThreadId,
} from "@aqqua/contracts";

export type ThreadLineageMember = {
  readonly id: ThreadId;
  readonly parentThreadId?: ThreadId | null | undefined;
  readonly session: OrchestrationSession | null;
  readonly archivedAt: string | null;
};

/** Roots plus every descendant over a combined live and archived thread shell. */
export function collectThreadLineage(
  roots: ReadonlyArray<ThreadId | string>,
  threads: ReadonlyArray<ThreadLineageMember>,
): ReadonlyArray<ThreadLineageMember> {
  const childrenByParent = new Map<string, ThreadLineageMember[]>();
  const byId = new Map(threads.map((thread) => [String(thread.id), thread] as const));
  for (const thread of threads) {
    if (thread.parentThreadId == null) continue;
    const parentId = String(thread.parentThreadId);
    const children = childrenByParent.get(parentId) ?? [];
    children.push(thread);
    childrenByParent.set(parentId, children);
  }

  const collected = new Map<string, ThreadLineageMember>();
  const pending = roots.map(String);
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || collected.has(id)) continue;
    collected.set(
      id,
      byId.get(id) ?? {
        id: ThreadId.make(id),
        parentThreadId: null,
        session: null,
        archivedAt: null,
      },
    );
    for (const child of childrenByParent.get(id) ?? []) pending.push(String(child.id));
  }
  return [...collected.values()];
}

/**
 * Stable step-thread id claimed with a starting/advancing/retrying operation.
 * Derived from the operation id (itself the claiming command id) so a reactor
 * restart never allocates a second agent thread for the same claim.
 *
 * Single source of truth — decider and BoardReactor must both use this.
 */
export function boardOperationThreadId(operationId: CardOperationId | string): ThreadId {
  return ThreadId.make(`board-op-thread:${operationId}`);
}

/**
 * Stable user MessageId for the board step prompt. Restart recovery reuses this
 * id so `thread.message-sent` upserts the same logical prompt instead of
 * appending a duplicate. Turn-start *command* ids stay fresh so receipts do not
 * suppress the replacement hot event after restart.
 */
export function boardOperationMessageId(operationId: CardOperationId | string): MessageId {
  return MessageId.make(`board-op-message:${operationId}`);
}

/**
 * Resolve the durable step-thread id for a step-entry claim. Legacy projected
 * rows may have `threadId: null`; fall back to the same deterministic derivation.
 */
export function resolveStepEntryThreadId(
  operation: Extract<CardOperation, { kind: "starting" | "advancing" | "retrying" }>,
): ThreadId {
  return operation.threadId ?? boardOperationThreadId(operation.operationId);
}

/**
 * A provider turn that may still be executing. Ready/stopped/interrupted/error/
 * idle/missing mean lifecycle finalization may proceed.
 */
export function isProviderTurnLive(session: OrchestrationSession | null | undefined): boolean {
  if (session === null || session === undefined) {
    return false;
  }
  return session.status === "starting" || session.status === "running";
}

/**
 * Pure restart/receipt decision for step-entry turn starts.
 *
 * - `request-turn`: session is null and this process has not yet dispatched
 * - `await-session`: session is still null but this process already dispatched
 *   (must not re-request; keep the durable claim)
 * - `link`: session receipt observed — clear claim via step.enter (optionally
 *   surface a terminal recoverable status)
 *
 * A new process starts with `turnStartAlreadyDispatched: false`, so null session
 * after restart correctly re-requests once with a fresh command id.
 */
export type BoardStepTurnStartDecision =
  | { readonly action: "request-turn" }
  | { readonly action: "await-session" }
  | {
      readonly action: "link";
      readonly terminalStatus: Extract<CardStatus, "needs-input" | "failed"> | null;
    };

export function decideBoardStepTurnStart(input: {
  readonly session: OrchestrationSession | null | undefined;
  readonly turnStartAlreadyDispatched: boolean;
}): BoardStepTurnStartDecision {
  if (input.session === null || input.session === undefined) {
    return input.turnStartAlreadyDispatched
      ? { action: "await-session" }
      : { action: "request-turn" };
  }
  if (isProviderTurnLive(input.session)) {
    return { action: "link", terminalStatus: null };
  }
  if (input.session.status === "error") {
    return { action: "link", terminalStatus: "failed" };
  }
  return { action: "link", terminalStatus: "needs-input" };
}

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
