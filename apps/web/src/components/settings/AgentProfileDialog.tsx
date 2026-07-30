"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  AGENT_PROFILE_RUNTIME_DESCRIPTIONS,
  AGENT_PROFILE_RUNTIME_LABELS,
  AGENT_PROFILE_RUNTIMES,
  type AgentProfileDraft,
  agentProfileFromDraft,
  buildProviderChoices,
  findProviderChoice,
  INHERIT_MODEL_LABEL,
  INHERIT_MODEL_VALUE,
  INTERACTION_MODE_DESCRIPTIONS,
  INTERACTION_MODE_LABELS,
  INTERACTION_MODES,
  isAgentProfileRuntime,
  isInteractionMode,
  isRuntimeMode,
  parseProviderChoiceValue,
  providerChoiceValue,
  pruneAgentProfileOptions,
  RUNTIME_MODE_DESCRIPTIONS,
  RUNTIME_MODE_LABELS,
  RUNTIME_MODES,
  selectOptionDescriptorsForModel,
  setAgentProfileOption,
  validateAgentProfileName,
} from "./AgentProfilesSettings.logic";
import type { AgentProfile } from "@t3tools/contracts";

/** Field wrapper matching the label / control / hint rhythm of the other dialogs. */
function DialogField({
  label,
  hint,
  error,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

interface AgentProfileDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Key being edited, or `null` when adding. Drives rename vs. append. */
  readonly originalName: string | null;
  readonly initialDraft: AgentProfileDraft;
  readonly existingNames: ReadonlyArray<string>;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverLabels: Readonly<Record<string, string | undefined>>;
  readonly onSubmit: (result: {
    readonly originalName: string | null;
    readonly name: string;
    readonly profile: AgentProfile;
  }) => void;
}

/**
 * Add / edit dialog for one agent profile.
 *
 * Keyed by the caller on the profile being edited, so opening a different row
 * remounts with fresh draft state rather than carrying over the previous one.
 */
export function AgentProfileDialog({
  open,
  onOpenChange,
  originalName,
  initialDraft,
  existingNames,
  entries,
  driverLabels,
  onSubmit,
}: AgentProfileDialogProps) {
  const [draft, setDraft] = useState<AgentProfileDraft>(initialDraft);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const choices = useMemo(
    () => buildProviderChoices({ entries, driverLabels }),
    [driverLabels, entries],
  );
  const selectedChoice = findProviderChoice(choices, draft.provider);
  const models = selectedChoice?.models ?? [];
  const descriptors = useMemo(
    () => selectOptionDescriptorsForModel(models, draft.model),
    [draft.model, models],
  );

  // A stored slug the live provider no longer reports still has to be
  // selectable, or editing an unrelated field would silently drop it.
  const hasUnlistedModel =
    draft.model !== null && !models.some((model) => model.slug === draft.model);

  const nameError = validateAgentProfileName({
    name: draft.name,
    existingNames,
    originalName,
  });
  const showNameError = hasAttemptedSubmit && nameError !== null;

  const updateProvider = (value: string | null) => {
    const selection = value === null ? null : parseProviderChoiceValue(value);
    if (!selection) return;
    const nextModels = findProviderChoice(choices, selection)?.models ?? [];
    const modelStillOffered =
      draft.model !== null && nextModels.some((model) => model.slug === draft.model);
    const nextModel = modelStillOffered ? draft.model : null;
    setDraft((current) => ({
      ...current,
      provider: selection,
      model: nextModel,
      options: pruneAgentProfileOptions(
        current.options,
        selectOptionDescriptorsForModel(nextModels, nextModel),
      ),
    }));
  };

  const updateModel = (value: string | null) => {
    const nextModel = value === null || value === INHERIT_MODEL_VALUE ? null : value;
    setDraft((current) => ({
      ...current,
      model: nextModel,
      options: pruneAgentProfileOptions(
        current.options,
        selectOptionDescriptorsForModel(models, nextModel),
      ),
    }));
  };

  const handleSubmit = () => {
    setHasAttemptedSubmit(true);
    if (nameError !== null) return;
    onSubmit({
      originalName,
      name: draft.name.trim(),
      profile: agentProfileFromDraft(draft),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {originalName === null ? "Add agent profile" : "Edit agent profile"}
            </DialogTitle>
            <DialogDescription>
              A profile is the role an orchestrator spawns a sub-agent with — the provider, model,
              and runtime behind{" "}
              <code>3T agent spawn --profile {draft.name.trim() || "<name>"}</code>.
            </DialogDescription>
          </DialogHeader>

          <div
            data-slot="dialog-panel"
            className="space-y-4 overflow-y-auto bg-zinc-25/80 px-6 py-5 ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5"
          >
            <DialogField
              label="Name"
              hint="Letters, digits, '-', or '_'. Must start with a letter."
              error={showNameError ? nameError : null}
            >
              <Input
                className="bg-background"
                placeholder="e.g. grok"
                value={draft.name}
                spellCheck={false}
                aria-label="Profile name"
                aria-invalid={showNameError}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </DialogField>

            <DialogField
              label="Provider"
              hint={
                selectedChoice?.description ??
                "This profile points at a provider instance that is not configured here."
              }
            >
              <Select value={providerChoiceValue(draft.provider)} onValueChange={updateProvider}>
                <SelectTrigger className="w-full" aria-label="Provider">
                  <SelectValue>
                    {selectedChoice?.label ??
                      (draft.provider.kind === "instance"
                        ? `${draft.provider.instanceId} (not configured)`
                        : draft.provider.driver)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {choices.map((choice) => (
                    <SelectItem hideIndicator key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </DialogField>

            <DialogField
              label="Model"
              hint="Inheriting keeps sub-agents on whatever model the project defaults to."
            >
              <Select value={draft.model ?? INHERIT_MODEL_VALUE} onValueChange={updateModel}>
                <SelectTrigger className="w-full" aria-label="Model">
                  <SelectValue>{draft.model ?? INHERIT_MODEL_LABEL}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value={INHERIT_MODEL_VALUE}>
                    {INHERIT_MODEL_LABEL}
                  </SelectItem>
                  {hasUnlistedModel ? (
                    <SelectItem hideIndicator value={draft.model!}>
                      {draft.model}
                    </SelectItem>
                  ) : null}
                  {models.map((model) => (
                    <SelectItem hideIndicator key={model.slug} value={model.slug}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </DialogField>

            {descriptors.map((descriptor) => {
              if (descriptor.type !== "select") return null;
              const selected = draft.options.find((option) => option.id === descriptor.id);
              const selectedValue = typeof selected?.value === "string" ? selected.value : null;
              const selectedLabel =
                descriptor.options.find((choice) => choice.id === selectedValue)?.label ??
                "Provider default";
              return (
                <DialogField
                  key={descriptor.id}
                  label={descriptor.label}
                  hint={descriptor.description}
                >
                  <Select
                    value={selectedValue ?? INHERIT_MODEL_VALUE}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        options: setAgentProfileOption(
                          current.options,
                          descriptor.id,
                          value === null || value === INHERIT_MODEL_VALUE ? null : value,
                        ),
                      }))
                    }
                  >
                    <SelectTrigger className="w-full" aria-label={descriptor.label}>
                      <SelectValue>{selectedLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value={INHERIT_MODEL_VALUE}>
                        Provider default
                      </SelectItem>
                      {descriptor.options.map((choice) => (
                        <SelectItem hideIndicator key={choice.id} value={choice.id}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </DialogField>
              );
            })}

            <DialogField
              label="Title prefix"
              hint="Prefixed to generated sub-agent thread titles. Defaults to the profile name."
            >
              <Input
                className="bg-background"
                placeholder="e.g. impl"
                value={draft.titlePrefix}
                spellCheck={false}
                aria-label="Title prefix"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, titlePrefix: event.target.value }))
                }
              />
            </DialogField>

            <div className="grid gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-fit gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={isAdvancedOpen}
                onClick={() => setIsAdvancedOpen((current) => !current)}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", isAdvancedOpen && "rotate-180")}
                />
                Advanced
              </Button>
              <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <CollapsibleContent>
                  <div className="grid gap-4 pt-1">
                    <DialogField
                      label="Runtime"
                      hint={AGENT_PROFILE_RUNTIME_DESCRIPTIONS[draft.runtime]}
                    >
                      <Select
                        value={draft.runtime}
                        onValueChange={(value) => {
                          if (value === null || !isAgentProfileRuntime(value)) return;
                          setDraft((current) => ({
                            ...current,
                            runtime: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full" aria-label="Runtime">
                          <SelectValue>{AGENT_PROFILE_RUNTIME_LABELS[draft.runtime]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup alignItemWithTrigger={false}>
                          {AGENT_PROFILE_RUNTIMES.map((runtime) => (
                            <SelectItem hideIndicator key={runtime} value={runtime}>
                              {AGENT_PROFILE_RUNTIME_LABELS[runtime]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </DialogField>

                    <DialogField
                      label="Runtime mode"
                      hint={RUNTIME_MODE_DESCRIPTIONS[draft.runtimeMode]}
                    >
                      <Select
                        value={draft.runtimeMode}
                        onValueChange={(value) => {
                          if (value === null || !isRuntimeMode(value)) return;
                          setDraft((current) => ({
                            ...current,
                            runtimeMode: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full" aria-label="Runtime mode">
                          <SelectValue>{RUNTIME_MODE_LABELS[draft.runtimeMode]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup alignItemWithTrigger={false}>
                          {RUNTIME_MODES.map((mode) => (
                            <SelectItem hideIndicator key={mode} value={mode}>
                              {RUNTIME_MODE_LABELS[mode]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </DialogField>

                    <DialogField
                      label="Interaction mode"
                      hint={INTERACTION_MODE_DESCRIPTIONS[draft.interactionMode]}
                    >
                      <Select
                        value={draft.interactionMode}
                        onValueChange={(value) => {
                          if (value === null || !isInteractionMode(value)) return;
                          setDraft((current) => ({
                            ...current,
                            interactionMode: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full" aria-label="Interaction mode">
                          <SelectValue>
                            {INTERACTION_MODE_LABELS[draft.interactionMode]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup alignItemWithTrigger={false}>
                          {INTERACTION_MODES.map((mode) => (
                            <SelectItem hideIndicator key={mode} value={mode}>
                              {INTERACTION_MODE_LABELS[mode]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </DialogField>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          <DialogFooter variant="bare">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              {originalName === null ? "Add profile" : "Save profile"}
            </Button>
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
