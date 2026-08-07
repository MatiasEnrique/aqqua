import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  type ClientOrchestrationCommand,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@aqqua/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { canonicalizeClientCommandTimestamps, normalizeDispatchCommand } from "./Normalizer.ts";

const clientCreatedAt = "2031-01-01T00:00:00.000Z";
const serverReceivedAt = "2026-07-18T00:00:00.000Z";
const normalizerTestLayer = Layer.mergeAll(
  ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "aqqua-normalizer-test-" }),
  WorkspacePaths.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

describe("canonicalizeClientCommandTimestamps", () => {
  it("replaces a client command timestamp with the server receipt timestamp", () => {
    const command: ClientOrchestrationCommand = {
      type: "project.create",
      commandId: CommandId.make("command-1"),
      projectId: ProjectId.make("project-1"),
      title: "Clock-safe project",
      workspaceRoot: "/tmp/clock-safe-project",
      createdAt: clientCreatedAt,
    };

    expect(canonicalizeClientCommandTimestamps(command, serverReceivedAt)).toEqual({
      ...command,
      createdAt: serverReceivedAt,
    });
  });

  it("replaces both timestamps when the first turn bootstraps a thread", () => {
    const command: ClientOrchestrationCommand = {
      type: "thread.turn.start",
      commandId: CommandId.make("command-2"),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Start a thread",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: ProjectId.make("project-1"),
          title: "Clock-safe thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: clientCreatedAt,
        },
      },
      createdAt: clientCreatedAt,
    };

    const result = canonicalizeClientCommandTimestamps(command, serverReceivedAt);

    expect(result.type).toBe("thread.turn.start");
    if (result.type !== "thread.turn.start") {
      throw new Error("Expected a thread.turn.start command");
    }
    expect(result.createdAt).toBe(serverReceivedAt);
    expect(result.bootstrap?.createThread?.createdAt).toBe(serverReceivedAt);
  });

  it.effect("normalizes uploaded attachments included in an atomic queued-message submit", () =>
    Effect.gen(function* () {
      const command: ClientOrchestrationCommand = {
        type: "thread.message.submit",
        commandId: CommandId.make("command-submit-queue"),
        threadId: ThreadId.make("thread-1"),
        messageIds: [MessageId.make("message-1")],
        messages: [
          {
            enqueueCommandId: CommandId.make("enqueue-message-1"),
            messageId: MessageId.make("message-1"),
            text: "Inspect this image",
            attachments: [
              {
                type: "image",
                name: "screen.png",
                mimeType: "image/png",
                sizeBytes: 1,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: clientCreatedAt,
          },
        ],
        createdAt: clientCreatedAt,
      };

      const result = yield* normalizeDispatchCommand(command);
      expect(result.type).toBe("thread.message.submit");
      if (result.type !== "thread.message.submit") {
        throw new Error("Expected a thread.message.submit command");
      }
      const attachment = result.messages?.[0]?.attachments[0];
      expect(attachment).toMatchObject({
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 1,
      });
      expect(attachment).not.toHaveProperty("dataUrl");
      expect(result.messages?.[0]?.createdAt).not.toBe(clientCreatedAt);

      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      expect(
        yield* fileSystem.exists(path.join(config.attachmentsDir, `${attachment?.id}.png`)),
      ).toBe(true);
    }).pipe(Effect.provide(normalizerTestLayer)),
  );
});
