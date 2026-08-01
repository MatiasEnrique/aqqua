import {
  type CardOperation,
  type CardOperationId,
  type OrchestrationCard,
  type OrchestrationSession,
  ThreadId,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";

import { resolveStepEntryThreadId } from "../boardCardHelpers.ts";

/**
 * Branch for a released card: `board/<slugified-title>-<short-id>`.
 * Short id is the trailing 8 chars of the card id for uniqueness.
 */
export function boardCardBranchName(input: {
  readonly title: string;
  readonly cardId: string;
}): string {
  const slug = sanitizeBranchFragment(input.title);
  const shortId = input.cardId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "card";
  return `board/${slug}-${shortId}`;
}

/**
 * Step thread title shown in the sidebar: `<card title> · <n> <step name>`.
 * Step numbers are 1-based for humans.
 */
export function boardStepThreadTitle(input: {
  readonly cardTitle: string;
  readonly stepIndex: number;
  readonly stepName: string;
}): string {
  return `${input.cardTitle} · ${input.stepIndex + 1} ${input.stepName}`;
}

export type ThreadLineageMember = {
  readonly id: ThreadId;
  readonly parentThreadId: ThreadId | null;
  readonly session: OrchestrationSession | null;
  readonly archivedAt: string | null;
};

/**
 * Roots plus all descendants over a combined live+archived thread shell.
 * Used so Continue/Retry/Reset interrupt every live agent on the card worktree.
 */
export function collectThreadLineage(
  roots: ReadonlyArray<ThreadId | string>,
  threads: ReadonlyArray<ThreadLineageMember>,
): ReadonlyArray<ThreadLineageMember> {
  const byId = new Map(threads.map((thread) => [String(thread.id), thread] as const));
  const collected = new Map<string, ThreadLineageMember>();
  const queue = roots.map(String);
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    if (collected.has(id)) {
      continue;
    }
    const existing = byId.get(id);
    if (existing !== undefined) {
      collected.set(id, existing);
    } else {
      collected.set(id, {
        id: ThreadId.make(id),
        parentThreadId: null,
        session: null,
        archivedAt: null,
      });
    }
    for (const thread of threads) {
      if (thread.parentThreadId != null && String(thread.parentThreadId) === id) {
        queue.push(String(thread.id));
      }
    }
  }
  return [...collected.values()];
}

/**
 * Whether a card's *current* durable operation owns `threadId` for handler-failure
 * recovery: the stable step-entry thread and/or the advancing/retrying/resetting
 * interrupt lineage (over a live+archived shell view).
 */
export function cardOperationOwnsThreadForHandlerFailure(input: {
  readonly card: OrchestrationCard;
  readonly threadId: ThreadId;
  readonly allThreads: ReadonlyArray<ThreadLineageMember>;
}): boolean {
  const operation = input.card.operation;
  if (operation === null) {
    return false;
  }

  if (
    operation.kind === "starting" ||
    operation.kind === "advancing" ||
    operation.kind === "retrying"
  ) {
    if (resolveStepEntryThreadId(operation) === input.threadId) {
      return true;
    }
  }

  let roots: ThreadId[] = [];
  if (operation.kind === "advancing") {
    const position = input.card.position;
    if (position.kind === "step") {
      const root = [...input.card.stepThreads]
        .toReversed()
        .find((entry) => entry.stepIndex === position.stepIndex)?.threadId;
      if (root !== undefined) {
        roots = [root];
      }
    }
  } else if (operation.kind === "retrying") {
    const root = [...input.card.stepThreads]
      .toReversed()
      .find((entry) => entry.stepIndex === operation.stepIndex)?.threadId;
    if (root !== undefined) {
      roots = [root];
    }
  } else if (operation.kind === "resetting") {
    roots = [...operation.threadIds];
  } else {
    return false;
  }

  if (roots.length === 0) {
    return false;
  }
  return collectThreadLineage(roots, input.allThreads).some(
    (member) => member.id === input.threadId,
  );
}

export function cardOperationMatches(
  card: OrchestrationCard,
  operationId: CardOperationId | undefined,
  kinds: ReadonlyArray<CardOperation["kind"]>,
): card is OrchestrationCard & { readonly operation: CardOperation } {
  if (card.operation === null) {
    return false;
  }
  if (operationId !== undefined && card.operation.operationId !== operationId) {
    return false;
  }
  return (kinds as ReadonlyArray<string>).includes(card.operation.kind);
}

export function currentStepRootThreadId(card: OrchestrationCard): ThreadId | null {
  if (card.position.kind !== "step") return null;
  const stepIndex = card.position.stepIndex;
  return (
    [...card.stepThreads].toReversed().find((item) => item.stepIndex === stepIndex)?.threadId ??
    null
  );
}
