import {
  type AgentProfileMap,
  type AgentProfileTarget,
  BoardStepId,
  type BoardStep,
  type BoardStepContinuation,
  type OrchestrationBoard,
  type ProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
} from "@aqqua/contracts";
import { collectBoardParameterNames } from "@aqqua/shared/boardTemplate";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  BUILT_IN_IMPLEMENTER_PROFILE,
  getAgentProfile,
} from "../settings/AgentProfilesSettings.logic";

/** Editing shape: plain form strings plus any canonical selector that must survive editing. */
export interface BoardStepDraft {
  readonly id: BoardStepId;
  readonly name: string;
  readonly promptTemplate: string;
  readonly profileName: string;
  readonly agent?: BoardStep["agent"];
  readonly continuation: BoardStepContinuation;
}

export interface BoardDraft {
  readonly name: string;
  readonly steps: ReadonlyArray<BoardStepDraft>;
}

export const CONTINUATION_OPTIONS: ReadonlyArray<{
  readonly value: BoardStepContinuation;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Success advances the card to the next step immediately.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Success pauses the card here so you can review the artifact before continuing.",
  },
];

export function createStepDraft(id: BoardStepId, profileName: string): BoardStepDraft {
  return { id, name: "", promptTemplate: "", profileName, continuation: "auto" };
}

export function draftFromBoard(board: OrchestrationBoard): BoardDraft {
  return {
    name: board.name,
    steps: board.steps.map((step) => ({
      id: step.id,
      name: step.name,
      promptTemplate: step.promptTemplate,
      profileName: step.profileName ?? "",
      ...(step.agent === undefined ? {} : { agent: step.agent }),
      continuation: step.continuation,
    })),
  };
}

export function updateStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
  patch: Partial<Omit<BoardStepDraft, "id">>,
): ReadonlyArray<BoardStepDraft> {
  return steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
}

export function removeStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
): ReadonlyArray<BoardStepDraft> {
  return steps.filter((_, i) => i !== index);
}

/** Up/down reorder. Out-of-range moves are no-ops so the buttons can stay dumb. */
export function moveStep(
  steps: ReadonlyArray<BoardStepDraft>,
  index: number,
  direction: "up" | "down",
): ReadonlyArray<BoardStepDraft> {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) {
    return steps;
  }
  const next = [...steps];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

export interface BoardDraftErrors {
  readonly name: string | null;
  /** Board-level problems that belong to no single step. */
  readonly general: string | null;
  /** Keyed by step id so a reorder carries the message with its step. */
  readonly steps: Readonly<Record<string, string>>;
}

const MAX_BOARD_NAME_CHARS = 120;
const MAX_STEP_NAME_CHARS = 64;
const MAX_STEPS = 20;

export function validateBoardDraft(draft: BoardDraft): BoardDraftErrors {
  const stepErrors: Record<string, string> = {};
  const seenNames = new Set<string>();

  for (const step of draft.steps) {
    const name = step.name.trim();
    const message =
      name === ""
        ? "Give the step a name."
        : name.length > MAX_STEP_NAME_CHARS
          ? `Step names are at most ${MAX_STEP_NAME_CHARS} characters.`
          : seenNames.has(name.toLowerCase())
            ? // Artifact placeholders address steps by name (`${artifact:Review}`),
              // so duplicates would be ambiguous downstream.
              "Step names must be unique."
            : step.promptTemplate.trim() === ""
              ? "Give the step a prompt template."
              : step.profileName.trim() === "" && step.agent === undefined
                ? "Pick an agent."
                : null;
    if (name !== "") seenNames.add(name.toLowerCase());
    if (message !== null) stepErrors[step.id] = message;
  }

  const name = draft.name.trim();
  const nameError =
    name === ""
      ? "Give the flow a name."
      : name.length > MAX_BOARD_NAME_CHARS
        ? `Flow names are at most ${MAX_BOARD_NAME_CHARS} characters.`
        : null;

  const general =
    draft.steps.length === 0
      ? "Add at least one step."
      : draft.steps.length > MAX_STEPS
        ? `A flow holds at most ${MAX_STEPS} steps.`
        : null;

  return { name: nameError, general, steps: stepErrors };
}

export function isBoardDraftSubmittable(errors: BoardDraftErrors): boolean {
  return errors.name === null && errors.general === null && Object.keys(errors.steps).length === 0;
}

/** Trimmed steps, ready for `board.create` / `board.update` (replaced wholesale). */
export function toBoardSteps(draft: BoardDraft): ReadonlyArray<BoardStep> {
  return draft.steps.map((step) => {
    const shared = {
      id: step.id,
      name: step.name.trim(),
      promptTemplate: step.promptTemplate.trim(),
      continuation: step.continuation,
    };
    const profileName = step.profileName.trim();
    if (profileName !== "") {
      return {
        ...shared,
        profileName: profileName as NonNullable<BoardStep["profileName"]>,
      };
    }
    if (step.agent !== undefined) return { ...shared, agent: step.agent };
    throw new Error(`Step '${step.name}' has no agent selector.`);
  });
}

/** The reasoning select a model advertises, whatever its provider calls it. */
export function reasoningDescriptorForModel(model: ServerProviderModel | undefined) {
  return (model?.capabilities?.optionDescriptors ?? []).find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && descriptor.semantic === "reasoning",
  );
}

export interface StepAgentDisplay {
  readonly entry: ProviderInstanceEntry;
  readonly model: string;
  readonly reasoning: string | null;
}

/**
 * A replacement selector for a step whose stored agent no longer resolves.
 * Only instances with a visible model option can back the picker; custom-only
 * instances therefore remain usable, while an empty model is never invented.
 */
export function resolveStepAgentFallbackDisplay(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceEntry["instanceId"],
    ReadonlyArray<{ readonly slug: string }>
  >,
): StepAgentDisplay | null {
  for (const entry of entries) {
    if (!entry.enabled || !entry.isAvailable) continue;
    const options = modelOptionsByInstance.get(entry.instanceId) ?? [];
    const defaultModel = entry.models.find((candidate) => candidate.isDefault)?.slug;
    const model = options.find((option) => option.slug === defaultModel)?.slug ?? options[0]?.slug;
    if (model !== undefined) return { entry, model, reasoning: null };
  }
  return null;
}

/**
 * What the model picker shows for a step: its canonical `agent` when set,
 * otherwise its legacy profile resolved against the live provider instances,
 * mirroring the server's compatibility adapter (instance target wins, else the
 * first enabled instance of the driver target). `null` when nothing on this
 * machine can display it — no matching instance, or no instances at all.
 */
export function resolveStepAgentDisplay(
  step: Pick<BoardStepDraft, "agent" | "profileName">,
  agentProfiles: AgentProfileMap | undefined,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): StepAgentDisplay | null {
  const agent = step.agent;
  if (agent !== undefined) {
    const entry = entries.find((candidate) => candidate.instanceId === agent.instanceId);
    if (entry === undefined) return null;
    return { entry, model: agent.model, reasoning: agent.reasoning ?? null };
  }

  // Unknown names fall back to the built-in implementer configuration so the
  // picker still shows a concrete starting point the user can change.
  const profile =
    getAgentProfile(agentProfiles, step.profileName.trim()) ?? BUILT_IN_IMPLEMENTER_PROFILE;
  const target = profile.target;
  const entry =
    target.kind === "instance"
      ? entries.find((candidate) => candidate.instanceId === target.instanceId)
      : entries.find((candidate) => candidate.enabled && candidate.driverKind === target.driver);
  if (entry === undefined) return null;
  const model =
    profile.model ??
    entry.models.find((candidate) => candidate.isDefault)?.slug ??
    entry.models[0]?.slug;
  if (model === undefined) return null;
  const descriptor = reasoningDescriptorForModel(
    entry.models.find((candidate) => candidate.slug === model),
  );
  const reasoningSelection =
    descriptor === undefined
      ? undefined
      : (profile.options ?? []).find((option) => option.id === descriptor.id);
  return {
    entry,
    model,
    reasoning: typeof reasoningSelection?.value === "string" ? reasoningSelection.value : null,
  };
}

/**
 * Canonical selection for a picked instance + model. Carries a reasoning level
 * only when the chosen model actually advertises that choice, so a provider or
 * model switch cannot leave behind a level the spawn would reject.
 */
export function stepAgentSelection(
  entry: ProviderInstanceEntry,
  model: string,
  reasoning: string | null,
): NonNullable<BoardStep["agent"]> {
  const descriptor = reasoningDescriptorForModel(
    entry.models.find((candidate) => candidate.slug === model),
  );
  const keepsReasoning =
    reasoning !== null && (descriptor?.options ?? []).some((choice) => choice.id === reasoning);
  return {
    instanceId: entry.instanceId,
    model,
    ...(keepsReasoning ? { reasoning } : {}),
  };
}

export function makeBoardStepId(id: string): BoardStepId {
  return BoardStepId.make(id);
}

export type TemplateSegment =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "parameter" | "artifact" | "skill";
      readonly text: string;
      readonly body: string;
    };

const TEMPLATE_TOKEN_RE = /(\$\{[^}]*\})/g;
const PARAMETER_BODY_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
// Mirrors the composer's skill-token shape (`$name` on word boundaries), but
// also matches at end-of-input so a token highlights while it is being typed.
const SKILL_TOKEN_RE = /(^|\s)(\$[a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

function segmentSkillTokens(text: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let consumed = 0;
  for (const match of text.matchAll(SKILL_TOKEN_RE)) {
    const start = (match.index ?? 0) + match[1]!.length;
    const token = match[2]!;
    if (start > consumed) segments.push({ kind: "text", text: text.slice(consumed, start) });
    segments.push({ kind: "skill", text: token, body: token.slice(1) });
    consumed = start + token.length;
  }
  if (consumed < text.length) segments.push({ kind: "text", text: text.slice(consumed) });
  return segments;
}

/**
 * Split a prompt template into plain text, `${...}` tokens, and `$skill`
 * references for syntax highlighting. Concatenating `text` across segments
 * round-trips the input verbatim, so a highlight overlay stays caret-aligned
 * with the textarea.
 */
export function segmentTemplate(template: string): ReadonlyArray<TemplateSegment> {
  const segments: TemplateSegment[] = [];
  for (const part of template.split(TEMPLATE_TOKEN_RE)) {
    if (part === "") continue;
    if (part.startsWith("${") && part.endsWith("}")) {
      const body = part.slice(2, -1);
      if (body === "artifact" || body.startsWith("artifact:")) {
        segments.push({ kind: "artifact", text: part, body });
        continue;
      }
      if (body === "card_title" || PARAMETER_BODY_RE.test(body)) {
        segments.push({ kind: "parameter", text: part, body });
        continue;
      }
    }
    segments.push(...segmentSkillTokens(part));
  }
  return segments;
}

export function isValidParameterName(name: string): boolean {
  return PARAMETER_BODY_RE.test(name);
}

export interface TemplatePlaceholderOption {
  /** Full `${...}` text inserted on accept. */
  readonly token: string;
  readonly label: string;
  readonly description: string;
}

/**
 * `${...}` completions available inside one step's prompt: the previous
 * step's artifact, each earlier step's artifact by name (later steps are
 * excluded because their artifacts don't exist yet when this step runs),
 * every card field already used on the board, and the card title.
 */
export function buildPlaceholderOptions(
  steps: ReadonlyArray<BoardStepDraft>,
  stepIndex: number,
): ReadonlyArray<TemplatePlaceholderOption> {
  const options: TemplatePlaceholderOption[] = [];

  if (stepIndex > 0) {
    const previousName = steps[stepIndex - 1]?.name.trim() ?? "";
    options.push({
      token: "${artifact}",
      label: "${artifact}",
      description:
        previousName === ""
          ? "Path of the previous step's artifact"
          : `Path of the previous step's artifact (${previousName})`,
    });
  }

  for (const [index, step] of steps.entries()) {
    if (index >= stepIndex) break;
    const name = step.name.trim();
    if (name === "") continue;
    options.push({
      token: `\${artifact:${name}}`,
      label: `\${artifact:${name}}`,
      description: `Artifact written by step ${index + 1} · ${name}`,
    });
  }

  for (const parameter of collectBoardParameterNames(steps.map((step) => step.promptTemplate))) {
    options.push({
      token: `\${${parameter}}`,
      label: `\${${parameter}}`,
      description: "Card field",
    });
  }

  options.push({
    token: "${card_title}",
    label: "${card_title}",
    description: "The card's title",
  });

  return options;
}

/**
 * Insert a `$skill` reference at the caret, padding with spaces so the token
 * sits on the word boundaries the composer grammar requires.
 */
export function insertSkillToken(
  template: string,
  caretIndex: number,
  skillName: string,
): { readonly text: string; readonly caret: number } {
  const caret = Math.max(0, Math.min(template.length, Math.floor(caretIndex)));
  const before = template.slice(0, caret);
  const after = template.slice(caret);
  const token = `${before !== "" && !/\s$/.test(before) ? " " : ""}$${skillName}${
    after === "" || !/^\s/.test(after) ? " " : ""
  }`;
  return { text: before + token + after, caret: caret + token.length };
}

/**
 * The provider instance whose native skills a step's profile would run with.
 * Mirrors server-side resolution in `agent-control/Profiles.ts`: an instance
 * target wins, else the first enabled instance of the driver target.
 */
export function resolveProfileSkillsProvider(
  target: AgentProfileTarget | null,
  providers: ReadonlyArray<ServerProvider>,
): ServerProvider | null {
  if (target === null) return null;
  if (target.kind === "instance") {
    return providers.find((provider) => provider.instanceId === target.instanceId) ?? null;
  }
  return (
    providers.find((provider) => provider.enabled && provider.driver === target.driver) ?? null
  );
}
