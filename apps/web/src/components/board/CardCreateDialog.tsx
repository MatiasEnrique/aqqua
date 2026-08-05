import type { CardParameters, OrchestrationBoard } from "@aqqua/contracts";
import { SquarePlusIcon } from "lucide-react";
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
import {
  boardParameterNames,
  buildPlaceholderCardTitle,
  missingParameterNames,
  toCardParameters,
} from "./CardCreateDialog.logic";

export interface CardCreateSubmit {
  readonly title: string;
  readonly parameters: CardParameters;
}

export function CardCreateDialog({
  open,
  board,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly board: OrchestrationBoard | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: CardCreateSubmit) => Promise<boolean> | boolean;
}) {
  const parameterNames = useMemo(() => boardParameterNames(board), [board]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues({});
    setHasAttemptedSubmit(false);
    setIsCreating(false);
  }, [open]);

  const missing = missingParameterNames(parameterNames, values);
  const canSubmit = !isCreating && missing.length === 0;

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit) return;
    setIsCreating(true);
    let succeeded = false;
    try {
      succeeded = await onSubmit({
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
            The card lands in To-Do. Nothing runs and no worktree is created until you start it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-4 overflow-y-auto">
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
