// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

describe("AcpSessionRuntime", () => {
  it.live("queues AssistantItemCompleted for the open segment when the prompt is interrupted", () =>
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime.make({
        spawn: {
          command: process.execPath,
          args: [mockAgentPath],
          // The mock streams an assistant chunk and then hangs the prompt, so
          // the assistant segment is still open when the prompt is interrupted
          // (the shape of the xAI prompt-completion fallback race).
          env: { AQQUA_ACP_EMIT_XAI_PROMPT_COMPLETE_THEN_HANG: "1" },
        },
        cwd: process.cwd(),
        clientInfo: { name: "aqqua-test", version: "0.0.0" },
        authMethodId: "test",
      });
      yield* runtime.start();

      const seen: Array<AcpSessionRuntime.AcpSessionRuntimeEvent> = [];
      yield* runtime.getEvents().pipe(
        Stream.runForEach((event) => Effect.sync(() => seen.push(event))),
        Effect.forkChild,
      );
      const awaitEventTag = (tag: AcpSessionRuntime.AcpSessionRuntimeEvent["_tag"]) =>
        Effect.gen(function* () {
          while (!seen.some((event) => event._tag === tag)) {
            yield* Effect.sleep("10 millis");
          }
        }).pipe(Effect.timeout("10 seconds"));

      const promptFiber = yield* runtime
        .prompt({ prompt: [{ type: "text", text: "hi" }] })
        .pipe(Effect.forkChild);
      yield* awaitEventTag("AssistantItemStarted");

      yield* Fiber.interrupt(promptFiber);

      yield* awaitEventTag("AssistantItemCompleted");
      const started = seen.find(
        (
          event,
        ): event is Extract<
          AcpSessionRuntime.AcpSessionRuntimeEvent,
          { _tag: "AssistantItemStarted" }
        > => event._tag === "AssistantItemStarted",
      );
      const completed = seen.filter(
        (
          event,
        ): event is Extract<
          AcpSessionRuntime.AcpSessionRuntimeEvent,
          { _tag: "AssistantItemCompleted" }
        > => event._tag === "AssistantItemCompleted",
      );
      expect(started).toBeDefined();
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ itemId: started?.itemId });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
