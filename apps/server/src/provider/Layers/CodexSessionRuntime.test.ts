import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { describe } from "vite-plus/test";
import {
  DEFAULT_MODEL,
  ProviderDriverKind,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@aqqua/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  buildCodexDeveloperInstructions,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import {
  buildTurnStartParams,
  codexNativeChildTitle,
  hasConfiguredMcpServer,
  interruptCodexTurn,
  isRecoverableThreadResumeError,
  openCodexThread,
  rememberCodexNativeChild,
  rememberCodexNativeChildrenFromNotification,
  resolveCodexProviderSubagentTarget,
  shouldSteerCodexTurn,
  steerCodexTurn,
  steerCodexTurnOrStart,
  turnStartSessionUpdates,
  updateTurnStartSession,
  type CodexNativeChildMeta,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

type TurnControlRequest = <M extends "thread/read" | "turn/interrupt" | "turn/steer">(
  method: M,
  payload: CodexRpc.ClientRequestParamsByMethod[M],
) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexErrors.CodexAppServerError>;

function makeProviderSession(updates: Partial<ProviderSession> = {}): ProviderSession {
  return {
    provider: ProviderDriverKind.make("codex"),
    status: "ready",
    runtimeMode: "full-access",
    cwd: "/tmp/project",
    threadId: ThreadId.make("thread-1"),
    resumeCursor: { threadId: "provider-thread-1" },
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
    ...updates,
  };
}

describe("CodexSessionRuntimeIdentifierGenerationError", () => {
  it("retains identifier purpose and the random source failure", () => {
    const cause = new Error("random source unavailable");
    const error = new CodexErrors.CodexAppServerIdentifierGenerationError({
      purpose: "provider-event",
      cause,
    });

    NodeAssert.equal(error.purpose, "provider-event");
    NodeAssert.strictEqual(error.cause, cause);
    NodeAssert.equal(
      error.message,
      "Failed to generate Codex App Server identifier for provider-event.",
    );
  });
});

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("keeps invalid turn values only in the schema cause", () => {
    const secret = "codex-turn-input-secret-sentinel";
    const error = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        attachments: [
          {
            type: "image",
            url: { secret } as unknown as string,
          },
        ],
      }).pipe(Effect.flip),
    );
    const { cause, ...directDiagnostics } = error;

    NodeAssert.equal(error.operation, "decode-request-payload");
    NodeAssert.equal(error.method, "turn/start");
    NodeAssert.ok((error.issueCount ?? 0) > 0);
    NodeAssert.ok(error.issueKinds?.includes("Pointer"));
    NodeAssert.ok((error.maximumPathDepth ?? 0) > 0);
    NodeAssert.ok(Schema.isSchemaError(cause));
    NodeAssert.doesNotMatch(error.message, new RegExp(secret));
    NodeAssert.doesNotMatch(JSON.stringify(directDiagnostics), new RegExp(secret));
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("plan", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("default", {
            model: "gpt-5.3-codex",
            reasoningEffort: "medium",
          }),
        },
      },
    });
  });

  it("reports the same fallback model and effort in settings and instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Go",
        interactionMode: "default",
      }),
    );

    const settings = params.collaborationMode?.settings;
    NodeAssert.equal(settings?.model, DEFAULT_MODEL);
    NodeAssert.equal(settings?.reasoning_effort, "medium");
    NodeAssert.ok(settings?.developer_instructions?.includes(`as ${DEFAULT_MODEL} with medium`));
  });

  it.effect("routes approvals to the auto reviewer in auto mode", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto",
        prompt: "Ship it",
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        input: [
          {
            type: "text",
            text: "Ship it",
          },
        ],
      });
    }),
  );

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("Codex turn control", () => {
  it.effect("steers a plain prompt into the active turn and reuses its id", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      const session = makeProviderSession({
        status: "running",
        activeTurnId,
        model: "gpt-5.3-codex",
      });
      const input = { input: "One more thing" };
      const calls: Array<{ method: string; payload: unknown }> = [];
      const request = (<M extends "thread/read" | "turn/interrupt" | "turn/steer">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        return Effect.succeed({
          turnId: "ignored-response-id",
        } as CodexRpc.ClientRequestResponsesByMethod[M]);
      }) as TurnControlRequest;

      NodeAssert.equal(shouldSteerCodexTurn(session, input, session.model), true);
      const returnedTurnId = yield* steerCodexTurn(
        request,
        "provider-thread-1",
        activeTurnId,
        input.input,
      );

      NodeAssert.equal(returnedTurnId, activeTurnId);
      NodeAssert.deepStrictEqual(calls, [
        {
          method: "turn/steer",
          payload: {
            threadId: "provider-thread-1",
            expectedTurnId: activeTurnId,
            input: [{ type: "text", text: "One more thing" }],
          },
        },
      ]);
    }),
  );

  it.effect("falls back to turn/start when steering loses the active-turn race", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      const startedTurnId = TurnId.make("started-turn");
      const mismatch = new CodexErrors.CodexAppServerRequestError({
        code: -32600,
        errorMessage: "expected active turn id active-turn but found next-turn",
      });
      const request = (() => Effect.fail(mismatch)) as TurnControlRequest;
      let startCount = 0;

      const result = yield* steerCodexTurnOrStart(
        request,
        "provider-thread-1",
        activeTurnId,
        "One more thing",
        () =>
          Effect.sync(() => {
            startCount += 1;
            return startedTurnId;
          }),
      );

      NodeAssert.equal(result, startedTurnId);
      NodeAssert.equal(startCount, 1);
    }),
  );

  it.effect("falls back to turn/start when the active turn finishes before steering", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      const startedTurnId = TurnId.make("started-turn");
      const noActiveTurn = new CodexErrors.CodexAppServerRequestError({
        code: -32600,
        errorMessage: "no active turn to steer",
      });
      const request = (() => Effect.fail(noActiveTurn)) as TurnControlRequest;
      let startCount = 0;

      const result = yield* steerCodexTurnOrStart(
        request,
        "provider-thread-1",
        activeTurnId,
        "One more thing",
        () =>
          Effect.sync(() => {
            startCount += 1;
            return startedTurnId;
          }),
      );

      NodeAssert.equal(result, startedTurnId);
      NodeAssert.equal(startCount, 1);
    }),
  );

  it.effect("preserves non-mismatch steer failures", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      const failure = new CodexErrors.CodexAppServerRequestError({
        code: -32603,
        errorMessage: "Codex App Server unavailable",
      });
      const request = (() => Effect.fail(failure)) as TurnControlRequest;
      let startCount = 0;

      const error = yield* steerCodexTurnOrStart(
        request,
        "provider-thread-1",
        activeTurnId,
        "One more thing",
        () =>
          Effect.sync(() => {
            startCount += 1;
            return TurnId.make("started-turn");
          }),
      ).pipe(Effect.flip);

      NodeAssert.strictEqual(error, failure);
      NodeAssert.equal(startCount, 0);
    }),
  );

  it.effect("preserves same-message failures with a non-invalid-request code", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      let startCount = 0;

      for (const errorMessage of [
        "expected active turn id active-turn but found next-turn",
        "no active turn to steer",
      ]) {
        const failure = new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage,
        });
        const request = (() => Effect.fail(failure)) as TurnControlRequest;
        const error = yield* steerCodexTurnOrStart(
          request,
          "provider-thread-1",
          activeTurnId,
          "One more thing",
          () =>
            Effect.sync(() => {
              startCount += 1;
              return TurnId.make("started-turn");
            }),
        ).pipe(Effect.flip);

        NodeAssert.strictEqual(error, failure);
      }

      NodeAssert.equal(startCount, 0);
    }),
  );

  it("keeps idle and non-plain inputs on the turn/start path", () => {
    const activeTurnId = TurnId.make("active-turn");

    NodeAssert.equal(
      shouldSteerCodexTurn(makeProviderSession(), { input: "Start" }, "gpt-5.3-codex"),
      false,
    );
    NodeAssert.equal(
      shouldSteerCodexTurn(
        makeProviderSession({ status: "running", activeTurnId, model: "gpt-5.3-codex" }),
        { input: "Use this", attachments: [{ type: "image", url: "data:image/png;base64,x" }] },
        "gpt-5.3-codex",
      ),
      false,
    );
    NodeAssert.deepStrictEqual(
      turnStartSessionUpdates(makeProviderSession(), TurnId.make("started-turn"), undefined),
      { status: "running", activeTurnId: TurnId.make("started-turn") },
    );
    NodeAssert.deepStrictEqual(
      turnStartSessionUpdates(
        makeProviderSession({ status: "running", activeTurnId }),
        TurnId.make("queued-turn"),
        undefined,
      ),
      {},
    );
  });

  it.effect("records the replacement turn from session state updated during steering", () =>
    Effect.gen(function* () {
      const staleTurnId = TurnId.make("stale-turn");
      const replacementTurnId = TurnId.make("replacement-turn");
      const sessionBeforeSend = makeProviderSession({
        status: "running",
        activeTurnId: staleTurnId,
      });
      const sessionRef = yield* Ref.make(sessionBeforeSend);

      yield* Ref.set(sessionRef, makeProviderSession());
      yield* updateTurnStartSession(sessionRef, replacementTurnId, undefined);

      const session = yield* Ref.get(sessionRef);
      NodeAssert.equal(session.status, "running");
      NodeAssert.equal(session.activeTurnId, replacementTurnId);
    }),
  );

  it.effect("interrupts a matching active turn on the first request", () =>
    Effect.gen(function* () {
      const activeTurnId = TurnId.make("active-turn");
      const sessionRef = yield* Ref.make(makeProviderSession({ status: "running", activeTurnId }));
      const calls: Array<{ method: string; payload: unknown }> = [];
      const request = (<M extends "thread/read" | "turn/interrupt" | "turn/steer">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        return Effect.succeed(undefined as unknown as CodexRpc.ClientRequestResponsesByMethod[M]);
      }) as TurnControlRequest;

      yield* interruptCodexTurn(request, sessionRef, "provider-thread-1", activeTurnId);

      NodeAssert.deepStrictEqual(calls, [
        {
          method: "turn/interrupt",
          payload: { threadId: "provider-thread-1", turnId: activeTurnId },
        },
      ]);
    }),
  );

  it.effect("re-reads and retries an interrupt with Codex's active turn id", () =>
    Effect.gen(function* () {
      const staleTurnId = TurnId.make("stale-turn");
      const recoveredTurnId = TurnId.make("recovered-turn");
      const sessionRef = yield* Ref.make(
        makeProviderSession({ status: "running", activeTurnId: staleTurnId }),
      );
      const calls: Array<{ method: string; payload: unknown }> = [];
      let interruptCount = 0;
      const mismatch = new CodexErrors.CodexAppServerRequestError({
        code: -32600,
        errorMessage: `expected active turn id ${recoveredTurnId} but found ${staleTurnId}`,
      });
      const threadReadResponse = {
        thread: {
          id: "provider-thread-1",
          turns: [
            { id: "completed-turn", status: "completed", items: [] },
            { id: recoveredTurnId, status: "inProgress", items: [] },
          ],
        },
      } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/read"];
      const request = (<M extends "thread/read" | "turn/interrupt" | "turn/steer">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/read") {
          return Effect.succeed(threadReadResponse as CodexRpc.ClientRequestResponsesByMethod[M]);
        }
        interruptCount += 1;
        return interruptCount === 1
          ? Effect.fail(mismatch)
          : Effect.succeed(undefined as unknown as CodexRpc.ClientRequestResponsesByMethod[M]);
      }) as TurnControlRequest;

      yield* interruptCodexTurn(request, sessionRef, "provider-thread-1", staleTurnId);

      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["turn/interrupt", "thread/read", "turn/interrupt"],
      );
      NodeAssert.deepStrictEqual(calls.at(-1)?.payload, {
        threadId: "provider-thread-1",
        turnId: recoveredTurnId,
      });
      NodeAssert.equal((yield* Ref.get(sessionRef)).activeTurnId, recoveredTurnId);
    }),
  );

  it.effect("retries an interrupt only once and preserves the original mismatch error", () =>
    Effect.gen(function* () {
      const staleTurnId = TurnId.make("stale-turn");
      const recoveredTurnId = TurnId.make("recovered-turn");
      const sessionRef = yield* Ref.make(
        makeProviderSession({ status: "running", activeTurnId: staleTurnId }),
      );
      const calls: Array<string> = [];
      const originalMismatch = new CodexErrors.CodexAppServerRequestError({
        code: -32600,
        errorMessage: `expected active turn id ${recoveredTurnId} but found ${staleTurnId}`,
      });
      const retryFailure = new CodexErrors.CodexAppServerRequestError({
        code: -32603,
        errorMessage: "retry failed",
      });
      let interruptCount = 0;
      const request = (<M extends "thread/read" | "turn/interrupt" | "turn/steer">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push(method);
        if (method === "thread/read") {
          return Effect.succeed({
            thread: {
              turns: [{ id: recoveredTurnId, status: "inProgress", items: [] }],
            },
          } as unknown as CodexRpc.ClientRequestResponsesByMethod[M]);
        }
        interruptCount += 1;
        return Effect.fail(interruptCount === 1 ? originalMismatch : retryFailure);
      }) as TurnControlRequest;

      const error = yield* interruptCodexTurn(
        request,
        sessionRef,
        "provider-thread-1",
        staleTurnId,
      ).pipe(Effect.flip);

      NodeAssert.strictEqual(error, originalMismatch);
      NodeAssert.deepStrictEqual(calls, ["turn/interrupt", "thread/read", "turn/interrupt"]);
    }),
  );
});

describe("buildCodexDeveloperInstructions", () => {
  it("appends runtime info after the mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });

    NodeAssert.ok(instructions.startsWith(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS));
    NodeAssert.match(instructions, /aqqua/);
    NodeAssert.match(instructions, /Codex harness/);
    NodeAssert.match(instructions, /as gpt-5\.3-codex with high reasoning effort/);
  });

  it("includes runtime info alongside plan mode instructions", () => {
    const instructions = buildCodexDeveloperInstructions("plan", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    NodeAssert.ok(instructions.startsWith(CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS));
    NodeAssert.match(instructions, /as gpt-5\.3-codex with medium reasoning effort/);
  });

  it("varies with the model and effort of each turn", () => {
    const first = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
    const second = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    NodeAssert.notEqual(first, second);
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

describe("aqqua browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      NodeAssert.match(instructions, /aqqua/);
      NodeAssert.match(instructions, /preview_status/);
      NodeAssert.match(instructions, /preview_open/);
      NodeAssert.match(instructions, /Do not switch to global browser skills/);
    }
  });
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    NodeAssert.equal(hasConfiguredMcpServer(undefined), false);
    NodeAssert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.aqqua.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

describe("codexSessionAppServerArgs", () => {
  it("keeps the app-server subcommand when explicit args are provided", () => {
    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", "model=gpt-5"], undefined), [
      "app-server",
      "-c",
      "model=gpt-5",
    ]);
  });

  it("keeps launch args when explicit app-server args are provided", () => {
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(
        ["-c", "mcp_servers.aqqua.url=http://127.0.0.1/mcp"],
        "--strict-config --enable foo",
      ),
      [
        "app-server",
        "--strict-config",
        "--enable",
        "foo",
        "-c",
        "mcp_servers.aqqua.url=http://127.0.0.1/mcp",
      ],
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it.effect("falls back to thread/start when resume fails recoverably", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const started = makeThreadOpenResponse("fresh-thread");
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          calls.push({ method, payload });
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          }
          return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      NodeAssert.equal(opened.thread.id, "fresh-thread");
      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
    }),
  );

  it.effect("propagates non-recoverable resume failures", () =>
    Effect.gen(function* () {
      const client = {
        request: <M extends "thread/start" | "thread/resume">(
          method: M,
          _payload: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          if (method === "thread/resume") {
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "timed out waiting for server",
              }),
            );
          }
          return Effect.succeed(
            makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
          );
        },
      };

      const error = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }).pipe(Effect.flip);

      NodeAssert.ok(isCodexAppServerRequestError(error));
      NodeAssert.equal(error.errorMessage, "timed out waiting for server");
    }),
  );
});

describe("Codex native provider-subagent targeting", () => {
  it("prefers name, then nickname, then role for child titles", () => {
    NodeAssert.equal(
      codexNativeChildTitle({
        name: "Explorer",
        agentNickname: "nick",
        agentRole: "worker",
      }),
      "Explorer",
    );
    NodeAssert.equal(
      codexNativeChildTitle({
        name: "  ",
        agentNickname: "nick",
        agentRole: "worker",
      }),
      "nick",
    );
    NodeAssert.equal(
      codexNativeChildTitle({
        agentRole: "researcher",
      }),
      "researcher",
    );
    NodeAssert.equal(codexNativeChildTitle({}), undefined);
  });

  it("leaves root provider-thread events untargeted", () => {
    const children = new Map<string, CodexNativeChildMeta>();
    const target = resolveCodexProviderSubagentTarget({
      providerThreadId: "root-thread",
      rootProviderThreadId: "root-thread",
      nativeChildren: children,
    });
    NodeAssert.equal(target, undefined);
  });

  it("targets child thread/started with lineage and title", () => {
    const children = new Map<string, CodexNativeChildMeta>();
    rememberCodexNativeChildrenFromNotification(
      children,
      {
        method: "thread/started",
        params: {
          thread: {
            id: "child-thread-1",
            parentThreadId: "root-thread",
            name: "Explore codebase",
            agentNickname: "scout",
            agentRole: "worker",
          },
        },
      } as never,
      "root-thread",
    );

    const target = resolveCodexProviderSubagentTarget({
      providerThreadId: "child-thread-1",
      rootProviderThreadId: "root-thread",
      nativeChildren: children,
    });
    NodeAssert.deepStrictEqual(target, {
      childId: "child-thread-1",
      title: "Explore codebase",
    });
  });

  it("sets parentChildId only when the native parent is itself a child", () => {
    const children = new Map<string, CodexNativeChildMeta>();
    rememberCodexNativeChildrenFromNotification(
      children,
      {
        method: "thread/started",
        params: {
          thread: {
            id: "nested-child",
            parentThreadId: "parent-child",
            name: "Nested",
          },
        },
      } as never,
      "root-thread",
    );

    const target = resolveCodexProviderSubagentTarget({
      providerThreadId: "nested-child",
      rootProviderThreadId: "root-thread",
      nativeChildren: children,
    });
    NodeAssert.deepStrictEqual(target, {
      childId: "nested-child",
      parentChildId: "parent-child",
      title: "Nested",
    });
  });

  it("establishes child identity from collabAgentToolCall receivers before thread/started", () => {
    const children = new Map<string, CodexNativeChildMeta>();
    rememberCodexNativeChildrenFromNotification(
      children,
      {
        method: "item/started",
        params: {
          threadId: "root-thread",
          turnId: "parent-turn",
          item: {
            type: "collabAgentToolCall",
            id: "collab-1",
            tool: "spawnAgent",
            status: "inProgress",
            senderThreadId: "root-thread",
            receiverThreadIds: ["receiver-1", "receiver-2"],
            agentsStates: {},
          },
        },
      } as never,
      "root-thread",
    );

    // Parent collab row stays root-scoped.
    NodeAssert.equal(
      resolveCodexProviderSubagentTarget({
        providerThreadId: "root-thread",
        rootProviderThreadId: "root-thread",
        nativeChildren: children,
      }),
      undefined,
    );

    NodeAssert.deepStrictEqual(
      resolveCodexProviderSubagentTarget({
        providerThreadId: "receiver-1",
        rootProviderThreadId: "root-thread",
        nativeChildren: children,
      }),
      { childId: "receiver-1" },
    );

    // Later thread/started enriches title without changing child id.
    rememberCodexNativeChildrenFromNotification(
      children,
      {
        method: "thread/started",
        params: {
          thread: {
            id: "receiver-1",
            parentThreadId: "root-thread",
            agentNickname: "helper",
          },
        },
      } as never,
      "root-thread",
    );
    NodeAssert.deepStrictEqual(
      resolveCodexProviderSubagentTarget({
        providerThreadId: "receiver-1",
        rootProviderThreadId: "root-thread",
        nativeChildren: children,
      }),
      { childId: "receiver-1", title: "helper" },
    );
  });

  it("preserves child identity and title for approval routing", () => {
    const children = new Map<string, CodexNativeChildMeta>();
    rememberCodexNativeChild(children, {
      childId: "child-thread-1",
      title: "Worker",
    });

    const target = resolveCodexProviderSubagentTarget({
      providerThreadId: "child-thread-1",
      rootProviderThreadId: "root-thread",
      nativeChildren: children,
    });
    NodeAssert.deepStrictEqual(target, {
      childId: "child-thread-1",
      title: "Worker",
    });
  });
});
