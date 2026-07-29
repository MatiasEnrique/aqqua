import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyGrokAcpModelSelection,
  buildGrokAcpSpawnInput,
  currentGrokReasoningEffortFromSessionSetup,
  resolveGrokAcpBaseModelId,
} from "./GrokAcpSupport.ts";

describe("resolveGrokAcpBaseModelId", () => {
  it("normalizes empty and custom Grok model ids", () => {
    expect(resolveGrokAcpBaseModelId(undefined)).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("   ")).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("  grok-test-custom-model  ")).toBe("grok-test-custom-model");
  });
});

describe("buildGrokAcpSpawnInput", () => {
  it("passes the T3 Code referrer through Grok OAuth env", () => {
    const spawn = buildGrokAcpSpawnInput({ binaryPath: "/usr/local/bin/grok" }, "/tmp/project", {
      XAI_API_KEY: "secret",
      GROK_OAUTH2_REFERRER: "other-client",
    });

    expect(spawn).toEqual({
      command: "/usr/local/bin/grok",
      args: ["agent", "stdio"],
      cwd: "/tmp/project",
      env: {
        XAI_API_KEY: "secret",
        GROK_OAUTH2_REFERRER: "t3code",
      },
    });
  });
});

describe("currentGrokReasoningEffortFromSessionSetup", () => {
  it("reads the current model's reasoning effort from session setup meta", () => {
    expect(
      currentGrokReasoningEffortFromSessionSetup({
        sessionId: "session-1",
        models: {
          currentModelId: "grok-4.5",
          availableModels: [
            {
              modelId: "grok-4.5",
              name: "Grok 4.5",
              _meta: { supportsReasoningEffort: true, reasoningEffort: "high" },
            },
          ],
        },
      }),
    ).toBe("high");
  });

  it("returns undefined when the setup response has no effort meta", () => {
    expect(currentGrokReasoningEffortFromSessionSetup({ sessionId: "session-1" })).toBeUndefined();
    expect(
      currentGrokReasoningEffortFromSessionSetup({
        sessionId: "session-1",
        models: {
          currentModelId: "grok-4.5",
          availableModels: [{ modelId: "grok-4.5", name: "Grok 4.5" }],
        },
      }),
    ).toBeUndefined();
  });
});

describe("applyGrokAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<{
      readonly modelId: string;
      readonly meta: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    const runtime = {
      setSessionModel: (modelId: string, meta?: Readonly<Record<string, unknown>>) =>
        Effect.gen(function* () {
          modelCalls.push({ modelId, meta });
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-build",
        requestedModelId: "grok-mock-alt",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-mock-alt", meta: undefined }]);
      expect(result).toEqual({ modelId: "grok-mock-alt", reasoningEffort: undefined });
    }),
  );

  it.effect("skips set_model when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-build",
        requestedModelId: "grok-build",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({ modelId: "grok-build", reasoningEffort: undefined });
    }),
  );

  it.effect("skips set_model when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-build",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({ modelId: "grok-build", reasoningEffort: undefined });
    }),
  );

  it.effect("skips set_model when the requested model is not advertised by the CLI", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-build",
        availableModelIds: ["grok-4.5"],
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({ modelId: "grok-4.5", reasoningEffort: undefined });
    }),
  );

  it.effect("switches when the requested model is advertised by the CLI", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-mock-alt",
        availableModelIds: ["grok-4.5", "grok-mock-alt"],
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-mock-alt", meta: undefined }]);
      expect(result).toEqual({ modelId: "grok-mock-alt", reasoningEffort: undefined });
    }),
  );

  it.effect("sends the requested effort as set_model meta when it differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        requestedReasoningEffort: "low",
        currentReasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-4.5", meta: { reasoningEffort: "low" } }]);
      expect(result).toEqual({ modelId: "grok-4.5", reasoningEffort: "low" });
    }),
  );

  it.effect("skips set_model when the requested effort already matches the session", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        requestedReasoningEffort: "high",
        currentReasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({ modelId: "grok-4.5", reasoningEffort: "high" });
    }),
  );

  it.effect("carries the requested effort along with a model switch", () =>
    Effect.gen(function* () {
      // set_model without a reasoningEffort meta resets the session to the
      // model's default, so an unchanged effort selection must still ride
      // along when the model itself switches.
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-mock-alt",
        requestedReasoningEffort: "medium",
        currentReasoningEffort: "medium",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([
        { modelId: "grok-mock-alt", meta: { reasoningEffort: "medium" } },
      ]);
      expect(result).toEqual({ modelId: "grok-mock-alt", reasoningEffort: "medium" });
    }),
  );

  it.effect("applies an effort change even when the requested model is not advertised", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-build",
        availableModelIds: ["grok-4.5"],
        requestedReasoningEffort: "low",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-4.5", meta: { reasoningEffort: "low" } }]);
      expect(result).toEqual({ modelId: "grok-4.5", reasoningEffort: "low" });
    }),
  );

  it.effect("propagates session/set_model failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyGrokAcpModelSelection({
          runtime,
          currentModelId: "grok-build",
          requestedModelId: "grok-mock-alt",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});
