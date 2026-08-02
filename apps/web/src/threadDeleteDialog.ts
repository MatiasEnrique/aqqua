import type { VcsInspectWorktreeRemovalResult } from "@aqqua/contracts";

import type { WorktreeDeletionCandidate } from "./worktreeCleanup";

export interface ThreadDeleteDialogRequest {
  readonly title: string;
  readonly threadCount: number;
  readonly candidates: ReadonlyArray<WorktreeDeletionCandidate>;
  readonly hasUnverifiableWorktrees: boolean;
}

export interface ThreadDeleteDecision {
  readonly deleteWorktrees: boolean;
  readonly selectionSource: "none" | "smart-default" | "explicit";
  readonly inspections: Readonly<Record<string, VcsInspectWorktreeRemovalResult>>;
}

export type ThreadDeleteDialogState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming";
      readonly requestId: number;
      readonly request: ThreadDeleteDialogRequest;
    }
  | {
      readonly status: "closing";
      readonly requestId: number;
      readonly request: ThreadDeleteDialogRequest;
    };

export class ThreadDeleteConfirmationConflictError extends Error {
  constructor() {
    super("Another thread deletion confirmation is already open.");
    this.name = "ThreadDeleteConfirmationConflictError";
  }
}

const idleState: ThreadDeleteDialogState = { status: "idle" };
let state: ThreadDeleteDialogState = idleState;
let nextRequestId = 1;
let resolveConfirmation: ((decision: ThreadDeleteDecision | null) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: ThreadDeleteDialogState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function readThreadDeleteDialogState(): ThreadDeleteDialogState {
  return state;
}

export function subscribeThreadDeleteDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestThreadDeleteConfirmation(
  request: ThreadDeleteDialogRequest,
): Promise<ThreadDeleteDecision | null> {
  if (state.status !== "idle") {
    return Promise.reject(new ThreadDeleteConfirmationConflictError());
  }

  const requestId = nextRequestId++;
  publish({ status: "confirming", requestId, request });
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
  });
}

export function respondToThreadDeleteConfirmation(decision: ThreadDeleteDecision | null): void {
  if (state.status !== "confirming" || !resolveConfirmation) return;

  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  publish({
    status: "closing",
    requestId: state.requestId,
    request: state.request,
  });
  resolve(decision);
}

export function completeThreadDeleteDialogClose(): void {
  if (state.status === "closing") publish(idleState);
}

export function resetThreadDeleteDialogForTests(): void {
  resolveConfirmation?.(null);
  resolveConfirmation = null;
  publish(idleState);
  listeners.clear();
  nextRequestId = 1;
}
