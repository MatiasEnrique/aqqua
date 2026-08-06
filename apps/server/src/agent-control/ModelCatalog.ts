/**
 * The agent model catalog.
 *
 * Every model every configured provider instance advertises is a spawn choice,
 * with no settings record standing in front of it. This module is the only
 * place that knows how a `{instanceId, model, reasoning}` request becomes a
 * concrete launch: which instances can host a sub-agent right now, which model
 * slugs each one really offers, and what a semantic reasoning level is called
 * natively on the chosen model.
 *
 * Deliberately pure and snapshot-driven. Callers hand in the provider snapshots
 * they already hold — the same ones the UI renders — so the catalog cannot go
 * stale against the CLIs, and adds no subscription, poll, or refresh of its
 * own. Every rule below is testable without a provider runtime.
 *
 * @module agent-control/ModelCatalog
 */
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  isProviderAvailable,
  type ModelSelection,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderOptionSelections,
  type RuntimeMode,
  type ServerProvider,
  type ServerProviderModel,
} from "@aqqua/contracts";
import * as Result from "effect/Result";

import {
  type AgentModelCatalogError,
  AgentModelCatalogEmptyError,
  AgentModelInstanceUnavailableError,
  AgentModelInstanceUnknownError,
  AgentModelReasoningInvalidError,
  AgentModelReasoningUnsupportedError,
  AgentModelUnknownError,
} from "./Errors.ts";

/** One provider-instance/model pair an orchestrator can choose between. */
export interface AgentModelRow {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly providerName: string;
  readonly model: ServerProviderModel;
  /** Whether a spawn against this row would be accepted right now. */
  readonly available: boolean;
  /** `null` when spawnable; otherwise why not, in the provider's own words. */
  readonly unavailableReason: string | null;
  /**
   * The configured project default, or the effective fallback when none is
   * configured. An unavailable configured default remains marked and rejects
   * resolution.
   */
  readonly isProjectDefault: boolean;
}

/**
 * Exact identity of one catalog row, plus any generic provider options the
 * caller already chose. Options survive resolution untouched except for the
 * reasoning descriptor, which an explicit `reasoning` level replaces.
 */
export interface AgentModelIdentity {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly options?: ProviderOptionSelections | undefined;
}

/**
 * What one spawn asks for.
 *
 * `model: null` means "whatever the project defaults to" — half a selection
 * (an instance with no model, or the reverse) is unrepresentable rather than a
 * runtime failure, so the transport seam has to pair its flags before it gets
 * here.
 */
export interface AgentModelSelection {
  readonly model: AgentModelIdentity | null;
  /** Semantic level, validated against the chosen model's advertised choices. */
  readonly reasoning?: string | undefined;
}

/** Everything agent control needs to create the sub-agent thread. */
export interface ResolvedAgentLaunch {
  readonly driverKind: ProviderDriverKind;
  readonly modelSelection: ModelSelection;
  /**
   * Always `session`. A terminal-runtime sub-agent is the provider's own CLI in
   * a PTY, which cannot be made to honour a chosen model or its options; only
   * legacy profiles still reach that path.
   */
  readonly runtime: "session";
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly titlePrefix: string;
}

export interface ListAgentModelsInput {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly projectDefaultModelSelection: ModelSelection | null;
}

export interface ResolveAgentModelSelectionInput extends ListAgentModelsInput {
  readonly selection: AgentModelSelection;
}

/**
 * Every known model across every configured instance, in snapshot order.
 *
 * Rows that cannot be spawned right now are listed anyway, carrying the
 * provider's own reason: an orchestrator that can see "Grok is not signed in"
 * fixes it, while a silently shortened list just looks like Grok does not
 * exist. Duplicate slugs across instances stay separate rows — `instanceId`,
 * not the slug, is the identity.
 */
export function listAgentModels(input: ListAgentModelsInput): ReadonlyArray<AgentModelRow> {
  const { projectDefaultModelSelection, providers } = input;
  const fallback =
    projectDefaultModelSelection === null ? deterministicFallbackRow(providers) : undefined;
  const defaultInstanceId =
    projectDefaultModelSelection?.instanceId ??
    (fallback !== undefined && Result.isSuccess(fallback)
      ? fallback.success.snapshot.instanceId
      : undefined);
  const defaultModel =
    projectDefaultModelSelection?.model ??
    (fallback !== undefined && Result.isSuccess(fallback)
      ? fallback.success.model.slug
      : undefined);
  return providers.flatMap((snapshot) => {
    const spawnable = providerSpawnability(snapshot);
    const providerName = displayNameOf(snapshot);
    return snapshot.models.map(
      (model): AgentModelRow => ({
        instanceId: snapshot.instanceId,
        driverKind: snapshot.driver,
        providerName,
        model,
        available: spawnable === null,
        unavailableReason: spawnable,
        isProjectDefault: defaultInstanceId === snapshot.instanceId && defaultModel === model.slug,
      }),
    );
  });
}

/**
 * Turn one spawn request into the launch that runs it.
 *
 * The row comes from, in order: the caller's exact `instanceId + model`; the
 * project's default selection (validated like any other, never trusted); or —
 * with no default at all — the first spawnable snapshot's own default model,
 * falling back to its first model. Every rejection is typed and names what the
 * caller asked for next to what exists.
 */
export function resolveAgentModelSelection(
  input: ResolveAgentModelSelectionInput,
): Result.Result<ResolvedAgentLaunch, AgentModelCatalogError> {
  const { projectDefaultModelSelection, providers, selection } = input;

  const identity =
    selection.model ??
    (projectDefaultModelSelection === null
      ? null
      : {
          instanceId: projectDefaultModelSelection.instanceId,
          model: projectDefaultModelSelection.model,
          options: projectDefaultModelSelection.options,
        });

  const rowResult =
    identity === null ? deterministicFallbackRow(providers) : findRow(providers, identity);
  if (Result.isFailure(rowResult)) return Result.fail(rowResult.failure);
  const { snapshot, model, options } = rowResult.success;

  const optionsResult = applyReasoning({
    instanceId: snapshot.instanceId,
    model,
    options,
    reasoning: selection.reasoning,
  });
  if (Result.isFailure(optionsResult)) return Result.fail(optionsResult.failure);
  const resolvedOptions = optionsResult.success;

  return Result.succeed({
    driverKind: snapshot.driver,
    modelSelection: {
      instanceId: snapshot.instanceId,
      model: model.slug,
      ...(resolvedOptions === undefined ? {} : { options: resolvedOptions }),
    },
    runtime: "session",
    // A delegated sub-agent has nobody to answer an approval prompt while its
    // orchestrator waits, so it must not start in a mode that can block.
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    titlePrefix: model.slug,
  });
}

/**
 * The reasoning control a model advertises, whatever its provider calls it.
 * The contract already confines the marker to `select` descriptors; the type
 * check here is what narrows the union so the advertised choices are readable.
 */
export const findReasoningDescriptor = (model: ServerProviderModel) =>
  (model.capabilities?.optionDescriptors ?? []).find(
    (descriptor) => descriptor.semantic === "reasoning" && descriptor.type === "select",
  );

interface CatalogRow {
  readonly snapshot: ServerProvider;
  readonly model: ServerProviderModel;
  readonly options: ProviderOptionSelections | undefined;
}

const findRow = (
  providers: ReadonlyArray<ServerProvider>,
  identity: AgentModelIdentity,
): Result.Result<CatalogRow, AgentModelCatalogError> => {
  const snapshot = providers.find((candidate) => candidate.instanceId === identity.instanceId);
  if (!snapshot) {
    return Result.fail(
      new AgentModelInstanceUnknownError({
        instanceId: identity.instanceId,
        availableInstanceIds: providers.map((candidate) => candidate.instanceId),
      }),
    );
  }

  const unavailable = providerSpawnability(snapshot);
  if (unavailable !== null) {
    return Result.fail(
      new AgentModelInstanceUnavailableError({
        instanceId: snapshot.instanceId,
        detail: unavailable,
      }),
    );
  }

  const model = snapshot.models.find((candidate) => candidate.slug === identity.model);
  if (!model) {
    return Result.fail(
      new AgentModelUnknownError({
        instanceId: snapshot.instanceId,
        model: identity.model,
        availableModels: snapshot.models.map((candidate) => candidate.slug),
      }),
    );
  }

  return Result.succeed({ snapshot, model, options: identity.options });
};

/**
 * With no project default, the first snapshot that can actually host a
 * sub-agent wins, on its own preferred model. Snapshot order is stable across a
 * run, so the same environment always lands on the same sub-agent — better than
 * pinning one provider's model name, which is wrong the moment that provider is
 * not the one installed.
 */
const deterministicFallbackRow = (
  providers: ReadonlyArray<ServerProvider>,
): Result.Result<CatalogRow, AgentModelCatalogError> => {
  for (const snapshot of providers) {
    if (providerSpawnability(snapshot) !== null) continue;
    const model = snapshot.models.find((candidate) => candidate.isDefault) ?? snapshot.models[0];
    if (!model) continue;
    return Result.succeed({ snapshot, model, options: undefined });
  }
  return Result.fail(new AgentModelCatalogEmptyError());
};

const applyReasoning = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly model: ServerProviderModel;
  readonly options: ProviderOptionSelections | undefined;
  readonly reasoning: string | undefined;
}): Result.Result<ProviderOptionSelections | undefined, AgentModelCatalogError> => {
  const { instanceId, model, options, reasoning } = input;
  const descriptor = findReasoningDescriptor(model);
  // No reasoning asked for means no override: the provider's own default is
  // what the user would get from the picker, and inventing a level here would
  // silently outrank it. A caller may still supply the provider-native option
  // through ModelSelection, so validate that value against the same live
  // descriptor instead of allowing it to bypass the semantic convenience.
  if (reasoning === undefined) {
    if (descriptor === undefined || descriptor.type !== "select") {
      return Result.succeed(options);
    }
    const nativeReasoning = options?.find(({ id }) => id === descriptor.id);
    if (nativeReasoning === undefined) return Result.succeed(options);
    if (
      typeof nativeReasoning.value !== "string" ||
      !descriptor.options.some(({ id }) => id === nativeReasoning.value)
    ) {
      return Result.fail(
        new AgentModelReasoningInvalidError({
          instanceId,
          model: model.slug,
          reasoning: String(nativeReasoning.value),
          supported: descriptor.options.map((option) => option.id),
        }),
      );
    }
    return Result.succeed(options);
  }

  if (!descriptor || descriptor.type !== "select") {
    return Result.fail(new AgentModelReasoningUnsupportedError({ instanceId, model: model.slug }));
  }

  const choice = descriptor.options.find((option) => option.id === reasoning);
  if (!choice) {
    return Result.fail(
      new AgentModelReasoningInvalidError({
        instanceId,
        model: model.slug,
        reasoning,
        supported: descriptor.options.map((option) => option.id),
      }),
    );
  }

  const others = (options ?? []).filter((selection) => selection.id !== descriptor.id);
  return Result.succeed([...others, { id: descriptor.id, value: choice.id }]);
};

/**
 * `null` when the instance can host a sub-agent, otherwise the honest reason it
 * cannot — the provider's own message when it has one, since it knows more than
 * a status enum does.
 */
const providerSpawnability = (snapshot: ServerProvider): string | null => {
  if (!isProviderAvailable(snapshot)) {
    return snapshot.unavailableReason ?? "this build does not ship its provider driver.";
  }
  if (!snapshot.enabled || snapshot.status === "disabled") {
    return snapshot.message ?? "it is disabled in aqqua settings.";
  }
  if (!snapshot.installed) {
    return snapshot.message ?? "its CLI is not installed.";
  }
  if (snapshot.status === "warning") {
    return snapshot.message ?? "it has not finished its availability checks.";
  }
  if (snapshot.status === "error") {
    return snapshot.message ?? "its CLI reported an error.";
  }
  if (snapshot.auth.status === "unauthenticated") {
    return snapshot.message ?? "it is not signed in.";
  }
  return null;
};

const displayNameOf = (snapshot: ServerProvider): string =>
  snapshot.displayName ?? PROVIDER_DISPLAY_NAMES[snapshot.driver] ?? snapshot.driver;
