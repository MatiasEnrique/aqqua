import type { OrchestrationBoard } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, LayoutGridIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { usePrimarySettings } from "../../hooks/useSettings";
import { buildAgentProfileRows } from "../settings/AgentProfilesSettings.logic";
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
import { Textarea } from "../ui/textarea";
import {
  type BoardDraft,
  type BoardStepDraft,
  CONTINUATION_OPTIONS,
  createStepDraft,
  draftFromBoard,
  isBoardDraftSubmittable,
  makeBoardStepId,
  moveStep,
  removeStep,
  toBoardSteps,
  updateStep,
  validateBoardDraft,
} from "./BoardEditorDialog.logic";

const EMPTY_DRAFT: BoardDraft = { name: "", steps: [] };

export interface BoardEditorSubmit {
  readonly name: string;
  readonly steps: ReturnType<typeof toBoardSteps>;
}

export function BoardEditorDialog({
  open,
  board,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  /** `null` creates a board; a board edits it in place. */
  readonly board: OrchestrationBoard | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: BoardEditorSubmit) => Promise<void> | void;
}) {
  const agentProfiles = usePrimarySettings((settings) => settings.agentProfiles);
  const profileNames = useMemo(
    () => buildAgentProfileRows(agentProfiles).map((row) => row.name),
    [agentProfiles],
  );
  const defaultProfileName = profileNames[0] ?? "implementer";

  const [draft, setDraft] = useState<BoardDraft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Reopening always shows the persisted board, never the last edit session.
  useEffect(() => {
    if (!open) return;
    setDraft(
      board === null
        ? { name: "", steps: [createStepDraft(makeBoardStepId(randomUUID()), defaultProfileName)] }
        : draftFromBoard(board),
    );
    setHasAttemptedSubmit(false);
    setIsSaving(false);
  }, [open, board, defaultProfileName]);

  const errors = validateBoardDraft(draft);
  const canSubmit = !isSaving && isBoardDraftSubmittable(errors);

  const patchStep = (index: number, patch: Partial<Omit<BoardStepDraft, "id">>) =>
    setDraft((current) => ({ ...current, steps: updateStep(current.steps, index, patch) }));

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!canSubmit) return;
    setIsSaving(true);
    try {
      await onSubmit({ name: draft.name.trim(), steps: toBoardSteps(draft) });
    } finally {
      setIsSaving(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGridIcon className="size-4" />
            {board === null ? "New board" : "Edit board"}
          </DialogTitle>
          <DialogDescription>
            Steps run left to right, one fresh thread each. Cards released before a change keep the
            board they were released with.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-4 overflow-y-auto">
          <label className="grid gap-1.5">
            <span className="font-medium text-foreground text-xs">Board name</span>
            <Input
              size="sm"
              placeholder="Delivery"
              value={draft.name}
              aria-invalid={hasAttemptedSubmit && errors.name !== null}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            {hasAttemptedSubmit && errors.name ? (
              <span className="text-[11px] text-destructive">{errors.name}</span>
            ) : null}
          </label>

          <div className="space-y-3">
            {draft.steps.map((step, index) => (
              <StepEditor
                key={step.id}
                index={index}
                step={step}
                stepCount={draft.steps.length}
                profileNames={profileNames}
                error={hasAttemptedSubmit ? (errors.steps[step.id] ?? null) : null}
                onPatch={(patch) => patchStep(index, patch)}
                onMove={(direction) =>
                  setDraft((current) => ({
                    ...current,
                    steps: moveStep(current.steps, index, direction),
                  }))
                }
                onRemove={() =>
                  setDraft((current) => ({ ...current, steps: removeStep(current.steps, index) }))
                }
              />
            ))}
          </div>

          {hasAttemptedSubmit && errors.general ? (
            <span className="block text-[11px] text-destructive">{errors.general}</span>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                steps: [
                  ...current.steps,
                  createStepDraft(makeBoardStepId(randomUUID()), defaultProfileName),
                ],
              }))
            }
          >
            <PlusIcon className="size-3.5" />
            Add step
          </Button>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {isSaving ? "Saving..." : board === null ? "Create board" : "Save board"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function StepEditor({
  index,
  step,
  stepCount,
  profileNames,
  error,
  onPatch,
  onMove,
  onRemove,
}: {
  readonly index: number;
  readonly step: BoardStepDraft;
  readonly stepCount: number;
  readonly profileNames: ReadonlyArray<string>;
  readonly error: string | null;
  readonly onPatch: (patch: Partial<Omit<BoardStepDraft, "id">>) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}) {
  const continuation =
    CONTINUATION_OPTIONS.find((option) => option.value === step.continuation) ??
    CONTINUATION_OPTIONS[0]!;

  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3 dark:border-transparent dark:bg-white/[0.035]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span>
        <Input
          size="sm"
          className="flex-1"
          placeholder="Step name"
          aria-label={`Step ${index + 1} name`}
          value={step.name}
          aria-invalid={error !== null}
          onChange={(event) => onPatch({ name: event.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move step ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove("up")}
        >
          <ArrowUpIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move step ${index + 1} down`}
          disabled={index === stepCount - 1}
          onClick={() => onMove("down")}
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove step ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>

      <label className="grid gap-1.5">
        <span className="font-medium text-foreground text-xs">Prompt template</span>
        <Textarea
          size="sm"
          className="font-mono"
          placeholder={"Implement ${issue_id}. Write your summary to ${artifact}."}
          value={step.promptTemplate}
          onChange={(event) => onPatch({ promptTemplate: event.target.value })}
        />
        <span className="text-[11px] text-muted-foreground">
          {
            "${placeholders} become card fields. ${artifact} and ${artifact:step-name} resolve to earlier artifact paths."
          }
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="font-medium text-foreground text-xs">Agent profile</span>
          <Select
            value={step.profileName}
            onValueChange={(value) =>
              onPatch({ profileName: typeof value === "string" ? value : step.profileName })
            }
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Agent profile">
              <SelectValue>{step.profileName || "Select a profile"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {profileNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>

        <label className="grid gap-1.5">
          <span className="font-medium text-foreground text-xs">Continuation</span>
          <Select
            value={step.continuation}
            onValueChange={(value) => {
              if (value === "auto" || value === "manual") onPatch({ continuation: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Continuation mode">
              <SelectValue>{continuation.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {CONTINUATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <span className="text-[11px] text-muted-foreground">{continuation.description}</span>
        </label>
      </div>

      {error === null ? null : <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
