import { type GrokSettings, ProviderDriverKind } from "@aqqua/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@aqqua/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const AQQUA_OAUTH_REFERRER = "aqqua";
const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

type GrokAcpRuntimeGrokSettings = Pick<GrokSettings, "binaryPath">;

interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeGrokSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeGrokSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: grokSettings?.binaryPath || "grok",
    args: ["agent", "stdio"],
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: AQQUA_OAUTH_REFERRER,
    },
  };
}

function resolveGrokAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(input.grokSettings, input.cwd, input.environment),
        authMethodId: resolveGrokAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "grok-build";
  return normalizeModelSlug(base, GROK_DRIVER_KIND) ?? "grok-build";
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

/**
 * CLI-advertised reasoning effort for the current model at session setup
 * (`ModelInfo._meta.reasoningEffort`). Used only to seed the adapter's
 * last-requested effort tracker; it is not re-read after later set_model calls.
 */
export function currentGrokReasoningEffortFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const models = sessionSetupResult.models;
  const currentModelId = models?.currentModelId?.trim();
  if (!currentModelId) {
    return undefined;
  }
  const currentModel = models?.availableModels?.find((model) => model.modelId === currentModelId);
  const effort = currentModel?._meta?.["reasoningEffort"];
  return typeof effort === "string" && effort.trim() ? effort.trim() : undefined;
}

export function availableGrokModelIdsFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): ReadonlyArray<string> | undefined {
  const models = sessionSetupResult.models?.availableModels;
  if (!models) {
    return undefined;
  }
  return models.flatMap((model) => {
    const id = model?.modelId?.trim();
    return id ? [id] : [];
  });
}

export interface GrokAcpModelSelectionResult {
  readonly modelId: string | undefined;
  /**
   * Last reasoning effort requested of this session via `session/set_model`
   * `_meta.reasoningEffort` (or seeded from session setup). Not CLI-confirmed:
   * the CLI silently ignores unsupported efforts while still succeeding the RPC.
   * `undefined` means the model default is currently requested — either none was
   * ever sent as an override, or the last `set_model` omitted the meta (which
   * resets the CLI to the model default). A no-op with an `unchanged` request
   * preserves the previous last-requested value.
   */
  readonly lastRequestedReasoningEffort: string | undefined;
}

/**
 * Intent for the next reasoning-effort selection. Makes "use the model default",
 * "set an explicit override", and "leave the tracked override alone" distinct so
 * a bare `undefined` cannot mean both reset and no-op.
 */
export type GrokReasoningEffortRequest =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "default" }
  | { readonly _tag: "explicit"; readonly value: string };

/**
 * Map a model-selection option into an effort request.
 *
 * - No model selection for this instance → leave the tracker alone.
 * - Selection present without a non-empty effort option → model default.
 * - Non-empty effort option → explicit override.
 */
export function grokReasoningEffortRequestFromSelection(input: {
  readonly selectionPresent: boolean;
  readonly rawOption: string | null | undefined;
}): GrokReasoningEffortRequest {
  if (!input.selectionPresent) {
    return { _tag: "unchanged" };
  }
  const trimmed = input.rawOption?.trim();
  if (!trimmed) {
    return { _tag: "default" };
  }
  return { _tag: "explicit", value: trimmed };
}

/**
 * Resolve whether effort alone requires `session/set_model`, which meta to send
 * when the RPC runs, and the next tracked last-requested value.
 *
 * Tracked state uses `undefined` for the model default (no override). Model
 * switches without an explicit effort omit meta so the CLI resets to that
 * model's default, and the tracker becomes unset.
 */
export function resolveGrokReasoningEffortTransition(input: {
  readonly request: GrokReasoningEffortRequest;
  readonly lastRequested: string | undefined;
  readonly modelSwitching: boolean;
}): {
  readonly effortRequiresSetModel: boolean;
  readonly setModelMeta: { readonly reasoningEffort: string } | undefined;
  readonly nextLastRequested: string | undefined;
} {
  switch (input.request._tag) {
    case "unchanged": {
      if (input.modelSwitching) {
        return {
          effortRequiresSetModel: false,
          setModelMeta: undefined,
          nextLastRequested: undefined,
        };
      }
      return {
        effortRequiresSetModel: false,
        setModelMeta: undefined,
        nextLastRequested: input.lastRequested,
      };
    }
    case "default": {
      return {
        effortRequiresSetModel: input.lastRequested !== undefined,
        setModelMeta: undefined,
        nextLastRequested: undefined,
      };
    }
    case "explicit": {
      const value = input.request.value;
      return {
        effortRequiresSetModel: value !== input.lastRequested,
        setModelMeta: { reasoningEffort: value },
        nextLastRequested: value,
      };
    }
  }
}

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  /**
   * Model ids the CLI advertised in its session setup response. When present,
   * a requested id outside this list skips `session/set_model` and keeps the
   * CLI's current model: the CLI rejects unknown ids with a fatal
   * "Invalid params" (e.g. a stored default like "grok-build" that a newer CLI
   * no longer serves), and a stale slug must not prevent the session from
   * starting. Omit to force the switch attempt (explicit user selection paths).
   */
  readonly availableModelIds?: ReadonlyArray<string>;
  /**
   * Reasoning effort intent for this selection. Explicit values are forwarded
   * as `_meta.reasoningEffort` on `session/set_model`. `default` omits that
   * meta so the CLI resets to the model default. `unchanged` (or omit) leaves
   * the tracked override alone on effort-only paths; a model switch without an
   * explicit effort still omits meta so Grok resets to the new model's default.
   * Unsupported explicit values are silently ignored by the CLI and the RPC
   * still succeeds.
   */
  readonly requestedReasoningEffort?: GrokReasoningEffortRequest;
  /**
   * Last effort this session requested (not CLI-confirmed). `undefined` means
   * the model default / no override. Used to skip redundant effort-only
   * `set_model` calls.
   */
  readonly lastRequestedReasoningEffort?: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<GrokAcpModelSelectionResult, E> {
  const requestedIsAvailable =
    input.availableModelIds === undefined ||
    (input.requestedModelId !== undefined &&
      input.availableModelIds.includes(input.requestedModelId));
  const shouldSwitchModel =
    input.requestedModelId !== undefined &&
    input.requestedModelId !== input.currentModelId &&
    requestedIsAvailable;
  const effortTransition = resolveGrokReasoningEffortTransition({
    request: input.requestedReasoningEffort ?? { _tag: "unchanged" },
    lastRequested: input.lastRequestedReasoningEffort,
    modelSwitching: shouldSwitchModel,
  });
  const targetModelId = shouldSwitchModel ? input.requestedModelId : input.currentModelId;
  if (
    (!shouldSwitchModel && !effortTransition.effortRequiresSetModel) ||
    targetModelId === undefined
  ) {
    return Effect.succeed({
      modelId: input.currentModelId,
      lastRequestedReasoningEffort: effortTransition.nextLastRequested,
    });
  }
  return input.runtime.setSessionModel(targetModelId, effortTransition.setModelMeta).pipe(
    Effect.mapError(input.mapError),
    Effect.as({
      modelId: targetModelId,
      // Record what we asked for — not what the CLI necessarily applied.
      lastRequestedReasoningEffort: effortTransition.nextLastRequested,
    }),
  );
}
