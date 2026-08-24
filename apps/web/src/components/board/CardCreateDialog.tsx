import type { BoardId, CardParameters, OrchestrationBoard } from "@aqqua/contracts";
import { LayoutGridIcon, SquarePlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  boardParameterNames,
  buildPlaceholderCardTitle,
  missingParameterNames,
  resolveCardCreateBoard,
  toCardParameters,
} from "./CardCreateDialog.logic";

export interface CardCreateSubmit {
  readonly boardId: BoardId;
  readonly title: string;
  readonly parameters: CardParameters;
}

export function CardCreateDialog({
  open,
  boards,
  initialBoardId,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly boards: ReadonlyArray<OrchestrationBoard>;
  readonly initialBoardId: BoardId | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: CardCreateSubmit) => Promise<boolean> | boolean;
}) {
  const [selectedBoardId, setSelectedBoardId] = useState<BoardId | null>(
    () => resolveCardCreateBoard(boards, initialBoardId)?.id ?? null,
  );
  const selectedBoard = useMemo(
    () => resolveCardCreateBoard(boards, selectedBoardId),
    [boards, selectedBoardId],
  );
  const parameterNames = useMemo(() => boardParameterNames(selectedBoard), [selectedBoard]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({});
    setSelectedBoardId(resolveCardCreateBoard(boards, initialBoardId)?.id ?? null);
    setHasAttemptedSubmit(false);
    setIsCreating(false);
  }, [boards, initialBoardId, open]);

  const missing = missingParameterNames(parameterNames, values);
  const canSubmit = !isCreating && missing.length === 0;

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit || selectedBoard === null) return;
    setIsCreating(true);
    let succeeded = false;
    try {
      succeeded = await onSubmit({
        boardId: selectedBoard.id,
        title: buildPlaceholderCardTitle(parameterNames, values),
        parameters: toCardParameters(parameterNames, values),
      });
    } finally {
      setIsCreating(false);
    }
    if (succeeded) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isCreating) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SquarePlusIcon className="size-4" />
            New card
          </DialogTitle>
          <DialogDescription>
            The card lands in the selected flow's To-Do. Nothing runs and no worktree is created
            until you start it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-4 overflow-y-auto">
          {boards.length > 1 ? (
            <label className="grid gap-1.5">
              <span className="font-medium text-foreground text-xs">Flow</span>
              <Select value={selectedBoard?.id ?? null} onValueChange={setSelectedBoardId}>
                <SelectTrigger size="sm" className="w-full" aria-label="Flow">
                  <LayoutGridIcon className="size-3.5" />
                  <SelectValue>{selectedBoard?.name ?? "Select a flow"}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {boards.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          ) : null}
          {parameterNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This flow's step templates have no <code>{"${placeholders}"}</code>, so the card needs
              no inputs.
            </p>
          ) : (
            parameterNames.map((name) => {
              const isMissing = hasAttemptedSubmit && missing.includes(name);
              return (
                <label key={name} className="grid gap-1.5">
                  <span className="font-mono font-medium text-foreground text-xs">{name}</span>
                  <Input
                    size="sm"
                    value={values[name] ?? ""}
                    aria-label={name}
                    aria-invalid={isMissing}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [name]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void handleSubmit();
                    }}
                  />
                  {isMissing ? (
                    <span className="text-[11px] text-destructive">
                      Every template placeholder needs a value.
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isCreating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isCreating}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {isCreating ? "Creating..." : "Create card"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
