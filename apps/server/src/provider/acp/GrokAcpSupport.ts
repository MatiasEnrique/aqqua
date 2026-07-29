import { type GrokSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const T3_CODE_OAUTH_REFERRER = "t3code";
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
      [GROK_OAUTH2_REFERRER_ENV]: T3_CODE_OAUTH_REFERRER,
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
 * Reasoning effort the session is currently running at, read from the current
 * model's `_meta.reasoningEffort` in the CLI's session setup response.
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
   * Reasoning effort the session runs at after this call, when known.
   * `undefined` means the model's own default: `session/set_model` without a
   * `reasoningEffort` in `_meta` resets the session to that default.
   */
  readonly reasoningEffort: string | undefined;
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
   * Reasoning effort selected for the thread, forwarded to the CLI as
   * `_meta.reasoningEffort` on `session/set_model`. The CLI applies it only
   * when the model supports it, so an unsupported value is silently ignored
   * rather than failing the session. Omit to run at the model's default.
   */
  readonly requestedReasoningEffort?: string | undefined;
  /** Effort the session currently runs at, used to skip redundant calls. */
  readonly currentReasoningEffort?: string | undefined;
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
  const requestedEffort = input.requestedReasoningEffort?.trim() || undefined;
  const shouldApplyEffort =
    requestedEffort !== undefined && requestedEffort !== input.currentReasoningEffort;
  const targetModelId = shouldSwitchModel ? input.requestedModelId : input.currentModelId;
  if ((!shouldSwitchModel && !shouldApplyEffort) || targetModelId === undefined) {
    return Effect.succeed({
      modelId: input.currentModelId,
      reasoningEffort: input.currentReasoningEffort,
    });
  }
  return input.runtime
    .setSessionModel(
      targetModelId,
      requestedEffort === undefined ? undefined : { reasoningEffort: requestedEffort },
    )
    .pipe(
      Effect.mapError(input.mapError),
      Effect.as({ modelId: targetModelId, reasoningEffort: requestedEffort }),
    );
}
