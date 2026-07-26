/**
 * Agent profile resolution.
 *
 * Turns a role name an orchestrator asks for ("implementer") into the concrete
 * `ModelSelection` + runtime settings a sub-agent thread is created with.
 *
 * Kept pure — the caller supplies settings, the live provider instances, and the
 * owning project's default model — so every resolution rule is directly testable
 * without a provider runtime.
 *
 * @module agent-control/Profiles
 */
import {
  type AgentProfile,
  type AgentProfileMap,
  type AgentProfileName,
  DEFAULT_AGENT_PROFILE_NAME,
  DEFAULT_AGENT_PROFILE_RUNTIME,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

import { AgentProfileUnavailableError, AgentProfileUnknownError } from "./Errors.ts";

/** Driver used for sub-agents when a profile does not name one. */
export const DEFAULT_AGENT_PROFILE_DRIVER = "codex";

/**
 * Model used when neither the profile nor the project supplies one.
 *
 * Resolved per driver rather than pinned to one name: this fallback fires
 * precisely when the project's default belongs to *another* provider, which is
 * the cross-provider delegation case, so the sub-agent's own driver is the only
 * thing that says which model names are even meaningful.
 */
export const agentProfileFallbackModel = (driverKind: ProviderDriverKind): string =>
  DEFAULT_MODEL_BY_PROVIDER[driverKind] ?? DEFAULT_MODEL;

export interface AgentInstanceCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly enabled: boolean;
}

export interface ResolvedAgentProfile {
  readonly profile: AgentProfileName;
  readonly runtime: AgentProfile["runtime"];
  /** Driver behind the resolved instance; needed to host a CLI in a terminal. */
  readonly driverKind: ProviderDriverKind;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly titlePrefix: string;
}

/**
 * The profile every build behaves as if it had, so delegation works on a machine
 * with no `agentProfiles` written yet.
 */
const IMPLICIT_DEFAULT_PROFILE: AgentProfile = {
  runtime: DEFAULT_AGENT_PROFILE_RUNTIME,
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
};

export interface ResolveAgentProfileInput {
  readonly profile: AgentProfileName;
  readonly profiles: AgentProfileMap;
  /** Live provider instances, from the instance registry. */
  readonly instances: ReadonlyArray<AgentInstanceCandidate>;
  /** Owning project's default selection, used to inherit a model. */
  readonly projectDefaultModelSelection: ModelSelection | null;
}

/**
 * Resolve a role name to a concrete sub-agent configuration.
 *
 * Resolution order for the provider instance:
 *
 * 1. the profile's explicit `instanceId`;
 * 2. otherwise the first **enabled** instance whose driver matches the profile's
 *    `driver` (default `codex`).
 *
 * Resolution order for the model:
 *
 * 1. the profile's explicit `model`;
 * 2. otherwise the project's default model, but only when that default targets
 *    the instance we resolved — a model name is meaningless on another provider;
 * 3. otherwise a built-in fallback.
 */
export function resolveAgentProfile(
  input: ResolveAgentProfileInput,
): Result.Result<ResolvedAgentProfile, AgentProfileUnknownError | AgentProfileUnavailableError> {
  const { instances, profile, profiles, projectDefaultModelSelection } = input;
  const configured = profiles[profile];

  // The default role resolves even with no settings written; any other name must
  // be configured, so a typo fails loudly instead of silently running as codex.
  const definition =
    configured ?? (profile === DEFAULT_AGENT_PROFILE_NAME ? IMPLICIT_DEFAULT_PROFILE : undefined);
  if (!definition) {
    return Result.fail(
      new AgentProfileUnknownError({
        profile,
        availableProfiles: Object.keys(profiles).toSorted(),
      }),
    );
  }

  const instanceResult = resolveInstance({ definition, instances, profile });
  if (Result.isFailure(instanceResult)) {
    return Result.fail(instanceResult.failure);
  }
  const instanceId = instanceResult.success;
  const driverKind =
    instances.find((candidate) => candidate.instanceId === instanceId)?.driverKind ??
    (DEFAULT_AGENT_PROFILE_DRIVER as ProviderDriverKind);

  const inheritedModel =
    projectDefaultModelSelection !== null && projectDefaultModelSelection.instanceId === instanceId
      ? projectDefaultModelSelection.model
      : undefined;
  const model = definition.model ?? inheritedModel ?? agentProfileFallbackModel(driverKind);
  const options =
    definition.options ??
    projectDefaultModelSelectionOptions(projectDefaultModelSelection, instanceId);

  return Result.succeed({
    profile,
    runtime: definition.runtime,
    driverKind,
    modelSelection: {
      instanceId,
      model,
      ...(options === undefined ? {} : { options }),
    },
    runtimeMode: definition.runtimeMode,
    interactionMode: definition.interactionMode,
    titlePrefix: definition.titlePrefix ?? profile,
  });
}

const projectDefaultModelSelectionOptions = (
  projectDefaultModelSelection: ModelSelection | null,
  instanceId: ProviderInstanceId,
): ModelSelection["options"] =>
  projectDefaultModelSelection !== null && projectDefaultModelSelection.instanceId === instanceId
    ? projectDefaultModelSelection.options
    : undefined;

const resolveInstance = (input: {
  readonly definition: AgentProfile;
  readonly instances: ReadonlyArray<AgentInstanceCandidate>;
  readonly profile: AgentProfileName;
}): Result.Result<ProviderInstanceId, AgentProfileUnavailableError> => {
  const { definition, instances, profile } = input;

  if (definition.instanceId !== undefined) {
    const explicit = instances.find((candidate) => candidate.instanceId === definition.instanceId);
    if (!explicit) {
      return Result.fail(
        new AgentProfileUnavailableError({
          profile,
          detail: "its configured provider instance is not available in this build.",
        }),
      );
    }
    if (!explicit.enabled) {
      return Result.fail(
        new AgentProfileUnavailableError({
          profile,
          detail: "its configured provider instance is disabled in T3 Code settings.",
        }),
      );
    }
    return Result.succeed(explicit.instanceId);
  }

  const driver = definition.driver ?? DEFAULT_AGENT_PROFILE_DRIVER;
  const matching = instances.filter((candidate) => candidate.driverKind === driver);
  const usable = matching.find((candidate) => candidate.enabled);
  if (!usable) {
    return Result.fail(
      new AgentProfileUnavailableError({
        profile,
        detail:
          matching.length === 0
            ? `no '${driver}' provider is configured in this build.`
            : `every configured '${driver}' provider is disabled in T3 Code settings.`,
      }),
    );
  }
  return Result.succeed(usable.instanceId);
};
