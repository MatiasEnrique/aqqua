import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AgentProfileMap,
  BoardStepId,
  EnvironmentId,
  OrchestrationBoard,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@aqqua/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { ProviderWorkspaceSkillsState } from "../../lib/providerSkillsState";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "../chat/providerIconUtils";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import {
  type BoardStepDraft,
  CONTINUATION_OPTIONS,
  insertSkillToken,
  reasoningDescriptorForModel,
  resolveStepAgentDisplay,
  segmentTemplate,
  type StepAgentDisplay,
  stepAgentSelection,
  type TemplatePlaceholderOption,
} from "./BoardEditorDialog.logic";
import { PromptEditor, SkillsMenu } from "./BoardPromptEditor";
import { type BoardEditorSubmit, useBoardEditorController } from "./useBoardEditorController";

export type { BoardEditorSubmit } from "./useBoardEditorController";

/** Deterministic accent for an agent chip, so a selector keeps its color everywhere. */
const PROFILE_DOT_CLASSES = [
  "bg-violet-500",
  "bg-sky-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-indigo-500",
] as const;

function profileDotClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PROFILE_DOT_CLASSES[Math.abs(hash) % PROFILE_DOT_CLASSES.length] ?? "bg-violet-500";
}

/** Chip label for a step's agent: the display model's name, else the raw selector. */
function stepAgentLabel(step: BoardStepDraft, display: StepAgentDisplay | null): string {
  if (display !== null) {
    const model = display.entry.models.find((candidate) => candidate.slug === display.model);
    return model?.shortName ?? model?.name ?? display.model;
  }
  return (
    step.profileName ||
    (step.agent === undefined ? "agent" : `${step.agent.instanceId}/${step.agent.model}`)
  );
}

/** Sentinel radio value for "no explicit reasoning level" (the model's default). */
const REASONING_DEFAULT_VALUE = "__default__";

export function BoardEditorDialog({
  open,
  board,
  environmentId,
  projectTitle,
  workspaceRoot,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  /** `null` creates a board; a board edits it in place. */
  readonly board: OrchestrationBoard | null;
  readonly environmentId: EnvironmentId;
  readonly projectTitle?: string;
  /** Project root the step threads run in; scopes native-skill discovery. */
  readonly workspaceRoot?: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: BoardEditorSubmit) => Promise<boolean> | boolean;
}) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (input: BoardEditorSubmit) => {
    setIsSaving(true);
    let succeeded = false;
    try {
      succeeded = await onSubmit(input);
    } finally {
      setIsSaving(false);
    }
    if (succeeded) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) onOpenChange(nextOpen);
      }}
    >
      <DialogPopup showCloseButton={false} className="h-[min(50rem,85dvh)] max-w-3xl">
        {/* The popup unmounts its children after the close transition, so each
            open mounts a fresh form seeded from the persisted board. */}
        <BoardEditorForm
          board={board}
          environmentId={environmentId}
          projectTitle={projectTitle}
          workspaceRoot={workspaceRoot}
          isSaving={isSaving}
          onSave={handleSave}
        />
      </DialogPopup>
    </Dialog>
  );
}

function BoardEditorForm({
  board,
  environmentId,
  projectTitle,
  workspaceRoot,
  isSaving,
  onSave,
}: {
  readonly board: OrchestrationBoard | null;
  readonly environmentId: EnvironmentId;
  readonly projectTitle?: string | undefined;
  readonly workspaceRoot?: string | null | undefined;
  readonly isSaving: boolean;
  readonly onSave: (input: BoardEditorSubmit) => Promise<void>;
}) {
  const controller = useBoardEditorController({
    board,
    environmentId,
    workspaceRoot,
    isSaving,
    onSave,
  });
  const {
    addStep,
    agentProfiles,
    boardNameRef,
    cardFieldCount,
    draft,
    errors,
    focusStep,
    focusedPlaceholderOptions,
    focusedSkillsProvider,
    focusedStepId,
    focusedStepSkills,
    handleKeyDown,
    handleSubmit,
    hasAttemptedSubmit,
    isMac,
    modelOptionsByInstance,
    patchStep,
    providerEntries,
    registerNameRef,
    removeStepById,
    reorderSteps,
    setBoardName,
  } = controller;

  return (
    // Keyboard shortcuts listen here, on the popup's content root, so they
    // catch events bubbling from any of the form's inputs.
    <section
      aria-label="Flow editor"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5">
            <LayoutGridIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground/80 text-xs">
              {projectTitle ?? "Project"}
            </span>
          </span>
          <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          <DialogTitle className="shrink-0 font-medium font-sans text-muted-foreground text-xs leading-none">
            {board === null ? "New flow" : "Edit flow"}
          </DialogTitle>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
          esc to close
        </span>
      </div>

      <div className="px-4 pt-2 pb-3">
        <input
          ref={boardNameRef}
          aria-label="Flow name"
          aria-invalid={hasAttemptedSubmit && errors.name !== null}
          placeholder="Flow name"
          value={draft.name}
          className="w-full bg-transparent font-medium text-[21px] text-foreground tracking-[-0.015em] outline-none placeholder:text-muted-foreground/50"
          onChange={(event) => setBoardName(event.target.value)}
        />
        {hasAttemptedSubmit && errors.name !== null ? (
          <p className="mt-1 text-[13px] text-destructive-foreground">{errors.name}</p>
        ) : (
          <DialogDescription className="mt-1 text-[13px]">
            Describe the pipeline. Each step runs in its own thread, in order.
          </DialogDescription>
        )}
      </div>

      <StepListSection
        steps={draft.steps}
        focusedStepId={focusedStepId}
        stepErrors={hasAttemptedSubmit ? errors.steps : null}
        agentProfiles={agentProfiles}
        providerEntries={providerEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        skills={focusedSkillsProvider === null ? null : focusedStepSkills}
        skillsDriver={focusedSkillsProvider?.driver ?? null}
        placeholderOptions={focusedPlaceholderOptions}
        isMac={isMac}
        registerNameRef={registerNameRef}
        onReorder={reorderSteps}
        onFocusStep={focusStep}
        onPatchStep={patchStep}
        onRemoveStep={removeStepById}
        onAddStep={addStep}
      />

      <div className="flex items-center justify-between gap-3 rounded-b-[calc(var(--radius-2xl)-1px)] border-t bg-muted/40 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {cardFieldCount > 0 ? (
            <span className="flex h-[26px] shrink-0 items-center rounded-md border border-border px-2 font-medium text-muted-foreground text-xs">
              {cardFieldCount} card field{cardFieldCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {hasAttemptedSubmit && errors.general !== null ? (
            <span className="truncate text-destructive-foreground text-xs">{errors.general}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {isMac ? "⌘⇧⏎" : "Ctrl+Shift+⏎"} to {board === null ? "create" : "save"}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={isSaving}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {isSaving ? "Saving..." : board === null ? "Create flow" : "Save flow"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function StepListSection({
  steps,
  focusedStepId,
  stepErrors,
  agentProfiles,
  providerEntries,
  modelOptionsByInstance,
  skills,
  skillsDriver,
  placeholderOptions,
  isMac,
  registerNameRef,
  onReorder,
  onFocusStep,
  onPatchStep,
  onRemoveStep,
  onAddStep,
}: {
  readonly steps: ReadonlyArray<BoardStepDraft>;
  readonly focusedStepId: BoardStepId | null;
  /** `null` until a submit attempt surfaces validation. */
  readonly stepErrors: Readonly<Record<string, string>> | null;
  readonly agentProfiles: AgentProfileMap | undefined;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly skills: ProviderWorkspaceSkillsState | null;
  readonly skillsDriver: ProviderDriverKind | null;
  readonly placeholderOptions: ReadonlyArray<TemplatePlaceholderOption>;
  readonly isMac: boolean;
  readonly registerNameRef: (id: BoardStepId, node: HTMLInputElement | null) => void;
  readonly onReorder: (activeId: string, overId: string) => void;
  readonly onFocusStep: (id: BoardStepId) => void;
  readonly onPatchStep: (index: number, patch: Partial<Omit<BoardStepDraft, "id">>) => void;
  readonly onRemoveStep: (id: BoardStepId) => void;
  readonly onAddStep: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // A completed drag still fires the row's click; swallow that one expand.
  const dragActiveRef = useRef(false);
  const settleDrag = () => {
    window.setTimeout(() => {
      dragActiveRef.current = false;
    }, 0);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    settleDrag();
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      <div className="flex items-center justify-between px-2.5 pt-1 pb-2">
        <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
          Steps
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {isMac ? "⌥" : "Alt+"}↑↓ reorder
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragStart={() => {
          dragActiveRef.current = true;
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={settleDrag}
      >
        <SortableContext
          items={steps.map((step) => step.id)}
          strategy={verticalListSortingStrategy}
        >
          {steps.map((step, index) => {
            const expanded = step.id === focusedStepId;
            const previousExpanded = index > 0 && steps[index - 1]?.id === focusedStepId;
            const error = stepErrors === null ? null : (stepErrors[step.id] ?? null);
            return (
              <Fragment key={step.id}>
                {index > 0 && !expanded && !previousExpanded ? (
                  <div aria-hidden className="mx-2.5 h-px bg-border/60" />
                ) : null}
                <SortableStepRow id={step.id}>
                  {(drag) =>
                    expanded ? (
                      <ExpandedStep
                        index={index}
                        step={step}
                        drag={drag}
                        agentProfiles={agentProfiles}
                        providerEntries={providerEntries}
                        modelOptionsByInstance={modelOptionsByInstance}
                        skills={skills}
                        skillsDriver={skillsDriver}
                        placeholderOptions={placeholderOptions}
                        error={error}
                        nameRef={(node) => registerNameRef(step.id, node)}
                        onPatch={(patch) => onPatchStep(index, patch)}
                        onRemove={() => onRemoveStep(step.id)}
                      />
                    ) : (
                      <CollapsedStep
                        index={index}
                        step={step}
                        drag={drag}
                        agentProfiles={agentProfiles}
                        providerEntries={providerEntries}
                        hasError={error !== null}
                        onExpand={() => {
                          if (dragActiveRef.current) return;
                          onFocusStep(step.id);
                        }}
                        onRemove={() => onRemoveStep(step.id)}
                      />
                    )
                  }
                </SortableStepRow>
              </Fragment>
            );
          })}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onAddStep}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-border border-dashed">
          <PlusIcon aria-hidden className="size-2.5 text-muted-foreground" />
        </span>
        <span className="font-medium text-[13px] text-muted-foreground">Add step</span>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {isMac ? "⌘⏎" : "Ctrl+⏎"}
        </span>
      </button>
    </div>
  );
}

function StepNumber({
  index,
  variant,
}: {
  readonly index: number;
  readonly variant: "default" | "active" | "error";
}) {
  return (
    <span
      className={cn(
        "mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full font-mono text-[9px]",
        variant === "active"
          ? "bg-primary font-semibold text-primary-foreground"
          : variant === "error"
            ? "border border-destructive/60 font-medium text-destructive-foreground"
            : "border border-border font-medium text-muted-foreground",
      )}
    >
      {index + 1}
    </span>
  );
}

type StepDragHandle = {
  readonly attributes: ReturnType<typeof useSortable>["attributes"];
  readonly listeners: ReturnType<typeof useSortable>["listeners"];
  readonly setActivatorNodeRef: (node: HTMLElement | null) => void;
};

function SortableStepRow({
  id,
  children,
}: {
  readonly id: string;
  readonly children: (drag: StepDragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-20 opacity-80")}
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </div>
  );
}

function CollapsedStep({
  index,
  step,
  drag,
  agentProfiles,
  providerEntries,
  hasError,
  onExpand,
  onRemove,
}: {
  readonly index: number;
  readonly step: BoardStepDraft;
  readonly drag: StepDragHandle;
  readonly agentProfiles: AgentProfileMap | undefined;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly hasError: boolean;
  readonly onExpand: () => void;
  readonly onRemove: () => void;
}) {
  const display = resolveStepAgentDisplay(step, agentProfiles, providerEntries);
  // Newlines collapse so the one-line preview truncates instead of clipping.
  const previewSegments = useMemo(
    () => segmentTemplate(step.promptTemplate.replace(/\s+/g, " ").trim()),
    [step.promptTemplate],
  );

  return (
    <div className="group/step relative flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-muted/40">
      {/* Positioned overlay paints above the static row content, so it takes
          the whole row's clicks and drags; the trash opts back in below. */}
      <button
        type="button"
        ref={drag.setActivatorNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        aria-label={`Edit step ${index + 1}: ${step.name.trim() === "" ? "Untitled step" : step.name}`}
        className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onExpand}
      />
      <StepNumber index={index} variant={hasError ? "error" : "default"} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            "truncate font-medium text-sm leading-[18px]",
            step.name.trim() === "" ? "text-muted-foreground/60" : "text-foreground/90",
          )}
        >
          {step.name.trim() === "" ? "Untitled step" : step.name}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground leading-[17px]">
          {previewSegments.length === 0 ? (
            <span className="text-muted-foreground/50">No prompt yet</span>
          ) : (
            previewSegments.map((segment, segmentIndex) =>
              segment.kind === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                <span key={segmentIndex}>{segment.text}</span>
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  key={segmentIndex}
                  className={cn(
                    "rounded-sm px-1",
                    segment.kind === "artifact"
                      ? "bg-success/12 text-success-foreground"
                      : segment.kind === "skill"
                        ? "bg-violet-500/12 text-violet-600 dark:text-violet-400"
                        : "bg-primary/12 text-primary",
                  )}
                >
                  {segment.kind === "skill" ? segment.text : segment.body}
                </span>
              ),
            )
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <StepChip
          dotClass={profileDotClass(display?.entry.instanceId ?? stepAgentLabel(step, display))}
          label={stepAgentLabel(step, display)}
        />
        <StepChip
          dotClass={step.continuation === "auto" ? "bg-success" : "bg-warning"}
          label={step.continuation === "auto" ? "auto-continue" : "waits"}
        />
        <button
          type="button"
          aria-label={`Remove step ${index + 1}`}
          className="relative z-10 flex size-[22px] items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] group-hover/step:opacity-100 pointer-coarse:opacity-100 hover:bg-destructive/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground hover:[&_svg]:text-destructive-foreground"
          onClick={onRemove}
        >
          <Trash2Icon aria-hidden className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

function StepChip({ dotClass, label }: { readonly dotClass: string; readonly label: string }) {
  return (
    <span className="flex h-[22px] items-center gap-1.5 rounded-sm border border-border px-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
      <span className="max-w-28 truncate font-medium text-[11px] text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

function ChipMenu({
  dotClass,
  label,
  ariaLabel,
  children,
}: {
  readonly dotClass: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={ariaLabel}
        className="flex h-[22px] items-center gap-1.5 rounded-sm border border-border bg-background/40 px-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
        <span className="max-w-28 truncate font-medium text-[11px] text-foreground/85">
          {label}
        </span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}

function ExpandedStep({
  index,
  step,
  drag,
  agentProfiles,
  providerEntries,
  modelOptionsByInstance,
  skills,
  skillsDriver,
  placeholderOptions,
  error,
  nameRef,
  onPatch,
  onRemove,
}: {
  readonly index: number;
  readonly step: BoardStepDraft;
  readonly drag: StepDragHandle;
  readonly agentProfiles: AgentProfileMap | undefined;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  /** `null` when the step's agent resolves to no configured provider. */
  readonly skills: ProviderWorkspaceSkillsState | null;
  readonly skillsDriver: ProviderDriverKind | null;
  readonly placeholderOptions: ReadonlyArray<TemplatePlaceholderOption>;
  readonly error: string | null;
  readonly nameRef: (node: HTMLInputElement | null) => void;
  readonly onPatch: (patch: Partial<Omit<BoardStepDraft, "id">>) => void;
  readonly onRemove: () => void;
}) {
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const display = resolveStepAgentDisplay(step, agentProfiles, providerEntries);
  // An unresolvable selector must still be replaceable: anchor the picker to
  // the first enabled instance so the user can choose a new model, and keep
  // the unavailable chip only when this machine has no usable provider at all.
  const fallbackEntry = providerEntries.find((candidate) => candidate.enabled);
  const pickerDisplay =
    display ??
    (fallbackEntry === undefined
      ? null
      : {
          entry: fallbackEntry,
          model:
            fallbackEntry.models.find((candidate) => candidate.isDefault)?.slug ??
            fallbackEntry.models[0]?.slug ??
            "",
          reasoning: null,
        });
  const reasoningDescriptor =
    pickerDisplay === null
      ? undefined
      : reasoningDescriptorForModel(
          pickerDisplay.entry.models.find((candidate) => candidate.slug === pickerDisplay.model),
        );
  const reasoningLabel =
    reasoningDescriptor === undefined
      ? null
      : (reasoningDescriptor.options.find((choice) => choice.id === pickerDisplay?.reasoning)
          ?.label ?? reasoningDescriptor.label);

  const insertSkill = (skillName: string) => {
    const textarea = promptRef.current;
    const next = insertSkillToken(
      step.promptTemplate,
      textarea?.selectionStart ?? step.promptTemplate.length,
      skillName,
    );
    onPatch({ promptTemplate: next.text });
    requestAnimationFrame(() => {
      const node = promptRef.current;
      if (node === null) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="starting:translate-y-1 starting:opacity-0 flex items-start gap-2.5 rounded-lg bg-muted/50 px-2.5 py-3 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none">
      <button
        type="button"
        ref={drag.setActivatorNodeRef}
        {...drag.attributes}
        {...drag.listeners}
        aria-label={`Drag step ${index + 1} to reorder`}
        className="shrink-0 cursor-grab touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <StepNumber index={index} variant="active" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2.5">
          <input
            ref={nameRef}
            aria-label={`Step ${index + 1} name`}
            aria-invalid={error !== null}
            placeholder="Step name"
            value={step.name}
            className="min-w-0 flex-1 bg-transparent font-semibold text-foreground text-sm outline-none placeholder:text-muted-foreground/50"
            onChange={(event) => onPatch({ name: event.target.value })}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {pickerDisplay === null ? (
              <StepChip
                dotClass="bg-destructive/70"
                label={`${stepAgentLabel(step, display)} (unavailable)`}
              />
            ) : (
              <>
                <ProviderModelPicker
                  activeInstanceId={pickerDisplay.entry.instanceId}
                  model={pickerDisplay.model}
                  lockedProvider={null}
                  instanceEntries={providerEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  compact
                  triggerVariant="outline"
                  triggerClassName="h-[22px] min-w-0 shrink rounded-sm text-[11px] text-foreground/90 hover:text-foreground"
                  triggerAriaLabel={`Step ${index + 1} model`}
                  onInstanceModelChange={(instanceId, model) => {
                    const entry = providerEntries.find(
                      (candidate) => candidate.instanceId === instanceId,
                    );
                    if (entry === undefined) return;
                    onPatch({
                      agent: stepAgentSelection(entry, model, pickerDisplay.reasoning),
                      profileName: "",
                    });
                  }}
                />
                {reasoningDescriptor === undefined ? null : (
                  <ChipMenu
                    ariaLabel={`Step ${index + 1} reasoning`}
                    dotClass={
                      pickerDisplay.reasoning === null ? "bg-muted-foreground/50" : "bg-amber-500"
                    }
                    label={reasoningLabel ?? "Reasoning"}
                  >
                    <MenuRadioGroup
                      value={pickerDisplay.reasoning ?? REASONING_DEFAULT_VALUE}
                      onValueChange={(value) => {
                        if (typeof value !== "string") return;
                        onPatch({
                          agent: stepAgentSelection(
                            pickerDisplay.entry,
                            pickerDisplay.model,
                            value === REASONING_DEFAULT_VALUE ? null : value,
                          ),
                          profileName: "",
                        });
                      }}
                    >
                      <MenuRadioItem value={REASONING_DEFAULT_VALUE}>Model default</MenuRadioItem>
                      {reasoningDescriptor.options.map((choice) => (
                        <MenuRadioItem key={choice.id} value={choice.id}>
                          {choice.label}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </ChipMenu>
                )}
              </>
            )}
            <ChipMenu
              ariaLabel={`Step ${index + 1} continuation`}
              dotClass={step.continuation === "auto" ? "bg-success" : "bg-warning"}
              label={step.continuation === "auto" ? "auto-continue" : "waits"}
            >
              <MenuRadioGroup
                value={step.continuation}
                onValueChange={(value) => {
                  if (value === "auto" || value === "manual") onPatch({ continuation: value });
                }}
              >
                {CONTINUATION_OPTIONS.map((option) => (
                  <MenuRadioItem key={option.value} value={option.value} className="items-start">
                    <span className="flex max-w-64 flex-col gap-0.5 py-0.5">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            option.value === "auto" ? "bg-success" : "bg-warning",
                          )}
                        />
                        {option.value === "auto" ? "auto-continue" : "waits"}
                      </span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </ChipMenu>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              className="flex size-[22px] items-center justify-center rounded-sm outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground hover:[&_svg]:text-destructive-foreground"
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>

        {error !== null ? <p className="text-[11px] text-destructive-foreground">{error}</p> : null}

        <PromptEditor
          ariaLabel={`Step ${index + 1} prompt template`}
          textareaRef={promptRef}
          value={step.promptTemplate}
          skills={skills}
          skillsDriver={skillsDriver}
          placeholderOptions={placeholderOptions}
          onChange={(value) => onPatch({ promptTemplate: value })}
        />

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="rounded-sm bg-muted px-1 py-0.5 font-medium font-mono text-[10px] text-muted-foreground">
            {"${"}
          </span>
          <span className="text-[11px] text-muted-foreground">
            insert a card field or an artifact from an earlier step
          </span>
          {skills === null ? null : (
            <>
              <span aria-hidden className="mx-0.5 h-3 w-px shrink-0 bg-border" />
              <SkillsMenu skills={skills} onInsert={insertSkill} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
