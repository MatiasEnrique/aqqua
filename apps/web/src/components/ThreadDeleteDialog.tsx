import type { VcsInspectWorktreeRemovalResult } from "@aqqua/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  completeThreadDeleteDialogClose,
  type ThreadDeleteDialogRequest,
  readThreadDeleteDialogState,
  respondToThreadDeleteConfirmation,
  subscribeThreadDeleteDialog,
} from "../threadDeleteDialog";
import { vcsEnvironment } from "../state/vcs";
import { useAtomCommand } from "../state/use-atom-command";
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

type InspectionMap = Readonly<Record<string, VcsInspectWorktreeRemovalResult>>;

const unknownInspection: VcsInspectWorktreeRemovalResult = {
  availability: "available",
  refName: null,
  headCommit: null,
  baseRef: null,
  mergeStatus: "unknown",
  workingTreeStatus: "unknown",
};

export function shouldDefaultDeleteWorktrees(
  inspections: ReadonlyArray<VcsInspectWorktreeRemovalResult>,
): boolean {
  return (
    inspections.length > 0 &&
    inspections.every(
      (inspection) =>
        inspection.availability === "available" &&
        inspection.mergeStatus === "merged" &&
        inspection.workingTreeStatus === "clean",
    )
  );
}

export function resolveCheckedAfterInspection(
  current: boolean,
  userTouched: boolean,
  inspections: ReadonlyArray<VcsInspectWorktreeRemovalResult>,
): boolean {
  return userTouched ? current : shouldDefaultDeleteWorktrees(inspections);
}

export function isThreadDeleteInspectionPending(input: {
  readonly requestId: number;
  readonly inspectedRequestId: number;
  readonly candidateCount: number;
  readonly pending: boolean;
}): boolean {
  return (
    input.candidateCount > 0 && (input.pending || input.inspectedRequestId !== input.requestId)
  );
}

export function canSelectAllWorktreeCandidates(
  candidateKeys: ReadonlyArray<string>,
  inspections: InspectionMap,
): boolean {
  return (
    candidateKeys.length > 0 &&
    candidateKeys.every((key) => inspections[key]?.availability === "available")
  );
}

function availabilityLabel(inspection: VcsInspectWorktreeRemovalResult): string {
  if (inspection.availability === "missing") return "Missing";
  if (inspection.availability === "not_worktree") return "Not a worktree";
  return inspection.refName ?? "Detached HEAD";
}

function mergeLabel(inspection: VcsInspectWorktreeRemovalResult): string {
  if (inspection.mergeStatus === "merged") return "Merged";
  if (inspection.mergeStatus === "unmerged") return "Not merged";
  return "Merge unknown";
}

function changesLabel(inspection: VcsInspectWorktreeRemovalResult): string {
  if (inspection.workingTreeStatus === "clean") return "Clean";
  if (inspection.workingTreeStatus === "dirty") return "Has changes";
  return "Changes unknown";
}

export function ThreadDeleteDialogView(props: {
  readonly request: ThreadDeleteDialogRequest;
  readonly inspections: InspectionMap;
  readonly checked: boolean;
  readonly pending: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onCancel: () => void;
  readonly onDelete: () => void;
}) {
  const candidateCount = props.request.candidates.length;
  const hasWorktreeSection = candidateCount > 0 || props.request.hasUnverifiableWorktrees;
  const allCandidatesSelectable = canSelectAllWorktreeCandidates(
    props.request.candidates.map((candidate) => candidate.key),
    props.inspections,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {props.request.threadCount === 1
            ? `Delete “${props.request.title}”?`
            : `Delete ${props.request.threadCount} threads?`}
        </DialogTitle>
        <DialogDescription>
          Conversation history will be permanently deleted. This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        {hasWorktreeSection ? (
          <section aria-label="Worktree cleanup" className="space-y-3">
            {props.request.hasUnverifiableWorktrees ? (
              <p className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm text-warning-foreground">
                Worktree cleanup is disabled for some threads because other thread references could
                not be verified.
              </p>
            ) : null}
            {candidateCount > 0 ? (
              <>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-border/70 px-3 py-2">
                  <Checkbox
                    aria-label={
                      candidateCount === 1
                        ? "Also delete the worktree"
                        : `Also delete ${candidateCount} orphaned worktrees`
                    }
                    checked={props.checked}
                    disabled={
                      props.pending ||
                      !allCandidatesSelectable ||
                      props.request.hasUnverifiableWorktrees
                    }
                    onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
                  />
                  <span className="text-sm font-medium">
                    {candidateCount === 1
                      ? "Also delete the worktree"
                      : `Also delete ${candidateCount} orphaned worktrees`}
                  </span>
                </label>
                {props.pending ? (
                  <p aria-live="polite" className="text-sm text-muted-foreground">
                    Checking merge and changes…
                  </p>
                ) : null}
                <ul className="space-y-2">
                  {props.request.candidates.map((candidate) => {
                    const inspection = props.inspections[candidate.key];
                    return (
                      <li
                        key={candidate.key}
                        className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm"
                      >
                        <p className="font-medium">{candidate.displayPath}</p>
                        <p className="break-all text-xs text-muted-foreground">{candidate.path}</p>
                        {inspection ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {availabilityLabel(inspection)} · Base:{" "}
                            {inspection.baseRef ?? "Unknown"} · {mergeLabel(inspection)} ·{" "}
                            {changesLabel(inspection)}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm text-destructive">
                  Selected worktrees are removed with force and cannot be recovered.
                </p>
              </>
            ) : null}
          </section>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={props.pending} onClick={props.onDelete}>
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}

export function ThreadDeleteDialog() {
  const state = useSyncExternalStore(
    subscribeThreadDeleteDialog,
    readThreadDeleteDialogState,
    readThreadDeleteDialogState,
  );
  const inspectWorktreeRemoval = useAtomCommand(vcsEnvironment.inspectWorktreeRemoval, {
    reportFailure: false,
  });
  const request = state.status === "idle" ? null : state.request;
  const requestId = state.status === "idle" ? 0 : state.requestId;
  const [inspections, setInspections] = useState<InspectionMap>({});
  const [pending, setPending] = useState(false);
  const [inspectedRequestId, setInspectedRequestId] = useState(0);
  const [checked, setChecked] = useState(false);
  const userTouchedRef = useRef(false);

  useEffect(() => {
    if (state.status !== "confirming") return;
    let active = true;
    userTouchedRef.current = false;
    setChecked(false);
    setInspections({});
    setInspectedRequestId(state.requestId);
    setPending(state.request.candidates.length > 0);

    void Promise.all(
      state.request.candidates.map(async (candidate) => {
        const result = await inspectWorktreeRemoval({
          environmentId: candidate.environmentId,
          input: { cwd: candidate.projectCwd, path: candidate.path },
        });
        return [
          candidate.key,
          result._tag === "Success" ? result.value : unknownInspection,
        ] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      const next = Object.fromEntries(entries);
      setInspections(next);
      setPending(false);
      if (!state.request.hasUnverifiableWorktrees) {
        setChecked((current) =>
          resolveCheckedAfterInspection(current, userTouchedRef.current, Object.values(next)),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [inspectWorktreeRemoval, requestId, state]);

  const inspectionPending =
    state.status === "confirming"
      ? isThreadDeleteInspectionPending({
          requestId,
          inspectedRequestId,
          candidateCount: state.request.candidates.length,
          pending,
        })
      : false;
  const cancel = () => respondToThreadDeleteConfirmation(null);
  const submit = () => {
    if (inspectionPending) return;
    respondToThreadDeleteConfirmation({
      deleteWorktrees: checked,
      selectionSource: checked ? (userTouchedRef.current ? "explicit" : "smart-default") : "none",
      inspections,
    });
  };

  return (
    <Dialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open && state.status === "confirming") cancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeThreadDeleteDialogClose();
      }}
    >
      <DialogPopup className="max-w-xl" showCloseButton>
        {request ? (
          <ThreadDeleteDialogView
            request={request}
            inspections={inspections}
            checked={checked}
            pending={inspectionPending}
            onCancel={cancel}
            onCheckedChange={(next) => {
              userTouchedRef.current = true;
              setChecked(next);
            }}
            onDelete={submit}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
