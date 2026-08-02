import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyGrokAcpModelSelection,
  buildGrokAcpSpawnInput,
  currentGrokReasoningEffortFromSessionSetup,
  grokReasoningEffortRequestFromSelection,
  resolveGrokAcpBaseModelId,
  resolveGrokReasoningEffortTransition,
} from "./GrokAcpSupport.ts";

describe("resolveGrokAcpBaseModelId", () => {
  it("normalizes empty and custom Grok model ids", () => {
    expect(resolveGrokAcpBaseModelId(undefined)).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("   ")).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("  grok-test-custom-model  ")).toBe("grok-test-custom-model");
  });
});

describe("buildGrokAcpSpawnInput", () => {
  it("passes the aqqua referrer through Grok OAuth env", () => {
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
        GROK_OAUTH2_REFERRER: "aqqua",
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

describe("grokReasoningEffortRequestFromSelection", () => {
  it("returns unchanged when no model selection is present", () => {
    expect(
      grokReasoningEffortRequestFromSelection({
        selectionPresent: false,
        rawOption: "high",
      }),
    ).toEqual({ _tag: "unchanged" });
  });

  it("returns default when selection is present without an effort option", () => {
    expect(
      grokReasoningEffortRequestFromSelection({
        selectionPresent: true,
        rawOption: undefined,
      }),
    ).toEqual({ _tag: "default" });
    expect(
      grokReasoningEffortRequestFromSelection({
        selectionPresent: true,
        rawOption: "   ",
      }),
    ).toEqual({ _tag: "default" });
  });

  it("returns an explicit value when selection includes a non-empty effort", () => {
    expect(
      grokReasoningEffortRequestFromSelection({
        selectionPresent: true,
        rawOption: "  low  ",
      }),
    ).toEqual({ _tag: "explicit", value: "low" });
  });
});

describe("resolveGrokReasoningEffortTransition", () => {
  it("treats default as a reset of an explicit override", () => {
    expect(
      resolveGrokReasoningEffortTransition({
        request: { _tag: "default" },
        lastRequested: "high",
        modelSwitching: false,
      }),
    ).toEqual({
      effortRequiresSetModel: true,
      setModelMeta: undefined,
      nextLastRequested: undefined,
    });
  });

  it("does not re-apply default when the tracker is already unset", () => {
    expect(
      resolveGrokReasoningEffortTransition({
        request: { _tag: "default" },
        lastRequested: undefined,
        modelSwitching: false,
      }),
    ).toEqual({
      effortRequiresSetModel: false,
      setModelMeta: undefined,
      nextLastRequested: undefined,
    });
  });

  it("clears the tracker on model switch without an explicit effort", () => {
    expect(
      resolveGrokReasoningEffortTransition({
        request: { _tag: "unchanged" },
        lastRequested: "high",
        modelSwitching: true,
      }),
    ).toEqual({
      effortRequiresSetModel: false,
      setModelMeta: undefined,
      nextLastRequested: undefined,
    });
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
      expect(result).toEqual({
        modelId: "grok-mock-alt",
        lastRequestedReasoningEffort: undefined,
      });
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
      expect(result).toEqual({
        modelId: "grok-build",
        lastRequestedReasoningEffort: undefined,
      });
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
      expect(result).toEqual({
        modelId: "grok-build",
        lastRequestedReasoningEffort: undefined,
      });
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
      expect(result).toEqual({
        modelId: "grok-4.5",
        lastRequestedReasoningEffort: undefined,
      });
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
      expect(result).toEqual({
        modelId: "grok-mock-alt",
        lastRequestedReasoningEffort: undefined,
      });
    }),
  );

  it.effect(
    "sends the requested effort as set_model meta when it differs from last requested",
    () =>
      Effect.gen(function* () {
        const { runtime, modelCalls } = makeRecordingRuntime();
        const result = yield* applyGrokAcpModelSelection({
          runtime,
          currentModelId: "grok-4.5",
          requestedModelId: "grok-4.5",
          requestedReasoningEffort: { _tag: "explicit", value: "low" },
          lastRequestedReasoningEffort: "high",
          mapError: (cause) => cause.message,
        });
        expect(modelCalls).toEqual([{ modelId: "grok-4.5", meta: { reasoningEffort: "low" } }]);
        expect(result).toEqual({
          modelId: "grok-4.5",
          lastRequestedReasoningEffort: "low",
        });
      }),
  );

  it.effect(
    "skips set_model when the requested effort already matches the last requested effort",
    () =>
      Effect.gen(function* () {
        const { runtime, modelCalls } = makeRecordingRuntime();
        const result = yield* applyGrokAcpModelSelection({
          runtime,
          currentModelId: "grok-4.5",
          requestedModelId: "grok-4.5",
          requestedReasoningEffort: { _tag: "explicit", value: "high" },
          lastRequestedReasoningEffort: "high",
          mapError: (cause) => cause.message,
        });
        expect(modelCalls).toEqual([]);
        expect(result).toEqual({
          modelId: "grok-4.5",
          lastRequestedReasoningEffort: "high",
        });
      }),
  );

  it.effect("resets to model default when default is requested over an explicit last effort", () =>
    Effect.gen(function* () {
      // Concrete missing transition: explicit high → default on the same
      // model must call set_model without reasoningEffort meta so the CLI
      // drops the override, and the tracker must become unset.
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        requestedReasoningEffort: { _tag: "default" },
        lastRequestedReasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-4.5", meta: undefined }]);
      expect(result).toEqual({
        modelId: "grok-4.5",
        lastRequestedReasoningEffort: undefined,
      });
    }),
  );

  it.effect("skips set_model when default is requested and the tracker is already unset", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        requestedReasoningEffort: { _tag: "default" },
        lastRequestedReasoningEffort: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({
        modelId: "grok-4.5",
        lastRequestedReasoningEffort: undefined,
      });
    }),
  );

  it.effect("preserves an explicit override when the effort request is unchanged", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.5",
        requestedReasoningEffort: { _tag: "unchanged" },
        lastRequestedReasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toEqual({
        modelId: "grok-4.5",
        lastRequestedReasoningEffort: "high",
      });
    }),
  );

  it.effect("carries the requested effort along with a model switch", () =>
    Effect.gen(function* () {
      // set_model without a reasoningEffort meta resets the session to the
      // model's default, so an explicit effort selection must still ride
      // along when the model itself switches.
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-mock-alt",
        requestedReasoningEffort: { _tag: "explicit", value: "medium" },
        lastRequestedReasoningEffort: "medium",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([
        { modelId: "grok-mock-alt", meta: { reasoningEffort: "medium" } },
      ]);
      expect(result).toEqual({
        modelId: "grok-mock-alt",
        lastRequestedReasoningEffort: "medium",
      });
    }),
  );

  it.effect("clears the effort override on model switch when no explicit effort is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-4.5",
        requestedModelId: "grok-mock-alt",
        requestedReasoningEffort: { _tag: "unchanged" },
        lastRequestedReasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-mock-alt", meta: undefined }]);
      expect(result).toEqual({
        modelId: "grok-mock-alt",
        lastRequestedReasoningEffort: undefined,
      });
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
        requestedReasoningEffort: { _tag: "explicit", value: "low" },
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([{ modelId: "grok-4.5", meta: { reasoningEffort: "low" } }]);
      expect(result).toEqual({
        modelId: "grok-4.5",
        lastRequestedReasoningEffort: "low",
      });
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
