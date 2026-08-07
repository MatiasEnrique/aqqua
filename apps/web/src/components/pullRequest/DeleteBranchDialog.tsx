import { isAtomCommandInterrupted } from "@aqqua/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@aqqua/contracts";
import { useMemo, useState } from "react";

import { useThreadActions } from "~/hooks/useThreadActions";
import { gitEnvironment } from "~/state/git";
import { useThreadShells } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  reduceDeleteBranchDialogStep,
  type DeleteBranchDialogStep,
} from "../PullRequestPanel.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { changeRequestFailureMessage } from "./changeRequestFailureMessage";

export function DeleteBranchDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly reference: string;
  readonly headRef: string;
}) {
  const [step, setStep] = useState<DeleteBranchDialogStep>({ kind: "confirm-remote" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteBranch = useAtomCommand(gitEnvironment.deleteChangeRequestBranch, {
    reportFailure: false,
  });
  const { deleteWorktree } = useThreadActions();
  const threads = useThreadShells();
  const toastData = useMemo(() => ({ threadRef: props.threadRef }), [props.threadRef]);

  const close = () => {
    setStep({ kind: "confirm-remote" });
    setError(null);
    props.onOpenChange(false);
  };
  const notify = (input: {
    readonly type: "success" | "warning";
    readonly title: string;
    readonly description?: string;
  }) => {
    toastManager.add({ ...input, data: toastData });
  };

  const runBranchDeletion = async (deleteLocalBranch = false) => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await deleteBranch({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        reference: props.reference,
        ...(deleteLocalBranch ? { deleteLocalBranch: true } : {}),
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setError(changeRequestFailureMessage(result, "The branch action failed."));
      return;
    }
    const next = reduceDeleteBranchDialogStep(result.value.local);
    if (next.kind === "complete") {
      const local = result.value.local;
      const description =
        local._tag === "branch"
          ? local.removal === "removed"
            ? `Local branch ${local.refName} was also deleted.`
            : local.removal === "failed"
              ? `Remote branch was deleted, but local branch ${local.refName} could not be removed.`
              : undefined
          : undefined;
      notify({
        type: local._tag === "branch" && local.removal === "failed" ? "warning" : "success",
        title:
          result.value.remote === "deleted"
            ? `Deleted remote branch ${result.value.branch}`
            : `Remote branch ${result.value.branch} was already deleted`,
        ...(description === undefined ? {} : { description }),
      });
      close();
      return;
    }
    setStep(next);
  };

  const handOffWorktreeDeletion = (input: {
    readonly refName: string;
    readonly worktreePath: string;
  }) => {
    close();
    void deleteWorktree({
      environmentId: props.environmentId,
      projectCwd: props.cwd,
      worktreePath: input.worktreePath,
      label: input.refName,
      threads,
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && pending) return;
        if (!open) close();
      }}
    >
      <DialogPopup className="max-w-md">
        {step.kind === "confirm-remote" ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete remote branch “{props.headRef}”?</DialogTitle>
              <DialogDescription>This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {error ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void runBranchDeletion()}
              >
                {pending ? "Deleting…" : "Delete branch"}
              </Button>
            </DialogFooter>
          </>
        ) : step.kind === "confirm-local" ? (
          <>
            <DialogHeader>
              <DialogTitle>Also delete local branch “{step.refName}”?</DialogTitle>
              <DialogDescription>
                The remote branch is deleted. You can also remove its plain local branch.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  notify({ type: "success", title: `Deleted remote branch ${props.headRef}` });
                  close();
                }}
              >
                Keep local branch
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void runBranchDeletion(true)}
              >
                {pending ? "Deleting…" : "Delete local branch"}
              </Button>
            </DialogFooter>
          </>
        ) : step.kind === "worktree" ? (
          <>
            <DialogHeader>
              <DialogTitle>Branch is checked out in a worktree</DialogTitle>
              <DialogDescription>
                The branch “{step.refName}” is checked out at “{step.worktreePath}”.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <p className="text-sm text-destructive">
                Deleting the worktree archives its aqqua conversations and permanently deletes the
                worktree. In the next step, you can choose whether to also delete its local branch.
                This cannot be undone.
              </p>
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={close}>
                Keep worktree
              </Button>
              <Button variant="destructive" onClick={() => handOffWorktreeDeletion(step)}>
                Delete worktree…
              </Button>
            </DialogFooter>
          </>
        ) : step.kind === "checked-out" ? (
          <>
            <DialogHeader>
              <DialogTitle>Local branch is checked out here</DialogTitle>
              <DialogDescription>
                Branch “{step.refName}” is checked out in this checkout. Switch branches to delete
                it locally.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
