import type { VcsInspectWorktreeRemovalResult } from "@aqqua/contracts";

export interface WorktreeDeleteDialogRequest {
  readonly label: string;
  readonly path: string;
  readonly conversationCount: number;
  readonly archivedCount: number;
  readonly inspection: VcsInspectWorktreeRemovalResult;
}

export interface WorktreeDeleteDecision {
  readonly deleteBranch: boolean;
}

export type WorktreeDeleteDialogState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming";
      readonly requestId: number;
      readonly request: WorktreeDeleteDialogRequest;
      readonly deleteBranch: boolean;
    }
  | {
      readonly status: "closing";
      readonly requestId: number;
      readonly request: WorktreeDeleteDialogRequest;
      readonly deleteBranch: boolean;
    };

export class WorktreeDeleteConfirmationConflictError extends Error {
  constructor() {
    super("Another worktree deletion confirmation is already open.");
    this.name = "WorktreeDeleteConfirmationConflictError";
  }
}

const idleState: WorktreeDeleteDialogState = { status: "idle" };
let state: WorktreeDeleteDialogState = idleState;
let nextRequestId = 1;
let resolveConfirmation: ((decision: WorktreeDeleteDecision | null) => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: WorktreeDeleteDialogState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function readWorktreeDeleteDialogState(): WorktreeDeleteDialogState {
  return state;
}

export function subscribeWorktreeDeleteDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestWorktreeDeleteConfirmation(
  request: WorktreeDeleteDialogRequest,
): Promise<WorktreeDeleteDecision | null> {
  if (state.status !== "idle") {
    return Promise.reject(new WorktreeDeleteConfirmationConflictError());
  }

  const requestId = nextRequestId++;
  publish({ status: "confirming", requestId, request, deleteBranch: false });
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
  });
}

export function setWorktreeDeleteBranchSelection(deleteBranch: boolean): void {
  if (state.status !== "confirming") return;
  publish({ ...state, deleteBranch });
}

export function respondToWorktreeDeleteConfirmation(decision: WorktreeDeleteDecision | null): void {
  if (state.status !== "confirming" || !resolveConfirmation) return;

  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  publish({
    status: "closing",
    requestId: state.requestId,
    request: state.request,
    deleteBranch: state.deleteBranch,
  });
  resolve(decision);
}

export function completeWorktreeDeleteDialogClose(): void {
  if (state.status === "closing") publish(idleState);
}

export function resetWorktreeDeleteDialogForTests(): void {
  resolveConfirmation?.(null);
  resolveConfirmation = null;
  publish(idleState);
  listeners.clear();
  nextRequestId = 1;
}
