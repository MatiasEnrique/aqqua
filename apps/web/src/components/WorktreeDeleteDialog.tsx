import { useSyncExternalStore } from "react";

import {
  completeWorktreeDeleteDialogClose,
  type WorktreeDeleteDialogRequest,
  readWorktreeDeleteDialogState,
  respondToWorktreeDeleteConfirmation,
  setWorktreeDeleteBranchSelection,
  subscribeWorktreeDeleteDialog,
} from "../worktreeDeleteDialog";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

function mergeLabel(request: WorktreeDeleteDialogRequest): string {
  if (request.inspection.mergeStatus === "merged") return "Merged";
  if (request.inspection.mergeStatus === "unmerged") return "Not merged";
  return "Merge unknown";
}

function changesLabel(request: WorktreeDeleteDialogRequest): string {
  if (request.inspection.workingTreeStatus === "clean") return "Clean";
  if (request.inspection.workingTreeStatus === "dirty") return "Has changes";
  return "Changes unknown";
}

export function WorktreeDeleteDialogView(props: {
  readonly request: WorktreeDeleteDialogRequest;
  readonly deleteBranch: boolean;
  readonly onDeleteBranchChange: (checked: boolean) => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}) {
  const { inspection } = props.request;
  const canDeleteBranch =
    inspection.availability === "available" &&
    inspection.refName !== null &&
    inspection.headCommit !== null;
  const conversationCopy = `${props.request.conversationCount} conversation${props.request.conversationCount === 1 ? "" : "s"} will be permanently deleted${props.request.archivedCount > 0 ? `, including ${props.request.archivedCount} archived` : ""}.`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete worktree “{props.request.label}”?</DialogTitle>
        <DialogDescription>{conversationCopy} This cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        <section className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
          <p className="break-all font-medium">{props.request.path}</p>
          {inspection.availability === "available" ? (
            <p className="text-xs text-muted-foreground">
              Branch: {inspection.refName ?? "Detached HEAD"} · Base:{" "}
              {inspection.baseRef ?? "Unknown"} · {mergeLabel(props.request)} ·{" "}
              {changesLabel(props.request)}
            </p>
          ) : inspection.availability === "missing" ? (
            <p className="text-xs text-muted-foreground">
              The worktree no longer exists. aqqua will remove its stale conversations.
            </p>
          ) : (
            <p className="text-xs text-warning-foreground">
              Git no longer recognizes this path as a worktree. aqqua will remove its stale
              conversations and leave the directory untouched.
            </p>
          )}
        </section>

        {canDeleteBranch ? (
          <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-2">
            <Checkbox
              aria-label={`Also delete local branch ${inspection.refName}`}
              checked={props.deleteBranch}
              onCheckedChange={(checked) => props.onDeleteBranchChange(checked === true)}
            />
            <span className="min-w-0 text-sm">
              <span className="block font-medium">
                Also delete local branch “{inspection.refName}”
              </span>
              <span className="block text-xs text-muted-foreground">
                Remote branches are never deleted.
              </span>
            </span>
          </label>
        ) : null}

        <p className="text-sm text-destructive">
          {inspection.availability !== "available"
            ? "Only Aqqua conversation metadata will be deleted for this unavailable worktree."
            : props.deleteBranch
              ? "The worktree and selected local branch are removed permanently."
              : "The worktree is removed permanently. The local branch is kept."}
        </p>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={props.onDelete}>
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}

export function WorktreeDeleteDialog() {
  const state = useSyncExternalStore(
    subscribeWorktreeDeleteDialog,
    readWorktreeDeleteDialogState,
    readWorktreeDeleteDialogState,
  );

  const request = state.status === "idle" ? null : state.request;
  const deleteBranch = state.status === "idle" ? false : state.deleteBranch;
  const cancel = () => respondToWorktreeDeleteConfirmation(null);
  const submit = () => respondToWorktreeDeleteConfirmation({ deleteBranch });

  return (
    <Dialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open && state.status === "confirming") cancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeWorktreeDeleteDialogClose();
      }}
    >
      <DialogPopup className="max-w-xl" showCloseButton>
        {request ? (
          <WorktreeDeleteDialogView
            request={request}
            deleteBranch={deleteBranch}
            onDeleteBranchChange={setWorktreeDeleteBranchSelection}
            onCancel={cancel}
            onDelete={submit}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
