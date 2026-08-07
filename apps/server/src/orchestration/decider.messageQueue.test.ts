import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@aqqua/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-06T18:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-message-queue");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
};

function makeReadModel(input?: {
  readonly status?: "ready" | "running" | "stopped";
  readonly queuedMessages?: ReadonlyArray<{
    readonly messageId: MessageId;
    readonly text: string;
    readonly createdAt: string;
  }>;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: NOW,
    projects: [
      {
        id: ProjectId.make("project-message-queue"),
        title: "Queue",
        workspaceRoot: "/tmp/message-queue",
        defaultModelSelection: MODEL_SELECTION,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-message-queue"),
        title: "Queue",
        modelSelection: MODEL_SELECTION,
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        queuedMessages: (input?.queuedMessages ?? []).map((message) => ({
          ...message,
          attachments: [],
          modelSelection: MODEL_SELECTION,
          runtimeMode: "full-access" as const,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        })),
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: input?.status ?? "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: input?.status === "ready" ? null : null,
          lastError: null,
          updatedAt: NOW,
        },
      },
    ],
    boards: [],
    cards: [],
  } as unknown as OrchestrationReadModel;
}

function enqueueCommand(messageId: MessageId): OrchestrationCommand {
  return {
    type: "thread.message.enqueue",
    commandId: CommandId.make(`enqueue-${messageId}`),
    threadId: THREAD_ID,
    message: {
      messageId,
      role: "user",
      text: `queued ${messageId}`,
      attachments: [],
    },
    modelSelection: MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    createdAt: NOW,
  } as unknown as OrchestrationCommand;
}

function submitQueuedMessagesCommand(
  messageIds: ReadonlyArray<MessageId>,
  messages: ReadonlyArray<{
    readonly messageId: MessageId;
    readonly text: string;
    readonly createdAt: string;
  }> = [],
): OrchestrationCommand {
  return {
    type: "thread.message.submit",
    commandId: CommandId.make("submit-queued-messages"),
    threadId: THREAD_ID,
    messageIds,
    messages: messages.map((message) => ({
      ...message,
      enqueueCommandId: CommandId.make(`enqueue-${message.messageId}`),
      attachments: [],
      modelSelection: MODEL_SELECTION,
      runtimeMode: "full-access" as const,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    })),
    createdAt: NOW,
  } as unknown as OrchestrationCommand;
}

it.layer(NodeServices.layer)("message queue decider", (it) => {
  it.effect("queues a message without steering the running turn", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("queued-message-1");
      const result = yield* decideOrchestrationCommand({
        command: enqueueCommand(messageId),
        readModel: makeReadModel({ status: "running" }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.message-enqueued"]);
      expect(events[0]?.payload).toMatchObject({
        threadId: THREAD_ID,
        message: {
          messageId,
          text: "queued queued-message-1",
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        },
      });
    }),
  );

  it.effect("submits the first queued message atomically when the running turn ends", () =>
    Effect.gen(function* () {
      const firstMessageId = MessageId.make("queued-message-1");
      const secondMessageId = MessageId.make("queued-message-2");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("session-ready"),
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
          createdAt: NOW,
        },
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [
            { messageId: firstMessageId, text: "first", createdAt: NOW },
            {
              messageId: secondMessageId,
              text: "second",
              createdAt: "2026-08-06T18:00:01.000Z",
            },
          ],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.message-dequeued",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events[1]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId: firstMessageId,
        reason: "submitted",
      });
      expect(events[2]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId: firstMessageId,
        text: "first",
      });
      expect(events[3]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId: firstMessageId,
      });
    }),
  );

  it.effect("removes a queued message without submitting it", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("queued-message-1");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.message.dequeue",
          commandId: CommandId.make("dequeue-message"),
          threadId: THREAD_ID,
          messageId,
          createdAt: NOW,
        } as unknown as OrchestrationCommand,
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [{ messageId, text: "first", createdAt: NOW }],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.message-dequeued"]);
      expect(events[0]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId,
        reason: "user",
      });
    }),
  );

  it.effect("steers the running turn with one selected queued message", () =>
    Effect.gen(function* () {
      const firstMessageId = MessageId.make("queued-message-1");
      const secondMessageId = MessageId.make("queued-message-2");
      const result = yield* decideOrchestrationCommand({
        command: submitQueuedMessagesCommand([secondMessageId]),
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [
            { messageId: firstMessageId, text: "first", createdAt: NOW },
            {
              messageId: secondMessageId,
              text: "second",
              createdAt: "2026-08-06T18:00:01.000Z",
            },
          ],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.message-dequeued",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events[0]?.payload).toMatchObject({
        messageId: secondMessageId,
        reason: "submitted",
      });
      expect(events[1]?.payload).toMatchObject({ messageId: secondMessageId, text: "second" });
    }),
  );

  it.effect("submits the whole queue as one newline-joined message", () =>
    Effect.gen(function* () {
      const firstMessageId = MessageId.make("queued-message-1");
      const secondMessageId = MessageId.make("queued-message-2");
      const result = yield* decideOrchestrationCommand({
        command: submitQueuedMessagesCommand([firstMessageId, secondMessageId]),
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [
            { messageId: firstMessageId, text: "first", createdAt: NOW },
            {
              messageId: secondMessageId,
              text: "second",
              createdAt: "2026-08-06T18:00:01.000Z",
            },
          ],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.message-dequeued",
        "thread.message-dequeued",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events.slice(0, 2).map((event) => event.payload)).toMatchObject([
        { messageId: firstMessageId, reason: "submitted" },
        { messageId: secondMessageId, reason: "submitted" },
      ]);
      expect(events[2]?.payload).toMatchObject({
        messageId: firstMessageId,
        text: "first\nsecond",
      });
    }),
  );

  it.effect("atomically includes a mobile-local queued message in send all", () =>
    Effect.gen(function* () {
      const serverMessageId = MessageId.make("queued-on-server");
      const localMessageId = MessageId.make("queued-on-mobile");
      const result = yield* decideOrchestrationCommand({
        command: submitQueuedMessagesCommand(
          [serverMessageId, localMessageId],
          [
            {
              messageId: localMessageId,
              text: "local second",
              createdAt: "2026-08-06T18:00:01.000Z",
            },
          ],
        ),
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [{ messageId: serverMessageId, text: "server first", createdAt: NOW }],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.message-dequeued",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events[1]?.payload).toMatchObject({
        messageId: serverMessageId,
        text: "server first\nlocal second",
      });
    }),
  );

  it.effect("rejects removing a message that is not queued on the thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.message.dequeue",
          commandId: CommandId.make("dequeue-wrong-thread-message"),
          threadId: THREAD_ID,
          messageId: MessageId.make("queued-on-another-thread"),
          createdAt: NOW,
        } as unknown as OrchestrationCommand,
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [
            { messageId: MessageId.make("queued-here"), text: "first", createdAt: NOW },
          ],
        }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("does not promote queued work during pre-subscription orphan reconciliation", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("queued-across-restart");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("session-stopped-before-subscription"),
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status: "stopped",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: "Server restarted",
            updatedAt: NOW,
          },
          promoteQueuedMessage: false,
          createdAt: NOW,
        },
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [{ messageId, text: "continue after restart", createdAt: NOW }],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.session-set"]);
    }),
  );

  it.effect("appends behind an existing queue even when the session is ready", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: enqueueCommand(MessageId.make("queued-message-2")),
        readModel: makeReadModel({
          status: "ready",
          queuedMessages: [
            {
              messageId: MessageId.make("queued-message-1"),
              text: "first",
              createdAt: NOW,
            },
          ],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.message-enqueued"]);
    }),
  );

  it.effect("submits the first queued message after the running turn is stopped", () =>
    Effect.gen(function* () {
      const messageId = MessageId.make("queued-message-after-stop");
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("session-stopped"),
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status: "stopped",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
          createdAt: NOW,
        },
        readModel: makeReadModel({
          status: "running",
          queuedMessages: [{ messageId, text: "continue after stop", createdAt: NOW }],
        }),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.session-set",
        "thread.message-dequeued",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
    }),
  );
});
