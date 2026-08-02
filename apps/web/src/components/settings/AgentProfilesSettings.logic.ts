/**
 * Pure logic behind the "Agent Profiles" settings section.
 *
 * A profile maps a role name an orchestrator asks for (`aqqua agent spawn
 * --profile <name>`) to a concrete provider configuration. Profiles are
 * machine-local: they live in server settings under `agentProfiles`, because
 * an instance target names a provider instance configured on this machine.
 *
 * Everything here is a pure function over the settings map plus the live
 * provider instance entries, so the presentation layer only has to render.
 * Server-side resolution lives in `apps/server/src/agent-control/Profiles.ts`;
 * the presentation rules below mirror it (instance target wins, else the first
 * enabled instance of a driver target, else the built-in `implementer` role).
 *
 * @module components/settings/AgentProfilesSettings.logic
 */
import {
  type AgentProfile,
  type AgentProfileMap,
  AgentProfileName,
  type AgentProfileRuntime,
  type AgentProfileTarget,
  AGENT_PROFILE_NAME_MAX_CHARS,
  AGENT_PROFILE_NAME_PATTERN,
  DEFAULT_AGENT_PROFILE_DRIVER,
  DEFAULT_AGENT_PROFILE_NAME,
  DEFAULT_AGENT_PROFILE_RUNTIME,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  isProviderDriverKind,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ServerProviderModel,
} from "@aqqua/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";

/** Re-export contracts limits so the dialog can cite a single source of truth. */
export { AGENT_PROFILE_NAME_MAX_CHARS, AGENT_PROFILE_NAME_PATTERN, DEFAULT_AGENT_PROFILE_DRIVER };

/** Label used wherever a profile omits `model` and inherits the project default. */
export const INHERIT_MODEL_LABEL = "Inherits project default";
/** Sentinel select value for "omit `model`". Not a legal model slug. */
export const INHERIT_MODEL_VALUE = "__inherit__";

// ── Map editing ──────────────────────────────────────────────────────

/**
 * Mutable view of a profile map for whole-map rebuilds. Keys stay plain
 * strings while editing; {@link toAgentProfileMap} brands the result once.
 */
type MutableProfileMap = Record<string, AgentProfile>;

const asMutableRecord = (map: AgentProfileMap | undefined): MutableProfileMap => {
  const next: MutableProfileMap = {};
  if (map === undefined) return next;
  for (const [key, value] of Object.entries(map)) {
    next[key] = value;
  }
  return next;
};

/** Brand a plain record as an `AgentProfileMap` after keys have been validated. */
export function toAgentProfileMap(record: MutableProfileMap): AgentProfileMap {
  return record as AgentProfileMap;
}

export function agentProfileNames(map: AgentProfileMap | undefined): ReadonlyArray<string> {
  return Object.keys(asMutableRecord(map));
}

export function getAgentProfile(
  map: AgentProfileMap | undefined,
  name: string,
): AgentProfile | undefined {
  return asMutableRecord(map)[name];
}

/**
 * Validate a profile name against the contract's rules plus uniqueness.
 *
 * Uniqueness is case-sensitive, matching the record key semantics on disk:
 * `Grok` and `grok` are two distinct roles. `originalName` is the key being
 * edited, which is excluded from the collision check so re-saving without a
 * rename is allowed.
 *
 * Returns a user-facing message, or `null` when the name is usable.
 */
export function validateAgentProfileName(input: {
  readonly name: string;
  readonly existingNames: ReadonlyArray<string>;
  readonly originalName?: string | null;
}): string | null {
  const name = input.name.trim();
  if (name.length === 0) return "Profile name is required.";
  if (name.length > AGENT_PROFILE_NAME_MAX_CHARS) {
    return `Profile name must be ${AGENT_PROFILE_NAME_MAX_CHARS} characters or fewer.`;
  }
  if (!AGENT_PROFILE_NAME_PATTERN.test(name)) {
    return "Profile name must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (name !== input.originalName && input.existingNames.includes(name)) {
    return `A profile named '${name}' already exists.`;
  }
  return null;
}

/**
 * Write one profile into the map, returning a whole new map.
 *
 * A rename (`originalName !== name`) drops the old key and writes the new one
 * **in the same position**, so the list does not reshuffle under the user. An
 * add appends. Server settings take whole-map replacement only, so callers
 * hand the result straight to `updateSettings({ agentProfiles })`.
 */
export function upsertAgentProfile(input: {
  readonly map: AgentProfileMap | undefined;
  readonly originalName?: string | null;
  readonly name: string;
  readonly profile: AgentProfile;
}): AgentProfileMap {
  const source = asMutableRecord(input.map);
  const name = input.name.trim();
  const originalName = input.originalName ?? null;
  const next: MutableProfileMap = {};

  let placed = false;
  for (const [key, value] of Object.entries(source)) {
    if (originalName !== null && key === originalName) {
      next[name] = input.profile;
      placed = true;
      continue;
    }
    // A rename onto an existing key overwrites it; the validator blocks that
    // in the dialog, so this only fires if the map changed underneath us.
    if (key === name) continue;
    next[key] = value;
  }
  if (!placed) {
    next[name] = input.profile;
  }
  return toAgentProfileMap(next);
}

/** Remove one profile, returning a whole new map. Unknown names are a no-op. */
export function deleteAgentProfile(
  map: AgentProfileMap | undefined,
  name: string,
): AgentProfileMap {
  const next: MutableProfileMap = {};
  for (const [key, value] of Object.entries(asMutableRecord(map))) {
    if (key === name) continue;
    next[key] = value;
  }
  return toAgentProfileMap(next);
}

// ── Draft ⇄ profile ──────────────────────────────────────────────────

/**
 * Which provider a profile targets. Same closed union as the contracts
 * `AgentProfile.target` field — drafts never invent a third state.
 */
export type AgentProfileProviderSelection = AgentProfileTarget;

/** Editable form state for the add/edit dialog. */
export interface AgentProfileDraft {
  readonly name: string;
  readonly provider: AgentProfileProviderSelection;
  /** `null` means "inherit the project default model" — the field is omitted. */
  readonly model: string | null;
  readonly options: ReadonlyArray<ProviderOptionSelection>;
  readonly runtime: AgentProfileRuntime;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly titlePrefix: string;
}

export const DEFAULT_AGENT_PROFILE_DRAFT: AgentProfileDraft = {
  name: "",
  provider: { kind: "driver", driver: DEFAULT_AGENT_PROFILE_DRIVER },
  model: null,
  options: [],
  runtime: DEFAULT_AGENT_PROFILE_RUNTIME,
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  titlePrefix: "",
};

/** The implicit `implementer` role every build resolves without any settings. */
export const BUILT_IN_IMPLEMENTER_PROFILE: AgentProfile = {
  runtime: DEFAULT_AGENT_PROFILE_RUNTIME,
  target: { kind: "driver", driver: DEFAULT_AGENT_PROFILE_DRIVER },
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
};

export function draftFromAgentProfile(name: string, profile: AgentProfile): AgentProfileDraft {
  return {
    name,
    provider: profile.target,
    model: profile.model ?? null,
    options: profile.options ?? [],
    runtime: profile.runtime,
    runtimeMode: profile.runtimeMode,
    interactionMode: profile.interactionMode,
    titlePrefix: profile.titlePrefix ?? "",
  };
}

/** Draft for "Customize" on the built-in row: an explicit copy of the implicit role. */
export function builtInImplementerDraft(): AgentProfileDraft {
  return draftFromAgentProfile(DEFAULT_AGENT_PROFILE_NAME, BUILT_IN_IMPLEMENTER_PROFILE);
}

/**
 * Project a draft into the persisted shape.
 *
 * Optional fields are *omitted* rather than written empty — an absent `model`
 * is what makes a profile inherit the project default, and an absent `options`
 * is what lets the server inherit the project's option selections. Writing
 * `[]` there would mean "explicitly no options", which is a different thing.
 */
export function agentProfileFromDraft(draft: AgentProfileDraft): AgentProfile {
  const model = draft.model?.trim() ?? "";
  const titlePrefix = draft.titlePrefix.trim();
  return {
    runtime: draft.runtime,
    target: draft.provider,
    ...(model.length > 0 ? { model } : {}),
    ...(draft.options.length > 0 ? { options: draft.options } : {}),
    runtimeMode: draft.runtimeMode,
    interactionMode: draft.interactionMode,
    ...(titlePrefix.length > 0 ? { titlePrefix } : {}),
  };
}

/** Set or clear one option selection, keeping the array canonical (no empties). */
export function setAgentProfileOption(
  options: ReadonlyArray<ProviderOptionSelection>,
  id: string,
  value: string | null,
): ReadonlyArray<ProviderOptionSelection> {
  const without = options.filter((option) => option.id !== id);
  if (value === null || value.trim().length === 0) return without;
  return [...without, { id, value: value.trim() }];
}

/**
 * Drop option selections the currently selected model does not understand.
 * Switching provider or model otherwise leaves a stale `reasoningEffort` behind
 * that the new model would reject at spawn time.
 */
export function pruneAgentProfileOptions(
  options: ReadonlyArray<ProviderOptionSelection>,
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ProviderOptionSelection> {
  const known = new Set(descriptors.map((descriptor) => descriptor.id));
  return options.filter((option) => known.has(option.id));
}

// ── Provider choices ─────────────────────────────────────────────────

/** One entry in the dialog's single provider select. */
export interface AgentProfileProviderChoice {
  readonly selection: AgentProfileProviderSelection;
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export function providerChoiceValue(selection: AgentProfileProviderSelection): string {
  return selection.kind === "instance"
    ? `instance:${selection.instanceId}`
    : `driver:${selection.driver}`;
}

export function parseProviderChoiceValue(value: string): AgentProfileProviderSelection | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (rest.length === 0) return null;
  if (kind === "instance") {
    try {
      return { kind: "instance", instanceId: ProviderInstanceId.make(rest) };
    } catch {
      return null;
    }
  }
  if (kind === "driver") {
    if (!isProviderDriverKind(rest)) return null;
    return { kind: "driver", driver: rest };
  }
  return null;
}

/**
 * Build the provider select: every enabled configured instance first (pinning
 * an instance target), then a generic "first enabled <driver>" fallback per
 * driver kind the user has at least one instance of (a driver target).
 *
 * A driver fallback's model list comes from the instance the server would pick
 * — the first enabled one of that kind — so the model select shows the same
 * slugs the sub-agent will actually be able to run.
 */
export function buildProviderChoices(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverLabels: Readonly<Record<string, string | undefined>>;
}): ReadonlyArray<AgentProfileProviderChoice> {
  const enabled = input.entries.filter((entry) => entry.enabled);
  const choices: AgentProfileProviderChoice[] = enabled.map((entry) => {
    const selection = {
      kind: "instance" as const,
      instanceId: entry.instanceId,
    };
    return {
      selection,
      value: providerChoiceValue(selection),
      label: entry.displayName,
      description: `Pinned instance '${entry.instanceId}'`,
      models: entry.models,
    };
  });

  const seenDrivers = new Set<string>();
  for (const entry of enabled) {
    if (seenDrivers.has(entry.driverKind)) continue;
    seenDrivers.add(entry.driverKind);
    const label = input.driverLabels[entry.driverKind] ?? entry.driverKind;
    const selection = {
      kind: "driver" as const,
      driver: entry.driverKind,
    };
    choices.push({
      selection,
      value: providerChoiceValue(selection),
      label: `First enabled ${label}`,
      description: "Resolved at spawn time, so it survives instance changes",
      models: entry.models,
    });
  }

  // A profile can reference a driver with no enabled instance on this machine
  // (a settings file copied from elsewhere). Keep the default reachable so the
  // dialog always has something to select.
  if (!seenDrivers.has(DEFAULT_AGENT_PROFILE_DRIVER)) {
    const label = input.driverLabels[DEFAULT_AGENT_PROFILE_DRIVER] ?? DEFAULT_AGENT_PROFILE_DRIVER;
    const selection = {
      kind: "driver" as const,
      driver: DEFAULT_AGENT_PROFILE_DRIVER,
    };
    choices.push({
      selection,
      value: providerChoiceValue(selection),
      label: `First enabled ${label}`,
      description: "No enabled instance of this driver is configured yet",
      models: [],
    });
  }

  return choices;
}

/**
 * Find the choice a selection refers to. Returns `undefined` when the profile
 * points at an instance that is gone or disabled — callers surface that as a
 * warning rather than silently rewriting the stored selection.
 */
export function findProviderChoice(
  choices: ReadonlyArray<AgentProfileProviderChoice>,
  selection: AgentProfileProviderSelection,
): AgentProfileProviderChoice | undefined {
  const value = providerChoiceValue(selection);
  return choices.find((choice) => choice.value === value);
}

/** Select descriptors for a model, or `[]` when nothing is selected/known. */
export function selectOptionDescriptorsForModel(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null,
): ReadonlyArray<ProviderOptionDescriptor> {
  if (model === null) return [];
  const descriptors = models.find((candidate) => candidate.slug === model)?.capabilities
    ?.optionDescriptors;
  return (descriptors ?? []).filter((descriptor) => descriptor.type === "select");
}

// ── Presentation ─────────────────────────────────────────────────────

export interface AgentProfileRow {
  readonly name: string;
  readonly profile: AgentProfile;
  /**
   * True for the implicit `implementer` role synthesized when settings hold no
   * explicit entry for it. Built-in rows cannot be deleted, only customized.
   */
  readonly isBuiltIn: boolean;
}

/**
 * List rows for the section: configured profiles sorted by name, with the
 * implicit `implementer` prepended when no explicit entry shadows it.
 */
export function buildAgentProfileRows(
  map: AgentProfileMap | undefined,
): ReadonlyArray<AgentProfileRow> {
  const record = asMutableRecord(map);
  const rows: AgentProfileRow[] = Object.keys(record)
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => ({ name, profile: record[name]!, isBuiltIn: false }));

  if (record[DEFAULT_AGENT_PROFILE_NAME] === undefined) {
    rows.unshift({
      name: DEFAULT_AGENT_PROFILE_NAME,
      profile: BUILT_IN_IMPLEMENTER_PROFILE,
      isBuiltIn: true,
    });
  }
  return rows;
}

/** Human label for the provider a profile targets, given the live instances. */
export function describeAgentProfileProvider(input: {
  readonly profile: AgentProfile;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly driverLabels: Readonly<Record<string, string | undefined>>;
}): string {
  const { profile, entries, driverLabels } = input;
  const { target } = profile;
  if (target.kind === "instance") {
    const entry = entries.find((candidate) => candidate.instanceId === target.instanceId);
    if (entry === undefined) return `${target.instanceId} (not configured)`;
    return entry.enabled ? entry.displayName : `${entry.displayName} (disabled)`;
  }
  return `First enabled ${driverLabels[target.driver] ?? target.driver}`;
}

/** Human label for a profile's model. */
export function describeAgentProfileModel(profile: AgentProfile): string {
  return profile.model ?? INHERIT_MODEL_LABEL;
}

/**
 * Compact one-line summary of a profile's option selections, e.g.
 * "Reasoning: High". Falls back to raw ids/values when the selected model's
 * descriptors are unavailable (a disabled instance, or a probe that has not
 * reported yet), so the row never hides configured state.
 */
export function summarizeAgentProfileOptions(input: {
  readonly options: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): string | null {
  const options = input.options ?? [];
  if (options.length === 0) return null;

  const parts = options.map((option) => {
    const descriptor = input.descriptors.find((candidate) => candidate.id === option.id);
    const label = descriptor?.label ?? option.id;
    if (descriptor?.type === "select") {
      const choice = descriptor.options.find((candidate) => candidate.id === option.value);
      if (choice) return `${label}: ${choice.label}`;
    }
    return `${label}: ${String(option.value)}`;
  });
  return parts.join(" · ");
}

/** Branded key for the settings write. The caller has already validated it. */
export function toAgentProfileName(name: string): AgentProfileName {
  return AgentProfileName.make(name.trim());
}

// ── Advanced-field copy ──────────────────────────────────────────────

export const AGENT_PROFILE_RUNTIME_LABELS: Readonly<Record<AgentProfileRuntime, string>> = {
  session: "Session",
  terminal: "Terminal",
};

export const AGENT_PROFILE_RUNTIME_DESCRIPTIONS: Readonly<Record<AgentProfileRuntime, string>> = {
  session:
    "Runs through a provider adapter, so the sub-agent renders as a normal aqqua transcript.",
  terminal: "Runs the provider's CLI in a PTY. Visible and interactive, but terminal output only.",
};

export const RUNTIME_MODE_LABELS: Readonly<Record<RuntimeMode, string>> = {
  "approval-required": "Approval required",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export const RUNTIME_MODE_DESCRIPTIONS: Readonly<Record<RuntimeMode, string>> = {
  "approval-required": "Every command and edit waits for approval — a sub-agent will stall.",
  "auto-accept-edits": "Edits apply without asking; commands still prompt.",
  auto: "Runs unattended within the provider's own safety rails.",
  "full-access": "Never prompts. The default, because nobody answers a sub-agent's prompts.",
};

export const INTERACTION_MODE_LABELS: Readonly<Record<ProviderInteractionMode, string>> = {
  default: "Default",
  plan: "Plan",
};

export const INTERACTION_MODE_DESCRIPTIONS: Readonly<Record<ProviderInteractionMode, string>> = {
  default: "The sub-agent executes the work it is given.",
  plan: "The sub-agent plans without changing files.",
};

export const AGENT_PROFILE_RUNTIMES: ReadonlyArray<AgentProfileRuntime> = ["session", "terminal"];
export const RUNTIME_MODES: ReadonlyArray<RuntimeMode> = [
  "full-access",
  "auto",
  "auto-accept-edits",
  "approval-required",
];
export const INTERACTION_MODES: ReadonlyArray<ProviderInteractionMode> = ["default", "plan"];

export function isAgentProfileRuntime(value: string): value is AgentProfileRuntime {
  return (AGENT_PROFILE_RUNTIMES as ReadonlyArray<string>).includes(value);
}

export function isRuntimeMode(value: string): value is RuntimeMode {
  return (RUNTIME_MODES as ReadonlyArray<string>).includes(value);
}

export function isInteractionMode(value: string): value is ProviderInteractionMode {
  return (INTERACTION_MODES as ReadonlyArray<string>).includes(value);
}

/** Build a typed driver target without casts at the call site. */
export function driverTarget(driver: ProviderDriverKind): AgentProfileTarget {
  return { kind: "driver", driver };
}

/** Build a typed instance target without casts at the call site. */
export function instanceTarget(instanceId: ProviderInstanceId): AgentProfileTarget {
  return { kind: "instance", instanceId };
}
